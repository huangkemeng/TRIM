import { DeepSeekClient } from '../api/DeepSeekClient';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolResult } from '../tools/ToolInterface';
import { AgentContext, Message } from './AgentContext';
import { MessageManager } from './MessageManager';

export interface AgentConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  workspaceRoot: string;
}

export interface AgentCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: ToolResult) => void;
  onStatus?: (status: string) => void;
  onComplete?: (summary: string) => void;
  onError?: (error: string) => void;
  onUsage?: (tokensUsed: number) => void;
}

interface ToolCallRecord {
  toolName: string;
  argsKey: string;
  timestamp: number;
}

export class Agent {
  private config: AgentConfig;
  private toolRegistry: ToolRegistry;
  private deepseekClient: DeepSeekClient;
  private context: AgentContext;
  private messageManager: MessageManager;
  private callbacks: AgentCallbacks;
  private cancelled: boolean = false;

  // Loop detection
  private recentToolCalls: ToolCallRecord[] = [];
  private static readonly MAX_REPEATED_CALLS = 5;
  private static readonly REPEAT_WINDOW_MS = 60000; // 1 minute

  constructor(
    config: AgentConfig,
    toolRegistry: ToolRegistry,
    deepseekClient: DeepSeekClient,
    callbacks: AgentCallbacks = {}
  ) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.deepseekClient = deepseekClient;
    this.context = new AgentContext(config.maxTokens);
    this.messageManager = new MessageManager(config.maxTokens);
    this.callbacks = callbacks;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Check if the agent is stuck in a loop by detecting repeated tool calls.
   * Returns true if a loop is detected.
   */
  private detectLoop(toolName: string, args: Record<string, unknown>): boolean {
    const argsKey = JSON.stringify(args);
    const now = Date.now();

    // Add current call
    this.recentToolCalls.push({ toolName, argsKey, timestamp: now });

    // Prune old entries outside the window
    this.recentToolCalls = this.recentToolCalls.filter(
      r => now - r.timestamp < Agent.REPEAT_WINDOW_MS
    );

    // Count repeats of this exact tool + args
    const repeatCount = this.recentToolCalls.filter(
      r => r.toolName === toolName && r.argsKey === argsKey
    ).length;

    return repeatCount >= Agent.MAX_REPEATED_CALLS;
  }

  async run(task: string): Promise<void> {
    this.cancelled = false;
    this.context.clear();
    this.recentToolCalls = [];

    // Add system prompt
    const systemPrompt = this.messageManager.buildSystemPrompt(
      this.config.workspaceRoot
    );
    this.context.addMessage({
      role: 'system',
      content: systemPrompt,
      timestamp: Date.now(),
    });

    // Add user task
    this.context.addUserMessage(task);
    this.callbacks.onStatus?.('Starting task...');

    let iterations = 0;
    let consecutiveEmptyResponses = 0;
    let totalTokensUsed = 0;
    const MAX_EMPTY_RESPONSES = 3;

    while (iterations < this.config.maxIterations && !this.cancelled) {
      iterations++;
      this.callbacks.onStatus?.(
        `Iteration ${iterations}/${this.config.maxIterations}`
      );

      try {
        // Build messages and ensure context fits
        let messages = this.context.getMessages();
        messages = this.messageManager.ensureContextFit(messages);
        const chatMessages = messages.map(m => ({
          role: m.role,
          content: m.content,
          tool_call_id: m.tool_call_id,
          tool_calls: m.tool_calls,
        }));

        // Get tool schemas
        const toolSchemas = this.toolRegistry.getOpenAIToolSchemas();

        // Call LLM with retry built into DeepSeekClient
        this.callbacks.onStatus?.(`Calling ${this.config.model}...`);
        const response = await this.deepseekClient.chatStream(chatMessages, {
          tools: toolSchemas,
          onToken: token => this.callbacks.onToken?.(token),
        });

        // Track token usage (rough estimate: content length / 4)
        if (response.content) {
          totalTokensUsed += Math.ceil(response.content.length / 4);
        }
        if (response.toolCalls) {
          for (const tc of response.toolCalls) {
            totalTokensUsed += Math.ceil(tc.function.arguments.length / 4);
          }
        }
        this.callbacks.onUsage?.(totalTokensUsed);

        // Check for empty responses (no content and no tool calls)
        if (!response.content && (!response.toolCalls || response.toolCalls.length === 0)) {
          consecutiveEmptyResponses++;
          this.callbacks.onStatus?.(
            `Empty response (${consecutiveEmptyResponses}/${MAX_EMPTY_RESPONSES})`
          );

          if (consecutiveEmptyResponses >= MAX_EMPTY_RESPONSES) {
            this.callbacks.onError?.(
              'Agent returned empty responses multiple times. Stopping.'
            );
            this.callbacks.onComplete?.(
              'Task stopped: agent returned empty responses.'
            );
            return;
          }
          continue;
        }
        consecutiveEmptyResponses = 0;

        // Check if there are tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Add assistant message with tool calls to context
          this.context.addAssistantMessage(
            response.content,
            response.toolCalls.map(tc => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            }))
          );

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
            if (this.cancelled) break;

            let args: Record<string, unknown>;
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              args = {};
            }

            const toolName = toolCall.function.name;
            this.callbacks.onToolCall?.(toolName, args);
            this.callbacks.onStatus?.(`Executing ${toolName}...`);

            // Loop detection
            if (this.detectLoop(toolName, args)) {
              const loopMsg = `Loop detected: "${toolName}" called with same arguments ${Agent.MAX_REPEATED_CALLS} times in ${Agent.REPEAT_WINDOW_MS / 1000}s. Stopping.`;
              this.callbacks.onError?.(loopMsg);
              this.context.addToolResult(toolName, {
                success: false,
                data: '',
                error: loopMsg,
              });
              this.callbacks.onComplete?.(loopMsg);
              return;
            }

            // Check if this is task_complete
            if (toolName === 'task_complete') {
              const summary = (args.summary as string) || 'Task completed';
              this.callbacks.onToolResult?.(toolName, {
                success: true,
                data: summary,
              });
              this.callbacks.onComplete?.(summary);
              return;
            }

            // Execute the tool
            try {
              const tool = this.toolRegistry.get(toolName);
              const result = await tool.execute(args);
              this.context.addToolResult(toolName, result);
              this.callbacks.onToolResult?.(toolName, result);
            } catch (error: any) {
              const errorResult: ToolResult = {
                success: false,
                data: '',
                error: `Tool execution error: ${error?.message || error}`,
              };
              this.context.addToolResult(toolName, errorResult);
              this.callbacks.onToolResult?.(toolName, errorResult);
            }
          }
        } else {
          // No tool calls - just text response
          this.context.addAssistantMessage(response.content);
          this.callbacks.onStatus?.('Agent is thinking...');
        }
      } catch (error: any) {
        const errorMessage = error?.message || String(error);

        // If cancelled, exit silently (no retry, no error reporting)
        if (this.cancelled) {
          return;
        }

        // Check if it's a non-retryable error (auth, invalid request)
        if (
          error?.status === 401 ||
          error?.status === 403 ||
          error?.status === 400
        ) {
          this.callbacks.onError?.(`Fatal API error: ${errorMessage}`);
          this.callbacks.onComplete?.(`Task failed: ${errorMessage}`);
          return;
        }

        this.callbacks.onError?.(errorMessage);
        this.callbacks.onStatus?.(`Error: ${errorMessage}. Retrying...`);

        // Add error message to context so agent can self-correct
        this.context.addAssistantMessage('');
        this.context.addToolResult('_error', {
          success: false,
          data: '',
          error: errorMessage,
        });
      }
    }

    // Reached max iterations or cancelled
    if (this.cancelled) {
      this.callbacks.onStatus?.('Task cancelled by user.');
    } else {
      this.callbacks.onStatus?.(
        `Reached max iterations (${this.config.maxIterations}).`
      );
      this.callbacks.onComplete?.(
        `Task stopped after ${this.config.maxIterations} iterations.`
      );
    }
  }
}

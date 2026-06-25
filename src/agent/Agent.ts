import { DeepSeekClient } from '../api/DeepSeekClient';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolResult } from '../tools/ToolInterface';
import { PlanTool } from '../tools/PlanTool';
import { AgentContext } from './AgentContext';
import { MessageManager } from './MessageManager';

export interface AgentConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  workspaceRoot: string;
  maxTurns?: number;
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

interface ToolResultRecord {
  success: boolean;
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
  private abortController: AbortController | null = null;
  private initialized: boolean = false;
  private turnCount: number = 0;

  // Loop detection
  private recentToolCalls: ToolCallRecord[] = [];
  private toolResults: ToolResultRecord[] = [];
  private consecutiveApiErrors = 0;
  private planTool: PlanTool | null = null;
  private static readonly MAX_REPEATED_CALLS = 5;
  private static readonly REPEAT_WINDOW_MS = 60000; // 1 minute
  private static readonly MAX_CONSECUTIVE_API_ERRORS = 3;
  private static readonly TOOL_FAILURE_WINDOW = 10;
  private static readonly TOOL_FAILURE_THRESHOLD = 0.7;
  private static readonly MAX_ALTERNATING_CYCLES = 4; // 4 repeats of a 2-tool pattern = 8 calls
  private static readonly NON_PATTERN_TOOLS = new Set(['plan']); // Tools excluded from alternating pattern detection

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
    this.messageManager = new MessageManager();
    this.callbacks = callbacks;
    this.turnCount = 0;
    // Extract PlanTool reference if registered
    try {
      const planTool = toolRegistry.get('plan');
      if (planTool instanceof PlanTool) {
        this.planTool = planTool;
      }
    } catch {
      // PlanTool not registered — that's okay
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }

  /**
   * Check if the agent is stuck in a loop by detecting:
   * 1. Repeated tool calls with same name+args (exact repeat)
   * 2. Alternating tool call patterns (e.g., A→B→A→B→A→B)
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

    // Check 1: Exact repeat detection (same tool + same args)
    const repeatCount = this.recentToolCalls.filter(
      r => r.toolName === toolName && r.argsKey === argsKey
    ).length;

    if (repeatCount >= Agent.MAX_REPEATED_CALLS) {
      return true;
    }

    // Check 2: Alternating pattern detection (e.g., A→B→A→B→A→B)
    // Only check if we have enough recent calls
    if (this.recentToolCalls.length >= 6) {
      // Get the last N tool names, excluding non-pattern tools (like 'plan'
      // which is called frequently as a progress tracker and would cause false positives)
      const recentNames = this.recentToolCalls
        .map(r => r.toolName)
        .filter(name => !Agent.NON_PATTERN_TOOLS.has(name));

      // Need at least 6 filtered calls to detect a pattern
      if (recentNames.length >= 6) {
        // Look for a 2-tool alternating pattern in the last 6+ calls
        for (let patternLen = 2; patternLen <= 3; patternLen++) {
          const lastN = recentNames.slice(-patternLen * 3); // Need at least 3 cycles
          if (lastN.length < patternLen * 3) continue;

          // Check if the pattern repeats
          const pattern = lastN.slice(0, patternLen);
          let isAlternating = true;
          for (let i = 0; i < lastN.length; i++) {
            if (lastN[i] !== pattern[i % patternLen]) {
              isAlternating = false;
              break;
            }
          }

          if (isAlternating) {
            // Found a repeating pattern — check how many times it's cycled
            const cycles = Math.floor(lastN.length / patternLen);
            if (cycles >= Agent.MAX_ALTERNATING_CYCLES / patternLen) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  async run(task: string): Promise<void> {
    this.cancelled = false;

    if (!this.initialized) {
      // === FIRST RUN: initialize everything ===
      this.context.clear();
      this.recentToolCalls = [];
      this.toolResults = [];
      this.consecutiveApiErrors = 0;
      this.planTool?.reset();
      this.initialized = true;
      this.turnCount = 0;

      // Add system prompt
      const systemPrompt = this.messageManager.buildSystemPrompt(
        this.config.workspaceRoot
      );
      this.context.addMessage({
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      });
    } else {
      // === SUBSEQUENT RUN: reset per-turn safety state only ===
      this.recentToolCalls = [];
      this.toolResults = [];
      this.consecutiveApiErrors = 0;
    }

    this.abortController = new AbortController();
    const abortSignal = this.abortController.signal;

    // Add user message (always)
    this.context.addUserMessage(task);
    this.callbacks.onStatus?.('Starting task...');

    let consecutiveEmptyResponses = 0;
    let totalTokensUsed = 0;
    const MAX_EMPTY_RESPONSES = 3;

    // No iteration limit — loop until task_complete or a safety guard triggers
    while (!this.cancelled) {
      this.turnCount++;
      if (this.config.maxTurns && this.turnCount > this.config.maxTurns) {
        const msg = `Max turns (${this.config.maxTurns}) exceeded. Stopping.`;
        this.callbacks.onError?.(msg);
        this.callbacks.onComplete?.(msg);
        return;
      }
      try {
        // Build messages — no context trimming; full history preserved
        const messages = this.context.getMessages();
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
          signal: abortSignal,
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
              this.context.addToolResult(toolCall.id, {
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

              // Check if there are incomplete plan steps
              const planStatus = this.planTool?.getStatus();
              if (planStatus && planStatus.incomplete.length > 0) {
                const errorMsg =
                  `Cannot complete task: the plan still has incomplete steps (${planStatus.incomplete.length}/${planStatus.total}): ${planStatus.incomplete.join(', ')}. ` +
                  `Please complete all steps first or update the plan.`;
                this.context.addToolResult(toolCall.id, {
                  success: false,
                  data: '',
                  error: errorMsg,
                });
                this.callbacks.onToolResult?.(toolName, {
                  success: false,
                  data: '',
                  error: errorMsg,
                });
                // Don't return — let the AI continue working on remaining steps
                continue;
              }

              // Add tool result to context so the AI sees completion confirmed
              this.context.addToolResult(toolCall.id, {
                success: true,
                data: `Task completed: ${summary}`,
              });

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
              this.context.addToolResult(toolCall.id, result);
              this.callbacks.onToolResult?.(toolName, result);
              this.toolResults.push({ success: result.success, timestamp: Date.now() });
            } catch (error: any) {
              const errorResult: ToolResult = {
                success: false,
                data: '',
                error: `Tool execution error: ${error?.message || error}`,
              };
              this.context.addToolResult(toolCall.id, errorResult);
              this.callbacks.onToolResult?.(toolName, errorResult);
              this.toolResults.push({ success: false, timestamp: Date.now() });
            }
          }

          // If cancelled mid-batch, add dummy results for remaining tool calls
          // to satisfy the API requirement that every tool_call_id has a response
          if (this.cancelled && response.toolCalls) {
            for (const tc of response.toolCalls) {
              // Only add if not already responded to
              const lastMsg = this.context.getMessages()[this.context.length - 1];
              if (lastMsg?.role === 'assistant' && lastMsg?.tool_call_id !== tc.id) {
                this.context.addToolResult(tc.id, {
                  success: false,
                  data: '',
                  error: 'Cancelled by user',
                });
              }
            }
          }

          // Check tool failure rate: if > 70% of recent tool calls failed, stop
          const now = Date.now();
          this.toolResults = this.toolResults.filter(r => now - r.timestamp < 120000);
          if (this.toolResults.length >= Agent.TOOL_FAILURE_WINDOW) {
            const failures = this.toolResults.filter(r => !r.success).length;
            const rate = failures / this.toolResults.length;
            if (rate >= Agent.TOOL_FAILURE_THRESHOLD) {
              const msg = `Tool failure rate too high: ${Math.round(rate * 100)}% (${failures}/${this.toolResults.length} failed). Stopping.`;
              this.callbacks.onError?.(msg);
              this.callbacks.onComplete?.(msg);
              return;
            }
          }

        } else {
          // No tool calls - just text response
          this.context.addAssistantMessage(response.content);
          this.callbacks.onStatus?.('Agent is thinking...');
        }
      } catch (error: any) {
        const errorMessage = error?.message || String(error);

        // If cancelled or aborted, exit silently
        if (this.cancelled || error?.name === 'AbortError') {
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

        // Track consecutive API errors. If too many, stop.
        this.consecutiveApiErrors++;
        if (this.consecutiveApiErrors >= Agent.MAX_CONSECUTIVE_API_ERRORS) {
          this.callbacks.onError?.(`Too many consecutive API errors (${this.consecutiveApiErrors}). Stopping.`);
          this.callbacks.onComplete?.(`Task failed after ${this.consecutiveApiErrors} consecutive API errors.`);
          return;
        }

        // Add error context so agent can self-correct on next iteration
        this.context.addAssistantMessage(`[System error occurred: ${errorMessage}]`);
      }
    }

    // Only reached if cancelled
    this.callbacks.onStatus?.('Task cancelled by user.');
  }
}

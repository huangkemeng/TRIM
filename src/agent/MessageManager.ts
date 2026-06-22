import { Message } from './AgentContext';

/**
 * Rough token estimation: ~4 characters per token for code/English text.
 * For more accuracy, use tiktoken or the model's tokenizer.
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export class MessageManager {
  private maxTokens: number;

  constructor(maxTokens: number = 128000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Build the system prompt for the agent.
   */
  buildSystemPrompt(workspaceRoot: string): string {
    return `You are an autonomous AI coding agent. Your goal is to complete the user's task by:

1. **Exploring** the codebase to understand the existing code
2. **Planning** your approach before writing code
3. **Writing/modifying** files using the tools available
4. **Running** commands to build, test, and verify your changes
5. **Iterating** based on errors and test results
6. **Completing** the task and calling task_complete when done

## Guidelines
- Be thorough and careful. Read files before modifying them.
- When you encounter errors, read the error output carefully and fix the root cause.
- Prefer surgical edits (edit_file) over full rewrites (write_file) for small changes.
- Run tests after making changes to verify they work.
- If you're stuck or need clarification, use the ask_user tool.
- When the task is complete, call task_complete with a summary.

## Working Directory
The workspace is at: ${workspaceRoot}

Use absolute paths when working with files.`;
  }

  /**
   * Estimate total tokens for a list of messages.
   */
  estimateTokenCount(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += estimateTokenCount(msg.content);
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += estimateTokenCount(tc.function.name + tc.function.arguments);
        }
      }
    }
    return total;
  }

  /**
   * Ensure messages fit within the token budget.
   * Strategy: Remove oldest non-system messages when over budget.
   */
  ensureContextFit(messages: Message[]): Message[] {
    const totalTokens = this.estimateTokenCount(messages);
    const threshold = this.maxTokens * 0.85; // Trigger at 85%

    if (totalTokens < threshold) {
      return messages; // No truncation needed
    }

    // Separate system messages from conversation
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Keep last N conversation messages (preserve most recent context)
    const keepCount = Math.max(30, Math.floor(conversationMessages.length * 0.4));
    const kept = conversationMessages.slice(-keepCount);

    const result = [...systemMessages, ...kept];

    console.log(
      `[MessageManager] Truncated from ${messages.length} to ${result.length} messages ` +
      `(estimated tokens: ~${totalTokens} -> ~${this.estimateTokenCount(result)})`
    );

    return result;
  }
}

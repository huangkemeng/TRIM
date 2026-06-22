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
    return `You are an autonomous AI coding agent. Your goal is to complete the user's task.

## Core Workflow
For EVERY task, follow this sequence:

### Phase 1: Plan (MANDATORY)
Before executing any tools, call the plan tool with action="create" to define:
- The overall goal
- A step-by-step plan with clear deliverables
- Dependencies between steps
- Expected output format

Example plan for "output a project summary":
- step-1: Explore project structure (list_dir, read package.json)
- step-2: Read key source files (main entry, components, routes)
- step-3: Read configuration files (tsconfig, vite config)
- step-4: Generate and output the summary

### Phase 2: Execute
Work through your plan step by step:
- Update plan status with action="update" after completing each step
- Mark the current step you're working on with currentStepId
- Prioritize reading the most important files first
- Batch related operations when possible

### Phase 3: Verify & Complete
Before calling task_complete:
1. Review your plan — are all steps completed?
2. Verify your output meets the task requirements
3. If the task requires a deliverable (summary, report, code), make sure it is actually produced and visible in your response
4. Call task_complete with a detailed summary of what was done

## Guidelines
- Be thorough and careful. Read files before modifying them.
- When you encounter errors, read the error output carefully and fix the root cause.
- Prefer surgical edits (edit_file) over full rewrites (write_file) for small changes.
- Run tests after making changes to verify they work.
- If you're stuck or need clarification, use the ask_user tool.
- **When the task is complete, ALWAYS call task_complete with a summary of what was done.**
- **If the user asks a simple question (not a coding task), answer concisely and call task_complete immediately after. Do NOT repeat yourself or answer multiple times.**
- **If the user just says "hello", "hi", "你好" or similar greetings, respond with ONE brief sentence at most and call task_complete immediately. Do NOT list your capabilities, do NOT ask what they want, and do NOT repeat yourself.**
- **After completing each plan step, ALWAYS call plan with action="update" and completedStepIds to mark progress. This is how the system tracks what has been done.**
- **If you respond with text only and no tool calls, the system will assume you have completed the task. After a text-only response, call task_complete explicitly on the next turn — do NOT generate another text-only response.**

## Strategic Tips
- **For "find and fix errors" tasks**: Run the compiler/test command FIRST (e.g., "npx tsc --noEmit"), then read only the files that have errors. Do NOT explore the entire project before running the compiler.
- **For "explore/summarize" tasks**: Read key files (package.json, main entry, configs) first, then explore specific areas of interest.
- **Use glob to find files by pattern** (e.g., "**/*.ts") instead of manually listing directories one by one.

## Budget Awareness
You have a limited number of iterations (maxIterations). Be strategic:
- Do not spend too many iterations on exploration
- If you receive a budget warning, prioritize the most important remaining work
- If you cannot complete everything, save progress with checkpoint and explain what was done in task_complete

## Working Directory
The workspace is at: ${workspaceRoot}

## Environment
- Platform: ${process.platform}
- Shell: ${process.platform === 'win32' ? 'cmd.exe (use dir, type, cd /d for drive changes)' : '/bin/sh (use ls, cat, cd)'}

Use absolute paths when working with files. On Windows, use backslash (\\) or forward slash (/) in paths.`;
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
   * Falls back to progressively fewer messages if the initial truncation
   * still exceeds the threshold, down to an absolute minimum of 2 messages.
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

    // Try progressively smaller keep counts until under threshold
    const MIN_KEEP = 2;
    let keepCount = Math.max(30, Math.floor(conversationMessages.length * 0.4));

    while (keepCount >= MIN_KEEP) {
      const kept = conversationMessages.slice(-keepCount);
      const result = [...systemMessages, ...kept];
      const estimatedTokens = this.estimateTokenCount(result);

      if (estimatedTokens < threshold) {
        console.log(
          `[MessageManager] Truncated from ${messages.length} to ${result.length} messages ` +
          `(estimated tokens: ~${totalTokens} -> ~${estimatedTokens})`
        );
        return result;
      }

      // Reduce keep count: try 60% of current, or drop by 5, whichever is larger
      keepCount = Math.max(MIN_KEEP, Math.min(Math.floor(keepCount * 0.6), keepCount - 5));
    }

    // Absolute fallback: keep system + last 2 messages
    const lastResort = [...systemMessages, ...conversationMessages.slice(-MIN_KEEP)];
    console.log(
      `[MessageManager] Aggressive truncation: ${messages.length} -> ${lastResort.length} messages ` +
      `(estimated tokens: ~${totalTokens} -> ~${this.estimateTokenCount(lastResort)})`
    );
    return lastResort;
  }
}

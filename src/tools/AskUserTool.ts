import * as vscode from 'vscode';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

/**
 * AskUserTool prompts the user for input via a VSCode dialog.
 * The callback pattern allows it to work within the Agent loop.
 */
export class AskUserTool implements ITool {
  definition: ToolDefinition = {
    name: 'ask_user',
    description: 'Ask the user a question when you need clarification or additional information to proceed with the task.',
    parameters: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
    },
    requiredParameters: ['question'],
  };

  private userResponse: string | undefined;

  /**
   * Register a callback that will be called when the user responds.
   */
  setUserResponse(response: string): void {
    this.userResponse = response;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const question = args.question as string;

    // Race the input dialog against a timeout to prevent indefinite blocking
    const ASK_USER_TIMEOUT_MS = 120000; // 2 minutes

    const response = await Promise.race([
      vscode.window.showInputBox({
        prompt: `TRIM asks: ${question}`,
        placeHolder: 'Type your response...',
        ignoreFocusOut: true,
      }),
      new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), ASK_USER_TIMEOUT_MS)
      ),
    ]);

    if (response === undefined) {
      // User cancelled or timed out
      return {
        success: true,
        data: 'User cancelled the input prompt or did not respond in time. Please try a different approach or ask a different question.',
      };
    }

    return {
      success: true,
      data: `User response: ${response}`,
      metadata: { response },
    };
  }
}

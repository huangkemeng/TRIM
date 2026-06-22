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

    // Show dialog to user
    const response = await vscode.window.showInputBox({
      prompt: `TRIM asks: ${question}`,
      placeHolder: 'Type your response...',
      ignoreFocusOut: true,
    });

    if (response === undefined) {
      // User cancelled
      return {
        success: true,
        data: 'User cancelled the input prompt. Please try a different approach or ask a different question.',
      };
    }

    return {
      success: true,
      data: `User response: ${response}`,
      metadata: { response },
    };
  }
}

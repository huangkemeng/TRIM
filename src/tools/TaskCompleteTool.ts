import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class TaskCompleteTool implements ITool {
  definition: ToolDefinition = {
    name: 'task_complete',
    description: 'Signal that the task is complete. Call this when you have successfully fulfilled the user\'s request. Provide a summary of what was done.',
    parameters: {
      summary: {
        type: 'string',
        description: 'A summary of what was accomplished, including key files created/modified and the final outcome',
      },
    },
    requiredParameters: ['summary'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const summary = args.summary as string;

    return {
      success: true,
      data: `Task completed: ${summary}`,
      metadata: { summary, completed: true },
    };
  }
}

import * as fs from 'fs/promises';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class EditFileTool implements ITool {
  definition: ToolDefinition = {
    name: 'edit_file',
    description: 'Make surgical, targeted edits to an existing file by finding and replacing exact text. Use this for small, precise changes instead of rewriting the entire file.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to search for (must exist in the file exactly once)',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace the old_string with',
      },
    },
    requiredParameters: ['file_path', 'old_string', 'new_string'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.file_path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (!content.includes(oldString)) {
        return {
          success: false,
          data: '',
          error: `Could not find old_string in "${filePath}". The exact text to replace was not found.`,
        };
      }

      // Count occurrences
      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          data: '',
          error: `Found ${occurrences} occurrences of old_string in "${filePath}". Expected exactly 1. Please provide a more specific old_string.`,
        };
      }

      const newContent = content.replace(oldString, newString);
      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        success: true,
        data: `Successfully edited "${filePath}" (replaced 1 occurrence)`,
        metadata: { filePath, oldLength: oldString.length, newLength: newString.length },
      };
    } catch (error: any) {
      return {
        success: false,
        data: '',
        error: `Failed to edit file "${filePath}": ${error?.message || error}`,
      };
    }
  }
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class WriteFileTool implements ITool {
  definition: ToolDefinition = {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with new content. Use this when you need to write a complete file.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file',
      },
    },
    requiredParameters: ['file_path', 'content'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.file_path as string;
    const content = args.content as string;

    try {
      // Ensure parent directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, 'utf-8');

      const lineCount = content.split('\n').length;
      const byteSize = Buffer.byteLength(content, 'utf-8');

      return {
        success: true,
        data: `Successfully wrote ${lineCount} lines (${byteSize} bytes) to "${filePath}"`,
        metadata: { lineCount, byteSize },
      };
    } catch (error: any) {
      return {
        success: false,
        data: '',
        error: `Failed to write file "${filePath}": ${error?.message || error}`,
      };
    }
  }
}

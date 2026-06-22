import * as fs from 'fs/promises';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class ReadFileTool implements ITool {
  definition: ToolDefinition = {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to explore existing code or read configuration files.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (0-indexed, optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (optional, default: 2000)',
      },
    },
    requiredParameters: ['file_path'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.file_path as string;
    const offset = (args.offset as number) || 0;
    const limit = (args.limit as number) || 2000;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const selectedLines = lines.slice(offset, offset + limit);

      const result = selectedLines
        .map((line, i) => `${offset + i + 1}\t${line}`)
        .join('\n');

      const totalLines = lines.length;
      const shownLines = selectedLines.length;
      const isTruncated = shownLines < totalLines - offset;

      let summary = `File: ${filePath}\n`;
      summary += `Lines: ${shownLines} shown (from line ${offset + 1})`;
      if (isTruncated) {
        summary += `, ${totalLines - offset - shownLines} more lines not shown`;
      }
      summary += `\n\n${result}`;

      return {
        success: true,
        data: summary,
        metadata: { totalLines, shownLines, isTruncated },
      };
    } catch (error: any) {
      return {
        success: false,
        data: '',
        error: `Failed to read file "${filePath}": ${error?.message || error}`,
      };
    }
  }
}

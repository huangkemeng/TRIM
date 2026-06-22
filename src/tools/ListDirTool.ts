import * as fs from 'fs/promises';
import * as path from 'path';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class ListDirTool implements ITool {
  definition: ToolDefinition = {
    name: 'list_dir',
    description: 'List the contents of a directory. Use this to explore the project structure.',
    parameters: {
      path: {
        type: 'string',
        description: 'The absolute path to the directory to list',
      },
    },
    requiredParameters: ['path'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = args.path as string;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const files: string[] = [];
      const dirs: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(`${entry.name}/`);
        } else {
          files.push(entry.name);
        }
      }

      dirs.sort();
      files.sort();

      const result = ['Contents of: ' + dirPath, ''];
      result.push('Directories:');
      result.push(...dirs.map(d => `  📁 ${d}`));
      result.push('');
      result.push('Files:');
      result.push(...files.map(f => `  📄 ${f}`));
      result.push('');
      result.push(`${dirs.length} directories, ${files.length} files`);

      return {
        success: true,
        data: result.join('\n'),
        metadata: { directoryCount: dirs.length, fileCount: files.length },
      };
    } catch (error: any) {
      return {
        success: false,
        data: '',
        error: `Failed to list directory "${dirPath}": ${error?.message || error}`,
      };
    }
  }
}

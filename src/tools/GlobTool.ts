import * as fs from 'fs/promises';
import * as path from 'path';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class GlobTool implements ITool {
  definition: ToolDefinition = {
    name: 'glob',
    description: 'List files matching a glob pattern. Use this to discover files in the project without knowing exact paths.',
    parameters: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match (e.g., "**/*.ts", "src/**/*.json")',
      },
      path: {
        type: 'string',
        description: 'The directory to search in (defaults to workspace root)',
      },
    },
    requiredParameters: ['pattern'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || process.cwd();

    try {
      const { execSync } = require('child_process');
      const cmd = `cd "${searchPath}" && ls -1 ${pattern} 2>/dev/null | head -200`;

      const stdout = execSync(cmd, { timeout: 10000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      if (!stdout.trim()) {
        return {
          success: true,
          data: `No files found matching pattern "${pattern}" in "${searchPath}"`,
        };
      }

      const files = stdout.trim().split('\n').filter(Boolean);
      return {
        success: true,
        data: `Found ${files.length} files matching "${pattern}":\n${files.join('\n')}`,
        metadata: { fileCount: files.length },
      };
    } catch (error: any) {
      return {
        success: true,
        data: `No files found matching pattern "${pattern}"`,
      };
    }
  }
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

export class GrepTool implements ITool {
  definition: ToolDefinition = {
    name: 'grep',
    description: 'Search for a pattern in files within a directory. Uses ripgrep-style regex. Use this to find relevant code, references, or definitions.',
    parameters: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The directory to search in (defaults to workspace root)',
      },
      glob: {
        type: 'string',
        description: 'Optional file glob pattern to filter (e.g., "*.ts", "*.{ts,js}")',
      },
    },
    requiredParameters: ['pattern'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || process.cwd();
    const glob = args.glob as string | undefined;

    try {
      const { execSync } = require('child_process');
      let cmd = `rg --no-heading --line-number --color never "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;

      if (glob) {
        cmd += ` --glob "${glob}"`;
      }

      // Limit output to prevent huge responses
      cmd += ' | head -200';

      const stdout = execSync(cmd, { timeout: 15000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

      if (!stdout.trim()) {
        return {
          success: true,
          data: `No matches found for pattern "${pattern}" in "${searchPath}"`,
        };
      }

      const lines = stdout.trim().split('\n');
      return {
        success: true,
        data: `Found ${lines.length} matches for pattern "${pattern}":\n\n${stdout.trim()}`,
        metadata: { matchCount: lines.length },
      };
    } catch (error: any) {
      // rg not installed or other error
      if (error?.stderr?.includes('command not found') || error?.message?.includes('command not found')) {
        return {
          success: false,
          data: '',
          error: 'ripgrep (rg) is not installed. Please install it or use glob/list_dir to explore files.',
        };
      }
      return {
        success: true,
        data: `No matches found for pattern "${pattern}"`,
      };
    }
  }
}

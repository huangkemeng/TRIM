import * as fs from 'fs';
import * as path from 'path';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

/**
 * Simple glob implementation using Node.js fs APIs.
 * Supports ** (recursive), * (single segment wildcard), and ? (single char).
 * This avoids shell dependency issues on Windows.
 */
function matchPattern(name: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        // ** matches everything including path separators
        regexStr += '.*';
        i += 2;
        // Skip any trailing /
        if (i < pattern.length && pattern[i] === '/') i++;
      } else {
        // * matches anything except path separator
        regexStr += '[^\\\\/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^\\\\/]';
      i++;
    } else if (ch === '.') {
      regexStr += '\\.';
      i++;
    } else if (ch === '/') {
      regexStr += '[/\\\\]';
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr, 'i').test(name);
}

function walkDir(
  dirPath: string,
  pattern: string,
  basePath: string,
  results: string[],
  maxResults: number
): void {
  if (results.length >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return; // Skip directories we can't read
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      // Check if directory matches pattern (for ** patterns)
      if (matchPattern(relativePath + '/', pattern)) {
        results.push(relativePath + '/');
      }
      // Always recurse into directories for ** patterns
      walkDir(fullPath, pattern, basePath, results, maxResults);
    } else if (entry.isFile()) {
      if (matchPattern(relativePath, pattern)) {
        results.push(relativePath);
      }
    }
  }
}

export class GlobTool implements ITool {
  definition: ToolDefinition = {
    name: 'glob',
    description: 'List files matching a glob pattern. Supports ** (recursive), * (wildcard), and ? (single char). Use this to discover files in the project without knowing exact paths.',
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
    const MAX_RESULTS = 200;

    try {
      // Verify the search path exists
      if (!fs.existsSync(searchPath)) {
        return {
          success: true,
          data: `Search path does not exist: "${searchPath}"`,
        };
      }

      const results: string[] = [];
      walkDir(searchPath, pattern, searchPath, results, MAX_RESULTS);

      if (results.length === 0) {
        return {
          success: true,
          data: `No files found matching pattern "${pattern}" in "${searchPath}"`,
        };
      }

      const truncated = results.length >= MAX_RESULTS;
      const displayFiles = truncated ? results.slice(0, MAX_RESULTS) : results;

      let result = `Found ${results.length} files matching "${pattern}":\n`;
      result += displayFiles.join('\n');
      if (truncated) {
        result += `\n... (${results.length - MAX_RESULTS} more files not shown)`;
      }

      return {
        success: true,
        data: result,
        metadata: { fileCount: results.length, truncated },
      };
    } catch (error: any) {
      return {
        success: true,
        data: `Error searching for pattern "${pattern}": ${error?.message || error}`,
      };
    }
  }
}

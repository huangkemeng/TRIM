import { execSync, ExecSyncOptions } from 'child_process';
import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

const MAX_OUTPUT_LENGTH = 50000; // 50KB max output
const DEFAULT_TIMEOUT = 120000;  // 2 minutes

/**
 * Check if a command is potentially destructive and requires approval.
 */
function isDestructiveCommand(command: string): boolean {
  const destructivePatterns = [
    /^rm\s+-rf/i,
    /^rm\s+.*--no-preserve-root/i,
    /^dd\s+/i,
    /^mkfs/i,
    /^format/i,
    /^git\s+push\s+.*--force/i,
    /^git\s+reset\s+--hard/i,
    /^git\s+clean\s+-f/i,
    /^drop\s+table/i,
    /^delete\s+from/i,
    /^truncate\s+/i,
  ];

  return destructivePatterns.some(pattern => pattern.test(command.trim()));
}

export class BashTool implements ITool {
  definition: ToolDefinition = {
    name: 'bash',
    description: 'Execute a terminal command and capture its output. Use this to run build commands, tests, scripts, or any shell operation.',
    parameters: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      description: {
        type: 'string',
        description: 'A brief description of what this command does (for display purposes)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000, max: 600000)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (defaults to workspace root)',
      },
    },
    requiredParameters: ['command'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const description = (args.description as string) || command;
    const timeout = Math.min(
      (args.timeout as number) || DEFAULT_TIMEOUT,
      600000
    );
    const cwd = args.cwd as string | undefined;

    if (!command.trim()) {
      return {
        success: false,
        data: '',
        error: 'Command cannot be empty',
      };
    }

    // Warn about destructive commands
    if (isDestructiveCommand(command)) {
      return {
        success: false,
        data: '',
        error: `Potentially destructive command rejected: "${command}". This command requires manual approval.`,
      };
    }

    try {
      const options: ExecSyncOptions = {
        timeout,
        maxBuffer: MAX_OUTPUT_LENGTH,
        encoding: 'utf-8',
        windowsHide: true,
      };

      if (cwd) {
        options.cwd = cwd;
      }

      const stdout = execSync(command, options);

      const output = stdout?.toString() || '';
      const truncated = output.length > MAX_OUTPUT_LENGTH;

      let result = `Command: ${description}\n`;
      result += `Exit code: 0\n`;
      result += `Output:\n${truncated ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)' : output}`;

      return {
        success: true,
        data: result,
        metadata: {
          exitCode: 0,
          outputLength: output.length,
          truncated,
        },
      };
    } catch (error: any) {
      const stderr = error?.stderr?.toString() || '';
      const stdout = error?.stdout?.toString() || '';
      const exitCode = error?.status ?? 1;
      const signal = error?.signal;

      let result = `Command: ${description}\n`;
      result += `Exit code: ${exitCode}${signal ? ` (signal: ${signal})` : ''}\n`;

      if (stdout) {
        result += `Stdout:\n${stdout.slice(0, MAX_OUTPUT_LENGTH / 2)}\n`;
      }
      if (stderr) {
        result += `Stderr:\n${stderr.slice(0, MAX_OUTPUT_LENGTH / 2)}\n`;
      }
      if (error?.message && !stdout && !stderr) {
        result += `Error: ${error.message}\n`;
      }

      return {
        success: exitCode === 0,
        data: result,
        error: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
        metadata: {
          exitCode,
          outputLength: stdout.length + stderr.length,
        },
      };
    }
  }
}

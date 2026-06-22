import * as vscode from 'vscode';

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Manages VS Code terminal instances for TRIM.
 * Uses VS Code's terminal API for visual feedback and child_process for reliable output capture.
 */
export class TerminalManager {
  private terminals: Map<string, vscode.Terminal> = new Map();

  /**
   * Get or create a named terminal.
   */
  getTerminal(name: string = 'TRIM'): vscode.Terminal {
    let terminal = this.terminals.get(name);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({ name });
      this.terminals.set(name, terminal);
    }
    return terminal;
  }

  /**
   * Show a command in the terminal for visual feedback.
   */
  showCommand(command: string, cwd?: string): void {
    const terminal = this.getTerminal();
    terminal.show();

    if (cwd) {
      terminal.sendText(`cd "${cwd}"`);
    }
    terminal.sendText(command);
  }

  /**
   * Dispose all terminals.
   */
  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}

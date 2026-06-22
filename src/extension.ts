import * as vscode from 'vscode';
import { DeepSeekClient } from './api/DeepSeekClient';
import { loadConfiguration } from './config';
import { Agent, AgentConfig } from './agent/Agent';
import { ToolRegistry } from './tools/ToolRegistry';
import { ReadFileTool } from './tools/ReadFileTool';
import { WriteFileTool } from './tools/WriteFileTool';
import { EditFileTool } from './tools/EditFileTool';
import { GrepTool } from './tools/GrepTool';
import { GlobTool } from './tools/GlobTool';
import { ListDirTool } from './tools/ListDirTool';
import { BashTool } from './tools/BashTool';
import { AskUserTool } from './tools/AskUserTool';
import { TaskCompleteTool } from './tools/TaskCompleteTool';
import { AgentWebview } from './ui/AgentWebview';

let currentAgent: Agent | undefined;
let webview: AgentWebview | undefined;

function registerAllTools(registry: ToolRegistry): void {
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new ListDirTool());
  registry.register(new BashTool());
  registry.register(new AskUserTool());
  registry.register(new TaskCompleteTool());
}

export function activate(context: vscode.ExtensionContext) {
  // Create output channel and add to subscriptions for proper lifecycle management
  const outputChannel = vscode.window.createOutputChannel('TRIM (Logs)');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('TRIM extension activated.');

  // Register: Start new task
  const startDisposable = vscode.commands.registerCommand('trim.start', async () => {
    const config = loadConfiguration();

    if (!config.apiKey) {
      const result = await vscode.window.showErrorMessage(
        'TRIM: DeepSeek API Key is not configured.',
        'Open Settings'
      );
      if (result === 'Open Settings') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'trim.apiKey'
        );
      }
      return;
    }

    // Ask user for task
    const task = await vscode.window.showInputBox({
      prompt: 'Describe the task for TRIM',
      placeHolder: 'e.g., "Create a new REST endpoint for user authentication"',
      ignoreFocusOut: true,
      validateInput: (value: string) => {
        return value.trim().length === 0 ? 'Task description cannot be empty' : null;
      },
    });

    if (!task) return;

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';

    // Initialize DeepSeek client
    const deepseekClient = new DeepSeekClient(
      config.apiKey,
      config.model,
      config.temperature,
      config.maxTokens
    );

    // Validate connection
    outputChannel.appendLine('Validating DeepSeek API connection...');

    const isValid = await deepseekClient.validateConnection();
    if (!isValid) {
      vscode.window.showErrorMessage(
        'Failed to connect to DeepSeek API. Please check your API key.'
      );
      return;
    }

    outputChannel.appendLine('DeepSeek API connection successful!');

    // Setup tool registry
    const toolRegistry = new ToolRegistry();
    registerAllTools(toolRegistry);

    outputChannel.appendLine(`Tools available: ${toolRegistry.list().join(', ')}`);

    // Create and show webview
    webview = new AgentWebview(context.extensionUri);
    webview.show();
    webview.setTask(task);

    // Create agent config
    const agentConfig: AgentConfig = {
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maxIterations: vscode.workspace.getConfiguration('trim').get<number>('maxIterations', 100),
      workspaceRoot,
    };

    // Create and run agent
    currentAgent = new Agent(agentConfig, toolRegistry, deepseekClient, {
      onToken: (token: string) => {
        webview?.streamToken(token);
      },
      onToolCall: (toolName: string, args: Record<string, unknown>) => {
        webview?.showToolCall(toolName, args);
        outputChannel.appendLine(`\n🔧 Tool: ${toolName}`);
        outputChannel.appendLine(`   Args: ${JSON.stringify(args).slice(0, 500)}`);
      },
      onToolResult: (toolName: string, result) => {
        webview?.showToolResult(toolName, result);
        outputChannel.appendLine(`${result.success ? '✅' : '❌'} ${toolName}: ${result.data.slice(0, 200)}`);
      },
      onStatus: (status: string) => {
        outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${status}`);
      },
      onComplete: (summary: string) => {
        webview?.showTaskComplete(summary);
        outputChannel.appendLine(`\n✅ TASK COMPLETE: ${summary}`);
        vscode.window.showInformationMessage('TRIM task completed!');
      },
      onError: (error: string) => {
        webview?.showError(error);
        outputChannel.appendLine(`\n❌ Error: ${error}`);
      },
    });

    // Wire up stop button
    webview.onStop(() => {
      currentAgent?.cancel();
    });

    outputChannel.appendLine('\n═══════════════════════════════════');
    outputChannel.appendLine('🚀 Starting TRIM Task');
    outputChannel.appendLine(`Task: ${task}`);
    outputChannel.appendLine(`Model: ${config.model}`);
    outputChannel.appendLine('═══════════════════════════════════');

    try {
      await currentAgent.run(task);
    } catch (error: any) {
      // Catch any unhandled errors from the agent loop
      const errorMessage = error?.message || String(error);
      if (!errorMessage.includes('Canceled')) {
        outputChannel.appendLine(`\n❌ Unhandled error: ${errorMessage}`);
      }
    }
  });

  // Register: Stop current task
  const stopDisposable = vscode.commands.registerCommand('trim.stop', () => {
    if (currentAgent) {
      currentAgent.cancel();
      outputChannel.appendLine('\n⏹️ TRIM stopped by user.');
      webview?.showError('Stopped by user');
    } else {
      vscode.window.showInformationMessage('No TRIM task is currently running.');
    }
  });

  context.subscriptions.push(startDisposable, stopDisposable);
}

export function deactivate() {
  currentAgent?.cancel();
  webview?.close();
  currentAgent = undefined;
  webview = undefined;
}

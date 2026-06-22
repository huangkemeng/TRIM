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
import { SidebarProvider } from './ui/sidebar/SidebarProvider';

let currentAgent: Agent | undefined;
let webview: AgentWebview | undefined;
let currentConversationId: string | undefined;
let sidebarProvider: SidebarProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;

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

/** Shared task runner used by sidebar and commands */
async function startTask(task: string, sidebar: SidebarProvider, ctx: vscode.ExtensionContext) {
  const config = loadConfiguration();

  if (!config.apiKey) {
    const result = await vscode.window.showErrorMessage(
      'TRIM: DeepSeek API Key is not configured.',
      'Open Settings'
    );
    if (result === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'trim.apiKey');
    }
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';

  // Initialize DeepSeek client
  const deepseekClient = new DeepSeekClient(
    config.apiKey, config.model, config.temperature, config.maxTokens
  );

  // Validate connection
  outputChannel?.appendLine('Validating DeepSeek API connection...');
  const isValid = await deepseekClient.validateConnection();
  if (!isValid) {
    vscode.window.showErrorMessage('Failed to connect to DeepSeek API. Please check your API key.');
    return;
  }
  outputChannel?.appendLine('DeepSeek API connection successful!');

  // Setup tools
  const toolRegistry = new ToolRegistry();
  registerAllTools(toolRegistry);

  // Create conversation record
  currentConversationId = sidebar.addConversation(task, config.model);

  // Create webview
  webview = new AgentWebview(ctx.extensionUri);
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

  currentAgent = new Agent(agentConfig, toolRegistry, deepseekClient, {
    onToken: (token: string) => webview?.streamToken(token),
    onToolCall: (toolName: string, args: Record<string, unknown>) => {
      webview?.showToolCall(toolName, args);
      outputChannel?.appendLine(`\n🔧 Tool: ${toolName}`);
      outputChannel?.appendLine(`   Args: ${JSON.stringify(args).slice(0, 500)}`);
    },
    onToolResult: (toolName: string, result) => {
      webview?.showToolResult(toolName, result);
      outputChannel?.appendLine(`${result.success ? '✅' : '❌'} ${toolName}: ${result.data.slice(0, 200)}`);
    },
    onUsage: (tokensUsed: number) => {
      if (currentConversationId) {
        sidebar.updateConversation(currentConversationId, { tokensUsed });
      }
    },
    onStatus: (status: string) => {
      outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${status}`);
    },
    onComplete: (summary: string) => {
      webview?.showTaskComplete(summary);
      outputChannel?.appendLine(`\n✅ TASK COMPLETE: ${summary}`);
      if (currentConversationId) {
        sidebar.updateConversation(currentConversationId, {
          status: 'completed',
          summary,
        });
      }
      vscode.window.showInformationMessage('TRIM task completed!');
    },
    onError: (error: string) => {
      webview?.showError(error);
      outputChannel?.appendLine(`\n❌ Error: ${error}`);
      if (currentConversationId) {
        sidebar.updateConversation(currentConversationId, {
          status: 'failed',
          summary: error,
        });
      }
    },
  });

  webview.onStop(() => currentAgent?.cancel());

  outputChannel?.appendLine('\n═══════════════════════════════════');
  outputChannel?.appendLine('🚀 Starting TRIM Task');
  outputChannel?.appendLine(`Task: ${task}`);
  outputChannel?.appendLine(`Model: ${config.model}`);
  outputChannel?.appendLine('═══════════════════════════════════');

  try {
    await currentAgent.run(task);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    if (!errorMessage.includes('Canceled')) {
      outputChannel?.appendLine(`\n❌ Unhandled error: ${errorMessage}`);
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TRIM (Logs)');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('TRIM extension activated.');

  // Register sidebar provider
  sidebarProvider = new SidebarProvider(context.extensionUri, context.globalState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
  );

  // Wire sidebar callbacks
  sidebarProvider.onNewConversation = async () => {
    const task = await vscode.window.showInputBox({
      prompt: 'Describe the task for TRIM',
      placeHolder: 'e.g., "Create a new REST endpoint for user authentication"',
      ignoreFocusOut: true,
      validateInput: (value: string) =>
        value.trim().length === 0 ? 'Task description cannot be empty' : null,
    });
    if (task && sidebarProvider) {
      await startTask(task, sidebarProvider, context);
    }
  };

  sidebarProvider.onQuickTask = async (task: string) => {
    if (sidebarProvider) {
      await startTask(task, sidebarProvider, context);
    }
  };

  sidebarProvider.onOpenConversation = (id: string) => {
    vscode.window.showInformationMessage(`Opening conversation: ${id}`);
    // Future: restore conversation from history
  };

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('trim.start', async () => {
      sidebarProvider?.onNewConversation?.();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trim.stop', () => {
      if (currentAgent) {
        currentAgent.cancel();
        outputChannel?.appendLine('\n⏹️ TRIM stopped by user.');
        webview?.showError('Stopped by user');
        if (currentConversationId && sidebarProvider) {
          sidebarProvider.updateConversation(currentConversationId, {
            status: 'stopped',
          });
        }
      } else {
        vscode.window.showInformationMessage('No TRIM task is currently running.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trim.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'trim.apiKey');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trim.newConversation', () => {
      sidebarProvider?.onNewConversation?.();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trim.clearHistory', () => {
      // Cleared via sidebar UI; this is a command palette fallback
      vscode.commands.executeCommand('workbench.action.webview.open', 'trim.main');
    })
  );
}

export function deactivate() {
  currentAgent?.cancel();
  webview?.close();
  currentAgent = undefined;
  webview = undefined;
  currentConversationId = undefined;
}

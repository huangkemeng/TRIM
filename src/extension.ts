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
import { PlanTool } from './tools/PlanTool';
import { SidebarProvider } from './ui/sidebar/SidebarProvider';

let currentAgent: Agent | undefined;
let currentConversationId: string | undefined;
let sidebarProvider: SidebarProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let isTaskRunning = false;

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
  registry.register(new PlanTool());
}

async function startTask(
  task: string,
  sidebar: SidebarProvider,
  ctx: vscode.ExtensionContext,
  newConversation: boolean = false
): Promise<void> {
  const config = loadConfiguration();
  if (!config.apiKey) {
    const result = await vscode.window.showErrorMessage(
      'TRIM: DeepSeek API Key is not configured.', 'Open Settings'
    );
    if (result === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'trim.apiKey');
    }
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';

  // If starting a new conversation, destroy the current agent
  if (newConversation && currentAgent) {
    outputChannel?.appendLine('Starting new conversation...');
    currentAgent.cancel();
    currentAgent = undefined;
    currentConversationId = undefined;
  }

  if (!currentAgent) {
    // === FIRST MESSAGE: create new Agent and conversation ===
    const deepseekClient = new DeepSeekClient(
      config.apiKey, config.model, config.temperature, config.maxTokens
    );

    outputChannel?.appendLine('Validating DeepSeek API connection...');
    const isValid = await deepseekClient.validateConnection();
    if (!isValid) {
      vscode.window.showErrorMessage(
        'Failed to connect to DeepSeek API. Please check your API key.'
      );
      return;
    }
    outputChannel?.appendLine('DeepSeek API connection successful!');

    const toolRegistry = new ToolRegistry();
    registerAllTools(toolRegistry);

    // Create conversation record and enter chat view
    currentConversationId = sidebar.addConversation(task, config.model);
    sidebar.enterChat(currentConversationId, task);

    const agentConfig: AgentConfig = {
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      workspaceRoot,
      maxTurns: config.maxTurns || undefined,
    };

    currentAgent = new Agent(agentConfig, toolRegistry, deepseekClient, {
      onToken: (token: string) => sidebar.streamToken(token),
      onToolCall: (toolName: string, args: Record<string, unknown>) => {
        sidebar.addToolCall(toolName, args);
        outputChannel?.appendLine(`\n🔧 Tool: ${toolName}`);
      },
      onToolResult: (toolName: string, result) => {
        sidebar.setToolResult(toolName, result);
        outputChannel?.appendLine(
          `${result.success ? '✅' : '❌'} ${toolName}: ${result.data.slice(0, 200)}`
        );
      },
      onUsage: (tokensUsed: number) => {
        if (currentConversationId) {
          sidebar.updateConversation(currentConversationId, { tokensUsed });
        }
      },
      onStatus: (status: string) =>
        outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${status}`),
      onComplete: (summary: string) => {
        sidebar.finalizeMessage();
        outputChannel?.appendLine(`\n✅ TASK COMPLETE: ${summary}`);
        if (currentConversationId) {
          // Keep conversation alive for multi-turn; save messages but don't mark final
          sidebar.updateConversation(currentConversationId, { summary });
          sidebar.saveConversationMessages(currentConversationId);
        }
        isTaskRunning = false;
      },
      onError: (error: string) => {
        sidebar.finalizeMessage();
        outputChannel?.appendLine(`\n❌ Error: ${error}`);
        if (currentConversationId) {
          sidebar.updateConversation(currentConversationId, {
            status: 'failed',
            summary: error,
          });
          sidebar.saveConversationMessages(currentConversationId);
        }
        isTaskRunning = false;
      },
    });
  } else {
    // === FOLLOW-UP MESSAGE: reuse existing agent ===
    sidebar.addUserMessage(task);
    if (currentConversationId) {
      sidebar.updateConversation(currentConversationId, { status: 'running' });
    }
  }

  isTaskRunning = true;
  outputChannel?.appendLine(
    `\n🚀 Processing message\nMessage: ${task}\nModel: ${config.model}`
  );

  try {
    await currentAgent.run(task);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    if (!errorMessage.includes('Canceled')) {
      outputChannel?.appendLine(`\n❌ Unhandled error: ${errorMessage}`);
    }
  } finally {
    isTaskRunning = false;
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

  // Wire: send message from sidebar input → continue conversation
  sidebarProvider.onSendMessage = async (text: string) => {
    if (sidebarProvider) await startTask(text, sidebarProvider, context, false);
  };

  // Wire: quick task buttons → start NEW conversation
  sidebarProvider.onQuickTask = async (task: string) => {
    if (sidebarProvider) await startTask(task, sidebarProvider, context, true);
  };

  // Wire: go back → destroy agent and save conversation
  sidebarProvider.onGoBack = () => {
    if (currentAgent) {
      currentAgent.cancel();
      currentAgent = undefined;
    }
    if (currentConversationId && sidebarProvider) {
      sidebarProvider.updateConversation(currentConversationId, { status: 'completed' });
      sidebarProvider.saveConversationMessages(currentConversationId);
    }
    currentConversationId = undefined;
    isTaskRunning = false;
  };

  // Wire: click history item → restore full conversation
  sidebarProvider.onOpenConversation = (id: string) => {
    const conv = sidebarProvider?.getConversation(id);
    if (conv && sidebarProvider) {
      if (conv.messages && conv.messages.length > 0) {
        // Restore full message history
        sidebarProvider.enterChat(id, conv.task, conv.messages);
      } else {
        // Fallback: show summary
        sidebarProvider.enterChat(id, conv.task);
        sidebarProvider.finalizeMessage();
        const summary = conv.summary || 'No summary available.';
        sidebarProvider.streamToken(
          `**Conversation resumed:** ${conv.title}\n\nStatus: ${conv.status}  •  Tokens: ${conv.tokensUsed}\n\n${summary}`
        );
        sidebarProvider.finalizeMessage();
      }
    }
  };

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('trim.start', async () => {
      const task = await vscode.window.showInputBox({
        prompt: 'Describe the task for TRIM',
        placeHolder: 'e.g., "Create a new REST endpoint"',
        ignoreFocusOut: true,
      });
      if (task && sidebarProvider) {
        await startTask(task, sidebarProvider, context, true);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trim.stop', () => {
      if (currentAgent) {
        currentAgent.cancel();
        outputChannel?.appendLine('\n⏹️ TRIM stopped by user.');
        sidebarProvider?.finalizeMessage();
        if (currentConversationId && sidebarProvider) {
          sidebarProvider.updateConversation(currentConversationId, { status: 'stopped' });
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
}

export function deactivate() {
  currentAgent?.cancel();
  currentAgent = undefined;
  currentConversationId = undefined;
}

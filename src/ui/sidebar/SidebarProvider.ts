import * as vscode from 'vscode';
import { SidebarStore, ConversationRecord, ConversationStatus } from './SidebarStore';

type SidebarMessage =
  | { type: 'newConversation' }
  | { type: 'quickTask'; task: string }
  | { type: 'openConversation'; id: string }
  | { type: 'deleteConversation'; id: string }
  | { type: 'clearHistory' }
  | { type: 'openSettings' }
  | { type: 'changeModel'; model: string }
  | { type: 'searchHistory'; query: string }
  | { type: 'exportConversation'; id: string }
  | { type: 'refresh' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trim.main';

  private view?: vscode.WebviewView;
  private store: SidebarStore;

  /** Callbacks for the extension to wire into */
  public onNewConversation?: () => void;
  public onQuickTask?: (task: string) => void;
  public onOpenConversation?: (id: string) => void;

  constructor(
    private extensionUri: vscode.Uri,
    storage: vscode.Memento
  ) {
    this.store = new SidebarStore(storage);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(
      (msg: SidebarMessage) => this.handleMessage(msg)
    );

    // Send initial data
    this.refresh();
  }

  /** Update conversation list in the sidebar */
  refresh(): void {
    const conversations = this.store.getAll();
    const config = vscode.workspace.getConfiguration('trim');
    const model = config.get<string>('model', 'deepseek-v4-flash');
    const hasApiKey = !!config.get<string>('apiKey', '');

    this.view?.webview.postMessage({
      type: 'refresh',
      conversations,
      model,
      hasApiKey,
    });
  }

  /** Notify sidebar that a conversation's status changed */
  updateConversation(id: string, updates: Partial<ConversationRecord>): void {
    this.store.update(id, updates);
    this.refresh();
  }

  /** Add a new conversation and refresh sidebar */
  addConversation(task: string, model: string): string {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.store.add({
      id,
      title: SidebarStore.generateTitle(task),
      task,
      status: 'running',
      timestamp: Date.now(),
      tokensUsed: 0,
      model,
    });
    this.refresh();
    return id;
  }

  private async handleMessage(msg: SidebarMessage) {
    switch (msg.type) {
      case 'newConversation':
        this.onNewConversation?.();
        break;

      case 'quickTask':
        this.onQuickTask?.(msg.task);
        break;

      case 'openConversation':
        this.onOpenConversation?.(msg.id);
        break;

      case 'deleteConversation':
        this.store.delete(msg.id);
        this.refresh();
        break;

      case 'clearHistory':
        this.store.clearAll();
        this.refresh();
        break;

      case 'openSettings':
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'trim.apiKey'
        );
        break;

      case 'changeModel':
        await vscode.workspace.getConfiguration('trim').update(
          'model',
          msg.model,
          vscode.ConfigurationTarget.Global
        );
        this.refresh();
        break;

      case 'searchHistory':
        // Just re-render with filtered data
        this.view?.webview.postMessage({
          type: 'searchResults',
          conversations: msg.query
            ? this.store.search(msg.query)
            : this.store.getAll(),
        });
        break;

      case 'exportConversation':
        this.exportConversation(msg.id);
        break;

      case 'refresh':
        this.refresh();
        break;
    }
  }

  private async exportConversation(id: string): Promise<void> {
    const conv = this.store.get(id);
    if (!conv) return;

    const content = `# TRIM Conversation Export\n\n` +
      `**Task**: ${conv.task}\n` +
      `**Status**: ${conv.status}\n` +
      `**Date**: ${new Date(conv.timestamp).toLocaleString()}\n` +
      `**Tokens**: ${conv.tokensUsed}\n` +
      `**Model**: ${conv.model || 'N/A'}\n\n` +
      `## Summary\n${conv.summary || 'No summary available.'}\n`;

    const uri = await vscode.window.showSaveDialog({
      filters: { Markdown: ['md'], JSON: ['json'] },
      defaultUri: vscode.Uri.file(
        `${conv.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`
      ),
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(content, 'utf-8')
      );
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div id="app">
    <!-- Header -->
    <div id="header">
      <div id="brand">
        <span id="brand-icon">⊠</span>
        <span id="brand-name">TRIM</span>
      </div>
      <div id="header-actions">
        <button id="btn-new" class="icon-btn" title="New Conversation">+</button>
        <button id="btn-settings" class="icon-btn" title="Settings">⚙</button>
      </div>
    </div>

    <!-- Search -->
    <div id="search-box">
      <input type="text" id="search-input" placeholder="Search conversations..." />
    </div>

    <!-- Quick Tasks -->
    <div id="quick-tasks">
      <div class="section-label">Quick Tasks</div>
      <button class="quick-btn" data-task="Create a new REST API endpoint with Express.js">🌐 New REST API</button>
      <button class="quick-btn" data-task="Add unit tests for the project">🧪 Add Tests</button>
      <button class="quick-btn" data-task="Find and fix all TypeScript errors in the project">🔧 Fix TS Errors</button>
      <button class="quick-btn" data-task="Refactor the codebase to improve performance and readability">📦 Refactor Code</button>
    </div>

    <!-- Model Selector -->
    <div id="model-selector">
      <select id="model-select">
        <option value="deepseek-v4-flash">deepseek-v4-flash</option>
        <option value="deepseek-v4-pro">deepseek-v4-pro</option>
      </select>
    </div>

    <!-- Conversation List -->
    <div id="conversations">
      <div class="section-label">History</div>
      <div id="conv-list"></div>
    </div>

    <!-- Status Bar -->
    <div id="status-bar">
      <span id="status-dot" class="dot disconnected"></span>
      <span id="status-text">No API key</span>
      <span id="token-count"></span>
    </div>
  </div>
  <script>
    ${this.getScript()}
  </script>
</body>
</html>`;
  }

  private getStyles(): string {
    return `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); }
#app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

/* Header */
#header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
#brand { display: flex; align-items: center; gap: 6px; }
#brand-icon { font-size: 18px; color: var(--vscode-textLink-foreground); }
#brand-name { font-weight: 700; font-size: 14px; letter-spacing: 1px; }
#header-actions { display: flex; gap: 4px; }
.icon-btn { background: none; border: none; color: var(--vscode-sideBar-foreground); cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 4px; }
.icon-btn:hover { background: var(--vscode-list-hoverBackground); }

/* Search */
#search-box { padding: 8px 12px; }
#search-input { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; outline: none; }
#search-input:focus { border-color: var(--vscode-focusBorder); }

/* Quick Tasks */
#quick-tasks { padding: 4px 12px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
.section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
.quick-btn { display: block; width: 100%; text-align: left; padding: 5px 8px; margin-bottom: 2px; background: none; border: none; color: var(--vscode-sideBar-foreground); cursor: pointer; border-radius: 4px; font-size: 12px; }
.quick-btn:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-list-hoverForeground); }

/* Model Selector */
#model-selector { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
#model-select { width: 100%; padding: 4px 6px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; font-size: 12px; outline: none; }

/* Conversation List */
#conversations { flex: 1; overflow-y: auto; padding: 8px 12px; }
.conv-item { padding: 8px; border-radius: 4px; cursor: pointer; margin-bottom: 4px; border-left: 3px solid transparent; }
.conv-item:hover { background: var(--vscode-list-hoverBackground); }
.conv-item.running { border-left-color: var(--vscode-editorInfo-foreground); }
.conv-item.completed { border-left-color: var(--vscode-testing-iconPassed); }
.conv-item.stopped { border-left-color: var(--vscode-descriptionForeground); }
.conv-item.failed { border-left-color: var(--vscode-testing-iconFailed); }
.conv-title { font-weight: 500; font-size: 13px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-meta { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; gap: 8px; }
.conv-actions { display: none; margin-top: 4px; gap: 4px; }
.conv-item:hover .conv-actions { display: flex; }
.conv-actions button { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 11px; padding: 2px 6px; border-radius: 3px; }
.conv-actions button:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-list-hoverForeground); }
.conv-empty { text-align: center; padding: 24px 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }

/* Status Bar */
#status-bar { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-top: 1px solid var(--vscode-panel-border); font-size: 11px; color: var(--vscode-descriptionForeground); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot.connected { background: var(--vscode-testing-iconPassed); }
.dot.disconnected { background: var(--vscode-testing-iconFailed); }
#status-text { flex: 1; }
`;
  }

  private getScript(): string {
    return `
const vscode = acquireVsCodeApi();
let conversations = [];

// DOM refs
const convList = document.getElementById('conv-list');
const searchInput = document.getElementById('search-input');
const modelSelect = document.getElementById('model-select');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const tokenCount = document.getElementById('token-count');

// Buttons
document.getElementById('btn-new').addEventListener('click', () => vscode.postMessage({ type: 'newConversation' }));
document.getElementById('btn-settings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));

// Quick tasks
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    vscode.postMessage({ type: 'quickTask', task: btn.dataset.task });
  });
});

// Search
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    vscode.postMessage({ type: 'searchHistory', query: searchInput.value });
  }, 200);
});

// Model select
modelSelect.addEventListener('change', () => {
  vscode.postMessage({ type: 'changeModel', model: modelSelect.value });
});

// Handle messages from extension
window.addEventListener('message', event => {
  const msg = event.data;
  switch (msg.type) {
    case 'refresh':
      conversations = msg.conversations || [];
      modelSelect.value = msg.model || 'deepseek-v4-flash';
      statusDot.className = 'dot ' + (msg.hasApiKey ? 'connected' : 'disconnected');
      statusText.textContent = msg.hasApiKey ? 'API Connected' : 'No API key';
      renderConversations(conversations);
      break;
    case 'searchResults':
      renderConversations(msg.conversations || []);
      break;
  }
});

function renderConversations(list) {
  if (!list || list.length === 0) {
    convList.innerHTML = '<div class="conv-empty">No conversations yet.<br>Start a new task to begin.</div>';
    return;
  }

  let totalTokens = 0;
  convList.innerHTML = list.map(c => {
    totalTokens += c.tokensUsed || 0;
    const date = new Date(c.timestamp);
    const timeStr = date.toLocaleDateString() === new Date().toLocaleDateString()
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const statusLabel = { running: 'Running...', completed: 'Completed', stopped: 'Stopped', failed: 'Failed' }[c.status] || c.status;
    return \`<div class="conv-item \${c.status}" data-id="\${c.id}">
      <div class="conv-title">📄 \${escapeHtml(c.title)}</div>
      <div class="conv-meta">
        <span>\${statusLabel}</span>
        <span>\${timeStr}</span>
        <span>\${c.tokensUsed || 0} tokens</span>
      </div>
      <div class="conv-actions">
        <button class="btn-export" data-id="\${c.id}">Export</button>
        <button class="btn-delete" data-id="\${c.id}">Delete</button>
      </div>
    </div>\`;
  }).join('');

  tokenCount.textContent = \`\${totalTokens} tokens total\`;

  // Attach event listeners
  convList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.conv-actions')) return;
      vscode.postMessage({ type: 'openConversation', id: el.dataset.id });
    });
  });
  convList.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      vscode.postMessage({ type: 'exportConversation', id: btn.dataset.id });
    });
  });
  convList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      vscode.postMessage({ type: 'deleteConversation', id: btn.dataset.id });
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
`;
  }
}

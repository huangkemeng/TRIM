import * as vscode from 'vscode';
import { ToolResult } from '../tools/ToolInterface';
import { DeepSeekConfig } from '../api/types';

type WebviewMessage =
  | { type: 'streamToken'; token: string }
  | { type: 'toolCall'; toolName: string; args: Record<string, unknown> }
  | { type: 'toolResult'; toolName: string; result: ToolResult }
  | { type: 'taskComplete'; summary: string }
  | { type: 'error'; message: string }
  | { type: 'status'; iteration: number; tokensUsed: number }
  | { type: 'clear' }
  | { type: 'setTask'; task: string };

export class AgentWebview {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private onStopCallback: (() => void) | null = null;

  constructor(private extensionUri: vscode.Uri) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'trim',
      'TRIM',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlContent();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message: { type: string }) => {
        if (message.type === 'stop') {
          this.onStopCallback?.();
        }
      },
      undefined,
      this.disposables
    );

    // Cleanup on dispose
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposeAll();
    }, null, this.disposables);
  }

  private disposeAll(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  onStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  postMessage(message: WebviewMessage): void {
    this.panel?.webview.postMessage(message);
  }

  streamToken(token: string): void {
    this.postMessage({ type: 'streamToken', token });
  }

  showToolCall(toolName: string, args: Record<string, unknown>): void {
    this.postMessage({ type: 'toolCall', toolName, args });
  }

  showToolResult(toolName: string, result: ToolResult): void {
    this.postMessage({ type: 'toolResult', toolName, result });
  }

  showTaskComplete(summary: string): void {
    this.postMessage({ type: 'taskComplete', summary });
  }

  showError(message: string): void {
    this.postMessage({ type: 'error', message });
  }

  setTask(task: string): void {
    this.postMessage({ type: 'setTask', task });
  }

  clear(): void {
    this.postMessage({ type: 'clear' });
  }

  close(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>TRIM</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div id="app">
    <div id="header">
      <div id="brand">
        <span id="brand-name">TRIM</span>
        <span id="brand-tagline">Token-Reduced Intelligent Maker</span>
      </div>
      <div id="task-display">
        <span id="task-label">Task:</span>
        <span id="task-text">Waiting for task...</span>
      </div>
      <div id="controls">
        <span id="iteration-display">Iteration: 0</span>
        <button id="stop-btn" title="Stop TRIM">⏹ Stop</button>
      </div>
    </div>
    <div id="messages"></div>
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
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-size: 13px; line-height: 1.5; }
#app { display: flex; flex-direction: column; height: 100vh; }
#header { position: sticky; top: 0; z-index: 10; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
#brand { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
#brand-name { font-weight: 700; font-size: 15px; color: var(--vscode-textLink-foreground); letter-spacing: 1px; }
#brand-tagline { font-size: 10px; color: var(--vscode-descriptionForeground); display: none; }
@media (min-width: 600px) { #brand-tagline { display: inline; } }
#task-display { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 100px; }
#task-label { font-weight: 600; color: var(--vscode-textLink-foreground); margin-right: 4px; }
#task-text { color: var(--vscode-editor-foreground); }
#controls { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
#iteration-display { font-size: 11px; color: var(--vscode-descriptionForeground); }
#stop-btn { background: var(--vscode-errorForeground); color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
#stop-btn:hover { opacity: 0.8; }
#messages { flex: 1; overflow-y: auto; padding: 12px; }
.message { margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; }
.message.assistant { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); }
.message.tool-call { background: var(--vscode-editor-inactiveSelectionBackground); border-left: 3px solid var(--vscode-editorInfo-foreground); font-family: monospace; font-size: 12px; }
.message.tool-result { background: var(--vscode-editor-inactiveSelectionBackground); border-left: 3px solid var(--vscode-editorInfo-foreground); font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
.message.tool-result.success { border-left-color: var(--vscode-testing-iconPassed); }
.message.tool-result.error { border-left-color: var(--vscode-testing-iconFailed); }
.message.system { background: transparent; border-left: 3px solid var(--vscode-descriptionForeground); font-style: italic; color: var(--vscode-descriptionForeground); font-size: 12px; }
.message.complete { background: var(--vscode-testing-iconPassed); color: white; border-left: 3px solid var(--vscode-testing-iconPassed); font-weight: 600; }
.message.error { background: var(--vscode-inputValidation-errorBackground); border-left: 3px solid var(--vscode-inputValidation-errorBorder); }
.message-header { font-weight: 600; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
.tool-args { background: var(--vscode-editor-background); padding: 6px 8px; border-radius: 4px; margin-top: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; overflow-x: auto; max-height: 200px; overflow-y: auto; }
`;
  }

  private getScript(): string {
    return `
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const taskText = document.getElementById('task-text');
const iterationDisplay = document.getElementById('iteration-display');
const stopBtn = document.getElementById('stop-btn');
let currentMessageEl = null;
let iterationCount = 0;

stopBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'stop' });
  addSystemMessage('⏹️ Stop requested by user...');
});

window.addEventListener('message', event => {
  const msg = event.data;
  switch (msg.type) {
    case 'setTask':
      taskText.textContent = msg.task;
      break;
    case 'streamToken':
      if (!currentMessageEl || currentMessageEl.dataset.type !== 'stream') {
        currentMessageEl = createMessageElement('assistant');
        currentMessageEl.dataset.type = 'stream';
        const header = document.createElement('div');
        header.className = 'message-header';
        header.textContent = '🤖 Thinking';
        currentMessageEl.appendChild(header);
        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = '';
        currentMessageEl.appendChild(content);
        messagesEl.appendChild(currentMessageEl);
        scrollToBottom();
      }
      const contentEl = currentMessageEl.querySelector('.message-content');
      if (contentEl) {
        contentEl.textContent += msg.token;
        scrollToBottom();
      }
      break;
    case 'toolCall':
      currentMessageEl = null;
      const toolEl = createMessageElement('tool-call');
      const toolHeader = document.createElement('div');
      toolHeader.className = 'message-header';
      toolHeader.textContent = '🔧 Tool: ' + msg.toolName;
      toolEl.appendChild(toolHeader);
      const argsEl = document.createElement('div');
      argsEl.className = 'tool-args';
      argsEl.textContent = JSON.stringify(msg.args, null, 2);
      toolEl.appendChild(argsEl);
      messagesEl.appendChild(toolEl);
      scrollToBottom();
      break;
    case 'toolResult':
      const resultEl = createMessageElement('tool-result ' + (msg.result.success ? 'success' : 'error'));
      const resultHeader = document.createElement('div');
      resultHeader.className = 'message-header';
      resultHeader.textContent = (msg.result.success ? '✅' : '❌') + ' Result: ' + msg.toolName;
      resultEl.appendChild(resultHeader);
      const resultContent = document.createElement('div');
      resultContent.textContent = (msg.result.data || msg.result.error || '').slice(0, 2000);
      resultEl.appendChild(resultContent);
      if ((msg.result.data || '').length > 2000) {
        const more = document.createElement('div');
        more.style.marginTop = '4px';
        more.style.fontStyle = 'italic';
        more.textContent = '... (output truncated, see full result in the tool)';
        resultEl.appendChild(more);
      }
      messagesEl.appendChild(resultEl);
      scrollToBottom();
      break;
    case 'taskComplete':
      currentMessageEl = null;
      const completeEl = createMessageElement('complete');
      completeEl.textContent = '✅ Task Complete!\\n\\n' + msg.summary;
      messagesEl.appendChild(completeEl);
      scrollToBottom();
      break;
    case 'error':
      currentMessageEl = null;
      const errorEl = createMessageElement('error');
      errorEl.textContent = '❌ Error: ' + msg.message;
      messagesEl.appendChild(errorEl);
      scrollToBottom();
      break;
    case 'status':
      if (msg.iteration) iterationCount = msg.iteration;
      iterationDisplay.textContent = 'Iteration: ' + iterationCount;
      break;
    case 'clear':
      messagesEl.innerHTML = '';
      currentMessageEl = null;
      iterationCount = 0;
      iterationDisplay.textContent = 'Iteration: 0';
      break;
  }
});

function createMessageElement(className) {
  const el = document.createElement('div');
  el.className = 'message ' + className;
  return el;
}

function addSystemMessage(text) {
  const el = createMessageElement('system');
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
`;
  }
}

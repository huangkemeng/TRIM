import * as vscode from 'vscode';
import { SidebarStore, ConversationRecord } from './SidebarStore';

type SidebarView = 'default' | 'history';

interface SidebarState {
  view: SidebarView;
  conversations: ConversationRecord[];
  model: string;
  hasApiKey: boolean;
}

type SidebarMessage =
  | { type: 'sendMessage'; text: string }
  | { type: 'quickTask'; task: string }
  | { type: 'toggleHistory' }
  | { type: 'openConversation'; id: string }
  | { type: 'deleteConversation'; id: string }
  | { type: 'changeModel'; model: string }
  | { type: 'searchHistory'; query: string }
  | { type: 'openSettings' }
  | { type: 'exportConversation'; id: string };

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'trim.main';

  private view?: vscode.WebviewView;
  private store: SidebarStore;
  private currentView: SidebarView = 'default';

  public onSendMessage?: (text: string) => void;
  public onQuickTask?: (task: string) => void;
  public onOpenConversation?: (id: string) => void;

  constructor(
    private extensionUri: vscode.Uri,
    storage: vscode.Memento
  ) {
    this.store = new SidebarStore(storage);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage((msg: SidebarMessage) => this.handleMessage(msg));
    this.pushState();
  }

  private pushState(): void {
    const config = vscode.workspace.getConfiguration('trim');
    const state: SidebarState = {
      view: this.currentView,
      conversations: this.store.getAll(),
      model: config.get<string>('model', 'deepseek-v4-flash'),
      hasApiKey: !!config.get<string>('apiKey', ''),
    };
    this.view?.webview.postMessage({ type: 'setState', state });
  }

  refresh(): void {
    this.pushState();
  }

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

  updateConversation(id: string, updates: Partial<ConversationRecord>): void {
    this.store.update(id, updates);
    this.refresh();
  }

  saveMessages(id: string, messages: any[]): void {
    this.store.update(id, { messages });
  }

  getMessages(id: string): any[] | undefined {
    return this.store.get(id)?.messages;
  }

  getConversation(id: string): ConversationRecord | undefined {
    return this.store.get(id);
  }

  private async handleMessage(msg: SidebarMessage) {
    switch (msg.type) {
      case 'sendMessage':
        this.onSendMessage?.(msg.text);
        break;
      case 'quickTask':
        this.onQuickTask?.(msg.task);
        break;
      case 'toggleHistory':
        this.currentView = this.currentView === 'default' ? 'history' : 'default';
        this.pushState();
        break;
      case 'openConversation':
        this.onOpenConversation?.(msg.id);
        break;
      case 'deleteConversation':
        this.store.delete(msg.id);
        this.refresh();
        break;
      case 'changeModel':
        await vscode.workspace.getConfiguration('trim').update(
          'model', msg.model, vscode.ConfigurationTarget.Global
        );
        this.refresh();
        break;
      case 'searchHistory':
        this.view?.webview.postMessage({
          type: 'searchResults',
          conversations: msg.query ? this.store.search(msg.query) : this.store.getAll(),
        });
        break;
      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'trim.apiKey');
        break;
      case 'exportConversation':
        await this.exportConversation(msg.id);
        break;
    }
  }

  private async exportConversation(id: string): Promise<void> {
    const conv = this.store.get(id);
    if (!conv) return;
    const content = `# TRIM Conversation\n\n**Task**: ${conv.task}\n**Status**: ${conv.status}\n**Date**: ${new Date(conv.timestamp).toLocaleString()}\n**Tokens**: ${conv.tokensUsed}\n\n## Summary\n${conv.summary || ''}\n`;
    const uri = await vscode.window.showSaveDialog({
      filters: { Markdown: ['md'] },
      defaultUri: vscode.Uri.file(conv.title.replace(/[^a-zA-Z0-9]/g, '_') + '.md'),
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
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
<style>${this.getStyles()}</style>
</head>
<body>
<div id="app">
  <!-- Top Bar -->
  <div id="topbar">
    <button id="btn-history" class="topbar-btn" title="Toggle History">☰ <span id="btn-label">History</span></button>
    <div id="brand">
      <span id="brand-icon">⊠</span>
      <span id="brand-name">TRIM</span>
    </div>
    <button id="btn-settings" class="topbar-btn" title="Settings">⚙</button>
  </div>

  <!-- Content Area -->
  <div id="content">
    <!-- Default View: Quick Tasks -->
    <div id="view-default" class="view-panel">
      <div class="section-label">Quick Tasks</div>
      <button class="quick-btn" data-task="Create a new REST API endpoint with Express.js">🌐 New REST API</button>
      <button class="quick-btn" data-task="Add unit tests for the project">🧪 Add Tests</button>
      <button class="quick-btn" data-task="Find and fix all TypeScript errors">🔧 Fix TS Errors</button>
      <button class="quick-btn" data-task="Refactor the codebase to improve performance">📦 Refactor Code</button>
      <button class="quick-btn" data-task="Create a Dockerfile and docker-compose.yml">🐳 Docker Setup</button>
      <button class="quick-btn" data-task="Set up CI/CD pipeline with GitHub Actions">🚀 CI/CD Pipeline</button>
      <button class="quick-btn" data-task="Write API documentation with examples">📝 Write Docs</button>
    </div>

    <!-- History View -->
    <div id="view-history" class="view-panel" style="display:none">
      <div id="history-search">
        <input type="text" id="search-input" placeholder="Search conversations..." />
      </div>
      <div id="conv-list"></div>
    </div>
  </div>

  <!-- Config Bar -->
  <div id="config-bar">
    <select id="model-select">
      <option value="deepseek-v4-flash">deepseek-v4-flash</option>
      <option value="deepseek-v4-pro">deepseek-v4-pro</option>
    </select>
    <span id="status-indicator" class="dot disconnected" title="API Status"></span>
  </div>

  <!-- Input Area (always at bottom) -->
  <div id="input-area">
    <textarea id="message-input" rows="1" placeholder="Type your task here..." maxlength="5000"></textarea>
    <button id="send-btn" disabled title="Send (Enter)">▶</button>
  </div>
</div>
<script>${this.getScript()}</script>
</body>
</html>`;
  }

  private getStyles(): string {
    return `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;background:var(--vscode-sideBar-background);color:var(--vscode-sideBar-foreground)}
#app{display:flex;flex-direction:column;height:100vh;overflow:hidden}

/* Top Bar */
#topbar{display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border);gap:4px;flex-shrink:0}
.topbar-btn{background:none;border:none;color:var(--vscode-sideBar-foreground);cursor:pointer;padding:4px 8px;border-radius:4px;font-size:13px;display:flex;align-items:center;gap:4px}
.topbar-btn:hover{background:var(--vscode-list-hoverBackground)}
#brand{flex:1;text-align:center;display:flex;align-items:center;justify-content:center;gap:4px}
#brand-icon{font-size:16px;color:var(--vscode-textLink-foreground)}
#brand-name{font-weight:700;font-size:13px;letter-spacing:1px}

/* Content */
#content{flex:1;overflow-y:auto;padding:8px 10px;min-height:0}
.view-panel{height:100%}
.section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--vscode-descriptionForeground);margin-bottom:8px;padding:0 2px}
.quick-btn{display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;background:var(--vscode-list-hoverBackground);border:1px solid var(--vscode-panel-border);border-radius:6px;color:var(--vscode-sideBar-foreground);cursor:pointer;font-size:12px}
.quick-btn:hover{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);border-color:var(--vscode-focusBorder)}

/* History Search */
#history-search{margin-bottom:8px}
#search-input{width:100%;padding:6px 8px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;outline:none;font-size:12px}
#search-input:focus{border-color:var(--vscode-focusBorder)}

/* Conversation List */
.conv-item{padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;border-left:3px solid transparent}
.conv-item:hover{background:var(--vscode-list-hoverBackground)}
.conv-item.running{border-left-color:var(--vscode-editorInfo-foreground)}
.conv-item.completed{border-left-color:var(--vscode-testing-iconPassed)}
.conv-item.stopped{border-left-color:var(--vscode-descriptionForeground)}
.conv-item.failed{border-left-color:var(--vscode-testing-iconFailed)}
.conv-title{font-weight:500;font-size:13px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conv-meta{font-size:11px;color:var(--vscode-descriptionForeground);display:flex;gap:8px}
.conv-actions{display:none;margin-top:4px;gap:4px}
.conv-item:hover .conv-actions{display:flex}
.conv-actions button{background:none;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:11px;padding:2px 6px;border-radius:3px}
.conv-actions button:hover{background:var(--vscode-list-hoverBackground)}
.conv-empty{text-align:center;padding:32px 12px;color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.8}

/* Config Bar */
#config-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid var(--vscode-panel-border);flex-shrink:0}
#model-select{flex:1;padding:4px 6px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;font-size:11px;outline:none}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot.connected{background:var(--vscode-testing-iconPassed)}
.dot.disconnected{background:var(--vscode-testing-iconFailed)}

/* Input Area */
#input-area{display:flex;align-items:flex-end;gap:6px;padding:8px;border-top:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);flex-shrink:0}
#message-input{flex:1;padding:8px 10px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:8px;outline:none;resize:none;font-family:inherit;font-size:13px;line-height:1.4;max-height:120px}
#message-input:focus{border-color:var(--vscode-focusBorder)}
#message-input::placeholder{color:var(--vscode-input-placeholderForeground)}
#send-btn{width:36px;height:36px;border:none;background:var(--vscode-textLink-foreground);color:white;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#send-btn:hover{opacity:.85}
#send-btn:disabled{opacity:.4;cursor:default}
`;
  }

  private getScript(): string {
    return `
(function(){
const vscode=acquireVsCodeApi();
const convList=document.getElementById('conv-list');
const searchInput=document.getElementById('search-input');
const modelSelect=document.getElementById('model-select');
const messageInput=document.getElementById('message-input');
const sendBtn=document.getElementById('send-btn');
const statusDot=document.getElementById('status-indicator');
const viewDefault=document.getElementById('view-default');
const viewHistory=document.getElementById('view-history');
const btnLabel=document.getElementById('btn-label');

// Top bar
document.getElementById('btn-history').addEventListener('click',()=>vscode.postMessage({type:'toggleHistory'}));
document.getElementById('btn-settings').addEventListener('click',()=>vscode.postMessage({type:'openSettings'}));

// Quick tasks
document.querySelectorAll('.quick-btn').forEach(btn=>{
  btn.addEventListener('click',()=>vscode.postMessage({type:'quickTask',task:btn.dataset.task}));
});

// Send
function send(){
  const text=messageInput.value.trim();
  if(!text)return;
  vscode.postMessage({type:'sendMessage',text});
  messageInput.value='';
  messageInput.style.height='auto';
  sendBtn.disabled=true;
}
sendBtn.addEventListener('click',send);
messageInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
});
messageInput.addEventListener('input',()=>{
  messageInput.style.height='auto';
  messageInput.style.height=Math.min(messageInput.scrollHeight,120)+'px';
  sendBtn.disabled=!messageInput.value.trim();
});

// Model
modelSelect.addEventListener('change',()=>vscode.postMessage({type:'changeModel',model:modelSelect.value}));

// Search
let st;
searchInput.addEventListener('input',()=>{
  clearTimeout(st);
  st=setTimeout(()=>vscode.postMessage({type:'searchHistory',query:searchInput.value}),200);
});

// Messages from extension
window.addEventListener('message',event=>{
  const msg=event.data;
  if(msg.type==='setState'){
    const s=msg.state;
    modelSelect.value=s.model;
    statusDot.className='dot '+(s.hasApiKey?'connected':'disconnected');
    viewDefault.style.display=s.view==='default'?'block':'none';
    viewHistory.style.display=s.view==='history'?'block':'none';
    btnLabel.textContent=s.view==='history'?'New Task':'History';
    renderConversations(s.conversations);
  }else if(msg.type==='searchResults'){
    renderConversations(msg.conversations||[]);
  }
});

function renderConversations(list){
  if(!list||!list.length){
    convList.innerHTML='<div class="conv-empty">No conversations yet.<br>Type a task below to begin!</div>';
    return;
  }
  convList.innerHTML=list.map(c=>{
    const d=new Date(c.timestamp);
    const ts=d.toLocaleDateString()===new Date().toLocaleDateString()
      ?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
      :d.toLocaleDateString([],{month:'short',day:'numeric'});
    const sl={running:'Running',completed:'Done',stopped:'Stopped',failed:'Failed'}[c.status]||c.status;
    return '<div class="conv-item '+c.status+'" data-id="'+c.id+'">'+
      '<div class="conv-title">📄 '+esc(c.title)+'</div>'+
      '<div class="conv-meta"><span>'+sl+'</span><span>'+ts+'</span><span>'+(c.tokensUsed||0)+' tokens</span></div>'+
      '<div class="conv-actions">'+
        '<button class="btn-exp" data-id="'+c.id+'">Export</button>'+
        '<button class="btn-del" data-id="'+c.id+'">Delete</button>'+
      '</div></div>';
  }).join('');
  convList.querySelectorAll('.conv-item').forEach(el=>{
    el.addEventListener('click',e=>{
      if(e.target.closest('.conv-actions'))return;
      vscode.postMessage({type:'openConversation',id:el.dataset.id});
    });
  });
  convList.querySelectorAll('.btn-exp').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({type:'exportConversation',id:btn.dataset.id})});
  });
  convList.querySelectorAll('.btn-del').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({type:'deleteConversation',id:btn.dataset.id})});
  });
}
function esc(str){var d=document.createElement('div');d.textContent=str;return d.innerHTML}
})();
`;
  }
}

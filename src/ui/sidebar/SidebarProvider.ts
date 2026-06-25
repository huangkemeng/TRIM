import * as vscode from 'vscode';
import { SidebarStore, ConversationRecord } from './SidebarStore';

type SidebarView = 'default' | 'history' | 'chat';

interface SidebarState {
  view: SidebarView;
  conversations: ConversationRecord[];
  model: string;
  hasApiKey: boolean;
  chatTitle?: string;
  chatId?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
}

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result?: { success: boolean; data: string; error?: string };
}

type SidebarMessage =
  | { type: 'sendMessage'; text: string }
  | { type: 'quickTask'; task: string }
  | { type: 'toggleHistory' }
  | { type: 'openConversation'; id: string }
  | { type: 'goBack' }
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
  private chatMessages: ChatMessage[] = [];
  private currentChatId?: string;
  private currentChatTitle?: string;

  public onSendMessage?: (text: string) => void;
  public onQuickTask?: (task: string) => void;
  public onOpenConversation?: (id: string) => void;
  public onGoBack?: () => void;

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
      chatTitle: this.currentChatTitle,
      chatId: this.currentChatId,
    };
    this.view?.webview.postMessage({ type: 'setState', state });
  }

  refresh(): void { this.pushState(); }

  /** Switch to chat view for a new conversation */
  enterChat(id: string, task: string, storedMessages?: ChatMessage[]): void {
    this.currentView = 'chat';
    this.currentChatId = id;
    this.currentChatTitle = task;
    this.chatMessages = storedMessages || [
      { role: 'user', content: task },
      { role: 'assistant', content: '', isStreaming: true },
    ];
    this.pushState();
    // Send messages to webview
    this.view?.webview.postMessage({ type: 'setMessages', messages: this.chatMessages });
  }

  /** Add a user message to the chat */
  addUserMessage(text: string): void {
    this.chatMessages.push({ role: 'user', content: text });
    this.chatMessages.push({ role: 'assistant', content: '', isStreaming: true });
    this.view?.webview.postMessage({ type: 'appendMessages', messages: [
      { role: 'user', content: text },
      { role: 'assistant', content: '', isStreaming: true },
    ]});
  }

  /** Stream a token to the last assistant message */
  streamToken(token: string): void {
    this.view?.webview.postMessage({ type: 'streamToken', token });
  }

  /** Add thinking content to the last message */
  setThinking(thinking: string): void {
    const last = this.chatMessages[this.chatMessages.length - 1];
    if (last && last.role === 'assistant') {
      last.thinking = (last.thinking || '') + thinking;
    }
    this.view?.webview.postMessage({ type: 'updateLastMessage', updates: { thinking } });
  }

  /** Add a tool call to the last message */
  addToolCall(name: string, args: Record<string, unknown>): void {
    const last = this.chatMessages[this.chatMessages.length - 1];
    if (last && last.role === 'assistant') {
      if (!last.toolCalls) last.toolCalls = [];
      last.toolCalls.push({ name, args });
    }
    this.view?.webview.postMessage({ type: 'addToolCall', toolCall: { name, args } });
  }

  /** Add a tool result to the last tool call */
  setToolResult(name: string, result: { success: boolean; data: string; error?: string }): void {
    const last = this.chatMessages[this.chatMessages.length - 1];
    if (last?.toolCalls) {
      const tc = last.toolCalls[last.toolCalls.length - 1];
      if (tc) tc.result = result;
    }
    this.view?.webview.postMessage({ type: 'setToolResult', toolResult: { name, result } });
  }

  /** Finalize the last assistant message (streaming done) */
  finalizeMessage(): void {
    const last = this.chatMessages[this.chatMessages.length - 1];
    if (last) last.isStreaming = false;
    this.view?.webview.postMessage({ type: 'finalizeMessage' });
  }

  /** Save current chat messages to the conversation record in the store */
  saveConversationMessages(conversationId: string): void {
    const conv = this.store.get(conversationId);
    if (!conv) return;
    this.store.update(conversationId, {
      messages: this.chatMessages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        thinking: m.thinking,
        isStreaming: m.isStreaming,
      })),
    });
  }

  addConversation(task: string, model: string): string {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.store.add({
      id, title: SidebarStore.generateTitle(task), task,
      status: 'running', timestamp: Date.now(), tokensUsed: 0, model,
    });
    return id;
  }

  updateConversation(id: string, updates: Partial<ConversationRecord>): void {
    this.store.update(id, updates);
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
        this.currentView = this.currentView === 'history' ? 'default' : 'history';
        this.pushState();
        break;
      case 'goBack':
        this.onGoBack?.();
        this.currentView = 'default';
        this.chatMessages = [];
        this.currentChatId = undefined;
        this.currentChatTitle = undefined;
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
    <button id="btn-back" class="topbar-btn" style="display:none" title="Back">← <span>Back</span></button>
    <button id="btn-history" class="topbar-btn" title="History">☰ <span id="btn-label">History</span></button>
    <div id="brand">
      <span id="brand-icon">⊠</span>
      <span id="brand-name">TRIM</span>
    </div>
    <button id="btn-settings" class="topbar-btn" title="Settings">⚙</button>
  </div>

  <!-- Content Area -->
  <div id="content">
    <!-- Default View -->
    <div id="view-default" class="view-panel">
      <div class="section-label">Quick Tasks</div>
      <button class="quick-btn" data-task="Create a new REST API endpoint with Express.js">🌐 New REST API</button>
      <button class="quick-btn" data-task="Add unit tests for the project">🧪 Add Tests</button>
      <button class="quick-btn" data-task="Find and fix all TypeScript errors">🔧 Fix TS Errors</button>
      <button class="quick-btn" data-task="Refactor the codebase to improve performance">📦 Refactor Code</button>
      <button class="quick-btn" data-task="Create a Dockerfile and docker-compose.yml">🐳 Docker Setup</button>
      <button class="quick-btn" data-task="Set up CI/CD pipeline with GitHub Actions">🚀 CI/CD Pipeline</button>
    </div>

    <!-- History View -->
    <div id="view-history" class="view-panel" style="display:none">
      <div id="history-search"><input type="text" id="search-input" placeholder="Search conversations..." /></div>
      <div id="conv-list"></div>
    </div>

    <!-- Chat View -->
    <div id="view-chat" class="view-panel" style="display:none">
      <div id="chat-title"></div>
      <div id="chat-messages"></div>
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

  <!-- Input Area -->
  <div id="input-area">
    <textarea id="message-input" rows="1" placeholder="Type your message here..." maxlength="5000"></textarea>
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
#content{flex:1;overflow-y:auto;min-height:0}
.view-panel{height:100%;padding:8px 10px}
.section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--vscode-descriptionForeground);margin-bottom:8px;padding:0 2px}
.quick-btn{display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;background:var(--vscode-list-hoverBackground);border:1px solid var(--vscode-panel-border);border-radius:6px;color:var(--vscode-sideBar-foreground);cursor:pointer;font-size:12px}
.quick-btn:hover{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);border-color:var(--vscode-focusBorder)}

/* History */
#history-search{margin-bottom:8px}
#search-input{width:100%;padding:6px 8px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;outline:none;font-size:12px}
#search-input:focus{border-color:var(--vscode-focusBorder)}
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

/* Chat View */
#chat-title{font-size:12px;font-weight:600;padding:6px 2px 8px;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#chat-messages{display:flex;flex-direction:column;gap:8px;padding-bottom:8px}
.msg{display:flex;flex-direction:column;gap:4px}
.msg.user{align-items:flex-end}
.msg.assistant{align-items:flex-start}
.msg-bubble{max-width:95%;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5;word-wrap:break-word;overflow-wrap:break-word}
.msg.user .msg-bubble{background:var(--vscode-textBlockQuote-background);border:1px solid var(--vscode-panel-border);border-bottom-right-radius:2px}
.msg.assistant .msg-bubble{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-bottom-left-radius:2px}
.msg-label{font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);padding:0 4px}

/* Markdown inside messages */
.msg-bubble p{margin:4px 0}
.msg-bubble p:first-child{margin-top:0}
.msg-bubble p:last-child{margin-bottom:0}
.msg-bubble code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-size:11px;font-family:Consolas,monospace}
.msg-bubble pre{background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:4px;overflow-x:auto;margin:6px 0}
.msg-bubble pre code{background:none;padding:0;font-size:11px;display:block;white-space:pre}
.msg-bubble strong{font-weight:600}
.msg-bubble em{font-style:italic}
.msg-bubble ul,.msg-bubble ol{padding-left:16px;margin:4px 0}
.msg-bubble li{margin:2px 0}
.msg-bubble h1,.msg-bubble h2,.msg-bubble h3,.msg-bubble h4{font-weight:600;margin:8px 0 4px}
.msg-bubble h1{font-size:14px}
.msg-bubble h2{font-size:13px}
.msg-bubble h3{font-size:12px}
.msg-bubble table{border-collapse:collapse;margin:6px 0;font-size:11px;width:100%}
.msg-bubble th,.msg-bubble td{border:1px solid var(--vscode-panel-border);padding:4px 6px;text-align:left}
.msg-bubble th{background:var(--vscode-list-hoverBackground);font-weight:600}
.msg-bubble blockquote{border-left:3px solid var(--vscode-panel-border);padding-left:8px;margin:6px 0;color:var(--vscode-descriptionForeground)}
.msg-bubble hr{border:none;border-top:1px solid var(--vscode-panel-border);margin:8px 0}

/* Collapsible sections */
.collapsible{margin:4px 0;border-radius:4px;overflow:hidden}
.collapsible summary{cursor:pointer;padding:4px 8px;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);border-radius:4px;user-select:none}
.collapsible summary:hover{background:var(--vscode-list-hoverBackground)}
.collapsible-content{padding:4px 8px 4px 16px;font-size:11px;color:var(--vscode-descriptionForeground);white-space:pre-wrap;line-height:1.5}
.collapsible-content.thinking{font-style:italic;color:var(--vscode-textPreformat-foreground)}
.tool-item{padding:4px 0}
.tool-name{font-weight:600;color:var(--vscode-editorInfo-foreground)}
.tool-args{font-family:Consolas,monospace;font-size:10px;color:var(--vscode-descriptionForeground);padding:2px 0;white-space:pre-wrap}
.tool-result{font-family:Consolas,monospace;font-size:10px;padding:4px 6px;margin:2px 0;border-radius:3px;background:var(--vscode-textCodeBlock-background);white-space:pre-wrap;max-height:100px;overflow-y:auto}
.tool-result.success{color:var(--vscode-testing-iconPassed)}
.tool-result.error{color:var(--vscode-testing-iconFailed)}

/* Streaming cursor */
.streaming-cursor::after{content:'▊';animation:blink 1s infinite;margin-left:2px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

/* Config Bar */
#config-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid var(--vscode-panel-border);flex-shrink:0}
#model-select{flex:1;padding:4px 6px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;font-size:11px;outline:none}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot.connected{background:var(--vscode-testing-iconPassed)}
.dot.disconnected{background:var(--vscode-testing-iconFailed)}

/* Input */
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
const viewChat=document.getElementById('view-chat');
const btnLabel=document.getElementById('btn-label');
const btnBack=document.getElementById('btn-back');
const chatMessages=document.getElementById('chat-messages');
const chatTitle=document.getElementById('chat-title');

let isChatActive=false;

// Top bar
btnBack.addEventListener('click',()=>vscode.postMessage({type:'goBack'}));
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

// ===== Message Rendering =====
function renderMarkdown(text){
  if(!text)return '';
  let html=text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    // Code blocks
    .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\\n\`\`\`/g,(_,lang,code)=>{
      return '<pre><code>'+esc(code)+'</code></pre>';
    })
    // Inline code
    .replace(/\`([^\`]+)\`/g,'<code>'+esc('$1')+'</code>')
    // Bold
    .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
    // Italic
    .replace(/\\*([^*]+)\\*/g,'<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm,'<h4>$1</h4>')
    .replace(/^## (.+)$/gm,'<h3>$1</h3>')
    .replace(/^# (.+)$/gm,'<h2>$1</h2>')
    // Unordered list
    .replace(/^[-*] (.+)$/gm,'<li>$1</li>')
    // Ordered list
    .replace(/^\\d+\\. (.+)$/gm,'<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gm,'<hr>')
    // Blockquote
    .replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>')
    // Line breaks (double newline = paragraph)
    .replace(/\\n\\n/g,'</p><p>')
    // Single line break
    .replace(/\\n/g,'<br>');
  return '<p>'+html+'</p>';
}

function esc(str){
  var d=document.createElement('div');
  d.textContent=str;
  return d.innerHTML;
}

function addMessage(msg){
  const el=document.createElement('div');
  el.className='msg '+msg.role;
  const label=document.createElement('div');
  label.className='msg-label';
  label.textContent=msg.role==='user'?'You':'TRIM';
  el.appendChild(label);
  const bubble=document.createElement('div');
  bubble.className='msg-bubble';
  if(msg.isStreaming)bubble.classList.add('streaming-cursor');
  bubble.innerHTML=renderMarkdown(msg.content);
  el.appendChild(bubble);

  // Thinking (collapsible)
  if(msg.thinking){
    const details=document.createElement('details');
    details.className='collapsible';
    details.open=false;
    const sum=document.createElement('summary');
    sum.textContent='💭 Thinking';
    details.appendChild(sum);
    const div=document.createElement('div');
    div.className='collapsible-content thinking';
    div.textContent=msg.thinking;
    details.appendChild(div);
    bubble.appendChild(details);
  }

  // Tool calls (collapsible)
  if(msg.toolCalls&&msg.toolCalls.length){
    const details=document.createElement('details');
    details.className='collapsible';
    details.open=false;
    const sum=document.createElement('summary');
    sum.textContent='🔧 Tool Calls ('+msg.toolCalls.length+')';
    details.appendChild(sum);
    const div=document.createElement('div');
    div.className='collapsible-content';
    msg.toolCalls.forEach(tc=>{
      const item=document.createElement('div');
      item.className='tool-item';
      item.innerHTML='<div class="tool-name">🔧 '+esc(tc.name)+'</div>'+
        '<div class="tool-args">'+esc(JSON.stringify(tc.args,null,2))+'</div>';
      if(tc.result){
        const r=document.createElement('div');
        r.className='tool-result '+(tc.result.success?'success':'error');
        r.textContent=tc.result.success?tc.result.data.slice(0,500):'Error: '+(tc.result.error||'');
        item.appendChild(r);
      }
      div.appendChild(item);
    });
    details.appendChild(div);
    bubble.appendChild(details);
  }

  el.appendChild(bubble);
  chatMessages.appendChild(el);
  chatMessages.scrollTop=chatMessages.scrollHeight;
  return {el,bubble};
}

// Handle messages from extension
window.addEventListener('message',event=>{
  const msg=event.data;
  switch(msg.type){
    case 'setState':{
      const s=msg.state;
      modelSelect.value=s.model;
      statusDot.className='dot '+(s.hasApiKey?'connected':'disconnected');
      viewDefault.style.display='none';
      viewHistory.style.display='none';
      viewChat.style.display='none';
      btnBack.style.display='none';
      if(s.view==='default')viewDefault.style.display='block';
      else if(s.view==='history'){viewHistory.style.display='block';renderConversations(s.conversations);}
      else if(s.view==='chat'){viewChat.style.display='block';btnBack.style.display='flex';}
      btnLabel.textContent=s.view==='history'?'New Task':'History';
      if(s.chatTitle)chatTitle.textContent='📄 '+s.chatTitle;
      isChatActive=s.view==='chat';
      break;
    }
    case 'setMessages':{
      chatMessages.innerHTML='';
      (msg.messages||[]).forEach(m=>addMessage(m));
      break;
    }
    case 'appendMessages':{
      (msg.messages||[]).forEach(m=>addMessage(m));
      break;
    }
    case 'streamToken':{
      const last=chatMessages.lastElementChild;
      if(last){
        const bubble=last.querySelector('.msg-bubble');
        if(bubble){
          // Remove cursor class, update content, re-add cursor
          bubble.classList.remove('streaming-cursor');
          const txt=bubble.textContent||'';
          bubble.innerHTML=renderMarkdown(txt+msg.token);
          bubble.classList.add('streaming-cursor');
          chatMessages.scrollTop=chatMessages.scrollHeight;
        }
      }
      break;
    }
    case 'updateLastMessage':{
      const last=chatMessages.lastElementChild;
      if(last&&msg.updates.thinking){
        const bubble=last.querySelector('.msg-bubble');
        if(bubble){
          let details=bubble.querySelector('details');
          if(!details){
            details=document.createElement('details');
            details.className='collapsible';
            details.open=false;
            const sum=document.createElement('summary');
            sum.textContent='💭 Thinking';
            details.appendChild(sum);
            const div=document.createElement('div');
            div.className='collapsible-content thinking';
            details.appendChild(div);
            bubble.appendChild(details);
          }
          const contentDiv=details.querySelector('.collapsible-content');
          if(contentDiv)contentDiv.textContent+=msg.updates.thinking;
        }
      }
      break;
    }
    case 'addToolCall':{
      const last=chatMessages.lastElementChild;
      if(last){
        const bubble=last.querySelector('.msg-bubble');
        if(bubble){
          let details=bubble.querySelector('details:last-of-type');
          if(!details||details.querySelector('summary').textContent.indexOf('Tool')===-1){
            details=document.createElement('details');
            details.className='collapsible';
            details.open=false;
            const sum=document.createElement('summary');
            sum.textContent='🔧 Tool Calls';
            details.appendChild(sum);
            const div=document.createElement('div');
            div.className='collapsible-content';
            details.appendChild(div);
            bubble.appendChild(details);
          }
          const contentDiv=details.querySelector('.collapsible-content');
          const item=document.createElement('div');
          item.className='tool-item';
          item.id='tool-'+Date.now();
          item.innerHTML='<div class="tool-name">🔧 '+esc(msg.toolCall.name)+'</div>'+
            '<div class="tool-args">'+esc(JSON.stringify(msg.toolCall.args,null,2))+'</div>';
          contentDiv.appendChild(item);
          const sum=details.querySelector('summary');
          const match=sum.textContent.match(/\\((\\d+)\\)/);
          const count=match?parseInt(match[1])+1:1;
          sum.textContent='🔧 Tool Calls ('+count+')';
        }
      }
      break;
    }
    case 'setToolResult':{
      const item=chatMessages.querySelector('.tool-item:last-child');
      if(item){
        const r=document.createElement('div');
        r.className='tool-result '+(msg.toolResult.result.success?'success':'error');
        r.textContent=msg.toolResult.result.success
          ?(msg.toolResult.result.data||'').slice(0,500)
          :'Error: '+(msg.toolResult.result.error||'');
        item.appendChild(r);
      }
      break;
    }
    case 'finalizeMessage':{
      const last=chatMessages.lastElementChild;
      if(last){
        const bubble=last.querySelector('.msg-bubble');
        if(bubble)bubble.classList.remove('streaming-cursor');
      }
      break;
    }
    case 'searchResults':
      if(viewHistory.style.display!=='none')renderConversations(msg.conversations||[]);
      break;
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
})();
`;
  }
}

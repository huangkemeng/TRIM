(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const taskText = document.getElementById('task-text');
  const iterationDisplay = document.getElementById('iteration-display');
  const stopBtn = document.getElementById('stop-btn');
  let currentMessageEl = null;
  let iterationCount = 0;

  // Stop button
  stopBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'stop' });
    addSystemMessage('⏹️ Stop requested by user...');
  });

  // Handle messages from extension
  window.addEventListener('message', (event) => {
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
        {
          const resultEl = createMessageElement(
            'tool-result ' + (msg.result.success ? 'success' : 'error')
          );
          const resultHeader = document.createElement('div');
          resultHeader.className = 'message-header';
          resultHeader.textContent =
            (msg.result.success ? '✅' : '❌') + ' Result: ' + msg.toolName;
          resultEl.appendChild(resultHeader);
          const resultContent = document.createElement('div');
          resultContent.textContent = (
            msg.result.data || msg.result.error || ''
          ).slice(0, 2000);
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
        }
        break;

      case 'taskComplete':
        currentMessageEl = null;
        const completeEl = createMessageElement('complete');
        completeEl.textContent = '✅ Task Complete!\n\n' + msg.summary;
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
})();

import { ChatMessage, ToolCall } from '../api/types';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  timestamp: number;
}

export class AgentContext {
  private messages: Message[] = [];
  private maxTokens: number;

  constructor(maxTokens: number = 128000) {
    this.maxTokens = maxTokens;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  addUserMessage(content: string): void {
    this.addMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    this.addMessage({
      role: 'assistant',
      content,
      tool_calls: toolCalls,
      timestamp: Date.now(),
    });
  }

  addToolResult(toolName: string, result: { success: boolean; data: string; error?: string }): void {
    const content = result.success
      ? result.data
      : `Error: ${result.error || 'Unknown error'}`;

    this.addMessage({
      role: 'tool',
      content,
      tool_call_id: `call_${toolName}_${Date.now()}`,
      timestamp: Date.now(),
    });
  }

  getMessages(): Message[] {
    return this.messages;
  }

  toChatMessages(): ChatMessage[] {
    return this.messages.map(m => ({
      role: m.role,
      content: m.content,
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls,
    }));
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }

  get tokenBudget(): number {
    return this.maxTokens;
  }
}

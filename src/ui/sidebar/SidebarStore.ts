import * as vscode from 'vscode';
import { ChatMessage } from '../../api/types';

export type ConversationStatus = 'running' | 'completed' | 'stopped' | 'failed';

export interface ConversationRecord {
  id: string;
  title: string;
  task: string;
  status: ConversationStatus;
  timestamp: number;
  tokensUsed: number;
  summary?: string;
  model?: string;
  messages?: ChatMessage[];
}

const STORAGE_KEY = 'trim.conversations';

export class SidebarStore {
  constructor(private storage: vscode.Memento) {}

  getAll(): ConversationRecord[] {
    return this.storage.get<ConversationRecord[]>(STORAGE_KEY, []);
  }

  get(id: string): ConversationRecord | undefined {
    return this.getAll().find(c => c.id === id);
  }

  add(record: ConversationRecord): void {
    const list = this.getAll();
    list.unshift(record);
    this.storage.update(STORAGE_KEY, list);
  }

  update(id: string, updates: Partial<ConversationRecord>): void {
    const list = this.getAll();
    const index = list.findIndex(c => c.id === id);
    if (index !== -1) {
      list[index] = { ...list[index], ...updates };
      this.storage.update(STORAGE_KEY, list);
    }
  }

  delete(id: string): void {
    const list = this.getAll().filter(c => c.id !== id);
    this.storage.update(STORAGE_KEY, list);
  }

  clearAll(): void {
    this.storage.update(STORAGE_KEY, []);
  }

  search(query: string): ConversationRecord[] {
    if (!query.trim()) return this.getAll();
    const q = query.toLowerCase();
    return this.getAll().filter(
      c =>
        c.title.toLowerCase().includes(q) ||
        c.task.toLowerCase().includes(q) ||
        c.summary?.toLowerCase().includes(q)
    );
  }

  static generateTitle(task: string): string {
    const cleaned = task.replace(/\s+/g, ' ').trim();
    return cleaned.length > 50 ? cleaned.slice(0, 47) + '...' : cleaned;
  }
}

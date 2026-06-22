import * as vscode from 'vscode';
import { DeepSeekConfig } from './api/types';

export interface ValidatedConfig extends DeepSeekConfig {
  maxIterations: number;
  workspaceRoot: string;
  autoApproveCommands: boolean;
}

export function loadConfiguration(): ValidatedConfig {
  const config = vscode.workspace.getConfiguration('trim');

  const apiKey = config.get<string>('apiKey', '');
  const model = config.get<'deepseek-chat' | 'deepseek-reasoner'>('model', 'deepseek-chat');
  const temperature = config.get<number>('temperature', 0.1);
  const maxTokens = config.get<number>('maxTokens', 128000);
  const maxIterations = config.get<number>('maxIterations', 100);
  const autoApproveCommands = config.get<boolean>('autoApproveCommands', false);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';

  // Validation
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'TRIM: DeepSeek API Key is not configured. Set it in Settings → TRIM → Api Key.'
    );
  }

  if (temperature < 0 || temperature > 2) {
    vscode.window.showWarningMessage(
      'TRIM: temperature must be between 0 and 2. Using default (0.1).'
    );
  }

  if (maxIterations < 1 || maxIterations > 500) {
    vscode.window.showWarningMessage(
      'TRIM: maxIterations must be between 1 and 500. Using default (100).'
    );
  }

  if (model !== 'deepseek-chat' && model !== 'deepseek-reasoner') {
    vscode.window.showWarningMessage(
      `TRIM: Unknown model "${model}". Using "deepseek-chat".`
    );
  }

  return {
    apiKey,
    model: model === 'deepseek-chat' || model === 'deepseek-reasoner' ? model : 'deepseek-chat',
    temperature: Math.max(0, Math.min(2, temperature)),
    maxTokens: Math.max(1000, Math.min(128000, maxTokens)),
    maxIterations: Math.max(1, Math.min(500, maxIterations)),
    workspaceRoot,
    autoApproveCommands,
  };
}

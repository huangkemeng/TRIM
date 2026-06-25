import * as vscode from 'vscode';
import { DeepSeekConfig } from './api/types';

export interface ValidatedConfig extends DeepSeekConfig {
  workspaceRoot: string;
  autoApproveCommands: boolean;
  maxTurns: number;
}

export function loadConfiguration(): ValidatedConfig {
  const config = vscode.workspace.getConfiguration('trim');

  const apiKey = config.get<string>('apiKey', '');
  const model = config.get<'deepseek-v4-flash' | 'deepseek-v4-pro'>('model', 'deepseek-v4-flash');
  const temperature = config.get<number>('temperature', 0.1);
  const maxTokens = config.get<number>('maxTokens', 128000);
  const autoApproveCommands = config.get<boolean>('autoApproveCommands', false);
  const maxTurns = config.get<number>('maxTurns', 0);
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

  if (model !== 'deepseek-v4-flash' && model !== 'deepseek-v4-pro') {
    vscode.window.showWarningMessage(
      `TRIM: Unknown model "${model}". Using "deepseek-v4-flash".`
    );
  }

  return {
    apiKey,
    model: model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro' ? model : 'deepseek-v4-flash',
    temperature: Math.max(0, Math.min(2, temperature)),
    maxTokens: Math.max(1000, Math.min(128000, maxTokens)),
    workspaceRoot,
    autoApproveCommands,
    maxTurns: Math.max(0, maxTurns),
  };
}

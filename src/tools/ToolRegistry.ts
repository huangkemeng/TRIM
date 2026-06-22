import { ITool, ToolDefinition } from './ToolInterface';

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  register(tool: ITool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): ITool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: "${name}". Available tools: ${this.list().join(', ')}`);
    }
    return tool;
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  getToolSchemas(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  getOpenAIToolSchemas(): Array<{ type: 'function'; function: ToolDefinition }> {
    return this.getToolSchemas().map(def => ({
      type: 'function' as const,
      function: def,
    }));
  }
}

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

  /**
   * Returns tool schemas in OpenAI/DeepSeek function calling format.
   * Each tool's parameters are wrapped in a proper JSON Schema object
   * with type: "object", properties, and required fields.
   */
  getOpenAIToolSchemas(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
      };
    };
  }> {
    return this.getToolSchemas().map(def => ({
      type: 'function' as const,
      function: {
        name: def.name,
        description: def.description,
        parameters: {
          type: 'object' as const,
          properties: def.parameters as unknown as Record<string, unknown>,
          required: def.requiredParameters,
        },
      },
    }));
  }
}

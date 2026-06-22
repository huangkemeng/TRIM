import OpenAI from 'openai';
import {
  ChatMessage,
  LLMResponse,
  ToolDefinition,
  ToolCall,
} from './types';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class DeepSeekClient {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(
    apiKey: string,
    model: string = 'deepseek-chat',
    temperature: number = 0.1,
    maxTokens: number = 128000
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
      maxRetries: 0, // We handle retries ourselves
    });
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  private toOpenAIMessages(
    messages: ChatMessage[]
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map(m => {
      switch (m.role) {
        case 'system':
          return { role: 'system' as const, content: m.content };
        case 'user':
          return { role: 'user' as const, content: m.content };
        case 'assistant':
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.tool_calls as any,
          };
        case 'tool':
          return {
            role: 'tool' as const,
            content: m.content,
            tool_call_id: m.tool_call_id || '',
          };
        default:
          return { role: 'user' as const, content: m.content };
      }
    });
  }

  /**
   * Check if an error is retryable (rate limit, server error, timeout).
   */
  private isRetryable(error: any): boolean {
    if (error?.status === 429) return true; // Rate limited
    if (error?.status && error.status >= 500) return true; // Server error
    if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET') return true;
    if (error?.message?.includes('timeout')) return true;
    if (error?.message?.includes('rate limit')) return true;
    if (error?.message?.includes('internal server error')) return true;
    return false;
  }

  /**
   * Sleep for a given duration (exponential backoff).
   */
  private async sleep(attempt: number): Promise<void> {
    const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Send a chat completion request with retry logic.
   */
  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: this.toOpenAIMessages(messages),
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          tools: tools as any,
        });

        const choice = response.choices[0];
        const message = choice.message;

        return {
          content: message.content || '',
          toolCalls: message.tool_calls as unknown as ToolCall[] | undefined,
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error: any) {
        lastError = error;

        if (this.isRetryable(error) && attempt < MAX_RETRIES) {
          console.log(
            `[DeepSeekClient] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${error.message}`
          );
          await this.sleep(attempt);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Send a chat completion request with streaming and retry logic.
   */
  async chatStream(
    messages: ChatMessage[],
    options: {
      tools?: ToolDefinition[];
      onToken?: (token: string) => void;
      onToolCall?: (toolCall: ToolCall) => void;
    }
  ): Promise<LLMResponse> {
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: this.toOpenAIMessages(messages),
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          tools: options.tools as any,
          stream: true,
        });

        let content = '';
        const toolCallsMap = new Map<
          number,
          { id: string; type: string; name: string; arguments: string }
        >();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            content += delta.content;
            options.onToken?.(delta.content);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index;
              if (!toolCallsMap.has(index)) {
                toolCallsMap.set(index, {
                  id: tc.id || '',
                  type: tc.type || 'function',
                  name: tc.function?.name || '',
                  arguments: '',
                });
              }
              const existing = toolCallsMap.get(index)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments)
                existing.arguments += tc.function.arguments;
            }
          }
        }

        const toolCalls: ToolCall[] = Array.from(toolCallsMap.values())
          .filter(tc => tc.name)
          .map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));

        return {
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      } catch (error: any) {
        lastError = error;

        if (this.isRetryable(error) && attempt < MAX_RETRIES) {
          console.log(
            `[DeepSeekClient] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${error.message}`
          );
          await this.sleep(attempt);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      return false;
    }
  }
}

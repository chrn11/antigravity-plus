/**
 * OpenAI-compatible API adapter
 */

import type { OpenAIRequest, StreamChunk } from './types.js';

interface ToolCallAccumulator {
  name?: string;
  arguments: string;
  emitted: boolean;
}

export class OpenAIAdapter {
  constructor(
    private baseURL: string,
    private apiKey: string
  ) {}

  async *streamResponse(request: OpenAIRequest): AsyncGenerator<StreamChunk> {
    const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const chunks = this.parseLine(line, toolCalls);
          if (chunks === 'done') {
            yield { type: 'done' };
            return;
          }

          for (const chunk of chunks) {
            yield chunk;
            if (chunk.type === 'done') {
              return;
            }
          }
        }
      }

      buffer += decoder.decode();
      if (buffer) {
        const chunks = this.parseLine(buffer, toolCalls);
        if (chunks === 'done') {
          yield { type: 'done' };
          return;
        }

        for (const chunk of chunks) {
          yield chunk;
          if (chunk.type === 'done') {
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseLine(
    line: string,
    toolCalls: Map<number, ToolCallAccumulator>
  ): StreamChunk[] | 'done' {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) {
      return [];
    }

    if (trimmed === 'data: [DONE]') {
      return 'done';
    }

    if (!trimmed.startsWith('data: ')) {
      return [];
    }

    try {
      const data = JSON.parse(trimmed.slice(6));
      const choice = data.choices?.[0];
      if (!choice) {
        return [];
      }

      const chunks: StreamChunk[] = [];

      if (choice.delta?.content) {
        chunks.push({ type: 'text', content: choice.delta.content });
      }

      if (choice.delta?.reasoning_content) {
        chunks.push({ type: 'thought', content: choice.delta.reasoning_content });
      }

      if (choice.delta?.tool_calls) {
        for (const toolCall of choice.delta.tool_calls) {
          const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
          const current = toolCalls.get(index) ?? { arguments: '', emitted: false };

          if (toolCall.function?.name) {
            current.name = toolCall.function.name;
          }

          if (typeof toolCall.function?.arguments === 'string') {
            current.arguments += toolCall.function.arguments;
          }

          toolCalls.set(index, current);

          if (current.name && current.arguments && !current.emitted) {
            try {
              const args = JSON.parse(current.arguments) as Record<string, unknown>;
              chunks.push({ type: 'tool-call', name: current.name, args });
              current.emitted = true;
            } catch {
              // OpenAI-compatible 提供商可能会把函数参数拆分到多个 SSE 分片。
            }
          }
        }
      }

      if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
        chunks.push({ type: 'done' });
      }

      return chunks;
    } catch {
      return [];
    }
  }
}

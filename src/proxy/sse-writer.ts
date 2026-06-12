/**
 * Gemini SSE response writer
 */

import type { GeminiResponse } from './types.js';

const SAFETY_RATINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
];

export class SseWriter {
  private responseId: string;
  private modelVersion: string;
  private promptTokenCount = 0;
  private candidatesTokenCount = 0;

  constructor(modelVersion: string = 'gemini-2.5-pro') {
    this.responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.modelVersion = modelVersion;
  }

  setUsage(promptTokens: number, candidatesTokens: number): void {
    this.promptTokenCount = promptTokens;
    this.candidatesTokenCount = candidatesTokens;
  }

  /**
   * 增量文本事件
   */
  writeTextEvent(text: string): string {
    return this.writeEvent({
      response: {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ text }] },
            safetyRatings: SAFETY_RATINGS,
          },
        ],
        usageMetadata: this.getUsageMetadata(),
        modelVersion: this.modelVersion,
        responseId: this.responseId,
      },
    });
  }

  /**
   * 思考事件
   */
  writeThoughtEvent(thought: string): string {
    return this.writeEvent({
      response: {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ thought: true, text: thought }] },
            safetyRatings: SAFETY_RATINGS,
          },
        ],
        modelVersion: this.modelVersion,
        responseId: this.responseId,
      },
    });
  }

  /**
   * 工具调用事件
   */
  writeToolCallEvent(name: string, args: Record<string, unknown>): string {
    return this.writeEvent({
      response: {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ functionCall: { name, args } }] },
            safetyRatings: SAFETY_RATINGS,
          },
        ],
        usageMetadata: this.getUsageMetadata(),
        modelVersion: this.modelVersion,
        responseId: this.responseId,
      },
    });
  }

  /**
   * 完成事件
   */
  writeFinalEvent(): string {
    return this.writeEvent({
      response: {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [] },
            finishReason: 'STOP',
            safetyRatings: SAFETY_RATINGS,
          },
        ],
        usageMetadata: this.getUsageMetadata(),
        modelVersion: this.modelVersion,
        responseId: this.responseId,
      },
    });
  }

  /**
   * 错误事件
   */
  writeErrorEvent(error: Error): string {
    return this.writeEvent({
      response: {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ text: `Error: ${error.message}` }] },
            finishReason: 'ERROR',
            safetyRatings: SAFETY_RATINGS,
          },
        ],
        modelVersion: this.modelVersion,
        responseId: this.responseId,
      },
      error: { message: error.message, code: 503 },
    });
  }

  private writeEvent(data: unknown): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  private getUsageMetadata(): GeminiResponse['usageMetadata'] {
    return {
      promptTokenCount: this.promptTokenCount,
      candidatesTokenCount: this.candidatesTokenCount,
      totalTokenCount: this.promptTokenCount + this.candidatesTokenCount,
    };
  }
}

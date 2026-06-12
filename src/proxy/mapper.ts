/**
 * Gemini ↔ OpenAI format mapping
 */

import type {
  Content,
  Part,
  Tool,
  GenerationConfig,
  OpenAIMessage,
  OpenAITool,
} from './types.js';

export function mapContentsToMessages(
  contents: Content[],
  systemInstruction?: string
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  for (const content of contents) {
    const text = content.parts
      .map(partToText)
      .filter((part): part is string => part.length > 0)
      .join('\n');

    messages.push({
      role: content.role === 'model' ? 'assistant' : 'user',
      content: text,
    });
  }

  return messages;
}

export function mapTools(tools: Tool[]): OpenAITool[] {
  return tools.flatMap(tool =>
    tool.functionDeclarations.map(declaration => ({
      type: 'function' as const,
      function: {
        name: declaration.name,
        description: declaration.description,
        parameters: declaration.parameters,
      },
    }))
  );
}

export function mapGenerationConfig(config: GenerationConfig): {
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
} {
  return {
    max_tokens: config.maxOutputTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stop: config.stopSequences,
  };
}

function partToText(part: Part): string {
  if (typeof part.text === 'string') {
    return part.text;
  }

  if (part.functionResponse) {
    return JSON.stringify({
      name: part.functionResponse.name,
      response: part.functionResponse.response,
    });
  }

  if (part.functionCall) {
    return JSON.stringify({
      name: part.functionCall.name,
      args: part.functionCall.args ?? {},
    });
  }

  if (part.inlineData) {
    return `[inline data: ${part.inlineData.mimeType}]`;
  }

  return '';
}

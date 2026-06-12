import type {
  Content,
  GeminiInnerRequest,
  GeminiRequest,
  JsonSchema,
  Part,
  SystemInstruction,
  Tool,
  GenerationConfig,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? value as T[] : undefined;
}

function parsePart(part: unknown): Part | undefined {
  if (!isRecord(part)) {
    return undefined;
  }

  const result: Part = {};

  if (typeof part.text === 'string') {
    result.text = part.text;
  }

  if (typeof part.thought === 'boolean') {
    result.thought = part.thought;
  }

  if (isRecord(part.inlineData)) {
    const mimeType = asString(part.inlineData.mimeType);
    const data = asString(part.inlineData.data);
    if (mimeType && data) {
      result.inlineData = { mimeType, data };
    }
  }

  if (isRecord(part.functionCall)) {
    const name = asString(part.functionCall.name);
    if (name) {
      result.functionCall = {
        name,
        args: isRecord(part.functionCall.args) ? part.functionCall.args : undefined,
      };
    }
  }

  if (isRecord(part.functionResponse)) {
    const name = asString(part.functionResponse.name);
    if (name) {
      result.functionResponse = {
        name,
        response: part.functionResponse.response,
      };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseContent(content: unknown): Content | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const role = content.role === 'model' ? 'model' : 'user';
  const parts = asArray<unknown>(content.parts)?.map(parsePart).filter((part): part is Part => Boolean(part)) ?? [];

  return { role, parts };
}

function parseSystemInstruction(value: unknown): SystemInstruction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const parts = asArray<unknown>(value.parts)?.map(parsePart).filter((part): part is Part => Boolean(part)) ?? [];
  return { parts };
}

function parseTool(tool: unknown): Tool | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }

  const functionDeclarations = asArray<unknown>(tool.functionDeclarations)
    ?.filter(isRecord)
    .map((decl) => {
      const name = asString(decl.name);
      if (!name) {
        return undefined;
      }

      return {
        name,
        description: asString(decl.description),
        parameters: parseJsonSchema(decl.parameters),
      };
    })
    .filter((decl): decl is NonNullable<typeof decl> => Boolean(decl)) ?? [];

  return { functionDeclarations };
}

function parseJsonSchema(value: unknown): JsonSchema | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  const schema: JsonSchema = { type: value.type };

  if (isRecord(value.properties)) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(value.properties)) {
      const parsed = parseJsonSchema(child);
      if (parsed) {
        properties[key] = parsed;
      }
    }

    if (Object.keys(properties).length > 0) {
      schema.properties = properties;
    }
  }

  if (Array.isArray(value.required)) {
    schema.required = value.required.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value.description === 'string') {
    schema.description = value.description;
  }

  if (Array.isArray(value.enum)) {
    schema.enum = value.enum;
  }

  const items = parseJsonSchema(value.items);
  if (items) {
    schema.items = items;
  }

  return schema;
}

function parseGenerationConfig(value: unknown): GenerationConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const config: GenerationConfig = {};

  if (typeof value.temperature === 'number') config.temperature = value.temperature;
  if (typeof value.topP === 'number') config.topP = value.topP;
  if (typeof value.topK === 'number') config.topK = value.topK;
  if (typeof value.maxOutputTokens === 'number') config.maxOutputTokens = value.maxOutputTokens;
  if (Array.isArray(value.stopSequences)) config.stopSequences = value.stopSequences.filter((item): item is string => typeof item === 'string');
  if (typeof value.candidateCount === 'number') config.candidateCount = value.candidateCount;
  if (typeof value.responseMimeType === 'string') config.responseMimeType = value.responseMimeType;

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeInnerRequest(value: unknown): GeminiInnerRequest {
  const source = isRecord(value) ? value : {};

  const contents = asArray<unknown>(source.contents)?.map(parseContent).filter((content): content is Content => Boolean(content)) ?? [];
  const tools = asArray<unknown>(source.tools)?.map(parseTool).filter((tool): tool is Tool => Boolean(tool)) ?? [];

  return {
    model: asString(source.model),
    contents,
    system_instruction: parseSystemInstruction(source.system_instruction),
    tools,
    generationConfig: parseGenerationConfig(source.generationConfig),
  };
}

export function parseGeminiRequest(body: unknown): GeminiRequest {
  const source = isRecord(body) ? body : {};
  const inner = isRecord(source.request) ? source.request : source;

  return {
    project: asString(source.project),
    requestId: asString(source.requestId),
    request: normalizeInnerRequest(inner),
  };
}

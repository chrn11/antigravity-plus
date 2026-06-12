/**
 * Shared types for Antigravity BYOK proxy
 */

// Gemini Request Types
export interface GeminiRequest {
  project?: string;
  requestId?: string;
  request: GeminiInnerRequest;
}

export interface GeminiInnerRequest {
  model?: string;
  contents?: Content[];
  system_instruction?: SystemInstruction;
  tools?: Tool[];
  generationConfig?: GenerationConfig;
}

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface Part {
  text?: string;
  thought?: boolean;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
}

export interface FunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface FunctionResponse {
  name: string;
  response: unknown;
}

export interface SystemInstruction {
  parts: Part[];
}

export interface Tool {
  functionDeclarations: FunctionDeclaration[];
}

export interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: JsonSchema;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
}

export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
}

// Gemini Response Types
export interface GeminiResponse {
  candidates: Candidate[];
  usageMetadata?: UsageMetadata;
  modelVersion?: string;
  responseId?: string;
}

export interface Candidate {
  index: number;
  content: Content;
  finishReason?: string;
  safetyRatings?: SafetyRating[];
  groundingMetadata?: GroundingMetadata;
}

export interface SafetyRating {
  category: string;
  probability: string;
}

export interface GroundingMetadata {
  searchEntryPoint?: {
    renderedContent: string;
  };
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

// OpenAI Request Types
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  reasoning_effort?: 'low' | 'medium' | 'high' | 'max';
}

// OpenAI Response Types
export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// OpenAI Stream Types
export interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIDelta;
  finish_reason: string | null;
}

export interface OpenAIDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIStreamToolCall[];
}

export interface OpenAIStreamToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

// Internal Stream Chunk
export interface StreamChunk {
  type: 'text' | 'thought' | 'tool-call' | 'error' | 'done';
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  error?: Error;
}

// Config Types
export interface ProviderConfig {
  name: string;
  type: 'openai-compatible';
  baseURL: string;
  apiKeyRef?: string;
}

export interface ModelMapping {
  [geminiModel: string]: string;
}

export interface ProxyConfig {
  providers: ProviderConfig[];
  models: ModelMapping;
  proxyPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Antigravity → DeepSeek model mapping with thinking/reasoning_effort support
 */

export interface ModelMappingEntry {
  deepseekModel: string;
  thinking: boolean;
  reasoningEffort?: 'high' | 'max';
}

/**
 * Antigravity 模型名 → DeepSeek 参数映射
 * 
 * DeepSeek 规则：
 * - thinking: enabled/disabled
 * - reasoning_effort: 仅 high/max（low/medium 自动映射为 high）
 * - Flash 模型使用 deepseek-v4-flash
 * - Pro/Claude/GPT 模型使用 deepseek-v4-pro
 */
export const MODEL_MAPPING: Record<string, ModelMappingEntry> = {
  'Gemini 3.5 Flash (Low)': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: false,
  },
  'Gemini 3.5 Flash (Medium)': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: true,
    reasoningEffort: 'high',
  },
  'Gemini 3.5 Flash (High)': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: true,
    reasoningEffort: 'max',
  },
  'Gemini 3.1 Pro (Low)': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'Gemini 3.1 Pro (High)': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'max',
  },
  'Claude Sonnet 4.6 (Thinking)': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'Claude Opus 4.6 (Thinking)': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'max',
  },
  'GPT-OSS 120B (Medium)': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'Gemini 4.0 Ultra': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'max',
  },
  // Antigravity 2.0 二进制精确 ID（不带 Thinking 后缀）
  'claude-opus-4-6': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'max',
  },
  'claude-sonnet-4-6': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'claude-haiku-4-5': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: false,
  },
  'claude-opus-4-5': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'max',
  },
  'claude-sonnet-4-5': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'gemini-2.5-pro': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'gemini-2.5-flash': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: false,
  },
  'gemini-3.1-pro': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'gemini-3.1-flash': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: false,
  },
  'gpt-oss-120b': {
    deepseekModel: 'deepseek-v4-pro',
    thinking: true,
    reasoningEffort: 'high',
  },
  'gpt-oss-20b': {
    deepseekModel: 'deepseek-v4-flash',
    thinking: false,
  },
  // DeepSeek 直通
  'deepseek-v4-flash': { deepseekModel: 'deepseek-v4-flash', thinking: false },
  'deepseek-v4-pro': { deepseekModel: 'deepseek-v4-pro', thinking: true, reasoningEffort: 'high' },
};

/**
 * 解析模型名，返回 DeepSeek 参数
 * 如果模型名不在映射表中，返回默认值
 */
export function resolveModel(antigravityModel: string): ModelMappingEntry {
  return MODEL_MAPPING[antigravityModel] ?? {
    deepseekModel: 'deepseek-v4-flash',
    thinking: false,
  };
}

/**
 * 构造 DeepSeek API 请求的额外参数
 */
export function getDeepSeekOptions(entry: ModelMappingEntry): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  if (entry.thinking) {
    options.thinking = { type: 'enabled' };
  }
  if (entry.reasoningEffort) {
    options.reasoning_effort = entry.reasoningEffort;
  }

  return options;
}

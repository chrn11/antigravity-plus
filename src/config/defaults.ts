/**
 * Default configuration values for DeepSeek
 */

import type { ProxyConfig } from '../proxy/types.js';

export const DEFAULT_CONFIG: ProxyConfig = {
  providers: [
    {
      name: 'deepseek',
      type: 'openai-compatible',
      baseURL: 'https://api.deepseek.com',
    },
  ],
  models: {
    'Gemini 3.5 Flash (Low)': 'deepseek-v4-flash',
    'Gemini 3.5 Flash (Medium)': 'deepseek-v4-flash',
    'Gemini 3.5 Flash (High)': 'deepseek-v4-flash',
    'Gemini 3.1 Pro (Low)': 'deepseek-v4-pro',
    'Gemini 3.1 Pro (High)': 'deepseek-v4-pro',
    'Claude Sonnet 4.6 (Thinking)': 'deepseek-v4-pro',
    'Claude Opus 4.6 (Thinking)': 'deepseek-v4-pro',
    'GPT-OSS 120B (Medium)': 'deepseek-v4-pro',
    'Gemini 4.0 Ultra': 'deepseek-v4-pro',
  },
  proxyPort: 8443,
  logLevel: 'info',
};

import { describe, it, expect } from 'vitest';
import { resolveModel, getDeepSeekOptions } from '../src/proxy/model-mapping.js';

describe('模型映射', () => {
  it('Gemini 3.5 Flash (Low) → deepseek-v4-flash, thinking disabled', () => {
    const result = resolveModel('Gemini 3.5 Flash (Low)');
    expect(result.deepseekModel).toBe('deepseek-v4-flash');
    expect(result.thinking).toBe(false);
    expect(result.reasoningEffort).toBeUndefined();
  });

  it('Gemini 3.5 Flash (Medium) → deepseek-v4-flash, thinking enabled + high', () => {
    const result = resolveModel('Gemini 3.5 Flash (Medium)');
    expect(result.deepseekModel).toBe('deepseek-v4-flash');
    expect(result.thinking).toBe(true);
    expect(result.reasoningEffort).toBe('high');
  });

  it('Gemini 3.5 Flash (High) → deepseek-v4-flash, thinking enabled + max', () => {
    const result = resolveModel('Gemini 3.5 Flash (High)');
    expect(result.deepseekModel).toBe('deepseek-v4-flash');
    expect(result.thinking).toBe(true);
    expect(result.reasoningEffort).toBe('max');
  });

  it('Gemini 3.1 Pro (Low) → deepseek-v4-pro, thinking enabled + high', () => {
    const result = resolveModel('Gemini 3.1 Pro (Low)');
    expect(result.deepseekModel).toBe('deepseek-v4-pro');
    expect(result.thinking).toBe(true);
    expect(result.reasoningEffort).toBe('high');
  });

  it('Gemini 3.1 Pro (High) → deepseek-v4-pro, thinking enabled + max', () => {
    const result = resolveModel('Gemini 3.1 Pro (High)');
    expect(result.deepseekModel).toBe('deepseek-v4-pro');
    expect(result.thinking).toBe(true);
    expect(result.reasoningEffort).toBe('max');
  });

  it('Claude Opus 4.6 (Thinking) → deepseek-v4-pro, thinking enabled + max', () => {
    const result = resolveModel('Claude Opus 4.6 (Thinking)');
    expect(result.deepseekModel).toBe('deepseek-v4-pro');
    expect(result.thinking).toBe(true);
    expect(result.reasoningEffort).toBe('max');
  });

  it('未知模型返回默认值', () => {
    const result = resolveModel('unknown-model');
    expect(result.deepseekModel).toBe('deepseek-v4-flash');
    expect(result.thinking).toBe(false);
  });

  it('getDeepSeekOptions 生成正确的参数', () => {
    const entry = resolveModel('Gemini 3.1 Pro (High)');
    const options = getDeepSeekOptions(entry);
    expect(options.thinking).toEqual({ type: 'enabled' });
    expect(options.reasoning_effort).toBe('max');
  });

  it('getDeepSeekOptions 不生成 disabled 的参数', () => {
    const entry = resolveModel('Gemini 3.5 Flash (Low)');
    const options = getDeepSeekOptions(entry);
    expect(options.thinking).toBeUndefined();
    expect(options.reasoning_effort).toBeUndefined();
  });
});

/**
 * Configuration schema
 */

import type { ProxyConfig } from '../proxy/types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Invalid config: ${message}`);
  }
}

interface RawProxyConfigInput {
  providers: unknown;
  models: unknown;
  proxyPort: unknown;
  logLevel: unknown;
}

export function validateConfig(config: unknown): ProxyConfig {
  assert(isObject(config), 'config must be an object');
  const input = config as RawProxyConfigInput;

  const providers = input.providers;
  assert(Array.isArray(providers), "missing required field 'providers'");
  const providerList = providers as unknown[];
  assert(providerList.length > 0, "'providers' must not be empty");

  const validatedProviders = providerList.map((provider: unknown, index: number) => {
    assert(isObject(provider), `providers[${index}] must be an object`);
    const providerRecord = provider as Record<string, unknown>;

    const nameValue = providerRecord.name;
    const typeValue = providerRecord.type;
    const baseURLValue = providerRecord.baseURL;
    const apiKeyRefValue = providerRecord.apiKeyRef;

    assert(typeof nameValue === 'string' && nameValue.trim().length > 0, `providers[${index}].name is required`);
    assert(typeValue === 'openai-compatible', `providers[${index}].type must be 'openai-compatible'`);
    assert(typeof baseURLValue === 'string' && baseURLValue.trim().length > 0, `providers[${index}].baseURL is required`);
    if (apiKeyRefValue !== undefined) {
      assert(typeof apiKeyRefValue === 'string' && apiKeyRefValue.trim().length > 0, `providers[${index}].apiKeyRef must be a string`);
    }

    const name = nameValue as string;
    const baseURL = baseURLValue as string;
    const apiKeyRef = apiKeyRefValue as string | undefined;

    return {
      name,
      type: 'openai-compatible' as const,
      baseURL,
      ...(apiKeyRef !== undefined ? { apiKeyRef } : {}),
    };
  });

  const models = input.models;
  assert(isObject(models), "missing required field 'models'");
  const modelMap = models as Record<string, unknown>;
  const validatedModels: Record<string, string> = {};
  for (const [geminiModel, mappedModel] of Object.entries(modelMap)) {
    assert(typeof geminiModel === 'string' && geminiModel.trim().length > 0, 'model mapping keys must be strings');
    assert(typeof mappedModel === 'string' && mappedModel.trim().length > 0, `model mapping for '${geminiModel}' must be a string`);
    validatedModels[geminiModel] = mappedModel as string;
  }

  const proxyPort = input.proxyPort;
  assert(Number.isInteger(proxyPort), "missing required field 'proxyPort'");
  assert(typeof proxyPort === 'number' && proxyPort > 0 && proxyPort <= 65535, "'proxyPort' must be between 1 and 65535");

  const logLevel = input.logLevel;
  assert(logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error', "missing or invalid field 'logLevel'");

  return {
    providers: validatedProviders,
    models: validatedModels,
    proxyPort: proxyPort as number,
    logLevel: logLevel as ProxyConfig['logLevel'],
  };
}

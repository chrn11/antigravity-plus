/**
 * Configuration loader with hot-reload
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ProxyConfig } from '../proxy/types.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { validateConfig } from './schema.js';

export class ConfigLoader {
  private configPath: string;
  private watcher: fs.FSWatcher | null = null;

  constructor(configPath?: string) {
    this.configPath =
      configPath ||
      path.join(process.env.APPDATA || process.env.HOME || '.', 'antigravity-plus', 'config.json');
  }

  private buildConfig(rawConfig: unknown): ProxyConfig {
    if (rawConfig === null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      throw new Error('Invalid config: config file must contain a JSON object');
    }

    const config = rawConfig as Record<string, unknown>;
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(config, key);
    const rawModels = has('models') ? config.models : DEFAULT_CONFIG.models;

    return validateConfig({
      providers: has('providers') ? config.providers : DEFAULT_CONFIG.providers,
      models:
        rawModels && typeof rawModels === 'object' && !Array.isArray(rawModels)
          ? { ...DEFAULT_CONFIG.models, ...(rawModels as Record<string, string>) }
          : rawModels,
      proxyPort: has('proxyPort') ? config.proxyPort : DEFAULT_CONFIG.proxyPort,
      logLevel: has('logLevel') ? config.logLevel : DEFAULT_CONFIG.logLevel,
    });
  }

  async load(): Promise<ProxyConfig> {
    try {
      const raw = await fs.promises.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return this.buildConfig(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return validateConfig(DEFAULT_CONFIG);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid config: failed to parse JSON at ${this.configPath}`);
      }
      throw error;
    }
  }

  async save(config: ProxyConfig): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const data = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(this.configPath, data, 'utf8');
  }

  watch(callback: (config: ProxyConfig) => void): void {
    this.stopWatching();

    const watchDir = path.dirname(this.configPath);
    const watchFile = path.basename(this.configPath);

    fs.mkdirSync(watchDir, { recursive: true });

    let timer: NodeJS.Timeout | null = null;

    const triggerReload = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(async () => {
        try {
          callback(await this.load());
        } catch {
          // 忽略热重载期间的临时错误，保留当前运行配置
        }
      }, 50);
    };

    this.watcher = fs.watch(watchDir, (eventType, filename) => {
      if (!filename || filename === watchFile || eventType === 'rename') {
        triggerReload();
      }
    });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

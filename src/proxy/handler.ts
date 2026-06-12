/**
 * Request handler for Gemini API
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import * as dns from 'node:dns';

import { parseGeminiRequest } from './parser.js';
import { mapContentsToMessages, mapGenerationConfig, mapTools } from './mapper.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { SseWriter } from './sse-writer.js';
import type { CredentialManager } from '../credential/manager.js';
import type { OpenAIRequest, ProxyConfig } from './types.js';
import { logger } from '../utils/logger.js';
import { resolveModel, getDeepSeekOptions } from './model-mapping.js';
import { pushLog } from '../utils/log-buffer.js';

import { MODEL_MAPPING } from './model-mapping.js';

const INTERCEPT_PATHS = [
  '/v1internal:streamGenerateContent',
  '/v1internal:cascadeGenerateContent',
  '/v1internal:cascadeStreamGenerateContent',
  '/v1internal:loadCodeAssist',
  '/v1internal:fetchAvailableModels',
  '/v1internal:onboardUser',
  '/v1internal:listExperiments',
  '/v1internal:fetchUserInfo',
  '/v1internal:buildWithGooglePlugins',
];
const AI_PATHS = ['/v1internal:streamGenerateContent', '/v1internal:cascadeGenerateContent', '/v1internal:cascadeStreamGenerateContent'];

/**
 * 非 AI 路径：直接代理到 Google 服务器，返回原始 protobuf 格式。
 * language_server.exe（Go 二进制）期望 protobuf 格式响应，
 * JSON mock 会导致 proto 解析失败后回退到 Google 官方服务器。
 */

/** 构造 fetchAvailableModels 返回的模型列表
 *  列出 Google Gemini 所有公开模型名，Antigravity 内部有硬编码白名单，
 *  只显示两边都有的交集。模型越多，命中概率越大。
 */
function buildModelList(): string {
  const models = [
    { name: 'models/deepseek-v4-flash', displayName: 'deepseek-v4-flash', supportedGenerationMethods: ['generateContent','streamGenerateContent'] },
    { name: 'models/deepseek-v4-pro', displayName: 'deepseek-v4-pro', supportedGenerationMethods: ['generateContent','streamGenerateContent'] },
  ];
  return JSON.stringify({ models });
}

const GOOGLE_HOSTS = [
  'generativelanguage.googleapis.com',
  'cloudcode-pa.googleapis.com',
  'daily-cloudcode-pa.googleapis.com',
];
const GOOGLE_REAL_HOST = 'generativelanguage.googleapis.com';
const MIHOMO_PROXY = 'http://127.0.0.1:7890';

/** 从请求路径推断目标 Google 域名（因为 Go 二进制的 Host 头已丢失） */
function resolveGoogleHost(req: IncomingMessage): string {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (GOOGLE_HOSTS.includes(host)) return host;

  // Go 二进制连接到 127.0.0.1:8080 时 Host 头丢失，
  // 按路径推断目标 Google 服务器：
  // - loadCodeAssist/fetchAvailableModels/onboardUser/fetchUserInfo → cloudcode-pa
  // - streamGenerateContent 等 AI 请求 → generativelanguage
  const url = req.url ?? '';
  if (url.includes('loadCodeAssist') || url.includes('fetchAvailableModels') ||
      url.includes('onboardUser') || url.includes('fetchUserInfo') ||
      url.includes('listExperiments') || url.includes('buildWithGooglePlugins')) {
    return 'cloudcode-pa.googleapis.com';
  }

  return GOOGLE_REAL_HOST;
}

/** 检测 mihomo HTTP 代理是否可用 */
async function detectUpstreamProxy(): Promise<string> {
  try {
    const proxyUrl = new URL(MIHOMO_PROXY);
    return new Promise((resolve) => {
      const proxy = http.request({
        hostname: proxyUrl.hostname,
        port: parseInt(proxyUrl.port || '7890'),
        method: 'CONNECT',
        path: `${GOOGLE_REAL_HOST}:443`,
        timeout: 3000,
      });
      proxy.on('connect', (_res, socket) => {
        socket.destroy();
        proxy.destroy();
        resolve(MIHOMO_PROXY);
      });
      proxy.on('error', () => {
        proxy.destroy();
        resolve('');
      });
      proxy.end();
    });
  } catch {
    return '';
  }
}

let cachedGoogleIp = '';
let upstreamProxyUrl = '';

async function getGoogleIp(): Promise<string> {
  if (cachedGoogleIp) return cachedGoogleIp;

  // 优先检测 mihomo 代理是否可用
  upstreamProxyUrl = await detectUpstreamProxy();
  if (upstreamProxyUrl) {
    logger.info(`检测到上游代理: ${upstreamProxyUrl}，将使用代理连接 Google`);
    // 通过代理连接时，使用域名而不是 IP
    return GOOGLE_REAL_HOST;
  }

  // 没有代理时，尝试 DNS 解析
  try {
    const addrs = await dns.promises.resolve4(GOOGLE_REAL_HOST);
    if (addrs.length > 0) {
      cachedGoogleIp = addrs[0];
      logger.debug(`DNS(${GOOGLE_REAL_HOST}) → ${cachedGoogleIp} (系统 DNS)`);
      return cachedGoogleIp;
    }
  } catch {
    logger.debug('系统 DNS 解析失败，尝试公共 DNS...');
  }

  return new Promise((resolve) => {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    dns.resolve4(GOOGLE_REAL_HOST, (err, addrs) => {
      dns.setServers([]);
      if (!err && addrs.length > 0) {
        cachedGoogleIp = addrs[0];
        logger.debug(`DNS(${GOOGLE_REAL_HOST}) → ${cachedGoogleIp} (公共 DNS)`);
        resolve(cachedGoogleIp);
      } else {
        logger.warn(`DNS 解析失败: ${GOOGLE_REAL_HOST}`);
        resolve('');
      }
    });
  });
}

/**
 * 代理请求到 Google 真实服务器。
 * 支持两种模式：
 * 1. 通过 mihomo HTTP 代理（CONNECT 隧道）
 * 2. 直连（使用 IP + SNI）
 */
async function proxyToGoogle(req: IncomingMessage, res: ServerResponse, _target: string): Promise<void> {
  const body = await readBodyRaw(req);
  // 根据请求的 Host 头决定目标 Google 服务器
  const targetHost = resolveGoogleHost(req);
  logger.info(`proxyToGoogle: ${req.method} ${req.url} → ${targetHost} (via ${upstreamProxyUrl || 'direct'})`);

  if (upstreamProxyUrl) {
    // 通过 mihomo HTTP 代理连接
    const proxyUrl = new URL(upstreamProxyUrl);
    const proxyReq = http.request({
      hostname: proxyUrl.hostname,
      port: parseInt(proxyUrl.port || '7890'),
      method: 'CONNECT',
      path: `${targetHost}:443`,
    });

    proxyReq.on('connect', (proxyRes, socket) => {
      if (proxyRes.statusCode !== 200) {
        logger.error(`代理 CONNECT 失败: ${proxyRes.statusCode}`);
        res.writeHead(502);
        res.end('Proxy CONNECT failed');
        socket.destroy();
        return;
      }

      const tlsOptions = {
        hostname: targetHost,
        port: 443,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: targetHost },
        socket,
        servername: targetHost,
        rejectUnauthorized: false,
      };
      const tlsReq = https.request(tlsOptions, (tlsRes) => {
        logger.info(`Google 响应: ${tlsRes.statusCode} ${req.url}`);
        res.writeHead(tlsRes.statusCode ?? 200, tlsRes.headers);
        tlsRes.pipe(res);
      });
      tlsReq.on('error', (e) => {
        logger.error(`TLS 请求到 ${targetHost} 失败: ${e.message}`);
        if (!res.headersSent) {
          res.writeHead(502);
          res.end('Proxy error');
        }
      });
      if (body && body.length > 0) tlsReq.write(body);
      tlsReq.end();
    });

    proxyReq.on('error', (e) => {
      logger.error(`代理连接失败: ${e.message}`);
      res.writeHead(502);
      res.end('Proxy error');
    });

    proxyReq.end();
  } else if (_target) {
    // 直连模式
    const options = {
      hostname: _target,
      port: 443,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: targetHost },
      rejectUnauthorized: false,
      servername: targetHost,
    };
    const proxy = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('Proxy error'); });
    if (body) proxy.write(body);
    proxy.end();
  } else {
    res.writeHead(502);
    res.end('No route to Google');
  }
}

function readBodyRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

export class RequestHandler {
  constructor(
    private config: ProxyConfig,
    private credentialManager: CredentialManager
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? '?';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const path = url.pathname;
    const shortPath = truncatePath(path);
    const t0 = Date.now();

    // 诊断日志：记录 Go 二进制的请求头
    logger.info(`[REQ] ${method} ${req.url} Host=${req.headers.host} Content-Type=${req.headers['content-type']}`);
    logger.info(`[REQ-HEADERS] ${JSON.stringify(req.headers)}`);

    // 匹配带冒号和不带冒号两种格式（/v1internal:xxx 和 /v1internal/xxx）
    // 使用 URL pathname（不含 query string），确保带查询参数的路径也能匹配
    if (!INTERCEPT_PATHS.some(p => path === p || path === p.replace(':', '/'))) {
      const ip = await getGoogleIp();
      if (ip) {
        log(method, shortPath, 0, `→ Google ${ip}`);
        return proxyToGoogle(req, res, ip);
      }
      log(method, shortPath, 404);
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // 非 AI 路径处理：代理到 Google 真实服务器。
    // language_server.exe（Go 二进制）期望 protobuf 格式响应，
    // JSON mock 会导致 proto 解析失败后回退到 Google 官方服务器。
    if (!AI_PATHS.some(p => path === p || path === p.replace(':', '/'))) {
      const ip = await getGoogleIp();
      if (ip) {
        log(method, shortPath, 0, `→ Google ${ip}`);
        return proxyToGoogle(req, res, ip);
      }
      // DNS 失败时用 mock 兜底（仅 IDE 1.0 Node.js 进程能解析 JSON）
      const shortName = path.replace(/^.*[:\/]/, '');
      if (shortName === 'fetchAvailableModels') {
        log(method, shortPath, 200, 'mock (DNS failed)');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(buildModelList());
        return;
      }
      log(method, shortPath, 502, 'DNS failed');
      res.writeHead(502);
      res.end('DNS resolution failed');
      return;
    }

    try {
      const body = await this.readBody(req);
      const geminiRequest = parseGeminiRequest(body);
      const provider = this.config.providers[0];

      if (!provider) {
        log(method, shortPath, 500, 'no provider');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'No provider configured' }));
        return;
      }

      const apiKey = await this.credentialManager.get('antigravity-plus', provider.name);
      if (!apiKey) {
        log(method, shortPath, 401, 'no API key');
        res.writeHead(401);
        res.end('API Key not configured');
        return;
      }

      let geminiModel = geminiRequest.request.model ?? 'Gemini 3.5 Flash (Medium)';
      if (geminiModel.startsWith('models/')) geminiModel = geminiModel.slice(7);

      const configModel = this.config.models[geminiModel];
      // 始终使用 resolveModel 获取完整的 thinking/reasoning 参数；
      // 用展开操作符创建副本，避免修改 MODELL_MAPPING 常量
      const defaultMapping = resolveModel(geminiModel);
      const mapping = configModel
        ? { ...defaultMapping, deepseekModel: configModel }
        : defaultMapping;

      // 记录未知模型，方便用户补充映射
      if (!configModel && !MODEL_MAPPING[geminiModel]) {
        logger.info(`未知模型: "${geminiModel}"，使用默认映射 → ${mapping.deepseekModel}`);
      }
      const deepseekOptions = getDeepSeekOptions(mapping);

      const messages = mapContentsToMessages(
        geminiRequest.request.contents ?? [],
        geminiRequest.request.system_instruction?.parts?.[0]?.text
      );
      const tools = mapTools(geminiRequest.request.tools ?? []);
      const generationConfig = mapGenerationConfig(geminiRequest.request.generationConfig ?? {});
      const openaiRequest: OpenAIRequest = {
        model: mapping.deepseekModel,
        messages,
        stream: true,
        tools: tools.length > 0 ? tools : undefined,
        ...deepseekOptions,
        ...generationConfig,
      };

      const adapter = new OpenAIAdapter(provider.baseURL, apiKey);
      const sseWriter = new SseWriter(geminiModel);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      let hasErr = false;
      for await (const chunk of adapter.streamResponse(openaiRequest)) {
        switch (chunk.type) {
          case 'text':
            res.write(sseWriter.writeTextEvent(chunk.content ?? ''));
            break;
          case 'thought':
            res.write(sseWriter.writeThoughtEvent(chunk.content ?? ''));
            break;
          case 'tool-call':
            res.write(sseWriter.writeToolCallEvent(chunk.name ?? '', chunk.args ?? {}));
            break;
          case 'done':
            res.write(sseWriter.writeFinalEvent());
            break;
          case 'error':
            hasErr = true;
            res.write(sseWriter.writeErrorEvent(chunk.error ?? new Error('Unknown stream error')));
            break;
        }
      }

      const ms = Date.now() - t0;
      log(method, shortPath, hasErr ? 502 : 200, `[${geminiModel}] → ${mapping.deepseekModel} ${ms}ms`);

      res.end();
    } catch (error) {
      const ms = Date.now() - t0;
      const msg = error instanceof Error ? error.message : String(error);
      log(method, shortPath, 500, `${ms}ms ${msg}`);
      logger.error('Proxy error:', msg);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }
}

// ======================== 日志辅助 ========================

function truncatePath(p: string): string {
  const idx = p.indexOf(':');
  if (idx >= 0) return p.substring(idx);
  return p.length > 32 ? p.slice(-32) : p;
}

function log(method: string, path: string, status: number, detail?: string): void {
  pushLog({
    ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    method,
    path,
    status,
    duration: 0,
    detail,
  });
}

/**
 * 代理服务器
 *   HTTPS 端口 8443 — 用于 IDE 1.0（Node.js 进程，信任自定义 CA）
 *   HTTP  端口 8080 — 用于 Antigravity 2.0（Go 二进制，不信任自定义 CA）
 */

import http from 'node:http';
import https from 'node:https';
import type { CredentialManager } from '../credential/manager.js';
import { RequestHandler } from './handler.js';
import type { ProxyConfig } from './types.js';
import { loadServerTls } from '../cert/manager.js';
import { logger } from '../utils/logger.js';

const HTTP_PORT = 8080;

export class ProxyServer {
  private httpsServer: https.Server | null = null;
  private httpServer: http.Server | null = null;
  private handler: RequestHandler;

  constructor(
    private config: ProxyConfig,
    credentialManager: CredentialManager,
  ) {
    this.handler = new RequestHandler(config, credentialManager);
  }

  async start(): Promise<void> {
    const tls = loadServerTls();

    // HTTPS 服务器（端口 8443）
    this.httpsServer = https.createServer(tls, (req, res) => {
      void this.handler.handle(req, res);
    });

    // HTTP 服务器（端口 8080）— 给 Go 二进制用，不需要 TLS 验证
    this.httpServer = http.createServer((req, res) => {
      void this.handler.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpsServer!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EACCES') {
          reject(new Error(`端口 ${this.config.proxyPort} 需要管理员权限。`));
        } else if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${this.config.proxyPort} 已被占用。`));
        } else {
          reject(err);
        }
      });

      this.httpsServer!.listen(this.config.proxyPort, '127.0.0.1', () => {
        logger.info(`HTTPS 代理已启动: https://127.0.0.1:${this.config.proxyPort}`);
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${HTTP_PORT} 已被占用。`));
        } else {
          reject(err);
        }
      });

      this.httpServer!.listen(HTTP_PORT, '127.0.0.1', () => {
        logger.info(`HTTP 代理已启动: http://127.0.0.1:${HTTP_PORT}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.httpsServer) {
      promises.push(new Promise((resolve) => {
        this.httpsServer!.close(() => {
          this.httpsServer = null;
          logger.info('HTTPS 代理已停止');
          resolve();
        });
      }));
    }
    if (this.httpServer) {
      promises.push(new Promise((resolve) => {
        this.httpServer!.close(() => {
          this.httpServer = null;
          logger.info('HTTP 代理已停止');
          resolve();
        });
      }));
    }
    await Promise.all(promises);
  }

  isRunning(): boolean {
    return this.httpsServer !== null || this.httpServer !== null;
  }
}

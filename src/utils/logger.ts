/**
 * Logger with sensitive data sanitization
 */

import { sanitize } from './sanitize.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  constructor(private level: LogLevel = 'info') {}

  debug(msg: string, ...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.debug) {
      console.debug(this.format('DEBUG', msg), ...this.sanitizeArgs(args));
    }
  }

  info(msg: string, ...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.info) {
      console.info(this.format('INFO', msg), ...this.sanitizeArgs(args));
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.warn) {
      console.warn(this.format('WARN', msg), ...this.sanitizeArgs(args));
    }
  }

  error(msg: string, ...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.error) {
      console.error(this.format('ERROR', msg), ...this.sanitizeArgs(args));
    }
  }

  private format(level: string, msg: string): string {
    const timestamp = new Date().toISOString();
    const sanitized = sanitize(msg);
    return `[${timestamp}] [${level}] ${sanitized}`;
  }

  private sanitizeArgs(args: unknown[]): unknown[] {
    return args.map(arg => {
      if (typeof arg === 'string') {
        return sanitize(arg);
      }
      if (arg instanceof Error) {
        return new Error(sanitize(arg.message));
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.parse(sanitize(JSON.stringify(arg)));
        } catch {
          return '[Object]';
        }
      }
      return arg;
    });
  }
}

// 默认 logger 实例
export const logger = new Logger();

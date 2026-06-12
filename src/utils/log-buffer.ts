/**
 * 共享日志缓冲 — 供面板 SSE 推送和 handler 写入
 * 保留最近 200 条，自动去重相同内容的连续日志
 */

export interface LogEntry {
  ts: string;      // HH:MM:SS
  method: string;
  path: string;
  status: number;
  model?: string;
  duration: number; // ms
  detail?: string;
}

const MAX_LINES = 200;
const buffer: LogEntry[] = [];
const listeners: Set<() => void> = new Set();

export function pushLog(entry: LogEntry): void {
  buffer.push(entry);
  while (buffer.length > MAX_LINES) buffer.shift();
  for (const cb of listeners) cb();
}

export function getLogs(since?: number): LogEntry[] {
  if (since === undefined) return buffer.slice(-100);
  return buffer.filter((_, i) => i >= since);
}

export function getLogCount(): number {
  return buffer.length;
}

export function onNewLog(cb: () => void): void {
  listeners.add(cb);
}

export function offNewLog(cb: () => void): void {
  listeners.delete(cb);
}

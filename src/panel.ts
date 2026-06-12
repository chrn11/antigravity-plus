/**
 * HTTP 配置面板 — 独立模式下的 Web 管理界面
 *
 * 提供 API 端点供前端调用，替代 VS Code Webview。
 * API：
 *   GET  /api/config     → 获取配置 + 密钥状态
 *   POST /api/key        → 保存 API Key
 *   POST /api/test       → 测试 DeepSeek 连接
 *   POST /api/patch/apply  → 应用补丁
 *   POST /api/patch/remove → 恢复补丁
 *   GET  /api/patch/status → 检查补丁状态
 *   POST /api/cert/import  → 导入证书
 *   GET  /api/cert/status  → 检查证书状态
 *   GET  /               → 管理界面 HTML
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ConfigLoader } from './config/loader.js';
import { WindowsCredentialManager } from './credential/windows.js';
import { applyPatch, removePatch, checkPatchStatus } from './patch/patcher.js';
import { installCaToWindows, isCaInstalled } from './cert/manager.js';
import { getLogs, onNewLog, offNewLog } from './utils/log-buffer.js';

// ======================== HTML 面板 ========================

function renderHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Antigravity Plus</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#1e1e1e;color:#d4d4d4;padding:24px;max-width:640px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px;background:linear-gradient(135deg,#0078d4,#4ec9b0);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#858585;font-size:13px;margin-bottom:20px}
.card{background:#252526;border:1px solid#3c3c3c;border-radius:10px;padding:18px;margin-bottom:16px}
.card h3{font-size:14px;color:#ccc;margin-bottom:12px;border-bottom:1px solid#3c3c3c;padding-bottom:8px}
label{display:block;font-size:12px;color:#858585;margin:8px 0 4px}
input,select{padding:8px 10px;border:1px solid#3c3c3c;background:#3c3c3c;color:#d4d4d4;border-radius:6px;font-size:13px;width:100%}
input:focus{outline:none;border-color:#0078d4}
button{padding:7px 14px;border:none;border-radius:6px;font-size:12px;cursor:pointer;margin:4px 4px 0 0;font-weight:500}
.btn-primary{background:#0078d4;color:white}
.btn-secondary{background:transparent;border:1px solid#474747;color:#ccc}
.btn-danger{color:#f44747;border-color:#f44747;background:transparent}
.status{padding:8px 12px;border-radius:6px;margin:8px 0;font-size:12px;display:none}
.status.ok{background:rgba(78,201,176,.1);color:#4ec9b0;border:1px solid rgba(78,201,176,.2);display:block}
.status.fail{background:rgba(244,71,71,.08);color:#f44747;border:1px solid rgba(244,71,71,.2);display:block}
.status.info{background:rgba(0,120,212,.1);color:#4da6e8;border:1px solid rgba(0,120,212,.2);display:block}
.model-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px}
.model-row span{flex:1;color:#858585}
.model-row code{color:#ce9178;font-size:11px}
.footer{text-align:center;color:#555;font-size:11px;margin-top:24px}
.log-line{padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.log-ts{color:#666}
.log-ok{color:#4ec9b0}
.log-err{color:#f44747}
.log-info{color:#858585}
.log-path{color:#ce9178}
.log-model{color:#569cd6}
</style>
</head>
<body>
<h1>⚡ Antigravity Plus</h1>
<p class="sub">BYOK · DeepSeek</p>

<!-- DeepSeek API Key -->
<div class="card">
  <h3>🔑 DeepSeek API Key</h3>
  <label>Base URL</label>
  <input id="baseUrl" value="https://api.deepseek.com" readonly>
  <label>API Key</label>
  <input type="password" id="apiKey" placeholder="sk-..." autocomplete="off">
  <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
    <button class="btn-primary" onclick="saveKey()">保存 Key</button>
    <button class="btn-secondary" onclick="testConn()">测试连接</button>
  </div>
  <div id="testResult" class="status"></div>
</div>

<!-- 补丁管理 -->
<div class="card">
  <h3>🔧 文件补丁</h3>
  <p style="font-size:12px;color:#858585;margin-bottom:8px">修改 Antigravity 的 API 地址指向本地代理</p>
  <div style="display:flex;align-items:center;gap:8px">
    <button class="btn-primary" onclick="applyPatch()">应用补丁</button>
    <button class="btn-danger" onclick="removePatch()">恢复补丁</button>
  </div>
  <div id="patchResult" class="status"></div>
</div>

<!-- 证书管理 -->
<div class="card">
  <h3>🔒 TLS 证书</h3>
  <p style="font-size:12px;color:#858585;margin-bottom:8px">将代理 CA 证书安装到系统信任存储</p>
  <div style="display:flex;align-items:center;gap:8px">
    <button class="btn-primary" onclick="importCert()">导入证书</button>
  </div>
  <div id="certResult" class="status"></div>
</div>

<!-- 模型映射 -->
<div class="card">
  <h3>🧠 模型映射</h3>
  <p style="font-size:12px;color:#858585;margin-bottom:8px">Antigravity 模型 → DeepSeek 模型</p>
  ${[
    ['Gemini 3.5 Flash (Low)', 'deepseek-v4-flash (no think)'],
    ['Gemini 3.5 Flash (Medium)', 'deepseek-v4-flash (think=high)'],
    ['Gemini 3.5 Flash (High)', 'deepseek-v4-flash (think=max)'],
    ['Gemini 3.1 Pro (Low)', 'deepseek-v4-pro (think=high)'],
    ['Gemini 3.1 Pro (High)', 'deepseek-v4-pro (think=max)'],
    ['Claude Sonnet 4.6', 'deepseek-v4-pro (think=high)'],
    ['Claude Opus 4.6', 'deepseek-v4-pro (think=max)'],
    ['GPT-OSS 120B', 'deepseek-v4-pro (think=high)'],
    ['Gemini 4.0 Ultra', 'deepseek-v4-pro (think=max)'],
  ].map(([src, dst]) => `<div class="model-row"><span>${src}</span>→ <code>${dst}</code></div>`).join('')}
</div>

<!-- 请求日志 -->
<div class="card">
  <h3>📋 请求日志 <span style="color:#555;font-weight:normal;font-size:11px;float:right" id="logCount">0 条</span></h3>
  <div id="logContainer" style="max-height:300px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.6;background:#1a1a1a;border-radius:6px;padding:6px 10px"></div>
  <button class="btn-secondary" onclick="clearLogs()" style="margin-top:8px">清空显示</button>
</div>

<div class="footer">Antigravity Plus v2.0 · 仅监听 127.0.0.1</div>

<script>
const api = (url, opts) => fetch(url, opts).then(r => r.json()).catch(e => ({ok:false,error:e.message}));

async function saveKey() {
  const k = document.getElementById('apiKey').value.trim();
  if (!k) return alert('请输入 API Key');
  await api('/api/key', {method:'POST',body:JSON.stringify({key:k}),headers:{'Content-Type':'application/json'}});
  document.getElementById('apiKey').value = '';
  alert('API Key 已保存到 Windows 凭据管理器');
}

async function testConn() {
  const el = document.getElementById('testResult');
  el.className = 'status info'; el.textContent = '测试中...';
  const r = await api('/api/test', {method:'POST'});
  el.className = r.ok ? 'status ok' : 'status fail';
  el.textContent = r.ok ? '✓ DeepSeek 连接成功' : ('✗ ' + (r.error || r.status || '连接失败'));
}

async function applyPatch() {
  const el = document.getElementById('patchResult');
  el.className = 'status info'; el.textContent = '应用补丁中...';
  const r = await api('/api/patch/apply', {method:'POST'});
  el.className = r.success ? 'status ok' : 'status fail';
  el.textContent = r.message;
}

async function removePatch() {
  if (!confirm('确定要恢复为原始 Google API 地址吗？')) return;
  const el = document.getElementById('patchResult');
  el.className = 'status info'; el.textContent = '恢复中...';
  const r = await api('/api/patch/remove', {method:'POST'});
  el.className = r.success ? 'status ok' : 'status fail';
  el.textContent = r.message;
}

async function importCert() {
  const el = document.getElementById('certResult');
  el.className = 'status info'; el.textContent = '导入证书中...';
  const r = await api('/api/cert/import', {method:'POST'});
  el.className = r.success ? 'status ok' : 'status fail';
  el.textContent = r.message;
}

// 日志渲染
const logContainer = document.getElementById('logContainer');
const logCountEl = document.getElementById('logCount');
let logLines = [];

function statusClass(s) {
  if (s >= 500) return 'log-err';
  if (s >= 200 && s < 300) return 'log-ok';
  return 'log-info';
}
function renderLog(e) {
  const cls = statusClass(e.status);
  const d = e.detail || '';
  const html = '<div class="log-line"><span class="log-ts">' + e.ts + '</span> <span class="' + cls + '">' + e.method + ' ' + e.status + '</span> <span class="log-path">' + e.path + '</span> ' + d + '</div>';
  logLines.push(html);
  if (logLines.length > 200) logLines.shift();
  logContainer.innerHTML = logLines.join('');
  logContainer.scrollTop = logContainer.scrollHeight;
  logCountEl.textContent = logLines.length + ' 条';
}
function clearLogs() { logLines = []; logContainer.innerHTML = ''; logCountEl.textContent = '0 条'; }

// SSE 日志连接
const es = new EventSource('/api/logs/stream');
es.onmessage = function(e) {
  try {
    const items = JSON.parse(e.data);
    items.forEach(renderLog);
  } catch {}
};

// 初始加载状态
(async function init() {
  const [patch, cert] = await Promise.all([
    api('/api/patch/status'),
    api('/api/cert/status'),
  ]);
  if (patch.message) {
    const el = document.getElementById('patchResult');
    el.className = patch.applied ? 'status ok' : 'status info';
    el.textContent = patch.message;
  }
  if (cert.message) {
    const el = document.getElementById('certResult');
    el.className = cert.installed ? 'status ok' : 'status info';
    el.textContent = cert.message;
  }
})();
</script>
</body>
</html>`;
}

// ======================== 请求处理 ========================

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('无效的 JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ======================== 路由 ========================

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  loader: ConfigLoader,
  credential: WindowsCredentialManager,
): Promise<boolean> {
  // GET /api/config
  if (req.method === 'GET' && path === '/api/config') {
    const config = await loader.load();
    const key = await credential.get('antigravity-plus', 'deepseek');
    sendJson(res, 200, { ...config, hasKey: !!key });
    return true;
  }

  // POST /api/key
  if (req.method === 'POST' && path === '/api/key') {
    const { key } = await readJsonBody(req);
    if (!key || typeof key !== 'string') {
      sendJson(res, 400, { ok: false, error: '缺少 key 参数' });
      return true;
    }
    await credential.set('antigravity-plus', 'deepseek', key);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST /api/test
  if (req.method === 'POST' && path === '/api/test') {
    const config = await loader.load();
    const key = await credential.get('antigravity-plus', 'deepseek');
    if (!key) {
      sendJson(res, 401, { ok: false, error: 'API Key 未配置' });
      return true;
    }
    try {
      const apiRes = await fetch(`${config.providers[0].baseURL}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      sendJson(res, 200, { ok: apiRes.ok, status: apiRes.status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: msg });
    }
    return true;
  }

  // 补丁相关 API
  if (path === '/api/patch/apply' && req.method === 'POST') {
    const config = await loader.load();
    // 使用 127.0.0.1 而非 localhost：
    // Go 二进制（language_server.exe）在某些 DNS 代理环境下无法解析 localhost，
    // 直接使用 IP 地址绕过 DNS 问题。证书 SAN 同时包含 localhost 和 127.0.0.1。
    const proxyUrl = `https://127.0.0.1:${config.proxyPort}`;
    const result = applyPatch(proxyUrl);
    sendJson(res, 200, result);
    return true;
  }

  if (path === '/api/patch/remove' && req.method === 'POST') {
    const result = removePatch();
    sendJson(res, 200, result);
    return true;
  }

  if (path === '/api/patch/status' && req.method === 'GET') {
    const status = checkPatchStatus();
    sendJson(res, 200, status);
    return true;
  }

  // 证书相关 API
  if (path === '/api/cert/import' && req.method === 'POST') {
    const result = installCaToWindows();
    sendJson(res, 200, result);
    return true;
  }

  if (path === '/api/cert/status' && req.method === 'GET') {
    const installed = isCaInstalled();
    sendJson(res, 200, {
      installed,
      message: installed ? 'CA 证书已安装到系统信任存储' : 'CA 证书未安装',
    });
    return true;
  }

  // SSE 日志流
  if (path === '/api/logs/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // 先发送现有日志
    const existing = getLogs();
    if (existing.length > 0) {
      res.write(`data: ${JSON.stringify(existing)}\n\n`);
    }
    const onLog = () => {
      const latest = getLogs();
      res.write(`data: ${JSON.stringify(latest.slice(-1))}\n\n`);
    };
    onNewLog(onLog);
    req.on('close', () => offNewLog(onLog));
    return true;
  }

  return false; // 未匹配
}

// ======================== 公开入口 ========================

export function startPanel(
  port: number,
  loader: ConfigLoader,
  credential: WindowsCredentialManager,
): void {
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      // API 路由
      const handled = await handleApi(req, res, url.pathname, loader, credential);
      if (handled) return;

      // 默认：HTML 面板
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml());
    } catch (err: unknown) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }).listen(port, '127.0.0.1', () => {
    console.log(`  [面板] http://127.0.0.1:${port}`);
  });
}

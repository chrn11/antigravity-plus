/**
 * Antigravity Plus — 独立启动入口
 *
 * 启动顺序：
 *   1. HTTP 配置面板（端口 4000）
 *   2. HTTPS 代理服务器（端口 8443）
 *
 * 不依赖 VS Code API、不依赖 CDP、不依赖 Puppeteer。
 */

import { startPanel } from './panel.js';
import { ProxyServer } from './proxy/server.js';
import { WindowsCredentialManager } from './credential/windows.js';
import { ConfigLoader } from './config/loader.js';

const PANEL_PORT = 4000;

let proxy: ProxyServer | null = null;

/** 优雅关闭：停止代理服务器，清理资源 */
async function shutdown(): Promise<void> {
  console.log('\n正在关闭代理...');
  if (proxy) {
    try {
      await proxy.stop();
      console.log('代理已停止');
    } catch (err) {
      console.error('停止代理失败:', err instanceof Error ? err.message : err);
    }
  }
  process.exit(0);
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  Antigravity Plus — BYOK for DeepSeek');
  console.log('═══════════════════════════════════════════\n');

  // 注册信号处理器（优雅关闭）
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  // 1. 加载配置
  const loader = new ConfigLoader();
  let config;
  try {
    config = await loader.load();
    console.log(`✓ 配置已加载 (提供者: ${config.providers.map(p => p.name).join(', ')})`);
  } catch (err) {
    console.error('✗ 配置加载失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 2. 启动配置面板
  console.log(`\n[1/2] 启动配置面板...`);
  const credentialManager = new WindowsCredentialManager();
  startPanel(PANEL_PORT, loader, credentialManager);
  console.log(`  面板地址: http://127.0.0.1:${PANEL_PORT}`);

  // 3. 启动代理服务器
  console.log(`\n[2/2] 启动代理服务器...`);
  proxy = new ProxyServer(config, credentialManager);

  try {
    await proxy.start();
    console.log(`  代理地址: https://127.0.0.1:${config.proxyPort}`);
  } catch (err) {
    console.error('\n✗ 代理启动失败:', err instanceof Error ? err.message : err);
    console.error('\n提示：面板仍在运行，可前往 http://127.0.0.1:4000 修改配置后刷新。');
    // 不退出，面板仍然可用
  }

  console.log('\n───────────────────────────────────────────');
  console.log('  下一步：');
  console.log(`  1. 打开 http://127.0.0.1:${PANEL_PORT}`);
  console.log('  2. 输入 DeepSeek API Key 并保存');
  console.log('  3. 点击「应用补丁」修改 Antigravity 配置');
  console.log('  4. 点击「导入证书」安装 TLS 证书');
  console.log('  5. 启动 Antigravity IDE');
  console.log('───────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});

/**
 * Antigravity 文件补丁模块 — 双版本支持
 *
 * 自动检测并支持两种 Antigravity 安装：
 *   - Antigravity IDE（1.0）：解压部署，直接修改核心 JS 文件
 *   - Antigravity（2.0）：asar 打包，提取 → 修改 → 重打包
 *
 * 补丁原理：
 *   将所有 Google API URL 替换为本地代理地址（localhost:8443），
 *   使 Antigravity 的 API 请求通过本地代理转发到用户自己的 AI 供应商。
 *
 * 关键差异：
 *   - IDE（1.0）是 Node.js 进程，注入 NODE_TLS_REJECT_UNAUTHORIZED 绕过 TLS 验证
 *   - asar（2.0）的 language_server.exe 是 Go 二进制，仅替换 URL 即可，
 *     证书验证靠 Windows 信任存储中的 CA 证书
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { logger } from '../utils/logger.js';

// ======================== 类型定义 ========================

export interface PatchResult {
  success: boolean;
  message: string;
  patchedCount: number;
  targetUrl: string;
}

export interface PatchStatus {
  applied: boolean;
  message: string;
  targetUrl?: string;
  version?: 'ide' | 'asar' | null;
}

// ======================== URL 替换列表 ========================

/** 所有需要重定向的 Google API 端点 */
const GOOGLE_API_URLS = [
  'https://autopush-cloudcode-pa.sandbox.googleapis.com',
  'https://preprod-daily-cloudcode-pa.sandbox.googleapis.com',
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://generativelanguage.googleapis.com',
];

/**
 * 用于在 IDE 版本 JS 文件中匹配所有需要重定向的 URL 的正则。
 * 匹配：cloudcode.*.googleapis.com、generativelanguage.googleapis.com、
 *       以及已替换的 127.0.0.1:端口 和 localhost:端口（支持重新补丁）
 */
const GOOGLE_API_URL_PATTERN = /https:\/\/([a-zA-Z0-9.\-]*cloudcode[a-zA-Z0-9.\-]*\.googleapis\.com|generativelanguage\.googleapis\.com|127\.0\.0\.1:\d+|localhost:\d+)/g;

/** TLS 绕过注入代码（仅用于 IDE 1.0 的 Node.js 进程） */
const TLS_BYPASS = "process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';";

// ======================== IDE 版本（1.0）路径检测 ========================

/** IDE 版本补丁目标文件（相对于 base 目录） */
const IDE_PATCH_TARGETS = [
  'vs/workbench/api/node/extensionHostProcess.js',
  'vs/workbench/api/worker/extensionHostWorkerMain.js',
  'main.js',
  'vs/code/node/cliProcessMain.js',
] as const;

const IDE_BACKUP_EXT = '.js.bak';

/**
 * 检测 Antigravity IDE（1.0）安装路径。
 * 搜索 %LOCALAPPDATA%\Programs\Antigravity IDE\resources\app\out\
 */
export function findIdeBase(): string | null {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates: string[] = [];

  if (localAppData) {
    candidates.push(join(localAppData, 'Programs', 'Antigravity IDE'));
  }

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  candidates.push(join(programFiles, 'Antigravity IDE'));
  candidates.push(join(programFilesX86, 'Antigravity IDE'));

  for (let drive = 'C'; drive <= 'Z'; drive = String.fromCharCode(drive.charCodeAt(0) + 1)) {
    candidates.push(`${drive}:\\Antigravity IDE`);
    candidates.push(join(`${drive}:\\`, 'Program Files', 'Antigravity IDE'));
  }

  for (const candidate of candidates) {
    const resolved = tryResolveIdeBase(candidate);
    if (resolved) return resolved;
  }

  return null;
}

function tryResolveIdeBase(candidate: string): string | null {
  const out = join(candidate, 'resources', 'app', 'out');
  if (existsSync(join(out, 'main.js'))) return out;

  const app = join(candidate, 'resources', 'app');
  if (existsSync(join(app, 'main.js'))) return app;

  if (existsSync(join(candidate, 'main.js')) && existsSync(join(candidate, 'vs'))) {
    return candidate;
  }

  return null;
}

// ======================== asar 版本（2.0）路径检测 ========================

export function findAppAsar(): string | null {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates: string[] = [];

  if (localAppData) {
    candidates.push(join(localAppData, 'Programs', 'Antigravity', 'resources', 'app.asar'));
  }

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  candidates.push(join(programFiles, 'Antigravity', 'resources', 'app.asar'));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  try {
    const regOutput = execSync(
      'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f Antigravity /d 2>nul',
      { encoding: 'utf8', timeout: 5000 }
    );
    for (const line of regOutput.split('\n')) {
      if (line.includes('REG_SZ')) {
        const val = line.split('REG_SZ')[1]?.trim().replace(/"/g, '') || '';
        if (val.toLowerCase().includes('antigravity') && val.endsWith('.exe')) {
          if (val.toLowerCase().includes('antigravity ide')) continue;
          const asarPath = join(dirname(val), 'resources', 'app.asar');
          if (existsSync(asarPath)) return asarPath;
        }
      }
    }
  } catch { /* 忽略 */ }

  return null;
}

// ======================== asar 操作 ========================

function extractAsar(asarPath: string): string {
  const extractDir = asarPath + '.extracted';
  logger.info(`解压 asar: ${asarPath} → ${extractDir}`);

  try {
    execSync(`npx --yes @electron/asar extract "${asarPath}" "${extractDir}"`, {
      encoding: 'utf8',
      timeout: 60000,
      stdio: 'pipe',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`解压 asar 失败: ${msg}`);
  }

  return extractDir;
}

function packAsar(sourceDir: string, asarPath: string): void {
  logger.info(`重新打包 asar: ${sourceDir} → ${asarPath}`);

  try {
    execSync(`npx --yes @electron/asar pack "${sourceDir}" "${asarPath}"`, {
      encoding: 'utf8',
      timeout: 60000,
      stdio: 'pipe',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`打包 asar 失败: ${msg}`);
  }
}

// ======================== URL 归一化 ========================

/**
 * 确保目标 URL 使用 127.0.0.1 而非 localhost。
 * Antigravity 2.0（Go 二进制）不信任自定义 CA 证书，
 * 因此使用 HTTP 协议（不需要 TLS 验证）。
 * 如果 targetUrl 是 https://127.0.0.1:8443，对 2.0 版本自动转为 http://127.0.0.1:8080。
 */
function normalizeTargetUrl(url: string, version?: 'ide' | 'asar' | null): string {
  // 统一 localhost → 127.0.0.1
  url = url.replace(/https:\/\/localhost:/, 'https://127.0.0.1:');
  url = url.replace(/http:\/\/localhost:/, 'http://127.0.0.1:');
  // Antigravity 2.0（asar/Go 二进制）使用 HTTP，避免 TLS 证书验证问题
  if (version === 'asar') {
    url = url.replace(/https:\/\/127\.0\.0\.1:8443/, 'http://127.0.0.1:8080');
  }
  return url;
}

// ======================== IDE 版本补丁操作 ========================

function applyIdePatch(basePath: string, targetUrl: string): PatchResult {
  const normalizedUrl = normalizeTargetUrl(targetUrl, 'ide');
  let patchedCount = 0;
  const errors: string[] = [];

  for (const relativePath of IDE_PATCH_TARGETS) {
    const filePath = join(basePath, relativePath);
    if (!existsSync(filePath)) {
      logger.debug(`IDE 补丁目标不存在: ${filePath}`);
      continue;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const backupPath = filePath + IDE_BACKUP_EXT;

      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, content);
      }

      // 正则替换所有 Google API URL（含已补丁的 localhost/127.0.0.1 地址）
      let replaced = content.replace(GOOGLE_API_URL_PATTERN, normalizedUrl);

      // IDE 版本注入 TLS 绕过（Node.js 进程生效）
      if (!replaced.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
        replaced = TLS_BYPASS + '\n' + replaced;
      }

      if (replaced !== content) {
        writeFileSync(filePath, replaced);
        patchedCount++;
        logger.info(`IDE 补丁: ${relativePath}`);
      } else if (content.includes(normalizedUrl)) {
        patchedCount++;
        logger.info(`IDE 已补丁: ${relativePath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`写入 ${relativePath} 失败: ${msg}`);
      logger.error(`IDE 补丁失败 ${relativePath}: ${msg}`);
    }
  }

  if (patchedCount === 0 && errors.length > 0) {
    return { success: false, patchedCount: 0, message: errors.join('; '), targetUrl: normalizedUrl };
  }
  if (patchedCount === 0) {
    return { success: false, patchedCount: 0, message: '没有找到任何 IDE 核心文件', targetUrl: normalizedUrl };
  }

  const msg = errors.length > 0
    ? `IDE 补丁：${patchedCount} 个文件 → ${normalizedUrl}（警告: ${errors.join('; ')}）`
    : `IDE 补丁：${patchedCount} 个文件 → ${normalizedUrl}`;
  return { success: true, patchedCount, message: msg, targetUrl: normalizedUrl };
}

function removeIdePatch(basePath: string): PatchResult {
  let restoredCount = 0;
  const errors: string[] = [];

  for (const relativePath of IDE_PATCH_TARGETS) {
    const filePath = join(basePath, relativePath);
    const backupPath = filePath + IDE_BACKUP_EXT;

    if (!existsSync(backupPath)) continue;

    try {
      const backup = readFileSync(backupPath, 'utf8');
      if (existsSync(filePath)) {
        const current = readFileSync(filePath, 'utf8');
        if (current === backup) {
          unlinkSync(backupPath);
          restoredCount++;
          continue;
        }
      }
      writeFileSync(filePath, backup);
      unlinkSync(backupPath);
      restoredCount++;
      logger.info(`IDE 恢复: ${relativePath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`恢复 ${relativePath} 失败: ${msg}`);
    }
  }

  if (restoredCount === 0) {
    return { success: false, patchedCount: 0, message: errors.length > 0 ? errors.join('; ') : '没有找到可恢复的备份', targetUrl: '' };
  }

  return { success: true, patchedCount: restoredCount, message: `IDE 恢复：${restoredCount} 个文件`, targetUrl: '' };
}

function checkIdePatchStatus(basePath: string): PatchStatus {
  const mainJsPath = join(basePath, 'main.js');
  if (!existsSync(mainJsPath)) {
    return { applied: false, message: 'main.js 不存在', version: 'ide' };
  }

  try {
    const content = readFileSync(mainJsPath, 'utf8');

    if (!content.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
      return { applied: false, message: 'IDE 补丁未应用', version: 'ide' };
    }

    const urlMatch = content.match(/https?:\/\/(127\.0\.0\.1|localhost):(\d+)/);
    if (urlMatch) {
      return { applied: true, message: `IDE 补丁已应用 (${urlMatch[1]}:${urlMatch[2]})`, targetUrl: urlMatch[0], version: 'ide' };
    }

    return { applied: true, message: 'IDE 补丁已应用', version: 'ide' };
  } catch {
    return { applied: false, message: '无法读取 main.js', version: 'ide' };
  }
}

// ======================== asar 版本补丁操作 ========================

const ASAR_BACKUP_EXT = '.bak';

function applyAsarPatch(asarPath: string, targetUrl: string): PatchResult {
  const normalizedUrl = normalizeTargetUrl(targetUrl, 'asar');
  let extractDir: string | undefined;

  try {
    // 1. 备份原 asar
    const backupPath = asarPath + ASAR_BACKUP_EXT;
    if (!existsSync(backupPath)) {
      copyFileSync(asarPath, backupPath);
      logger.info(`备份: ${asarPath} → ${backupPath}`);
    }

    // 2. 解压
    extractDir = extractAsar(asarPath);

    // 3. 查找并修改目标文件
    // Antigravity 2.0 的关键文件是 dist/languageServer.js，
    // 它向 language_server.exe（Go 二进制）传递 --api_server_url 和 --cloud_code_endpoint 参数。
    // main.js 不含 API URL，仅作为兜底检查。
    const targetFiles = [
      join(extractDir, 'dist', 'languageServer.js'),
      join(extractDir, 'dist', 'main.js'),
    ];

    let patchedAny = false;
    for (const targetFile of targetFiles) {
      if (!existsSync(targetFile)) continue;

      let content = readFileSync(targetFile, 'utf8');
      let changes = 0;

      // 替换所有 Google API URL（逐个检查，不能因为其他 URL 已替换就跳过）
      for (const url of GOOGLE_API_URLS) {
        if (!content.includes(url)) continue;
        const before = content.length;
        content = content.replaceAll(url, normalizedUrl);
        if (content.length !== before) changes++;
      }

      // 同时替换已补丁的旧地址：
      // - localhost → 127.0.0.1（Go 二进制 DNS 解析问题）
      // - 127.0.0.1 → 当前目标（支持迁移）
      const beforeRegex = content.length;
      content = content.replace(/https:\/\/localhost:(\d+)/g, normalizedUrl);
      content = content.replace(/https?:\/\/127\.0\.0\.1:(\d+)/g, normalizedUrl);
      if (content.length !== beforeRegex) changes++;

      // 注意：asar 版本不注入 NODE_TLS_REJECT_UNAUTHORIZED。
      // language_server.exe 是 Go 二进制，不读取 Node.js 环境变量。
      // TLS 验证靠 Windows 信任存储中的 CA 证书解决。

      if (changes > 0) {
        writeFileSync(targetFile, content, 'utf8');
        patchedAny = true;
        logger.info(`asar 补丁: ${targetFile} (${changes} 处变更)`);
      }
    }

    // 如果文件已包含目标 URL（被 proxy-tools 等补丁过），也算成功
    if (!patchedAny) {
      const lsFile = join(extractDir, 'dist', 'languageServer.js');
      if (existsSync(lsFile) && readFileSync(lsFile, 'utf8').includes(normalizedUrl)) {
        rmSync(extractDir, { recursive: true, force: true });
        return { success: true, patchedCount: 0, message: `asar 已包含目标地址 ${normalizedUrl}，无需修改`, targetUrl: normalizedUrl };
      }

      rmSync(extractDir, { recursive: true, force: true });
      return { success: false, patchedCount: 0, message: '未找到可替换的 Google API URL', targetUrl: normalizedUrl };
    }

    // 4. 重新打包
    packAsar(extractDir, asarPath);

    // 5. 清理
    rmSync(extractDir, { recursive: true, force: true });

    return {
      success: true,
      patchedCount: 1,
      message: `asar 补丁已应用 → ${normalizedUrl}。请重启 Antigravity 使设置生效。`,
      targetUrl: normalizedUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (extractDir && existsSync(extractDir)) {
      try { rmSync(extractDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }

    return { success: false, patchedCount: 0, message: `asar 补丁失败: ${msg}`, targetUrl: normalizedUrl };
  }
}

function removeAsarPatch(asarPath: string): PatchResult {
  const backupPath = asarPath + ASAR_BACKUP_EXT;

  if (!existsSync(backupPath)) {
    return { success: false, patchedCount: 0, message: '未找到 asar 备份文件', targetUrl: '' };
  }

  try {
    copyFileSync(backupPath, asarPath);
    logger.info(`恢复: ${backupPath} → ${asarPath}`);
    return { success: true, patchedCount: 1, message: 'asar 已从备份恢复。请重启 Antigravity 使设置生效。', targetUrl: '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, patchedCount: 0, message: `恢复失败: ${msg}`, targetUrl: '' };
  }
}

function checkAsarPatchStatus(asarPath: string): PatchStatus {
  const backupPath = asarPath + ASAR_BACKUP_EXT;

  if (!existsSync(backupPath)) {
    return { applied: false, message: '未找到 asar 备份（可能未补丁）', version: 'asar' };
  }

  // 从 asar 中提取 languageServer.js 检查补丁状态
  let extractDir: string | undefined;
  try {
    extractDir = extractAsar(asarPath);
    const lsFile = join(extractDir, 'dist', 'languageServer.js');

    if (!existsSync(lsFile)) {
      rmSync(extractDir, { recursive: true, force: true });
      return { applied: false, message: 'asar 内未找到 languageServer.js', version: 'asar' };
    }

    const content = readFileSync(lsFile, 'utf8');
    rmSync(extractDir, { recursive: true, force: true });

    const urlMatch = content.match(/https?:\/\/(127\.0\.0\.1|localhost):(\d+)/);
    if (urlMatch) {
      return {
        applied: true,
        message: `asar 补丁已应用 (${urlMatch[1]}:${urlMatch[2]})`,
        targetUrl: urlMatch[0],
        version: 'asar',
      };
    }

    // 有备份但没有代理地址 = 补丁状态不明
    return { applied: true, message: 'asar 有备份但未检测到代理地址（可能被其他工具补丁）', version: 'asar' };
  } catch (err) {
    if (extractDir && existsSync(extractDir)) {
      try { rmSync(extractDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { applied: false, message: `检查失败: ${msg}`, version: 'asar' };
  }
}

// ======================== 统一入口 ========================

export function applyPatch(targetUrl: string): PatchResult {
  const ideBase = findIdeBase();
  const asarPath = findAppAsar();

  const results: PatchResult[] = [];

  if (ideBase) {
    logger.info(`检测到 IDE 版本: ${ideBase}`);
    results.push(applyIdePatch(ideBase, targetUrl));
  }

  if (asarPath) {
    logger.info(`检测到 asar 版本: ${asarPath}`);
    results.push(applyAsarPatch(asarPath, targetUrl));
  }

  if (results.length === 0) {
    return { success: false, patchedCount: 0, message: '未检测到任何 Antigravity 安装', targetUrl };
  }

  // 合并结果
  const allSuccess = results.every(r => r.success);
  const totalCount = results.reduce((sum, r) => sum + r.patchedCount, 0);
  const messages = results.map(r => r.message).join('；');
  const finalUrl = results.find(r => r.targetUrl)?.targetUrl || targetUrl;

  return {
    success: allSuccess,
    patchedCount: totalCount,
    message: messages,
    targetUrl: finalUrl,
  };
}

export function removePatch(): PatchResult {
  const ideBase = findIdeBase();
  const asarPath = findAppAsar();

  const results: PatchResult[] = [];

  if (ideBase) {
    results.push(removeIdePatch(ideBase));
  }

  if (asarPath) {
    results.push(removeAsarPatch(asarPath));
  }

  if (results.length === 0) {
    return { success: false, patchedCount: 0, message: '未检测到任何 Antigravity 安装', targetUrl: '' };
  }

  const allSuccess = results.every(r => r.success);
  const totalCount = results.reduce((sum, r) => sum + r.patchedCount, 0);
  const messages = results.map(r => r.message).join('；');

  return {
    success: allSuccess,
    patchedCount: totalCount,
    message: messages,
    targetUrl: '',
  };
}

export function checkPatchStatus(): PatchStatus {
  const ideBase = findIdeBase();
  const asarPath = findAppAsar();

  if (ideBase) {
    return checkIdePatchStatus(ideBase);
  }

  if (asarPath) {
    return checkAsarPatchStatus(asarPath);
  }

  return { applied: false, message: '未检测到任何 Antigravity 安装', version: null };
}

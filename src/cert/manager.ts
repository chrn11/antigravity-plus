/**
 * TLS 证书管理 — CA 生成 + 通配符服务端证书 + Windows 信任存储
 *
 * 参考 gen-cert.cjs 的正确逻辑：
 *   1. 生成 CA 证书（10 年有效期）
 *   2. 安装 CA 到 Windows 受信任根证书存储
 *   3. 用 CA 签发服务端证书，SAN 包含 *.googleapis.com 等
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import forge from 'node-forge';
import { logger } from '../utils/logger.js';

const { pki, md } = forge;

// ======================== 路径工具 ========================

function getCertDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(appData, 'antigravity-plus', 'certs');
}

function caKeyPath(): string {
  return path.join(getCertDir(), 'ca-key.pem');
}
function caCertPath(): string {
  return path.join(getCertDir(), 'ca-cert.pem');
}
function serverKeyPath(): string {
  return path.join(getCertDir(), 'private-key.pem');
}
function serverCertPath(): string {
  return path.join(getCertDir(), 'certificate.pem');
}

/** Google API 相关域名和 IP SAN 列表 */
const GOOGLE_SAN_DNS = [
  '*.googleapis.com',
  'generativelanguage.googleapis.com',
  'daily-cloudcode-pa.googleapis.com',
  'cloudcode-pa.googleapis.com',
  'localhost',
];

/** IP SAN：Go 二进制（language_server.exe）连接 127.0.0.1 时需要 IP SAN */
const GOOGLE_SAN_IP = ['127.0.0.1'];

// ======================== CA 管理 ========================

/** 生成 CA 密钥对和自签名证书，保存到证书目录 */
function generateCa(): { caKey: forge.pki.rsa.PrivateKey; caCert: forge.pki.Certificate } {
  logger.info('生成 CA 证书...');

  const keyPair = pki.rsa.generateKeyPair(2048);
  const caKey = keyPair.privateKey;
  const caCert = pki.createCertificate();

  caCert.publicKey = keyPair.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date();
  caCert.validity.notAfter = new Date();
  caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);

  caCert.setSubject([
    { name: 'commonName', value: 'Antigravity Plus CA' },
    { name: 'organizationName', value: 'Antigravity Plus' },
  ]);
  caCert.setIssuer(caCert.subject.attributes);

  caCert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ]);

  caCert.sign(caKey, md.sha256.create());

  // 写入文件
  const dir = getCertDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(caKeyPath(), pki.privateKeyToPem(caKey));
  fs.writeFileSync(caCertPath(), pki.certificateToPem(caCert));

  logger.info('CA 证书已生成');
  return { caKey, caCert };
}

/** 加载已有 CA，不存在则返回 null */
function loadCa(): { caKey: forge.pki.rsa.PrivateKey; caCert: forge.pki.Certificate } | null {
  try {
    const keyPem = fs.readFileSync(caKeyPath(), 'utf8');
    const certPem = fs.readFileSync(caCertPath(), 'utf8');
    const caKey = pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    const caCert = pki.certificateFromPem(certPem);

    const now = new Date();
    if (now > caCert.validity.notAfter) {
      logger.warn('CA 证书已过期，将重新生成');
      return null;
    }

    return { caKey, caCert };
  } catch {
    return null;
  }
}

/** 获取或创建 CA */
export function ensureCa(): { caKey: forge.pki.rsa.PrivateKey; caCert: forge.pki.Certificate } {
  const existing = loadCa();
  if (existing) return existing;
  return generateCa();
}

// ======================== 服务端证书 ========================

/** 用 CA 签发服务端证书 */
function generateServerCert(
  caKey: forge.pki.rsa.PrivateKey,
  caCert: forge.pki.Certificate,
): void {
  logger.info('签发服务端证书...');

  const keyPair = pki.rsa.generateKeyPair(2048);
  const serverCert = pki.createCertificate();

  serverCert.publicKey = keyPair.publicKey;
  serverCert.serialNumber = Date.now().toString(16);
  serverCert.validity.notBefore = new Date();
  serverCert.validity.notAfter = new Date();
  serverCert.validity.notAfter.setFullYear(serverCert.validity.notBefore.getFullYear() + 1);

  serverCert.setSubject([
    { name: 'commonName', value: '*.googleapis.com' },
    { name: 'organizationName', value: 'Antigravity Plus' },
  ]);
  serverCert.setIssuer(caCert.subject.attributes);

  // SAN：Google API 域名 + localhost + IP 地址
  // type 2 = DNS 名称, type 7 = IP 地址（需要 hex 编码）
  const altNames: Array<{ type: number; value: string; ip?: string }> = [
    ...GOOGLE_SAN_DNS.map((d) => ({ type: 2, value: d })),
    ...GOOGLE_SAN_IP.map((ip) => ({ type: 7, ip, value: ip })),
  ];

  serverCert.setExtensions([
    { name: 'subjectAltName', altNames },
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
  ]);

  serverCert.sign(caKey, md.sha256.create());

  // 保存
  const dir = getCertDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(serverKeyPath(), pki.privateKeyToPem(keyPair.privateKey));
  fs.writeFileSync(serverCertPath(), pki.certificateToPem(serverCert));

  logger.info('服务端证书已签发（SAN: *.googleapis.com 等）');
}

/** 检查服务端证书是否有效 */
function isServerCertValid(): boolean {
  try {
    const certPem = fs.readFileSync(serverCertPath(), 'utf8');
    const cert = pki.certificateFromPem(certPem);
    const now = new Date();
    if (now > cert.validity.notAfter) return false;

    // 检查 SAN 是否包含 googleapis（使用 any 绕过类型限制）
    const ext = cert.getExtension('subjectAltName') as { altNames?: Array<{ value?: string }> } | undefined;
    if (!ext?.altNames) return false;
    return ext.altNames.some(
      (a) => a.value && typeof a.value === 'string' && a.value.includes('googleapis'),
    );
  } catch {
    return false;
  }
}

/** 确保证书目录中存在有效的服务端证书 */
export function ensureServerCerts(): void {
  if (isServerCertValid()) {
    logger.info('服务端证书有效，跳过生成');
    return;
  }
  const ca = ensureCa();
  generateServerCert(ca.caKey, ca.caCert);
}

// ======================== Windows 信任存储 ========================

/** 将 CA 证书安装到 Windows 受信任根证书颁发机构 */
export function installCaToWindows(): { success: boolean; message: string } {
  const certPath = caCertPath();

  if (!fs.existsSync(certPath)) {
    ensureCa();
  }

  try {
    execSync(`certutil -addstore -user Root "${certPath}"`, {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    logger.info('CA 证书已导入 Windows 信任存储');
    return { success: true, message: 'CA 证书已导入 Windows 信任存储' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes('access is denied') || lower.includes('administrator')) {
      return {
        success: false,
        message: '导入失败：需要管理员权限。请以管理员身份运行后重试。',
      };
    }
    if (lower.includes('already')) {
      return { success: true, message: 'CA 证书已在信任存储中' };
    }
    return { success: false, message: `导入失败: ${msg.slice(0, 200)}` };
  }
}

/** 检查 CA 证书是否已安装到信任存储 */
export function isCaInstalled(): boolean {
  try {
    const result = execSync('certutil -verifystore -user Root "Antigravity Plus CA"', {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    return (
      result.includes('Antigravity Plus CA') &&
      !result.toLowerCase().includes('not found') &&
      !result.toLowerCase().includes('no matching')
    );
  } catch {
    return false;
  }
}

// ======================== 公开给 proxy/server.ts ========================

/** 加载服务端 TLS 选项（供 https.createServer 使用） */
export function loadServerTls(): { key: Buffer; cert: Buffer } {
  ensureServerCerts();
  return {
    key: fs.readFileSync(serverKeyPath()),
    cert: fs.readFileSync(serverCertPath()),
  };
}

/** 获取证书存储目录 */
export function getCertDirectory(): string {
  return getCertDir();
}

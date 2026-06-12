package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// CAManager 管理 CA 证书和动态生成的域名证书
type CAManager struct {
	caKey    *rsa.PrivateKey
	caCert   *x509.Certificate
	dataDir  string
	caCertPEM []byte
}

// EnsureCA 加载或生成 CA 证书
func EnsureCA(dataDir string) (*CAManager, error) {
	certPath := filepath.Join(dataDir, "ca.crt")
	keyPath := filepath.Join(dataDir, "ca.key")

	ca := &CAManager{dataDir: dataDir}

	// 尝试加载已有 CA
	certPEM, err := os.ReadFile(certPath)
	if err == nil {
		keyPEM, err2 := os.ReadFile(keyPath)
		if err2 == nil {
			if ca.load(certPEM, keyPEM) == nil {
				logf("已加载已有 CA 证书: %s", certPath)
				return ca, nil
			}
		}
	}

	// 生成新 CA
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}

	key, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, fmt.Errorf("生成 CA 密钥失败: %w", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization: []string{"Antigravity Plus CA"},
			CommonName:   "Antigravity Plus Root CA",
		},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            1,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("生成 CA 证书失败: %w", err)
	}

	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})

	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return nil, fmt.Errorf("保存 CA 证书失败: %w", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		return nil, fmt.Errorf("保存 CA 密钥失败: %w", err)
	}

	ca.caKey = key
	ca.caCert = template
	ca.caCertPEM = certPEM

	logf("已生成新 CA 证书: %s", certPath)
	return ca, nil
}

func (ca *CAManager) load(certPEM, keyPEM []byte) error {
	// 解析密钥
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil {
		return fmt.Errorf("解析 CA 密钥失败")
	}
	key, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	if err != nil {
		return fmt.Errorf("解析 CA 密钥失败: %w", err)
	}

	// 解析证书
	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil {
		return fmt.Errorf("解析 CA 证书失败")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return fmt.Errorf("解析 CA 证书失败: %w", err)
	}

	ca.caKey = key
	ca.caCert = cert
	ca.caCertPEM = certPEM
	return nil
}

// GenerateCert 为指定域名生成 TLS 证书
func (ca *CAManager) GenerateCert(domains []string) (*rsa.PrivateKey, *x509.Certificate, error) {
	serverKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, fmt.Errorf("生成服务器密钥失败: %w", err)
	}

	serialNumber, _ := rand.Int(rand.Reader, big.NewInt(1<<62))

	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"Antigravity Plus"},
			CommonName:   domains[0],
		},
		NotBefore:   time.Now().Add(-1 * time.Hour),
		NotAfter:    time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:    domains,
		IPAddresses: []net.IP{},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, ca.caCert, &serverKey.PublicKey, ca.caKey)
	if err != nil {
		return nil, nil, fmt.Errorf("生成服务器证书失败: %w", err)
	}

	serverCert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, nil, fmt.Errorf("解析服务器证书失败: %w", err)
	}

	return serverKey, serverCert, nil
}

// CACertPath 返回 CA 证书文件路径
func (ca *CAManager) CACertPath() string {
	return filepath.Join(ca.dataDir, "ca.crt")
}

// InstallToSystem 将 CA 证书安装到 Windows 系统证书库
func (ca *CAManager) InstallToSystem() error {
	certPath := ca.CACertPath()

	// 先尝试添加到 LocalMachine\Root（需要管理员权限）
	cmd := exec.Command("certutil", "-addstore", "Root", certPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		logf("certutil LocalMachine 失败: %s, 尝试 CurrentUser", string(output))

		// 尝试 CurrentUser\Root
		cmd = exec.Command("certutil", "-addstore", "-user", "Root", certPath)
		output, err = cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("安装 CA 证书失败: %w\n输出: %s", err, string(output))
		}
	}

	return nil
}

// UninstallFromSystem 从系统证书库移除 CA 证书
func (ca *CAManager) UninstallFromSystem() error {
	certPath := ca.CACertPath()
	// 尝试从 LocalMachine 和 CurrentUser 中删除
	exec.Command("certutil", "-delstore", "Root", "Antigravity Plus Root CA").Run()
	exec.Command("certutil", "-delstore", "-user", "Root", "Antigravity Plus Root CA").Run()
	_ = certPath
	return nil
}
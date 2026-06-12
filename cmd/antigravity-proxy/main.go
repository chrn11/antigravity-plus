package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	httpPort := flag.Int("http-port", 8080, "HTTP 代理端口（非 TLS，给 Go 二进制管理端点用）")
	httpsPort := flag.Int("https-port", 443, "HTTPS MITM 代理端口（拦截 Google AI 请求）")
	configDir := flag.String("config", "", "配置目录（默认 %APPDATA%/antigravity-plus）")
	setupHosts := flag.Bool("setup-hosts", false, "自动配置 hosts 文件（仅首次安装时需要）")
	setupCert := flag.Bool("setup-cert", false, "自动安装 CA 证书（仅首次安装时需要）")
	flag.Parse()

	// 初始化日志（同时输出到控制台和文件）
	if err := initLogging(); err != nil {
		log.Fatalf("日志初始化失败: %v", err)
	}
	defer func() {
		if logFile != nil {
			logFile.Close()
		}
	}()

	// 写 PID 文件（用于停止脚本）
	pidPath := filepath.Join(os.TempDir(), "antigravity-proxy.pid")
	os.WriteFile(pidPath, []byte(fmt.Sprintf("%d", os.Getpid())), 0644)
	defer os.Remove(pidPath)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 加载配置
	cfg, err := LoadConfig(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	// CA 证书管理
	ca, err := EnsureCA(cfg.DataDir)
	if err != nil {
		log.Fatalf("CA 证书初始化失败: %v", err)
	}

	if *setupCert {
		if err := ca.InstallToSystem(); err != nil {
			log.Printf("⚠ 安装 CA 到系统证书库失败（需要管理员权限）: %v", err)
			log.Printf("  请手动运行: certutil -addstore Root %s", ca.CACertPath())
		} else {
			log.Printf("✓ CA 证书已安装到系统证书库")
		}
	}

	// hosts 文件管理
	hm := NewHostsManager()
	targetDomains := []string{
		"aicode.googleapis.com",
		"aiplatform.googleapis.com",
		"daily-cloudcode-pa.googleapis.com",
		"www.googleapis.com",
	}

	if *setupHosts {
		if err := hm.AddEntries(targetDomains); err != nil {
			log.Printf("⚠ 配置 hosts 文件失败（需要管理员权限）: %v", err)
			log.Printf("  请手动添加以下条目到 C:\\Windows\\System32\\drivers\\etc\\hosts:")
			for _, d := range targetDomains {
				log.Printf("    127.0.0.1 %s", d)
			}
		} else {
			log.Printf("✓ hosts 文件已配置（%d 个域名，持久化）", len(targetDomains))
		}
	}

	// 启动 HTTP 代理（管理端点）
	httpProxy := NewHTTPProxy(*httpPort, cfg)
	go func() {
		if err := httpProxy.Start(ctx); err != nil {
			log.Printf("HTTP 代理启动失败: %v（管理面板不可用，不影响 MITM 代理）", err)
		}
	}()
	log.Printf("HTTP 代理监听: http://127.0.0.1:%d", *httpPort)

	// 启动 HTTPS MITM 代理（AI 请求拦截）
	mitmProxy := NewMITMProxy(*httpsPort, ca, cfg)
	go func() {
		if err := mitmProxy.Start(ctx); err != nil {
			log.Printf("MITM 代理启动失败: %v", err)
		}
	}()
	log.Printf("MITM 代理监听: https://127.0.0.1:%d", *httpsPort)

	fmt.Printf("\nAntigravity BYOK 代理已就绪\n")
	fmt.Printf("  HTTP  端口: %d（管理端点代理）\n", *httpPort)
	fmt.Printf("  HTTPS 端口: %d（AI 请求 MITM 拦截）\n", *httpsPort)
	fmt.Printf("  日志文件: %s\n", filepath.Join(os.TempDir(), "antigravity-proxy.log"))
	fmt.Println()

	// 等待退出信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	fmt.Println("\n正在关闭...")
	cancel()
}

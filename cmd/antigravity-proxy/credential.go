package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
)

var logFile *os.File

func initLogging() error {
	logDir := os.TempDir()
	logPath := filepath.Join(logDir, "antigravity-proxy.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("无法创建日志文件: %w", err)
	}
	logFile = f
	// 只写文件（GUI 模式下 stderr 不可用）
	log.SetOutput(f)
	log.Printf("=== 日志初始化: %s ===", logPath)
	return nil
}

func logf(format string, args ...interface{}) {
	log.Printf(format, args...)
}

// getAPIKey 从 Windows Credential Manager 获取 API Key
// 备用方案：从配置目录的 .api_key 文件读取
func getAPIKey(provider string) (string, error) {
	// 先尝试从环境变量获取
	if key := os.Getenv("ANTIGRAVITY_API_KEY"); key != "" {
		return key, nil
	}

	// 尝试从文件读取
	configDir := os.Getenv("APPDATA")
	if configDir == "" {
		configDir = fmt.Sprintf("%s/AppData/Roaming", os.Getenv("USERPROFILE"))
	}
	keyFile := fmt.Sprintf("%s/antigravity-plus/%s.key", configDir, provider)
	data, err := os.ReadFile(keyFile)
	if err == nil && len(data) > 0 {
		return string(data), nil
	}

	// 尝试通用 key 文件
	keyFile = fmt.Sprintf("%s/antigravity-plus/api.key", configDir)
	data, err = os.ReadFile(keyFile)
	if err == nil && len(data) > 0 {
		return string(data), nil
	}

	return "", fmt.Errorf("未找到 API Key（请设置 ANTIGRAVITY_API_KEY 环境变量或创建 %s 文件）", keyFile)
}

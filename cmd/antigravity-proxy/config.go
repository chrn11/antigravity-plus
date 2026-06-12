package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Providers []ProviderConfig `json:"providers"`
	Models    map[string]string `json:"models"`
	DataDir   string            `json:"-"`
	LogLevel   string            `json:"logLevel"`
}

type ProviderConfig struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	BaseURL string `json:"baseURL"`
}

func LoadConfig(configDir string) (*Config, error) {
	if configDir == "" {
		configDir = os.Getenv("APPDATA")
		if configDir == "" {
			configDir = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		configDir = filepath.Join(configDir, "antigravity-plus")
	}

	cfg := &Config{
		DataDir:  configDir,
		LogLevel: "info",
		Providers: []ProviderConfig{
			{Name: "deepseek", Type: "openai-compatible", BaseURL: "https://api.deepseek.com"},
		},
		Models: map[string]string{
			"claude-opus-4-6": "deepseek-v4-pro",
			"claude-sonnet-4-6": "deepseek-v4-pro",
			"claude-haiku-4-5": "deepseek-v4-flash",
			"gemini-2.5-pro": "deepseek-v4-pro",
			"gemini-2.5-flash": "deepseek-v4-flash",
			"gemini-3.1-pro": "deepseek-v4-pro",
			"gemini-3.1-flash": "deepseek-v4-flash",
			"deepseek-v4-flash": "deepseek-v4-flash",
			"deepseek-v4-pro": "deepseek-v4-pro",
		},
	}

	configPath := filepath.Join(configDir, "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		os.MkdirAll(configDir, 0700)
		defaultData, _ := json.MarshalIndent(cfg, "", "  ")
		os.WriteFile(configPath, defaultData, 0600)
		logf("已创建默认配置文件: %s", configPath)
		return cfg, nil
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}
	cfg.DataDir = configDir
	return cfg, nil
}

func resolveModel(geminiModel string) string {
	model := geminiModel
	if len(model) > 7 && model[:7] == "models/" {
		model = model[7:]
	}
	// 精确匹配
	if mapped, ok := modelMap[model]; ok {
		return mapped
	}
	// 前缀匹配：未知 Claude 模型 → pro，未知含 flash/haiku → flash
	modelLower := strings.ToLower(model)
	if strings.HasPrefix(modelLower, "claude-opus") || strings.HasPrefix(modelLower, "claude-sonnet") {
		return "deepseek-v4-pro"
	}
	if strings.HasPrefix(modelLower, "claude-haiku") || strings.Contains(modelLower, "flash") {
		return "deepseek-v4-flash"
	}
	if strings.Contains(modelLower, "pro") || strings.Contains(modelLower, "thinking") {
		return "deepseek-v4-pro"
	}
	return "deepseek-v4-flash"
}

var modelMap = map[string]string{
	// Claude 系列
	"claude-opus-4-6":             "deepseek-v4-pro",
	"claude-opus-4-6-thinking":    "deepseek-v4-pro",
	"claude-sonnet-4-6":           "deepseek-v4-pro",
	"claude-sonnet-4-6-thinking":  "deepseek-v4-pro",
	"claude-haiku-4-5":            "deepseek-v4-flash",
	"claude-haiku-4-5-thinking":   "deepseek-v4-flash",
	// Gemini 系列
	"gemini-2.5-pro":   "deepseek-v4-pro",
	"gemini-2.5-flash":  "deepseek-v4-flash",
	"gemini-3.1-pro":    "deepseek-v4-pro",
	"gemini-3.1-flash":  "deepseek-v4-flash",
	// DeepSeek 直通
	"deepseek-v4-flash": "deepseek-v4-flash",
	"deepseek-v4-pro":   "deepseek-v4-pro",
	"deepseek-chat":     "deepseek-v4-flash",
	"deepseek-reasoner": "deepseek-v4-pro",
}
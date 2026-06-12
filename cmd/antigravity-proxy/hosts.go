package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const hostsMarkBegin = "# >>> antigravity-plus BEGIN >>>"
const hostsMarkEnd = "<<< antigravity-plus END <<<"
const hostsFile = `C:\Windows\System32\drivers\etc\hosts`

// HostsManager 管理 hosts 文件条目
type HostsManager struct{}

func NewHostsManager() *HostsManager {
	return &HostsManager{}
}

// AddEntries 向 hosts 文件添加域名指向 127.0.0.1
func (hm *HostsManager) AddEntries(domains []string) error {
	data, err := os.ReadFile(hostsFile)
	if err != nil {
		return fmt.Errorf("读取 hosts 文件失败: %w", err)
	}

	content := string(data)

	// 检查是否已存在
	if strings.Contains(content, hostsMarkBegin) {
		logf("hosts 文件已包含 antigravity-plus 条目，跳过")
		return nil
	}

	// 构建新条目
	var entries strings.Builder
	entries.WriteString(hostsMarkBegin + "\n")
	for _, d := range domains {
		entries.WriteString(fmt.Sprintf("127.0.0.1 %s\n", d))
	}
	entries.WriteString(hostsMarkEnd + "\n")

	// 追加到 hosts 文件
	f, err := os.OpenFile(hostsFile, os.O_APPEND|os.O_WRONLY, 0666)
	if err != nil {
		return fmt.Errorf("打开 hosts 文件失败（需要管理员权限）: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(entries.String()); err != nil {
		return fmt.Errorf("写入 hosts 文件失败: %w", err)
	}

	// 刷新 DNS 缓存
	hm.flushDNS()

	logf("已向 hosts 文件添加 %d 个域名条目", len(domains))
	return nil
}

// RemoveEntries 从 hosts 文件移除 antigravity-plus 条目
func (hm *HostsManager) RemoveEntries(domains []string) error {
	data, err := os.ReadFile(hostsFile)
	if err != nil {
		return fmt.Errorf("读取 hosts 文件失败: %w", err)
	}

	content := string(data)

	// 查找并移除标记块
	beginIdx := strings.Index(content, hostsMarkBegin)
	endIdx := strings.Index(content, hostsMarkEnd)
	if beginIdx == -1 || endIdx == -1 {
		return nil
	}

	// 移除从 beginIdx 到 endIdx + len(markEnd) + 1 (换行符)
	newContent := content[:beginIdx] + content[endIdx+len(hostsMarkEnd)+1:]

	if err := os.WriteFile(hostsFile, []byte(newContent), 0666); err != nil {
		return fmt.Errorf("写入 hosts 文件失败: %w", err)
	}

	hm.flushDNS()
	logf("已从 hosts 文件移除 antigravity-plus 条目")
	return nil
}

func (hm *HostsManager) flushDNS() {
	// 刷新 DNS 缓存
	cmd := exec.Command("ipconfig", "/flushdns")
	cmd.Run()
	logf("已刷新 DNS 缓存")
}
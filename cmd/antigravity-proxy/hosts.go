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

	// 如果已存在旧条目，先移除
	if strings.Contains(content, hostsMarkBegin) {
		beginIdx := strings.Index(content, hostsMarkBegin)
		endIdx := strings.Index(content, hostsMarkEnd)
		if beginIdx >= 0 && endIdx >= 0 {
			content = content[:beginIdx] + content[endIdx+len(hostsMarkEnd):]
			// 去掉尾部多余换行
			content = strings.TrimRight(content, "\r\n") + "\r\n"
		}
	}

	// 构建新条目
	var entries strings.Builder
	entries.WriteString(hostsMarkBegin + "\r\n")
	for _, d := range domains {
		entries.WriteString(fmt.Sprintf("127.0.0.1 %s\r\n", d))
	}
	entries.WriteString(hostsMarkEnd + "\r\n")

	// 写入 hosts 文件
	newContent := strings.TrimRight(content, "\r\n") + "\r\n" + entries.String()
	if err := os.WriteFile(hostsFile, []byte(newContent), 0666); err != nil {
		return fmt.Errorf("写入 hosts 文件失败（需要管理员权限）: %w", err)
	}

	// 刷新 DNS 缓存
	hm.flushDNS()

	logf("已向 hosts 文件更新 %d 个域名条目", len(domains))
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
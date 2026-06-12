package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

const mihomoProxyURL = "http://127.0.0.1:7890"

// hijackedDomains 是被 hosts 文件劫持到 127.0.0.1 的域名
var hijackedDomains = []string{
	"aicode.googleapis.com",
	"aiplatform.googleapis.com",
	"daily-cloudcode-pa.googleapis.com",
	"cloudcode-pa.googleapis.com",
	"generativelanguage.googleapis.com",
	"www.googleapis.com",
}

// isHijackedDomain 检查域名是否被 hosts 文件劫持
func isHijackedDomain(host string) bool {
	for _, d := range hijackedDomains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

// establishCONNECTTunnel 通过 mihomo HTTP 代理建立 CONNECT 隧道
func establishCONNECTTunnel(ctx context.Context, host string, port string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	proxyConn, err := dialer.DialContext(ctx, "tcp", "127.0.0.1:7890")
	if err != nil {
		return nil, fmt.Errorf("连接 mihomo HTTP 代理失败: %w", err)
	}

	proxyConn.SetDeadline(time.Now().Add(15 * time.Second))

	connectReq := fmt.Sprintf("CONNECT %s:%s HTTP/1.1\r\nHost: %s:%s\r\n\r\n", host, port, host, port)
	if _, err := proxyConn.Write([]byte(connectReq)); err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("发送 CONNECT 请求失败: %w", err)
	}

	reader := bufio.NewReader(proxyConn)
	resp, err := http.ReadResponse(reader, nil)
	if err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("读取 CONNECT 响应失败: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 200 {
		proxyConn.Close()
		return nil, fmt.Errorf("CONNECT 隧道建立失败: %d %s", resp.StatusCode, resp.Status)
	}

	proxyConn.SetDeadline(time.Time{})
	logf("[CONNECT] HTTP 隧道建立成功: %s:%s", host, port)

	// 用 bufferedConn 包装，确保 bufio 缓冲区的残余数据不丢失
	return &bufferedConn{reader: reader, Conn: proxyConn}, nil
}

// establishSOCKS5Tunnel 通过 mihomo SOCKS5 代理建立隧道
func establishSOCKS5Tunnel(ctx context.Context, host string, port string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	proxyConn, err := dialer.DialContext(ctx, "tcp", "127.0.0.1:7890")
	if err != nil {
		return nil, fmt.Errorf("连接 mihomo SOCKS5 代理失败: %w", err)
	}

	proxyConn.SetDeadline(time.Now().Add(15 * time.Second))

	// SOCKS5 握手：无认证
	_, err = proxyConn.Write([]byte{0x05, 0x01, 0x00})
	if err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 握手失败: %w", err)
	}

	buf := make([]byte, 2)
	if _, err := proxyConn.Read(buf); err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 握手响应失败: %w", err)
	}

	if buf[0] != 0x05 || buf[1] != 0x00 {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 握手不支持无认证: version=%d method=%d", buf[0], buf[1])
	}

	// SOCKS5 连接请求：连接到目标域名
	// 版本(1) + 命令(1, CONNECT=0x01) + 保留(1, 0x00) + 地址类型(1, 域名=0x03)
	// + 域名长度(1) + 域名 + 端口(2, 网络字节序)
	portInt := 443
	if p, err := net.LookupPort("tcp", port); err == nil {
		portInt = p
	}

	hostBytes := []byte(host)
	req := make([]byte, 0, 1+1+1+1+1+len(hostBytes)+2)
	req = append(req, 0x05)           // SOCKS 版本
	req = append(req, 0x01)           // CONNECT 命令
	req = append(req, 0x00)           // 保留
	req = append(req, 0x03)           // 地址类型：域名
	req = append(req, byte(len(hostBytes))) // 域名长度
	req = append(req, hostBytes...)    // 域名
	req = append(req, byte(portInt>>8), byte(portInt)) // 端口（网络字节序）

	if _, err := proxyConn.Write(req); err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 连接请求失败: %w", err)
	}

	// 读取 SOCKS5 响应
	respBuf := make([]byte, 4)
	if _, err := proxyConn.Read(respBuf); err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 响应失败: %w", err)
	}

	if respBuf[0] != 0x05 {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 响应版本错误: %d", respBuf[0])
	}

	if respBuf[1] != 0x00 {
		proxyConn.Close()
		return nil, fmt.Errorf("SOCKS5 连接失败: 状态码=%d", respBuf[1])
	}

	// 读取绑定地址（根据地址类型）
	switch respBuf[3] {
	case 0x01: // IPv4
		ipBuf := make([]byte, 4+2) // IP + 端口
		if _, err := proxyConn.Read(ipBuf); err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("SOCKS5 读取绑定地址失败: %w", err)
		}
	case 0x03: // 域名
		lenBuf := make([]byte, 1)
		if _, err := proxyConn.Read(lenBuf); err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("SOCKS5 读取域名长度失败: %w", err)
		}
		domainBuf := make([]byte, lenBuf[0]+2) // 域名 + 端口
		if _, err := proxyConn.Read(domainBuf); err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("SOCKS5 读取域名失败: %w", err)
		}
	case 0x04: // IPv6
		ipBuf := make([]byte, 16+2) // IP + 端口
		if _, err := proxyConn.Read(ipBuf); err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("SOCKS5 读取 IPv6 地址失败: %w", err)
		}
	}

	proxyConn.SetDeadline(time.Time{})
	logf("[SOCKS5] 隧道建立成功: %s:%s", host, port)

	return proxyConn, nil
}

// bufferedConn 包装 bufio.Reader 的残余数据到 net.Conn
type bufferedConn struct {
	reader *bufio.Reader
	net.Conn
}

func (bc *bufferedConn) Read(b []byte) (int, error) {
	return bc.reader.Read(b)
}

// newBypassTransport 创建一个通过 mihomo 代理转发 HTTPS 请求的 HTTP Transport
// 使用 SOCKS5 隧道 + TLS，支持 HTTP/2
func newBypassTransport() *http.Transport {
	return &http.Transport{
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, portStr, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			port := 443
			if p, err := net.LookupPort("tcp", portStr); err == nil {
				port = p
			}

			// 优先使用 SOCKS5 隧道（透传 TCP，不干预 HTTP 协议层）
			conn, err := establishSOCKS5Tunnel(ctx, host, fmt.Sprintf("%d", port))
			if err != nil {
				logf("[SOCKS5] 失败，回退到 CONNECT: %v", err)
				// 回退到 HTTP CONNECT 隧道
				conn, err = establishCONNECTTunnel(ctx, host, fmt.Sprintf("%d", port))
				if err != nil {
					return nil, fmt.Errorf("代理隧道建立失败: %w", err)
				}
			}

			// 在隧道上建立 TLS 连接（支持 HTTP/2 ALPN）
			tlsConfig := &tls.Config{
				ServerName: host,
				NextProtos: []string{"h2", "http/1.1"},
			}
			tlsConn := tls.Client(conn, tlsConfig)
			if err := tlsConn.HandshakeContext(ctx); err != nil {
				conn.Close()
				return nil, fmt.Errorf("TLS 握手失败: %w", err)
			}

			logf("[TLS] 握手成功: %s, 协议=%s", host, tlsConn.ConnectionState().NegotiatedProtocol)

			return tlsConn, nil
		},
		// 支持 HTTP/2
		ForceAttemptHTTP2: true,
		// 连接池
		MaxIdleConns:        100,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 15 * time.Second,
	}
}
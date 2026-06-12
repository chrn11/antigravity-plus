package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// MITMProxy 拦截 HTTPS 请求到 Google AI 域名
type MITMProxy struct {
	port      int
	ca        *CAManager
	cfg       *Config
	certCache map[string]*tls.Certificate
	server    *http.Server
	// 复用 HTTP 客户端（通过 mihomo CONNECT 隧道）
	bypassClient *http.Client
}

func NewMITMProxy(port int, ca *CAManager, cfg *Config) *MITMProxy {
	return &MITMProxy{
		port:      port,
		ca:        ca,
		cfg:       cfg,
		certCache: make(map[string]*tls.Certificate),
		bypassClient: &http.Client{
			Timeout:   60 * time.Second,
			Transport: newBypassTransport(),
		},
	}
}

func (p *MITMProxy) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", p.handleRequest)

	p.server = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", p.port),
		Handler: mux,
		TLSConfig: &tls.Config{
			GetCertificate: p.getCertificate,
		},
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 120 * time.Second,
	}

	go func() {
		<-ctx.Done()
		p.server.Close()
	}()

	logf("MITM 代理监听: 127.0.0.1:%d", p.port)
	return p.server.ListenAndServeTLS("", "")
}

func (p *MITMProxy) getCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	serverName := hello.ServerName
	if serverName == "" {
		serverName = "aiplatform.googleapis.com"
	}

	if cert, ok := p.certCache[serverName]; ok {
		return cert, nil
	}

	key, cert, err := p.ca.GenerateCert([]string{serverName})
	if err != nil {
		return nil, fmt.Errorf("生成证书失败: %w", err)
	}

	tlsCert := &tls.Certificate{
		Certificate: [][]byte{cert.Raw, p.ca.caCert.Raw},
		PrivateKey:  key,
		Leaf:        cert,
	}

	p.certCache[serverName] = tlsCert
	logf("已为 %s 生成 TLS 证书", serverName)
	return tlsCert, nil
}

func (p *MITMProxy) handleRequest(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if strings.Contains(host, ":") {
		host, _, _ = net.SplitHostPort(host)
	}

	logf("[MITM] %s %s Host=%s", r.Method, r.URL.Path, host)

	if isAIRequest(r.URL.Path) {
		p.handleAIRequest(w, r)
		return
	}

	p.proxyToGoogle(w, r)
}

func isAIRequest(path string) bool {
	aiPaths := []string{
		"streamGenerateContent",
		"generateContent",
		"cascadeStreamGenerateContent",
		"cascadeGenerateContent",
	}
	for _, p := range aiPaths {
		if strings.Contains(path, p) {
			return true
		}
	}
	return false
}

func (p *MITMProxy) handleAIRequest(w http.ResponseWriter, r *http.Request) {
	contentType := r.Header.Get("Content-Type")
	logf("[MITM-AI] AI 请求: %s %s Content-Type=%s", r.Method, r.URL.Path, contentType)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		logf("[MITM-AI] 读取请求体失败: %v", err)
		http.Error(w, "读取请求失败", http.StatusBadRequest)
		return
	}
	r.Body.Close()
	// 仅记录请求体大小，不打印内容（请求体可能含 API Key）
	logf("[MITM-AI] 请求体大小: %d 字节", len(body))

	// 打印请求头中可能包含模型信息的字段
	for _, key := range []string{"X-Goog-Request-Params", "X-Model", "Model", "X-Goog-Api-Client"} {
		if v := r.Header.Get(key); v != "" {
			logf("[MITM-AI] 请求头 %s: %s", key, v)
		}
	}
	// 打印 URL query 参数中的模型信息
	if r.URL.Query().Get("model") != "" {
		logf("[MITM-AI] URL 参数 model: %s", r.URL.Query().Get("model"))
	}

	geminiReq, err := parseGeminiRequest(body, contentType)
	if err != nil {
		logf("[MITM-AI] 解析请求失败: %v, 回退到直接代理", err)
		p.proxyToGoogle(w, r)
		return
	}
	logf("[MITM-AI] 解析成功: model=%s, contents=%d条, systemInst=%v, stream=%v, tools=%d个",
		geminiReq.Model, len(geminiReq.Contents), geminiReq.SystemInst != nil, geminiReq.Stream, len(geminiReq.Tools))

	provider := p.cfg.Providers[0]
	apiKey, err := getAPIKey(provider.Name)
	if err != nil || apiKey == "" {
		logf("[MITM-AI] 未配置 API Key for %s", provider.Name)
		http.Error(w, "API Key 未配置", http.StatusUnauthorized)
		return
	}
	// API Key 不写入日志（避免泄露到 %TEMP%\antigravity-proxy.log）

	model := resolveModel(geminiReq.Model)
	logf("[MITM-AI] 模型映射: %s → %s", geminiReq.Model, model)

	openaiReq := convertToOpenAI(geminiReq, model, apiKey, provider.BaseURL)
	logf("[MITM-AI] OpenAI 请求: model=%s, messages=%d条, stream=%v",
		openaiReq.Model, len(openaiReq.Messages), openaiReq.Stream)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "不支持流式响应", http.StatusInternalServerError)
		return
	}

	logf("[MITM-AI] 开始调用 DeepSeek...")
	err = streamAndConvert(w, flusher, openaiReq, geminiReq.Model, apiKey, provider.BaseURL)
	if err != nil {
		logf("[MITM-AI] 流式调用失败: %v", err)
		writeSSEError(w, flusher, err.Error())
	} else {
		logf("[MITM-AI] 流式调用完成")
	}
}

func (p *MITMProxy) proxyToGoogle(w http.ResponseWriter, r *http.Request) {
	// 使用 resolveGoogleHost 将域名路由到可达的 Google 服务器
	// daily-cloudcode-pa.googleapis.com 不可直接访问，需要路由到 cloudcode-pa.googleapis.com
	host := r.Host
	if strings.Contains(host, ":") {
		host, _, _ = net.SplitHostPort(host)
	}
	targetHost := resolveGoogleHost(r.URL.Path, host)

	targetURL := fmt.Sprintf("https://%s%s", targetHost, r.URL.Path)
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	logf("[MITM-PROXY] 代理到: %s (原始Host=%s)", targetURL, r.Host)

	// 读取请求体
	body, err := io.ReadAll(r.Body)
	if err != nil {
		logf("[MITM-PROXY] 读取请求体失败: %v", err)
		http.Error(w, "读取请求失败", http.StatusBadRequest)
		return
	}
	r.Body.Close()

	// 创建代理请求（使用独立 context，不受客户端断开影响）
	proxyReq, err := http.NewRequestWithContext(context.Background(), r.Method, targetURL, strings.NewReader(string(body)))
	if err != nil {
		logf("[MITM-PROXY] 创建请求失败: %v", err)
		http.Error(w, "代理请求创建失败", http.StatusInternalServerError)
		return
	}

	// 复制请求头
	for k, vv := range r.Header {
		proxyReq.Header[k] = vv
	}

	// 使用通过 mihomo SOCKS5 隧道的 HTTP 客户端
	resp, err := p.bypassClient.Do(proxyReq)
	if err != nil {
		logf("[MITM-PROXY] 请求失败: %s %s - %v", r.Method, targetURL, err)
		http.Error(w, fmt.Sprintf("代理请求失败: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	logf("[MITM-PROXY] 响应: %d %s %s", resp.StatusCode, r.Method, targetURL)

	// 复制响应头
	for k, vv := range resp.Header {
		w.Header()[k] = vv
	}
	w.WriteHeader(resp.StatusCode)

	// 流式复制响应体
	flusher, ok := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			if ok {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}
}
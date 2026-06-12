package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// HTTPProxy handles non-TLS management endpoint proxy and Web management UI
type HTTPProxy struct {
	port         int
	cfg          *Config
	server       *http.Server
	bypassClient *http.Client
	startTime    time.Time
}

func NewHTTPProxy(port int, cfg *Config) *HTTPProxy {
	return &HTTPProxy{
		port:         port,
		cfg:          cfg,
		bypassClient: &http.Client{Timeout: 60 * time.Second, Transport: newBypassTransport()},
		startTime:    time.Now(),
	}
}

func (p *HTTPProxy) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", p.routeRequest)

	p.server = &http.Server{
		Addr:         fmt.Sprintf("127.0.0.1:%d", p.port),
		Handler:      mux,
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 120 * time.Second,
	}

	go func() {
		<-ctx.Done()
		p.server.Close()
	}()

	logf("HTTP proxy listening: 127.0.0.1:%d", p.port)
	return p.server.ListenAndServe()
}

func (p *HTTPProxy) routeRequest(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" || r.URL.Path == "/index.html" {
		p.serveUI(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		p.handleAPI(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/static/") {
		p.serveStatic(w, r)
		return
	}
	p.proxyToGoogle(w, r)
}

// ==================== Management UI ====================

const uiHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Antigravity BYOK Proxy</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0b0d11;color:#e4e7ec;font-family:system-ui,-apple-system,sans-serif;padding:32px 16px;min-height:100vh;-webkit-font-smoothing:antialiased}
.container{max-width:640px;margin:0 auto}
.hero{background:linear-gradient(135deg,#13151a 0%,#171a22 100%);border:1px solid #262933;border-radius:16px;padding:28px 32px;margin-bottom:20px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#4a8eff44,transparent)}
.hero-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.hero-title{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;letter-spacing:-0.01em}
.hero-badge{background:#1a1d24;border:1px solid #262933;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:500;color:#8892a4;letter-spacing:.02em}
.hero-body{display:flex;align-items:center;gap:16px}
.status-ring{position:relative;width:44px;height:44px;flex-shrink:0}
.status-ring svg{transform:rotate(-90deg)}
.status-ring .bg{fill:none;stroke:#262933;stroke-width:3}
.status-ring .fg{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:113;transition:stroke-dashoffset .6s ease}
.status-ring .fg.active{stroke:#22c55e;stroke-dashoffset:0;filter:drop-shadow(0 0 8px #22c55e55)}
.status-ring .fg.inactive{stroke:#5c6474;stroke-dashoffset:113}
.status-ring .dot{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;transition:background .4s}
.status-ring .dot.active{background:#22c55e;box-shadow:0 0 12px #22c55e66}
.status-ring .dot.inactive{background:#5c6474}
@keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(34,197,94,.3)}70%{box-shadow:0 0 0 14px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.status-ring .dot.active.pulsing{animation:pulseRing 2s infinite}
@keyframes liveBlink{0%,100%{opacity:1}50%{opacity:.4}}
.live-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:#22c55e;margin-top:3px}
.live-badge .dot{width:5px;height:5px;border-radius:50%;background:#22c55e;animation:liveBlink 1.5s infinite}
.live-badge.stopped .dot{background:#5c6474;animation:none}
.live-badge.stopped{color:#5c6474}
.status-info{flex:1;min-width:0}
.status-info .line1{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.status-info .label{font-size:13px;font-weight:500}
.status-info .pid{font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;color:#5c6474}
.status-info .uptime{font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;color:#8892a4}
.status-info .sub{font-size:12px;color:#5c6474;margin-top:4px}
.status-info .sub span{display:inline-flex;align-items:center;gap:4px}
.status-info .sub .sep{margin:0 8px;color:#262933}
.hero-actions{display:flex;gap:6px;margin-left:auto;flex-shrink:0}
.card{background:#13151a;border:1px solid #262933;border-radius:12px;padding:24px;margin-bottom:16px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.card-header h2{font-size:13px;font-weight:500;color:#8892a4;text-transform:uppercase;letter-spacing:.06em}
.card-header .hint{font-size:11px;color:#5c6474}
.card-divider{height:1px;background:#262933;margin:16px 0}
.form-group{margin-bottom:16px}
.form-label{display:block;font-size:12px;font-weight:500;color:#8892a4;margin-bottom:6px}
.form-input{width:100%;padding:10px 14px;background:#0b0d11;border:1px solid #262933;border-radius:8px;color:#e4e7ec;font-size:14px;font-family:'JetBrains Mono','Fira Code',monospace;transition:border-color .2s,box-shadow .2s;outline:none}
.form-input::placeholder{color:#3c4357}
.form-input:focus{border-color:#4a8eff;box-shadow:0 0 0 3px rgba(74,142,255,.15)}
.form-input-wrap{position:relative}
.form-input-wrap .toggle-vis{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#5c6474;cursor:pointer;font-size:14px;padding:4px}
.form-input-wrap .toggle-vis:hover{color:#8892a4}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s ease;font-family:inherit;white-space:nowrap}
.btn:active{transform:scale(.97)}
.btn-primary{background:#4a8eff;color:#fff}
.btn-primary:hover{background:#3a7aef;box-shadow:0 0 20px rgba(74,142,255,.25)}
.btn-ghost{background:transparent;color:#8892a4;border:1px solid #262933}
.btn-ghost:hover{background:#1a1d24;color:#e4e7ec}
.btn-danger{background:#ef444433;color:#ef4444;border:1px solid #ef444433}
.btn-danger:hover{background:#ef444455}
.btn-sm{padding:6px 12px;font-size:12px}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat-card{background:#0b0d11;border:1px solid #1e2128;border-radius:10px;padding:16px}
.stat-card .stat-value{font-size:20px;font-weight:600;font-family:'JetBrains Mono','Fira Code',monospace;letter-spacing:-.02em;color:#e4e7ec}
.stat-card .stat-label{font-size:11px;color:#5c6474;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
.stat-card.accent{border-color:#4a8eff22}
.stat-card.accent .stat-value{color:#4a8eff}
.terminal{border-radius:10px;overflow:hidden;border:1px solid #262933;background:#090a0d}
.terminal-header{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#11141a;border-bottom:1px solid #1e2128}
.terminal-header .term-dots{display:flex;gap:6px}
.terminal-header .term-dot{width:8px;height:8px;border-radius:50%}
.terminal-header .term-dot.r{background:#ef444466}
.terminal-header .term-dot.y{background:#eab30866}
.terminal-header .term-dot.g{background:#22c55e66}
.terminal-header .term-title{font-size:11px;color:#5c6474;font-family:'JetBrains Mono','Fira Code',monospace;margin-left:4px}
.terminal-body{font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;line-height:1.6;padding:14px 16px;max-height:320px;overflow:auto;color:#8892a4;white-space:pre-wrap;word-break:break-all}
.terminal-body::-webkit-scrollbar{width:4px}
.terminal-body::-webkit-scrollbar-track{background:transparent}
.terminal-body::-webkit-scrollbar-thumb{background:#262933;border-radius:2px}
.terminal-actions{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#11141a;border-top:1px solid #1e2128}
.info-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0}
.info-row+.info-row{border-top:1px solid #1e2128}
.info-row .il{font-size:13px;color:#8892a4}
.info-row .ir{font-size:12px;color:#5c6474;font-family:'JetBrains Mono','Fira Code',monospace}
.toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;color:#fff;opacity:0;transform:translateY(8px);transition:all .3s ease;z-index:1000;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.success{background:#22c55e22;border:1px solid #22c55e44;backdrop-filter:blur(12px);color:#22c55e}
.toast.error{background:#ef444422;border:1px solid #ef444444;backdrop-filter:blur(12px);color:#ef4444}
@media(max-width:480px){body{padding:16px 12px}.hero{padding:20px}.hero-body{flex-direction:column;align-items:flex-start;gap:12px}.hero-actions{align-self:flex-end}.card{padding:18px}.stats-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="container" id="app">
<div class="hero">
	<div class="hero-top">
		<div class="hero-title"><span style="font-size:16px;line-height:1">&#9679;</span>Antigravity BYOK<span class="hero-badge">v0.1</span></div>
	</div>
	<div class="hero-body">
		<div class="status-ring" id="statusRing">
			<svg width="44" height="44" viewBox="0 0 44 44">
				<circle class="bg" cx="22" cy="22" r="18"></circle>
				<circle class="fg" id="ringFg" cx="22" cy="22" r="18"></circle>
			</svg>
			<div class="dot" id="ringDot"></div>
		</div>
		<div class="status-info">
			<div class="line1">
				<span class="label" id="statusLabel">Loading...</span>
				<span class="pid" id="statusPid"></span>
				<span class="live-badge" id="liveBadge"><span class="dot"></span>L I V E</span>
			</div>
			<div class="sub">
				<span id="statusUptime"></span>
				<span class="sep">&#183;</span>
				<span id="statusPort">Port 443</span>
			</div>
		</div>
	</div>
</div>
<div class="card">
	<div class="card-header"><h2>API Key</h2><span class="hint">DeepSeek</span></div>
	<div class="form-group">
		<label class="form-label" for="apiKey">API Key</label>
		<div class="form-input-wrap">
			<input class="form-input" type="password" id="apiKey" placeholder="sk-..." spellcheck="false" autocomplete="off">
			<button class="toggle-vis" onclick="tv()" title="Show/Hide">&#128065;</button>
		</div>
	</div>
	<button class="btn btn-primary" id="saveBtn" onclick="sc()">Save</button>
	<button class="btn btn-ghost btn-sm" id="testBtn" onclick="tk()" style="margin-left:8px">Test Key</button>
	<span id="keyResult" style="font-size:12px;margin-left:8px;display:inline-flex;align-items:center"></span>
</div>
<div class="card">
	<div class="card-header"><h2>Runtime</h2></div>
	<div class="stats-grid">
		<div class="stat-card accent"><div class="stat-value" id="statUptime">-</div><div class="stat-label">Uptime</div></div>
		<div class="stat-card"><div class="stat-value" id="statPid">-</div><div class="stat-label">PID</div></div>
	</div>
	<div class="card-divider"></div>
	<div class="info-row"><span class="il">Log file</span><span class="ir" id="logPath">-</span></div>
</div>
<div class="card" style="padding:0">
	<div class="terminal" style="border:none">
		<div class="terminal-header">
			<div class="term-dots"><span class="term-dot r"></span><span class="term-dot y"></span><span class="term-dot g"></span></div>
			<div class="term-title">antigravity-proxy.log</div>
		</div>
		<div class="terminal-body" id="logBox">Starting...</div>
		<div class="terminal-actions">
			<button class="btn btn-ghost btn-sm" onclick="fl()">Refresh</button>
			<button class="btn btn-danger btn-sm" onclick="cs()" style="margin-left:auto">Shutdown Proxy</button>
		</div>
	</div>
</div>
</div>
<div class="toast" id="toast"></div>
<script>
function $(id){return document.getElementById(id)}
function show(m,t){const n=$('toast');n.textContent=m;n.className='toast show '+t;setTimeout(()=>n.className='toast',3000)}
function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),se=s%60;if(h>0)return h+'h '+m+'m';if(m>0)return m+'m '+se+'s';return se+'s'}
function tv(){const i=$('apiKey');i.type=i.type==='password'?'text':'password'}
async function fs(){try{const r=await fetch('/api/status');if(!r.ok)throw Error();const d=await r.json(),a=d.running
$('ringFg').className='fg '+(a?'active':'inactive');$('ringDot').className='dot '+(a?'active pulsing':'inactive')
$('liveBadge').className='live-badge'+(a?'':' stopped');$('liveBadge').innerHTML=a?'<span class="dot"></span>L I V E':'O F F L I N E'
$('statusLabel').textContent=a?'Running':'Stopped'
if(a){$('statusPid').textContent='PID '+d.pid;const s=Math.floor(Date.now()/1000-d.startTime);$('statusUptime').innerHTML='<span>&#9654; '+fmt(s)+'</span>';$('statUptime').textContent=fmt(s);$('statPid').textContent=d.pid}
else{$('statusPid').textContent='';$('statusUptime').innerHTML='<span>&#9632; Stopped</span>';$('statUptime').textContent='-';$('statPid').textContent='-'}
$('logPath').textContent=d.logPath||'-'}catch(e){$('statusLabel').textContent='Connection failed'}}
async function fc(){try{const r=await fetch('/api/config');if(!r.ok)throw Error();const d=await r.json();if(d.apiKey)$('apiKey').value=d.apiKey}catch(e){}}
async function sc(){const b=$('saveBtn');b.disabled=true;const t=b.textContent;b.textContent='Saving...'
try{const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:$('apiKey').value})});if(!r.ok)throw Error(await r.text());show('API Key saved','success')}
catch(e){show('Failed: '+e.message,'error')}finally{b.disabled=false;b.textContent=t}}
async function tk(){const b=$('testBtn'),r=$('keyResult');b.disabled=true;r.innerHTML='<span style="color:#eab308">Testing...</span>'
try{const resp=await fetch('/api/test-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:$('apiKey').value})});
const d=await resp.json();if(d.valid){r.innerHTML='<span style="color:#22c55e">&#10003; Valid</span>'}else{r.innerHTML='<span style="color:#ef4444">&#10007; '+d.error+'</span>'}}
catch(e){r.innerHTML='<span style="color:#ef4444">&#10007; Request failed</span>'}finally{b.disabled=false}}
async function fl(){try{const r=await fetch('/api/logs?lines=200');if(!r.ok)throw Error();const d=await r.json(),b=$('logBox');b.textContent=d.logs||'(empty)';b.scrollTop=b.scrollHeight}catch(e){$('logBox').textContent='Failed to fetch logs'}}
function cs(){if(!confirm('Shut down the proxy?\nAntigravity AI will stop working.'))return;(async()=>{try{await fetch('/api/shutdown',{method:'POST'});show('Shutting down...','success')}catch(e){show('Failed','error')}})()}
fs();fc();fl();setInterval(fs,5000);setInterval(fl,3000)
</script>
</body>
</html>`

func (p *HTTPProxy) serveUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(uiHTML))
}

func (p *HTTPProxy) serveStatic(w http.ResponseWriter, r *http.Request) {
	http.NotFound(w, r)
}

// ==================== API ====================

type StatusResponse struct {
	Running   bool   `json:"running"`
	PID       int    `json:"pid"`
	StartTime int64  `json:"startTime"`
	LogPath   string `json:"logPath"`
}

type ConfigResponse struct {
	APIKey string `json:"apiKey,omitempty"`
}

type ConfigUpdate struct {
	APIKey string `json:"apiKey"`
}

func (p *HTTPProxy) handleAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.URL.Path {
	case "/api/status":
		p.getStatus(w, r)
	case "/api/config":
		if r.Method == "GET" {
			p.getConfig(w, r)
		} else {
			p.saveConfig(w, r)
		}
	case "/api/logs":
		p.getLogs(w, r)
	case "/api/test-key":
		p.testKey(w, r)
	case "/api/shutdown":
		p.shutdown(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *HTTPProxy) getStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, StatusResponse{
		Running:   true,
		PID:       os.Getpid(),
		StartTime: p.startTime.Unix(),
		LogPath:   filepath.Join(os.TempDir(), "antigravity-proxy.log"),
	})
}

func (p *HTTPProxy) getConfig(w http.ResponseWriter, r *http.Request) {
	configDir := filepath.Join(os.Getenv("APPDATA"), "antigravity-plus")
	apiKey := ""
	if data, err := os.ReadFile(filepath.Join(configDir, "deepseek.key")); err == nil {
		apiKey = string(bytes.TrimSpace(data))
	}
	if apiKey == "" {
		if data, err := os.ReadFile(filepath.Join(configDir, "api.key")); err == nil {
			apiKey = string(bytes.TrimSpace(data))
		}
	}
	writeJSON(w, ConfigResponse{APIKey: apiKey})
}

func (p *HTTPProxy) saveConfig(w http.ResponseWriter, r *http.Request) {
	var req ConfigUpdate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	configDir := filepath.Join(os.Getenv("APPDATA"), "antigravity-plus")
	os.MkdirAll(configDir, 0700)
	if err := os.WriteFile(filepath.Join(configDir, "deepseek.key"), []byte(strings.TrimSpace(req.APIKey)), 0600); err != nil {
		http.Error(w, "Save failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	logf("[API] API Key updated")
	writeJSON(w, map[string]string{"status": "ok"})
}

func (p *HTTPProxy) getLogs(w http.ResponseWriter, r *http.Request) {
	logPath := filepath.Join(os.TempDir(), "antigravity-proxy.log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		writeJSON(w, map[string]string{"logs": "(no log file)"})
		return
	}
	lines := strings.Split(string(data), "\n")
	n := 200
	if len(lines) < n {
		n = len(lines)
	}
	tail := strings.Join(lines[len(lines)-n:], "\n")
	writeJSON(w, map[string]string{"logs": tail})
}

func (p *HTTPProxy) shutdown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "shutting_down"})
	logf("[API] Shutdown requested")
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
}

type KeyTestRequest struct {
	APIKey string `json:"apiKey"`
}

func (p *HTTPProxy) testKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req KeyTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.APIKey == "" {
		writeJSON(w, map[string]interface{}{"valid": false, "error": "No API key provided"})
		return
	}
	// Call DeepSeek models endpoint to validate the key
	reqBody := `{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"max_tokens":1}`
	httpReq, err := http.NewRequest("POST", "https://api.deepseek.com/chat/completions", strings.NewReader(reqBody))
	if err != nil {
		writeJSON(w, map[string]interface{}{"valid": false, "error": "Internal error"})
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(req.APIKey))
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		writeJSON(w, map[string]interface{}{"valid": false, "error": "Cannot reach DeepSeek API"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		writeJSON(w, map[string]interface{}{"valid": true, "error": ""})
	} else if resp.StatusCode == 401 {
		writeJSON(w, map[string]interface{}{"valid": false, "error": "Invalid API key"})
	} else {
		body, _ := io.ReadAll(resp.Body)
		writeJSON(w, map[string]interface{}{"valid": false, "error": fmt.Sprintf("HTTP %d", resp.StatusCode)})
		logf("[API] Key test returned %d: %s", resp.StatusCode, string(body))
	}
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// ==================== Proxy to Google ====================

func (p *HTTPProxy) proxyToGoogle(w http.ResponseWriter, r *http.Request) {
	targetHost := resolveGoogleHost(r.URL.Path, r.Host)

	targetURL := fmt.Sprintf("https://%s%s", targetHost, r.URL.Path)
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	logf("[HTTP] Proxying to: %s", targetURL)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		logf("[HTTP] Read body failed: %v", err)
		http.Error(w, "Read failed", http.StatusBadRequest)
		return
	}
	r.Body.Close()

	proxyReq, err := http.NewRequestWithContext(context.Background(), r.Method, targetURL, strings.NewReader(string(body)))
	if err != nil {
		logf("[HTTP] Create request failed: %v", err)
		http.Error(w, "Proxy request failed", http.StatusInternalServerError)
		return
	}

	for k, vv := range r.Header {
		proxyReq.Header[k] = vv
	}
	proxyReq.Header.Set("Host", targetHost)
	proxyReq.Header.Del("X-Forwarded-For")
	proxyReq.Header.Del("X-Forwarded-Proto")

	resp, err := p.bypassClient.Do(proxyReq)
	if err != nil {
		logf("[HTTP] Request failed: %s %s - %v", r.Method, targetURL, err)
		http.Error(w, fmt.Sprintf("Proxy failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	logf("[HTTP] Response: %d %s %s", resp.StatusCode, r.Method, targetURL)

	for k, vv := range resp.Header {
		w.Header()[k] = vv
	}
	w.WriteHeader(resp.StatusCode)

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

func resolveGoogleHost(path string, host string) string {
	if strings.Contains(host, "daily-cloudcode-pa.googleapis.com") {
		return "cloudcode-pa.googleapis.com"
	}

	googleHosts := []string{
		"cloudcode-pa.googleapis.com",
		"aiplatform.googleapis.com",
		"generativelanguage.googleapis.com",
		"aicode.googleapis.com",
		"www.googleapis.com",
	}
	for _, h := range googleHosts {
		if strings.Contains(host, h) {
			return host
		}
	}

	managementPaths := []string{
		"loadCodeAssist",
		"fetchAvailableModels",
		"onboardUser",
		"fetchUserInfo",
		"listExperiments",
		"buildWithGooglePlugins",
	}
	for _, p := range managementPaths {
		if strings.Contains(path, p) {
			return "cloudcode-pa.googleapis.com"
		}
	}

	return "generativelanguage.googleapis.com"
}

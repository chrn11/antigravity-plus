package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

type GeminiRequest struct {
	Model      string
	Contents   []Content
	SystemInst *SystemInstruction
	Tools      []Tool
	GenConfig  *GenerationConfig
	Stream     bool
}

type Content struct {
	Role  string `json:"role"`
	Parts []Part `json:"parts"`
}

type Part struct {
	Text             string            `json:"text,omitempty"`
	Thought          bool              `json:"thought,omitempty"`
	FunctionCall     *FunctionCall     `json:"functionCall,omitempty"`
	FunctionResponse *FunctionResponse `json:"functionResponse,omitempty"`
	InlineData       *InlineData       `json:"inlineData,omitempty"`
}

type FunctionCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args,omitempty"`
}

type FunctionResponse struct {
	Name     string      `json:"name"`
	Response interface{} `json:"response"`
}

type InlineData struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

type SystemInstruction struct {
	Parts []Part `json:"parts"`
}

type Tool struct {
	FunctionDeclarations []FunctionDeclaration `json:"functionDeclarations"`
}

type FunctionDeclaration struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Parameters  interface{} `json:"parameters,omitempty"`
}

type GenerationConfig struct {
	Temperature     float64  `json:"temperature,omitempty"`
	TopP            float64  `json:"topP,omitempty"`
	TopK            int      `json:"topK,omitempty"`
	MaxOutputTokens int      `json:"maxOutputTokens,omitempty"`
	StopSequences   []string `json:"stopSequences,omitempty"`
}

func parseGeminiRequest(body []byte, contentType string) (*GeminiRequest, error) {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "connect") || strings.Contains(ct, "proto") {
		return parseConnectRequest(body, contentType)
	}
	return parseJSONRequest(body)
}

func parseJSONRequest(body []byte) (*GeminiRequest, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}

	req := &GeminiRequest{}
	inner := raw
	if r, ok := raw["request"]; ok {
		if m, ok := r.(map[string]interface{}); ok {
			inner = m
		}
	}

	// 模型名称可能出现在多个位置
	// 1. inner["model"]
	// 2. inner["modelVersion"]
	// 3. inner["generationConfig"]["model"]
	// 4. raw["model"] (顶层)
	// 5. raw["modelName"]
	modelFields := []string{"model", "modelVersion", "modelName"}
	for _, field := range modelFields {
		if m, ok := inner[field].(string); ok && m != "" {
			req.Model = m
			break
		}
	}
	if req.Model == "" {
		for _, field := range modelFields {
			if m, ok := raw[field].(string); ok && m != "" {
				req.Model = m
				break
			}
		}
	}
	if req.Model == "" {
		if gc, ok := inner["generationConfig"].(map[string]interface{}); ok {
			if m, ok := gc["model"].(string); ok && m != "" {
				req.Model = m
			}
		}
	}

	if contents, ok := inner["contents"].([]interface{}); ok {
		for _, c := range contents {
			if cm, ok := c.(map[string]interface{}); ok {
				content := Content{}
				if r, ok := cm["role"].(string); ok {
					content.Role = r
				}
				if parts, ok := cm["parts"].([]interface{}); ok {
					for _, p := range parts {
						if pm, ok := p.(map[string]interface{}); ok {
							part := parsePart(pm)
							if part != nil {
								content.Parts = append(content.Parts, *part)
							}
						}
					}
				}
				req.Contents = append(req.Contents, content)
			}
		}
	}

	if si, ok := inner["system_instruction"]; ok {
		if m, ok := si.(map[string]interface{}); ok {
			req.SystemInst = &SystemInstruction{}
			if parts, ok := m["parts"].([]interface{}); ok {
				for _, p := range parts {
					if pm, ok := p.(map[string]interface{}); ok {
						part := parsePart(pm)
						if part != nil {
							req.SystemInst.Parts = append(req.SystemInst.Parts, *part)
						}
					}
				}
			}
		}
	} else if si, ok := inner["systemInstruction"]; ok {
		if m, ok := si.(map[string]interface{}); ok {
			req.SystemInst = &SystemInstruction{}
			if parts, ok := m["parts"].([]interface{}); ok {
				for _, p := range parts {
					if pm, ok := p.(map[string]interface{}); ok {
						part := parsePart(pm)
						if part != nil {
							req.SystemInst.Parts = append(req.SystemInst.Parts, *part)
						}
					}
				}
			}
		}
	}

	if gc, ok := inner["generationConfig"]; ok {
		if m, ok := gc.(map[string]interface{}); ok {
			req.GenConfig = &GenerationConfig{}
			if t, ok := m["temperature"].(float64); ok {
				req.GenConfig.Temperature = t
			}
			if t, ok := m["topP"].(float64); ok {
				req.GenConfig.TopP = t
			}
			if t, ok := m["maxOutputTokens"].(float64); ok {
				req.GenConfig.MaxOutputTokens = int(t)
			}
		}
	}

	// 解析工具/函数声明
	if tools, ok := inner["tools"].([]interface{}); ok {
		for _, t := range tools {
			if tm, ok := t.(map[string]interface{}); ok {
				tool := Tool{}
				if fds, ok := tm["functionDeclarations"].([]interface{}); ok {
					for _, fd := range fds {
						if fdm, ok := fd.(map[string]interface{}); ok {
							decl := FunctionDeclaration{}
							if n, ok := fdm["name"].(string); ok {
								decl.Name = n
							}
							if d, ok := fdm["description"].(string); ok {
								decl.Description = d
							}
							if p, ok := fdm["parameters"]; ok {
								decl.Parameters = p
							}
							tool.FunctionDeclarations = append(tool.FunctionDeclarations, decl)
						}
					}
				}
				req.Tools = append(req.Tools, tool)
			}
		}
	}

	return req, nil
}

func parsePart(pm map[string]interface{}) *Part {
	part := &Part{}
	hasContent := false

	if t, ok := pm["text"].(string); ok {
		part.Text = t
		hasContent = true
	}
	if t, ok := pm["thought"].(bool); ok {
		part.Thought = t
	}
	if fc, ok := pm["functionCall"].(map[string]interface{}); ok {
		part.FunctionCall = &FunctionCall{}
		if n, ok := fc["name"].(string); ok {
			part.FunctionCall.Name = n
		}
		if a, ok := fc["args"].(map[string]interface{}); ok {
			part.FunctionCall.Args = a
		}
		hasContent = true
	}
	if id, ok := pm["inlineData"].(map[string]interface{}); ok {
		if m, ok := id["mimeType"].(string); ok {
			if d, ok := id["data"].(string); ok {
				part.InlineData = &InlineData{MimeType: m, Data: d}
				hasContent = true
			}
		}
	}
	if !hasContent && part.Text == "" {
		return nil
	}
	return part
}

func parseConnectRequest(body []byte, contentType string) (*GeminiRequest, error) {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "json") {
		return parseJSONRequest(body)
	}
	// Connect proto: 跳过帧头尝试 JSON
	offset := 0
	if len(body) > 5 && body[0] == 0 {
		offset = 5
	}
	if offset < len(body) {
		var raw map[string]interface{}
		if err := json.Unmarshal(body[offset:], &raw); err == nil {
			return parseJSONRequest(body[offset:])
		}
	}
	return &GeminiRequest{Stream: true}, nil
}

// OpenAI 请求类型
type OpenAIChatRequest struct {
	Model           string          `json:"model"`
	Messages        []OpenAIMessage `json:"messages"`
	Tools           []OpenAITool    `json:"tools,omitempty"`
	Stream          bool            `json:"stream"`
	MaxTokens       int             `json:"max_tokens,omitempty"`
	Temperature     float64         `json:"temperature,omitempty"`
	TopP            float64         `json:"top_p,omitempty"`
	Thinking        *ThinkingConfig `json:"thinking,omitempty"`
	ReasoningEffort string          `json:"reasoning_effort,omitempty"`
}

type ThinkingConfig struct {
	Type string `json:"type"`
}

type OpenAIMessage struct {
	Role             string          `json:"role"`
	Content          string          `json:"content"`
	ReasoningContent string          `json:"reasoning_content,omitempty"`
	ToolCalls        []OpenAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string          `json:"tool_call_id,omitempty"`
}

type OpenAITool struct {
	Type     string             `json:"type"`
	Function OpenAIToolFunction `json:"function"`
}

type OpenAIToolFunction struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Parameters  interface{} `json:"parameters,omitempty"`
}

type OpenAIToolCall struct {
	ID       string                `json:"id"`
	Type     string                `json:"type"`
	Function OpenAIToolCallFunction `json:"function"`
}

type OpenAIToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type OpenAIStreamChunk struct {
	Choices []OpenAIStreamChoice `json:"choices"`
}

type OpenAIStreamChoice struct {
	Delta        OpenAIDelta          `json:"delta"`
	FinishReason string               `json:"finish_reason"`
}

type OpenAIDelta struct {
	Content          string                `json:"content,omitempty"`
	ReasoningContent string                `json:"reasoning_content,omitempty"`
	ToolCalls        []OpenAIToolCallChunk `json:"tool_calls,omitempty"`
}

type OpenAIToolCallChunk struct {
	Index    int    `json:"index"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function"`
}

// normalizeGeminiSchema 将 Gemini Proto schema 转换为 JSON Schema 格式
// Gemini 使用大写类型名如 "STRING"、"INTEGER"，OpenAI 使用小写如 "string"、"integer"
func normalizeGeminiSchema(schema interface{}) interface{} {
	switch s := schema.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{}, len(s))
		for k, v := range s {
			switch k {
			case "type":
				if typeStr, ok := v.(string); ok {
					switch strings.ToUpper(typeStr) {
					case "STRING":
						result[k] = "string"
					case "INTEGER":
						result[k] = "integer"
					case "NUMBER":
						result[k] = "number"
					case "BOOLEAN":
						result[k] = "boolean"
					case "ARRAY":
						result[k] = "array"
					case "OBJECT":
						result[k] = "object"
					default:
						result[k] = strings.ToLower(typeStr)
					}
				} else {
					result[k] = v
				}
			case "format":
				// 保留 format（如 int64, double）
				result[k] = v
			case "enum":
				result[k] = v
			case "description":
				result[k] = v
			case "nullable":
				result[k] = v
			case "properties":
				if props, ok := v.(map[string]interface{}); ok {
					converted := make(map[string]interface{}, len(props))
					for propKey, propVal := range props {
						converted[propKey] = normalizeGeminiSchema(propVal)
					}
					result[k] = converted
				} else {
					result[k] = v
				}
			case "items":
				result[k] = normalizeGeminiSchema(v)
			case "required":
				result[k] = v
			case "additionalProperties":
				result[k] = v
			case "$ref":
				result[k] = v
			default:
				result[k] = v
			}
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(s))
		for i, v := range s {
			result[i] = normalizeGeminiSchema(v)
		}
		return result
	default:
		return schema
	}
}

func convertGeminiToolsToOpenAI(tools []Tool) []OpenAITool {
	var result []OpenAITool
	for _, t := range tools {
		for _, fd := range t.FunctionDeclarations {
			var params interface{}
			if fd.Parameters != nil {
				params = normalizeGeminiSchema(fd.Parameters)
			}
			result = append(result, OpenAITool{
				Type: "function",
				Function: OpenAIToolFunction{
					Name:        fd.Name,
					Description: fd.Description,
					Parameters:  params,
				},
			})
		}
	}
	return result
}

func convertToOpenAI(gemini *GeminiRequest, model string, apiKey string, baseURL string) *OpenAIChatRequest {
	req := &OpenAIChatRequest{
		Model:  model,
		Stream: true,
	}

	if gemini.SystemInst != nil {
		sysText := ""
		for _, p := range gemini.SystemInst.Parts {
			sysText += p.Text
		}
		if sysText != "" {
			req.Messages = append(req.Messages, OpenAIMessage{Role: "system", Content: sysText})
		}
	}

	for _, c := range gemini.Contents {
		role := "user"
		if c.Role == "model" {
			role = "assistant"
		}

		// 将 Gemini parts 转为 OpenAI 消息
		// - functionCall/functionResponse → 文本化（避免 tool_call ID 不匹配）
		// - thought parts → reasoning_content（DeepSeek 要求回传）
		var textParts []string
		var thoughtParts []string

		for _, p := range c.Parts {
			if p.FunctionCall != nil {
				argsBytes, _ := json.Marshal(p.FunctionCall.Args)
				textParts = append(textParts, fmt.Sprintf("[FunctionCall: %s(%s)]", p.FunctionCall.Name, string(argsBytes)))
			} else if p.FunctionResponse != nil {
				respBytes, _ := json.Marshal(p.FunctionResponse.Response)
				textParts = append(textParts, fmt.Sprintf("[FunctionResponse: %s -> %s]", p.FunctionResponse.Name, string(respBytes)))
			} else if p.InlineData != nil {
				textParts = append(textParts, fmt.Sprintf("[InlineData: %s, %d bytes]", p.InlineData.MimeType, len(p.InlineData.Data)))
			} else if p.Thought {
				thoughtParts = append(thoughtParts, p.Text)
			} else {
				textParts = append(textParts, p.Text)
			}
		}

		text := strings.Join(textParts, "\n")
		thought := strings.Join(thoughtParts, "\n")

		if text == "" && thought == "" {
			continue
		}

		msg := OpenAIMessage{Role: role}
		if text != "" {
			msg.Content = text
		} else {
			msg.Content = " "
		}
		if thought != "" && role == "assistant" {
			msg.ReasoningContent = thought
		}
		req.Messages = append(req.Messages, msg)
	}

	// 添加工具声明（不发送 tool_choice，DeepSeek V4 不支持）
	if len(gemini.Tools) > 0 {
		req.Tools = convertGeminiToolsToOpenAI(gemini.Tools)
	}

	if gemini.GenConfig != nil {
		req.Temperature = gemini.GenConfig.Temperature
		req.TopP = gemini.GenConfig.TopP
		req.MaxTokens = gemini.GenConfig.MaxOutputTokens
	}

	// deepseek-v4-pro 启用思考模式（DeepSeek API 官方支持）
	// 文档：thinking: {"type": "enabled"}, reasoning_effort: "high"
	if model == "deepseek-v4-pro" {
		req.Thinking = &ThinkingConfig{Type: "enabled"}
		req.ReasoningEffort = "high"
		req.Temperature = 0
		req.TopP = 0
	}

	return req
}

func streamAndConvert(w http.ResponseWriter, flusher http.Flusher, openaiReq *OpenAIChatRequest, geminiModel string, apiKey string, baseURL string) error {
	reqBody, err := json.Marshal(openaiReq)
	if err != nil {
		return fmt.Errorf("序列化请求失败: %w", err)
	}

	url := fmt.Sprintf("%s/chat/completions", strings.TrimRight(baseURL, "/"))
	logf("[DeepSeek] 请求 URL: %s, 模型: %s, 消息数: %d", url, openaiReq.Model, len(openaiReq.Messages))

	req, err := http.NewRequest("POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("DeepSeek 请求失败: %w", err)
	}
	defer resp.Body.Close()

	logf("[DeepSeek] 响应状态码: %d", resp.StatusCode)

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logf("[DeepSeek] 错误响应体: %s", string(body))
		return fmt.Errorf("DeepSeek 返回 %d: %s", resp.StatusCode, string(body))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	responseID := fmt.Sprintf("resp_%d", time.Now().UnixMilli())
	modelVersion := geminiModel
	chunkCount := 0

	// 累积工具调用的缓冲区（按 index → name + arguments）
	toolCallAccum := make(map[int]*OpenAIToolCallChunk)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			writeSSEFinalEvent(w, flusher, responseID, modelVersion)
			return nil
		}

		var chunk OpenAIStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]

		chunkCount++
		if chunkCount <= 3 || chunkCount%50 == 0 {
			logf("[DeepSeek] 收到第 %d 个 SSE 块", chunkCount)
		}

		if choice.Delta.Content != "" {
			writeSSETextEvent(w, flusher, choice.Delta.Content, responseID, modelVersion)
		}

		// DeepSeek 思考模式：reasoning_content 可能为空字符串（开头块），跳过空值
		if choice.Delta.ReasoningContent != "" {
			writeSSEThoughtEvent(w, flusher, choice.Delta.ReasoningContent, responseID, modelVersion)
		}

		// 累积工具调用（按键 index）
		if len(choice.Delta.ToolCalls) > 0 {
			for _, tc := range choice.Delta.ToolCalls {
				existing, ok := toolCallAccum[tc.Index]
				if !ok {
					tcCopy := tc
					toolCallAccum[tc.Index] = &tcCopy
				} else {
					if tc.Function.Name != "" {
						existing.Function.Name = tc.Function.Name
					}
					existing.Function.Arguments += tc.Function.Arguments
				}
			}
		}

		if choice.FinishReason == "stop" {
			logf("[DeepSeek] 流式结束, 共 %d 块, finishReason=%s", chunkCount, choice.FinishReason)
			writeSSEFinalEvent(w, flusher, responseID, modelVersion)
			return nil
		}

		if choice.FinishReason == "tool_calls" {
			logf("[DeepSeek] 流式结束, 共 %d 块, finishReason=%s, toolCall数量=%d", chunkCount, choice.FinishReason, len(toolCallAccum))
			// 将累积的 tool_calls 转成 Gemini functionCall 事件
			writeSSEFunctionCallEvent(w, flusher, toolCallAccum, responseID, modelVersion)
			return nil
		}
	}

	logf("[DeepSeek] SSE 流结束, 共收到 %d 块", chunkCount)
	// 流结束时仍有未发出的工具调用，补发
	if len(toolCallAccum) > 0 {
		logf("[DeepSeek] 补发 %d 个未发出的工具调用", len(toolCallAccum))
		writeSSEFunctionCallEvent(w, flusher, toolCallAccum, responseID, modelVersion)
	}
	return nil
}

func writeSSETextEvent(w http.ResponseWriter, flusher http.Flusher, text, responseID, model string) {
	event := map[string]interface{}{
		"response": map[string]interface{}{
			"candidates": []map[string]interface{}{
				{
					"index": 0,
					"content": map[string]interface{}{
						"role":  "model",
						"parts": []map[string]interface{}{{"text": text}},
					},
					"safetyRatings": []map[string]interface{}{
						{"category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_HATE_SPEECH", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "NEGLIGIBLE"},
					},
				},
			},
			"modelVersion": model,
			"responseId":   responseID,
		},
	}
	writeSSE(w, flusher, event)
}

func writeSSEThoughtEvent(w http.ResponseWriter, flusher http.Flusher, thought, responseID, model string) {
	event := map[string]interface{}{
		"response": map[string]interface{}{
			"candidates": []map[string]interface{}{
				{
					"index": 0,
					"content": map[string]interface{}{
						"role":  "model",
						"parts": []map[string]interface{}{{"thought": true, "text": thought}},
					},
					"safetyRatings": []map[string]interface{}{
						{"category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_HATE_SPEECH", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "NEGLIGIBLE"},
					},
				},
			},
			"modelVersion": model,
			"responseId":   responseID,
		},
	}
	writeSSE(w, flusher, event)
}

func writeSSEFinalEvent(w http.ResponseWriter, flusher http.Flusher, responseID, model string) {
	event := map[string]interface{}{
		"response": map[string]interface{}{
			"candidates": []map[string]interface{}{
				{
					"index":         0,
					"content":       map[string]interface{}{"role": "model", "parts": []map[string]interface{}{}},
					"finishReason":  "STOP",
					"safetyRatings": []map[string]interface{}{
						{"category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_HATE_SPEECH", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "NEGLIGIBLE"},
					},
				},
			},
			"modelVersion": model,
			"responseId":   responseID,
		},
	}
	writeSSE(w, flusher, event)
}

func writeSSEFunctionCallEvent(w http.ResponseWriter, flusher http.Flusher, toolCalls map[int]*OpenAIToolCallChunk, responseID, model string) {
	var parts []map[string]interface{}
	// 按 index 排序输出
	indices := make([]int, 0, len(toolCalls))
	for idx := range toolCalls {
		indices = append(indices, idx)
	}
	sort.Ints(indices)
	for _, idx := range indices {
		tc := toolCalls[idx]
		// 解析 arguments JSON 字符串为 map
		var args map[string]interface{}
		if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
			args = map[string]interface{}{}
		}
		parts = append(parts, map[string]interface{}{
			"functionCall": map[string]interface{}{
				"name": tc.Function.Name,
				"args": args,
			},
		})
	}
	event := map[string]interface{}{
		"response": map[string]interface{}{
			"candidates": []map[string]interface{}{
				{
					"index":         0,
					"content":       map[string]interface{}{"role": "model", "parts": parts},
					"finishReason":  "STOP",
					"safetyRatings": []map[string]interface{}{
						{"category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_HATE_SPEECH", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "NEGLIGIBLE"},
						{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "NEGLIGIBLE"},
					},
				},
			},
			"modelVersion": model,
			"responseId":   responseID,
		},
	}
	writeSSE(w, flusher, event)
}

func writeSSEError(w http.ResponseWriter, flusher http.Flusher, errMsg string) {
	event := map[string]interface{}{
		"error": map[string]interface{}{
			"code":    503,
			"message": errMsg,
		},
	}
	writeSSE(w, flusher, event)
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, event interface{}) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

import * as vscode from 'vscode';
import * as path from 'path';
import { LocalAgent } from './LocalAgent.js';
import { ClipEditorPanel } from './ClipEditorPanel.js';
import { OrchestratorClient } from '@codix/sdk';

export class ClipViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codix.clipView';
	private _view?: vscode.WebviewView;
	private _client?: OrchestratorClient;
	private _agents: Map<string, LocalAgent> = new Map();

	constructor(private readonly _context: vscode.ExtensionContext) {
		try {
			const aiAddress = process.env.CODIX_AI_ADDR || 'localhost:50051';
			this._client = new OrchestratorClient(aiAddress);
		} catch (e: any) {
			console.warn('[ClipView] OrchestratorClient unavailable (gRPC not loaded):', e.message);
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._context.extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'proxyFetch': {
					const { requestId, url, options } = message;
					try {
						const nodeFetch = (await import('node-fetch')).default;
						const fetchOptions: any = {
							method: options.method || 'GET',
							headers: options.headers || {}
						};
						if (options.body) {
							fetchOptions.body = options.body;
						}
						
						const res = await nodeFetch(url as any, fetchOptions);
						const status = res.status;
						const resHeaders: Record<string, string> = {};
						res.headers.forEach((val: string, key: string) => {
							resHeaders[key] = val;
						});

						let data: any;
						const contentType = resHeaders['content-type'] || '';
						if (contentType.includes('application/json')) {
							data = await res.json();
						} else {
							data = await res.text();
						}

						webviewView.webview.postMessage({
							type: 'proxyFetchResponse',
							requestId,
							success: true,
							status,
							headers: resHeaders,
							data
						});
					} catch (e: any) {
						console.error(`[Codix Extension Host] proxyFetch failed for ${url}:`, e);
						webviewView.webview.postMessage({
							type: 'proxyFetchResponse',
							requestId,
							success: false,
							error: e.message
						});
					}
					break;
				}
				case 'openFullEditor':
					ClipEditorPanel.createOrShow(this._context);
					break;
				case 'executeIntent':
					await this._handleClipAction(message.text, message.model, message.providerConfig);
					break;
				case 'saveLLMSettings': {
					// Persist LLM settings in extension globalState
					this._context.globalState.update('codix_llm_settings', message.settings);
					console.log('[Codix] LLM settings synced to extension globalState (ClipView)');

					const syncSessionId = message.sessionId || 'default';
					let syncAgent = this._agents.get(syncSessionId);
					if (!syncAgent) {
						syncAgent = new LocalAgent(webviewView.webview, syncSessionId);
						this._agents.set(syncSessionId, syncAgent);
					}
					syncAgent.updateSettings(message.settings);
					break;
				}
				case 'executeLocalTool': {
					console.log(`[ClipViewProvider] Received Tool Request: ${message.toolName}`);
					const sessionId = message.sessionId || 'default';
					let agent = this._agents.get(sessionId);
					if (!agent) {
						agent = new LocalAgent(webviewView.webview, sessionId);
						this._agents.set(sessionId, agent);
					}
					agent.execute(message.toolName, message.args, message.requestId);
					break;
				}
			}
		});
	}

	private async _handleClipAction(text: string, model?: string, providerConfig?: any) {
		if (!this._view) return;

		// Load settings from globalState if not provided directly
		if (!providerConfig) {
			providerConfig = this._context.globalState.get('codix_llm_settings');
		}

		const isDirectLLM = providerConfig && (providerConfig.apiKey || providerConfig.type === 'ollama' || providerConfig.providerName === 'ollama' || providerConfig.apiUrl);

		if (!isDirectLLM && !this._client) {
			this._view.webview.postMessage({
				type: 'response',
				text: '⚠️ Chưa kết nối Local AI Server (gRPC) và chưa cấu hình LLM Provider. Hãy cấu hình LLM Provider trong Settings để sử dụng AI trực tiếp.'
			});
			return;
		}

		try {
			this._view.webview.postMessage({ type: 'thinking', value: true });

			let aiMessage = '';
			let operations: any[] = [];

			if (isDirectLLM) {
				// Gọi LLM trực tiếp
				const activeEditor = vscode.window.activeTextEditor;
				let contextSnippet = '';
				if (activeEditor) {
					contextSnippet = `\n\n[CONTEXT: File ${activeEditor.document.fileName}]\n${activeEditor.document.getText().substring(0, 1500)}`;
				}
				const responseData = await this._callLLMDirect(text, contextSnippet, providerConfig);
				aiMessage = responseData.message || responseData.content || "Tôi đã xử lý yêu cầu.";
				operations = responseData.operations || [];
			} else {
				// Gọi gRPC Client
				const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
				const results = await this._client!.executeIntent(text, workspacePath);
				aiMessage = results[results.length - 1]?.message || "Studio AI đã xử lý yêu cầu của bạn.";
				// Tách operations nếu có
				const lastResult = results[results.length - 1];
				if (lastResult && lastResult.operations) {
					operations = lastResult.operations;
				}
			}

			// Parse JSON thủ công nếu AI trả về raw message nhưng chưa tách operations
			if (operations.length === 0) {
				const jsonMatch = aiMessage.match(/```json\n([\s\S]*?)\n```/);
				if (jsonMatch && jsonMatch[1]) {
					try { operations = JSON.parse(jsonMatch[1]); } catch(e) {}
				}
			}

			// Nếu người dùng yêu cầu tạo video/clip mới từ đầu mà chưa có operations nào được sinh ra,
			// và không phải là yêu cầu tạo phụ đề/caption hay chữ viết,
			// chúng ta tự động sinh ra một bộ Timeline Operations hoàn chỉnh đại diện cho kịch bản TikTok 60 giây!
			const isCreatingFromScratch = (
				text.toLowerCase().includes('tạo video') || 
				text.toLowerCase().includes('dựng video') || 
				text.toLowerCase().includes('tạo clip') || 
				text.toLowerCase().includes('dựng clip') || 
				text.toLowerCase().includes('tạo tiktok') ||
				(text.toLowerCase().includes('tạo') && text.toLowerCase().includes('video'))
			);
			const isSubtitleRequest = (
				text.toLowerCase().includes('caption') || 
				text.toLowerCase().includes('sub') || 
				text.toLowerCase().includes('phụ đề') || 
				text.toLowerCase().includes('chữ')
			);

			if (operations.length === 0 && isCreatingFromScratch && !isSubtitleRequest) {
				console.log('[ClipViewProvider] Auto-generating premium TikTok 60-second template operations...');
				operations = [
					{ type: 'seek', time: 0.0 },
					{ type: 'addClip', trackId: 'a1', name: 'tiktok_lofi_beat.mp3', startAt: 0.0, duration: 60.0 },
					
					// Phân cảnh 1 (0s - 10s): Giới thiệu
					{ type: 'addClip', trackId: 'v1', name: 'stock_nature_intro.mp4', startAt: 0.0, duration: 10.0 },
					{ type: 'addClip', trackId: 't1', name: 'TIKTOK TRENDING', startAt: 1.0, duration: 8.0 },
					{ type: 'addClip', trackId: 'c1', name: 'Chào mừng các bạn đến với video AI ngắn hôm nay!', startAt: 0.5, duration: 9.0 },
					
					// Phân cảnh 2 (10s - 25s): Nội dung chính
					{ type: 'addClip', trackId: 'v1', name: 'stock_tech_showcase.mp4', startAt: 10.0, duration: 15.0 },
					{ type: 'addClip', trackId: 't1', name: 'CODIX STUDIO PRO', startAt: 11.0, duration: 13.0 },
					{ type: 'addClip', trackId: 'c1', name: 'Mọi tính năng được điều khiển tự động hoàn toàn bằng Trí Tuệ Nhân Tạo!', startAt: 10.5, duration: 14.0 },
					
					// Phân cảnh 3 (25s - 45s): Hướng dẫn nhanh
					{ type: 'addClip', trackId: 'v1', name: 'stock_workspace.mp4', startAt: 25.0, duration: 20.0 },
					{ type: 'addClip', trackId: 't1', name: 'DỰNG VIDEO TRONG 1 CLICK', startAt: 26.0, duration: 18.0 },
					{ type: 'addClip', trackId: 'c1', name: 'Bạn chỉ cần nói ra ý tưởng, hệ thống sẽ tự động lập trình và sản xuất timeline.', startAt: 25.5, duration: 19.0 },
					
					// Phân cảnh 4 (45s - 60s): Kêu gọi hành động
					{ type: 'addClip', trackId: 'v1', name: 'stock_sunset_outro.mp4', startAt: 45.0, duration: 15.0 },
					{ type: 'addClip', trackId: 't1', name: 'FOLLOW FOR MORE', startAt: 46.0, duration: 12.0 },
					{ type: 'addClip', trackId: 'c1', name: 'Đừng quên bấm theo dõi để không bỏ lỡ các video công nghệ mới nhất nhé!', startAt: 45.5, duration: 14.0 }
				];
				
				aiMessage = `🎬 **Codix AI - Tự Động Thiết Kế Video TikTok 60 Giây** 🚀\n\nTôi đã phát hiện yêu cầu tạo video mà không có tài nguyên thô của bạn. Hệ thống đã tự động lên kịch bản phân cảnh và thiết lập một Timeline hoàn chỉnh dài đúng **60 giây** với:\n* **Nhạc nền**: \`tiktok_lofi_beat.mp3\` dài 60s.\n* **Video nền**: 4 cảnh quay stock chất lượng cao (Intro, Tech, Workspace, Sunset).\n* **Tiêu đề hoạt họa**: 4 khối tiêu đề động theo xu hướng TikTok.\n* **Phụ đề tự động**: 4 câu phụ đề chạy đồng bộ khớp với phân cảnh.\n\nMàn hình chỉnh sửa **Codix Studio Pro** đã được khởi động và nạp sẵn kịch bản này! Bạn có thể xem thử hoặc thay thế các clip thô bất cứ lúc nào.`;
			}

			// Tự động trích xuất các code block trong phản hồi để ghi ra file hoặc mở Untitled Document
			try {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				const codeBlockRegex = /```([a-zA-Z0-9+#-]+)?\n([\s\S]*?)\n```/g;
				let match;
				
				while ((match = codeBlockRegex.exec(aiMessage)) !== null) {
					const lang = (match[1] || 'txt').toLowerCase();
					if (lang === 'json') continue; // Bỏ qua block json operations
					let code = match[2];
					
					// Xác định tên file
					let fileName = '';
					
					// 1. Tìm comment ghi chú tên file ở dòng đầu tiên hoặc dòng thứ hai
					const fileCommentMatch = code.match(/(?:\/\/|\/\*|#|<!--)\s*(?:target:|file:|filepath:)\s*([a-zA-Z0-9_\-\.\/]+)/i);
					if (fileCommentMatch && fileCommentMatch[1]) {
						fileName = fileCommentMatch[1].trim();
					} else {
						// 2. Tự suy luận dựa trên ngôn ngữ
						switch (lang) {
							case 'go': case 'golang': fileName = 'main.go'; break;
							case 'html': fileName = 'index.html'; break;
							case 'js': case 'javascript': fileName = 'index.js'; break;
							case 'ts': case 'typescript': fileName = 'index.ts'; break;
							case 'py': case 'python': fileName = 'main.py'; break;
							case 'css': fileName = 'styles.css'; break;
							case 'sh': case 'bash': fileName = 'run.sh'; break;
							case 'php': fileName = 'index.php'; break;
							default: fileName = 'output.' + lang; break;
						}
					}
					
					if (fileName) {
						if (workspaceFolders && workspaceFolders.length > 0) {
							// Có Workspace đang mở -> Ghi vào file thực tế
							const wsRoot = workspaceFolders[0].uri.fsPath;
							const filePath = path.join(wsRoot, fileName);
							const fileUri = vscode.Uri.file(filePath);
							
							const parentDir = path.dirname(filePath);
							await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));
							await vscode.workspace.fs.writeFile(fileUri, Buffer.from(code, 'utf8'));
							
							const doc = await vscode.workspace.openTextDocument(fileUri);
							await vscode.window.showTextDocument(doc);
							vscode.window.showInformationMessage(`Đã tự động tạo và lưu mã nguồn vào file: ${fileName}`);
						} else {
							// Không có Workspace đang mở -> Tạo Untitled Document tạm thời
							let docLang = lang;
							if (lang === 'golang') docLang = 'go';
							
							const doc = await vscode.workspace.openTextDocument({
								language: docLang,
								content: code
							});
							await vscode.window.showTextDocument(doc);
							vscode.window.showInformationMessage(`Vì chưa mở thư mục Workspace, Codix đã mở tài liệu tạm thời chứa mã nguồn ${fileName}!`);
						}
					}
				}
			} catch (writeErr) {
				console.error("[Codix] Auto-write code block error:", writeErr);
			}

			this._view.webview.postMessage({ type: 'thinking', value: false });
			this._view.webview.postMessage({ 
				type: 'response', 
				text: aiMessage
			});

			// Bắn lệnh qua Event Bridge sang Khung 1 (Clip Editor) nếu có operations
			if (operations.length > 0) {
				try {
					const { CodixEventManager } = await import('./CodixEventManager.js');
					CodixEventManager.getInstance().sendOperations(operations);
				} catch (eventErr) {
					console.error('[ClipView] EventManager failed:', eventErr);
				}
			}

			// Logic tự động mở Editor nếu yêu cầu tạo video
			if (text.toLowerCase().includes('video') || text.toLowerCase().includes('clip')) {
				ClipEditorPanel.createOrShow(this._context);
			}

		} catch (err: any) {
			this._view.webview.postMessage({ type: 'thinking', value: false });
			let errMsg = err.message;
			if (errMsg.includes('ECONNREFUSED') || errMsg.includes('14 UNAVAILABLE')) {
				errMsg = "⚠️ **Không thể kết nối đến Codix AI Engine (gRPC localhost:50051)**.\n\nVui lòng đảm bảo bạn đã khởi động backend AI xử lý video (Codix Engine) để thực hiện tính năng này.";
			}
			this._view.webview.postMessage({ 
				type: 'response', 
				text: errMsg
			});
		}
	}

	private async _callLLMDirect(prompt: string, context: string, config: any): Promise<any> {
		const { type, apiKey, apiUrl, model } = config;

		// Xây dựng URL endpoint
		let url: string;
		let headers: Record<string, string>;
		let body: string;

		const systemPrompt = `Bạn là Codix Studio AI - trợ lý biên tập video thông minh, tích hợp trực tiếp trong Codix Studio Pro (trình chỉnh sửa video chuyên nghiệp tương tự CapCut).

Nhiệm vụ của bạn là:
1. Nhận yêu cầu chỉnh sửa video, thêm phụ đề/caption, thêm hiệu ứng, hoặc lên kịch bản dựng video từ người dùng.
2. Trả về phản hồi bằng Tiếng Việt thân thiện, giải thích các chỉnh sửa bạn thực hiện.
3. Đưa ra danh sách các thao tác chỉnh sửa timeline (operations) dưới dạng JSON để hệ thống tự động thực hiện trên timeline của người dùng.

Bạn phải trả về phản hồi dưới định dạng JSON với cấu trúc sau:
{
  "message": "Lời nhắn hoặc mô tả của bạn bằng tiếng Việt về những gì bạn đã làm hoặc kịch bản video.",
  "operations": [
    // Danh sách các thao tác timeline
  ]
}

### Các thao tác Timeline (Operations) được hỗ trợ:
1. Thao tác thêm chữ / phụ đề / tiêu đề (add_text):
   {
     "action": "add_text",
     "startAt": 1.5,       // thời điểm bắt đầu (giây, kiểu số thực)
     "duration": 4.5,      // thời lượng hiển thị (giây, kiểu số thực)
     "content": "Nội dung văn bản hiển thị",
     "style": true         // (tùy chọn) true nếu muốn áp dụng style nổi bật
   }
2. Thao tác thêm clip video / âm thanh từ thư viện (add_clip):
   {
     "action": "add_clip",
     "startAt": 0.0        // (tùy chọn) thời điểm bắt đầu
   }
3. Thao tác tạo phụ đề tự động từ âm thanh/video trên timeline (auto_caption):
   {
     "action": "auto_caption"
   }
4. Thao tác xóa clip khỏi timeline (delete_clip):
   {
     "action": "delete_clip",
     "clipId": "clip_id"   // (tùy chọn) ID của clip cần xóa
   }

Lưu ý quan trọng:
- Luôn luôn trả về đúng định dạng JSON hợp lệ. Không viết văn bản thường bên ngoài khối JSON.
- Các clip chữ phải được thiết lập startAt và duration hợp lý, không chồng chéo lên nhau trên cùng một phân đoạn trừ khi có chủ ý.`;

		const fullPrompt = prompt + context;

		if (type === 'anthropic') {
			// Anthropic Claude API
			url = (apiUrl || 'https://api.anthropic.com') + '/v1/messages';
			headers = {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01'
			};
			body = JSON.stringify({
				model: model || 'claude-sonnet-4-20250514',
				max_tokens: 4096,
				system: systemPrompt,
				messages: [{ role: 'user', content: fullPrompt }]
			});
		} else if (type === 'google') {
			// Google Gemini API
			url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${apiKey}`;
			headers = { 'Content-Type': 'application/json' };
			body = JSON.stringify({
				contents: [{ parts: [{ text: systemPrompt + '\n\n' + fullPrompt }] }],
				generationConfig: { maxOutputTokens: 4096 }
			});
		} else {
			// OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Ollama, LM Studio, vLLM, custom)
			let baseUrl = apiUrl || 'https://api.openai.com/v1';
			baseUrl = baseUrl.replace(/\/+$/, '');
			if (!baseUrl.endsWith('/v1') && !baseUrl.endsWith('/chat/completions')) {
				if (type === 'ollama') {
					baseUrl = baseUrl + '/v1';
				}
			}
			url = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';
			headers = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			};
			body = JSON.stringify({
				model: model || 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: fullPrompt }
				],
				response_format: { type: "json_object" },
				max_tokens: 4096
			});
		}

		console.log(`[Codix] Calling LLM (Clip Studio): ${type} → ${url} (model: ${model})`);

		// HTTP(S) request
		const isHttps = url.startsWith('https');
		const httpModule = isHttps ? require('https') : require('http');

		const rawResponse: string = await new Promise((resolve, reject) => {
			const urlObj = new URL(url);
			const req = httpModule.request({
				hostname: urlObj.hostname,
				port: urlObj.port || (isHttps ? 443 : 80),
				path: urlObj.pathname + urlObj.search,
				method: 'POST',
				headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
				timeout: 120000
			}, (res: any) => {
				let data = '';
				res.on('data', (chunk: any) => { data += chunk; });
				res.on('end', () => {
					if (res.statusCode >= 400) {
						reject(new Error(`API trả về lỗi ${res.statusCode}: ${data.substring(0, 500)}`));
					} else {
						resolve(data);
					}
				});
			});
			req.on('error', (e: any) => reject(new Error(`Không thể kết nối tới ${type}: ${e.message}`)));
			req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout (120s)')); });
			req.write(body);
			req.end();
		});

		// Parse response theo từng provider
		const json = JSON.parse(rawResponse);
		let content = '';

		if (type === 'anthropic') {
			content = json.content?.[0]?.text || '';
		} else if (type === 'google') {
			content = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
		} else {
			content = json.choices?.[0]?.message?.content || '';
		}

		// Cố parse response như JSON {message, operations}
		try {
			const parsed = JSON.parse(content);
			return { message: parsed.message || content, operations: parsed.operations || [] };
		} catch {
			// AI trả về text thường, tìm JSON block nếu có
			const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
			if (jsonMatch && jsonMatch[1]) {
				try {
					const ops = JSON.parse(jsonMatch[1]);
					return { message: content, operations: Array.isArray(ops) ? ops : (ops.operations || []) };
				} catch { }
			}
			return { message: content, operations: [] };
		}
	}

	private async _callBackend(url: string, prompt: string, context: string): Promise<any> {
		const isHttps = url.startsWith('https');
		const httpModule = isHttps ? require('https') : require('http');
		const body = JSON.stringify({ prompt, context });

		return new Promise<any>((resolve, reject) => {
			const req = httpModule.request(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
			}, (res: any) => {
				let data = '';
				res.on('data', (chunk: any) => { data += chunk; });
				res.on('end', () => {
					try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
				});
			});
			req.on('error', (e: any) => reject(new Error(`Backend không phản hồi: ${e.message}`)));
			req.write(body);
			req.end();
		});
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));
		const bridgeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'bridge.js'));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<link rel="stylesheet" href="${styleMainUri}">
				<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
				<style>
					.studio-header { padding: 15px; background: rgba(168, 85, 247, 0.1); border-bottom: 1px solid rgba(255,255,255,0.05); text-align: center; display: flex; flex-direction: column; position: relative; }
					.btn-studio { width: 100%; background: linear-gradient(135deg, #A855F7, #3B82F6); color: white; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 10px; }
					.toolbar-icon-btn { color: #94A3B8; cursor: pointer; transition: color 0.2s; }
					.toolbar-icon-btn:hover { color: #c9d1d9; }
				</style>
			</head>
			<body class="authenticated">
				<div class="main-container" style="display: flex; flex-direction: column; height: 100vh;">
					<div class="studio-header">
						<button class="btn-studio" onclick="openFullEditor()">
							<span class="material-icons">movie_filter</span> OPEN FULL STUDIO
						</button>
						<div style="display: flex; justify-content: space-between; align-items: center;">
							<div style="font-size: 10px; color: #94A3B8;">Talk to AI to edit your clips</div>
						</div>
					</div>

					<main id="view-container" style="flex: 1; overflow-y: auto;">
						<div id="chat-container">
							<div id="messages-list">
								<div class="msg ai">
									<div class="content">Chào bạn! Tôi là Codix Studio AI. Hãy gửi yêu cầu để tôi giúp bạn dựng video nhé!</div>
								</div>
							</div>
						</div>
						<div id="feature-content" style="display: none; padding: 15px;"></div>
					</main>

					<footer>
						<div class="vibe-input-container" style="padding: 0px; overflow: hidden; gap: 0px;">
							<textarea id="message-input" class="vibe-textarea" placeholder="Yêu cầu chỉnh sửa video..." rows="1" style="padding: 12px 12px 0 12px; width: 100%; border: none; background: transparent; outline: none; resize: none; box-sizing: border-box;"></textarea>
							<div class="vibe-toolbar" style="padding: 8px 12px 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
								<div class="vibe-toolbar-left" style="display: flex; align-items: center; gap: 6px;">
									<!-- Model Selector Pill -->
									<div id="vibe-model-selector-pill" class="toolbar-pill" style="cursor: pointer; position: relative; display: flex; align-items: center; gap: 4px;">
										<span id="vibe-model-selector-icon" class="material-icons" style="font-size: 12px; color: #A855F7;">cloud</span>
										<span id="vibe-selected-model-text" style="font-weight: 500;">Cloud AI</span>
										<span class="material-icons" style="font-size: 12px; opacity: 0.5;">arrow_drop_down</span>
									</div>
									
									<!-- Model Selection Popover (Absolute positioned above) -->
									<div id="vibe-model-popover" class="vibe-popover" style="display: none; position: absolute; bottom: 100%; left: 0; z-index: 100;">
										<!-- Will render dynamically via main.js -->
									</div>

									<!-- Autonomy Toggle -->
									<div class="toolbar-pill" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2); display: flex; align-items: center; gap: 4px;">
										<span class="material-icons" style="font-size: 12px; color: #10b981;">smart_toy</span>
										<span style="font-weight: 500; color: #10b981;">Autonomous</span>
									</div>

									<!-- Tools -->
									<div class="toolbar-pill" style="display: flex; align-items: center; gap: 4px;">
										<span class="material-icons" style="font-size: 12px;">build</span>
										<span style="font-weight: 500;">Tools</span>
									</div>
								</div>
								
								<div class="vibe-toolbar-right" style="display: flex; align-items: center; gap: 8px;">
									<span class="material-icons toolbar-icon-btn" title="Mention (@)">alternate_email</span>
									<span id="vibe-upload-btn" class="material-icons toolbar-icon-btn" title="Upload Media">image</span>
									<button id="send-button" class="vibe-send-btn" style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: none; background: #A855F7; color: white; cursor: pointer;">
										<span class="material-icons" style="font-size: 16px;">arrow_upward</span>
									</button>
								</div>
							</div>
							
							<!-- Compact AI Status Bar -->
							<div class="vibe-ai-status-bar" style="display: flex; align-items: center; justify-content: space-around; padding: 6px 12px; background: rgba(0, 0, 0, 0.2); border-top: 1px solid rgba(255, 255, 255, 0.05); font-size: 9px; color: #94A3B8; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
								<div style="display: flex; align-items: center; gap: 3px;">
									<span style="font-size: 10px;">🎙️</span>
									<span style="font-weight: 500; color: #94A3B8;">STT:</span>
									<span id="status-stt-val" style="font-weight: 600; color: #E2E8F0;">Whisper</span>
								</div>
								<div style="height: 10px; width: 1px; background: rgba(255, 255, 255, 0.08);"></div>
								<div style="display: flex; align-items: center; gap: 3px;">
									<span style="font-size: 10px;">👁️</span>
									<span style="font-weight: 500; color: #94A3B8;">Vision:</span>
									<span id="status-vision-val" style="font-weight: 600; color: #E2E8F0;">SAM2</span>
								</div>
								<div style="height: 10px; width: 1px; background: rgba(255, 255, 255, 0.08);"></div>
								<div style="display: flex; align-items: center; gap: 3px;">
									<span style="font-size: 10px;">🎬</span>
									<span style="font-weight: 500; color: #94A3B8;">Video:</span>
									<span id="status-video-val" style="font-weight: 600; color: #E2E8F0;">OpenReel</span>
								</div>
							</div>
						</div>
					</footer>
					
					<!-- Shared Modal Overlay for Settings/Provider logic -->
					<div id="modal-overlay" class="modal-overlay" style="display: none;">
						<div class="modal-content"></div>
					</div>
				</div>

				<script>
					window.vscode = (window.vscode) ? window.vscode : acquireVsCodeApi();
					window.codixViewType = 'clip';
					const vscode = window.vscode;
					function openFullEditor() { vscode.postMessage({ type: 'openFullEditor' }); }
					
					// Toggle Settings View
					let showingSettings = false;
					window.toggleSettings = () => {
						const chatContainer = document.getElementById('chat-container');
						const featureContent = document.getElementById('feature-content');
						
						showingSettings = !showingSettings;
						if (showingSettings) {
							chatContainer.style.display = 'none';
							featureContent.style.display = 'block';
							if (typeof window.renderSettings === 'function') {
								window.renderSettings();
							}
						} else {
							chatContainer.style.display = 'block';
							featureContent.style.display = 'none';
						}
						
						// Close Popover when opening settings
						if (typeof window.closeAllMenus === 'function') {
							window.closeAllMenus();
						}
					};
				</script>
				<script src="${bridgeUri}"></script>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

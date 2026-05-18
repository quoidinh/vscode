/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

import * as vscode from 'vscode';
import * as path from 'path';
import { OrchestratorClient } from '@codix/sdk';
import { LocalAgent } from './LocalAgent';

export class CodixViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codix.chatView';
	private _view?: vscode.WebviewView;
	private _client?: OrchestratorClient;
	private _agents: Map<string, LocalAgent> = new Map();
	private _messageHandler?: (message: any) => void;
	private _isAuthenticated: boolean = false;

	constructor(private readonly _context: vscode.ExtensionContext) {
		try {
			const aiAddress = process.env.CODIX_AI_ADDR || 'localhost:50051';
			this._client = new OrchestratorClient(aiAddress);
		} catch (e: any) {
			console.warn('[CodixView] OrchestratorClient unavailable (gRPC not loaded):', e.message);
		}
	}

	public setAuthState(isAuthenticated: boolean, token?: string) {
		this._isAuthenticated = isAuthenticated;
		if (this._view) {
			this._view.webview.postMessage({ type: 'auth_state_changed', isAuthenticated, token });
		}
	}

	public setUserInfo(name: string, avatar: string | null, isAuthenticated: boolean) {
		if (this._view) {
			this._view.webview.postMessage({ type: 'userInfo', name, avatar, isAuthenticated });
		}
	}

	public setMessageHandler(handler: (message: any) => void) {
		this._messageHandler = handler;
	}

	public getAgent(sessionId: string = 'default'): LocalAgent | undefined {
		return this._agents.get(sessionId);
	}

	public syncWorkspace(path: string) {
		if (this._view) {
			this._view.webview.postMessage({ type: 'syncWorkspace', path: path });
		}
	}

	public updateOpenFiles(fileNames: any[]) {
		if (this._view) {
			this._view.webview.postMessage({ type: 'updateOpenFiles', fileNames: fileNames });
		}
	}

	public addContextToChat(contextText: string) {
		if (this._view) {
			this._view.webview.postMessage({ type: 'addContext', text: contextText });
		}
	}

	public sendSearchResults(results: any[]) {
		if (this._view) {
			this._view.webview.postMessage({ type: 'search_results', results: results });
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
			if (this._messageHandler) {
				this._messageHandler(message);
			}

			switch (message.type) {
				case 'executeIntent':
					await this._handleRealAction(message.text, message.model || 'cloud', message.providerConfig);
					break;
				case 'saveLLMSettings':
					// Persist LLM settings in extension globalState
					this._context.globalState.update('codix_llm_settings', message.settings);
					console.log('[Codix] LLM settings synced to extension globalState');
					break;
				case 'syncSettings': {
					const syncSessionId = message.sessionId || 'default';
					let syncAgent = this._agents.get(syncSessionId);
					if (!syncAgent) {
						syncAgent = new LocalAgent(webviewView.webview, syncSessionId);
						this._agents.set(syncSessionId, syncAgent);
					}
					syncAgent.updateSettings(message.settings);
					console.log('[CodixView] Settings synced to LocalAgent');
					break;
				}
				case 'executeLocalTool': {
					console.log(`[CodixViewProvider] Received Tool Request: ${message.toolName}`);
					const sessionId = message.sessionId || 'default';
					let agent = this._agents.get(sessionId);
					if (!agent) {
						agent = new LocalAgent(webviewView.webview, sessionId);
						this._agents.set(sessionId, agent);
					}
					agent.execute(message.toolName, message.args, message.requestId);
					break;
				}
				case 'uploadMedia':
					vscode.window.showOpenDialog({
						canSelectFiles: true,
						canSelectMany: true,
						filters: { 'Media': ['mp4', 'png', 'jpg', 'mp3'] }
					}).then(uris => {
						if (uris && uris.length > 0) {
							vscode.window.showInformationMessage(`Codix AI: Đã tải lên và phân tích ${uris.length} file media.`);
							webviewView.webview.postMessage({
								type: 'response',
								text: `Đã đính kèm ${uris.length} file vào bộ nhớ tạm. Sẵn sàng dựng clip!`
							});
						}
					});
					break;
			}
		});
	}

	private async _handleRealAction(text: string, model: string, providerConfig?: any) {
		if (!this._view) return;

		const activeEditor = vscode.window.activeTextEditor;
		const currentFile = activeEditor ? activeEditor.document.fileName.split('/').pop() : 'Workspace';

		const providerLabel = providerConfig?.providerName || (model === 'local' ? 'Local AI' : 'Cloud AI');
		const tasks = [
			{ id: 1, title: `Đọc ngữ cảnh: ${currentFile}`, status: 'pending' },
			{ id: 2, title: `Gửi → ${providerLabel} (${providerConfig?.model || 'default'})`, status: 'pending' },
			{ id: 3, title: 'Thực thi phản hồi AI', status: 'pending' }
		];

		this._view.webview.postMessage({ type: 'start_tasks', tasks });

		let contextSnippet = '';
		if (activeEditor) {
			contextSnippet = `\n\n[CONTEXT: File ${activeEditor.document.fileName}]\n${activeEditor.document.getText().substring(0, 1500)}`;
		}

		try {
			this._view.webview.postMessage({ type: 'thinking', value: true });

			// Bước 1: Xử lý ngữ cảnh
			await new Promise(r => setTimeout(r, 300));
			tasks[0].status = 'completed';
			this._view.webview.postMessage({ type: 'update_tasks', tasks });

			// Bước 2: Gọi LLM trực tiếp dựa trên providerConfig
			let responseData: any;

			if (providerConfig && (providerConfig.apiKey || providerConfig.type === 'ollama' || providerConfig.providerName === 'ollama' || providerConfig.apiUrl)) {
				// Gọi LLM trực tiếp từ Extension Host
				responseData = await this._callLLMDirect(text, contextSnippet, providerConfig);
			} else if (model === 'local') {
				// Fallback: Local backend relay
				responseData = await this._callBackend('http://localhost:3826/api/v1/vibe-edit', text, contextSnippet);
			} else {
				// Fallback: Cloud backend relay
				responseData = await this._callBackend('https://coderx-backend-render.onrender.com/api/v1/vibe-edit', text, contextSnippet);
			}

			tasks[1].status = 'completed';
			this._view.webview.postMessage({ type: 'update_tasks', tasks });

			// Bước 3: Xử lý phản hồi
			let aiMessage = responseData.message || responseData.content || "Tôi đã xử lý yêu cầu.";
			let operations = responseData.operations || [];

			// Parse JSON thủ công nếu AI trả về raw message nhưng chưa tách operations
			if (operations.length === 0) {
				const jsonMatch = aiMessage.match(/```json\n([\s\S]*?)\n```/);
				if (jsonMatch && jsonMatch[1]) {
					try { operations = JSON.parse(jsonMatch[1]); } catch(e) {}
				}
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

			tasks[2].status = 'completed';
			this._view.webview.postMessage({ type: 'update_tasks', tasks });
			this._view.webview.postMessage({ type: 'thinking', value: false });

			// Bắn lệnh qua Event Bridge sang Khung 1 (Clip Editor) nếu có operations
			if (operations.length > 0) {
				const { CodixEventManager } = await import('./CodixEventManager.js');
				CodixEventManager.getInstance().sendOperations(operations);
			}

			this._view.webview.postMessage({ 
				type: 'response', 
				text: aiMessage
			});

		} catch (err: any) {
			this._view.webview.postMessage({ type: 'thinking', value: false });
			const errorMsg = `⚠️ **Lỗi kết nối ${providerLabel}**\n\n${err.message}\n\n💡 Hãy kiểm tra:\n- API Key hợp lệ\n- URL chính xác\n- Provider đang hoạt động`;
			this._view.webview.postMessage({ 
				type: 'response', 
				text: errorMsg 
			});
		}
	}

	/**
	 * Gọi LLM trực tiếp qua OpenAI-compatible API hoặc Anthropic API
	 */
	private async _callLLMDirect(prompt: string, context: string, config: any): Promise<any> {
		const { type, apiKey, apiUrl, model } = config;

		// Xây dựng URL endpoint
		let url: string;
		let headers: Record<string, string>;
		let body: string;

		const systemPrompt = `Bạn là Codix Studio AI - trợ lý biên tập video thông minh. 
Khi nhận yêu cầu chỉnh sửa video, hãy trả về JSON operations nếu có thể.
Định dạng: { "message": "...", "operations": [...] }`;

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
				max_tokens: 4096
			});
		}

		console.log(`[Codix] Calling LLM: ${type} → ${url} (model: ${model})`);

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

	/**
	 * Gọi backend relay (fallback khi không có providerConfig trực tiếp)
	 */
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
		const socketIoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'socket.io.min.js'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css'));
		const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'marked.min.js'));
		const prismJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'prism.min.js'));
		const prismCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'prism.css'));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<link rel="stylesheet" href="${styleMainUri}">
				<link rel="stylesheet" href="${prismCssUri}">
				<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
				<style>
					.header-commercial {
						display: flex; justify-content: space-between; align-items: center;
						padding: 10px 15px; border-bottom: 1px solid rgba(255,255,255,0.05);
						background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(10px);
					}
					.credit-badge {
						background: rgba(16, 185, 129, 0.1); color: #10B981;
						padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: bold;
						display: flex; align-items: center; gap: 4px; border: 1px solid rgba(16, 185, 129, 0.2);
					}
					.cloud-status {
						display: flex; align-items: center; gap: 5px; font-size: 9px; color: #64748B;
					}
					.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #10B981; }

					/* Task Graph Styles */
					#task-graph-container {
						background: rgba(168, 85, 247, 0.05);
						border: 1px solid rgba(168, 85, 247, 0.2);
						border-radius: 12px;
						margin: 15px; padding: 15px; display: none;
					}
					.task-item { display: flex; align-items: center; gap: 10px; font-size: 12px; margin-bottom: 8px; color: #94A3B8; }
					.task-item.completed { color: #10B981; }
					.task-title { flex: 1; }

					/* New Vibe Coding Input Area Styles */
					.vibe-input-container {
						margin: 12px;
						background: rgba(22, 27, 34, 0.8);
						border: 1px solid rgba(255, 255, 255, 0.08);
						border-radius: 12px;
						padding: 12px;
						transition: border-color 0.2s;
						display: flex;
						flex-direction: column;
						gap: 12px;
					}
					.vibe-input-container:focus-within {
						border-color: #8b5cf6;
					}
					.vibe-textarea {
						width: 100%;
						background: transparent;
						border: none;
						color: #c9d1d9;
						font-family: inherit;
						font-size: 13px;
						resize: none;
						outline: none;
						min-height: 40px;
					}
					.vibe-toolbar {
						display: flex;
						justify-content: space-between;
						align-items: center;
						padding-top: 8px;
						border-top: 1px solid rgba(255, 255, 255, 0.05);
					}
					.vibe-toolbar-left {
						display: flex;
						align-items: center;
						gap: 6px;
					}
					.vibe-toolbar-right {
						display: flex;
						align-items: center;
						gap: 10px;
					}
					.toolbar-pill {
						background: rgba(33, 38, 45, 0.8);
						border: 1px solid rgba(255, 255, 255, 0.08);
						border-radius: 6px;
						padding: 4px 8px;
						display: flex;
						align-items: center;
						gap: 4px;
						font-size: 11px;
						color: #8b949e;
						cursor: pointer;
						transition: all 0.2s;
					}
					.toolbar-pill:hover {
						background: rgba(40, 46, 54, 0.8);
						color: #c9d1d9;
					}
					.toolbar-icon-btn {
						font-size: 16px;
						color: #8b949e;
						cursor: pointer;
						transition: color 0.2s;
					}
					.toolbar-icon-btn:hover {
						color: #c9d1d9;
					}
					.vibe-send-btn {
						background: #8b5cf6;
						color: #fff;
						border: none;
						width: 28px;
						height: 28px;
						border-radius: 6px;
						display: flex;
						align-items: center;
						justify-content: center;
						cursor: pointer;
						transition: transform 0.2s, background 0.2s;
					}
					.vibe-send-btn:hover {
						background: #7c3aed;
						transform: scale(1.05);
					}
				</style>
			</head>
			<body class="authenticated">
				<div class="main-container" style="display: flex; flex-direction: column; height: 100vh;">
					<header class="header-commercial">
						<div style="display: flex; flex-direction: column;">
							<div style="display: flex; align-items: center; gap: 6px;">
								<span class="material-icons" style="color: #A855F7; font-size: 18px;">auto_awesome</span>
								<span style="font-weight: 800; font-size: 12px; letter-spacing: 0.5px;">CODIX PRO</span>
							</div>
							<div class="cloud-status"><span class="status-dot"></span> Cloud Connected</div>
						</div>
						<div style="display: flex; align-items: center; gap: 10px;">
							<div class="credit-badge">
								<span class="material-icons" style="font-size: 12px;">account_balance_wallet</span>
								<span id="credit-value">💎 2,500</span>
							</div>
							<span id="open-settings-btn" class="material-icons toolbar-icon-btn" style="font-size: 18px; color: #94A3B8; cursor: pointer;" title="Settings">settings</span>
						</div>
					</header>

					<main id="view-container" style="flex: 1; overflow-y: auto;">
						<div id="chat-container">
							<div id="task-graph-container">
								<div style="font-weight: bold; font-size: 11px; margin-bottom: 10px; color: #A855F7;">TASK GRAPH EXECUTING...</div>
								<div id="tasks-list"></div>
							</div>
							<div id="messages-list"></div>
						</div>
						<div id="feature-content" style="display: none; padding: 15px;"></div>
					</main>

					<footer>
						<div class="vibe-input-container">
							<textarea id="message-input" class="vibe-textarea" placeholder="Bạn muốn xây dựng gì hôm nay?" rows="1"></textarea>
							<div class="vibe-toolbar">
								<div class="vibe-toolbar-left">
									<!-- Model Selector -->
									<select id="vibe-model-selector" class="toolbar-pill" style="background: transparent; color: #c9d1d9; border: none; outline: none; appearance: none; cursor: pointer;">
										<option value="cloud">Codix Pro (Cloud)</option>
										<option value="local">Local AI (Bridge)</option>
									</select>
									
									<!-- Autonomy Toggle -->
									<div class="toolbar-pill" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2);">
										<span class="material-icons" style="font-size: 12px; color: #10b981;">smart_toy</span>
										<span style="font-weight: 500; color: #10b981;">Autonomous</span>
									</div>

									<!-- Tools -->
									<div class="toolbar-pill">
										<span class="material-icons" style="font-size: 12px;">build</span>
										<span style="font-weight: 500;">Tools</span>
									</div>
								</div>
								
								<div class="vibe-toolbar-right">
									<span class="material-icons toolbar-icon-btn" title="Mention (@)">alternate_email</span>
									<span id="vibe-upload-btn" class="material-icons toolbar-icon-btn" title="Upload Media">image</span>
									<button id="send-button" class="vibe-send-btn">
										<span class="material-icons" style="font-size: 16px;">arrow_upward</span>
									</button>
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
					// Khởi tạo vscode một lần duy nhất và gán vào window để bridge.js/main.js dùng chung
					window.vscode = (window.vscode) ? window.vscode : acquireVsCodeApi();
					window.codixViewType = 'codix';
					const vscode = window.vscode;

					window.addEventListener('message', event => {
						const message = event.data;
						const taskContainer = document.getElementById('task-graph-container');
						if (message.type === 'start_tasks') {
							taskContainer.style.display = 'block';
							renderTasks(message.tasks);
						}
						if (message.type === 'update_tasks') {
							renderTasks(message.tasks);
						}
					});

					document.getElementById('vibe-upload-btn').addEventListener('click', () => {
						vscode.postMessage({ type: 'uploadMedia' });
					});

					// Toggle Settings View
					let showingSettings = false;
					document.getElementById('open-settings-btn').addEventListener('click', () => {
						const chatContainer = document.getElementById('chat-container');
						const featureContent = document.getElementById('feature-content');
						const btn = document.getElementById('open-settings-btn');
						
						showingSettings = !showingSettings;
						if (showingSettings) {
							chatContainer.style.display = 'none';
							featureContent.style.display = 'block';
							btn.style.color = '#A855F7'; // highlight
							if (typeof window.renderSettings === 'function') {
								window.renderSettings();
							}
						} else {
							chatContainer.style.display = 'block';
							featureContent.style.display = 'none';
							btn.style.color = '#94A3B8'; // default
						}
					});

					function renderTasks(tasks) {
						const tasksList = document.getElementById('tasks-list');
						let html = '';
						for (const t of tasks) {
							const icon = t.status === 'completed' ? 'check_circle' : 'radio_button_unchecked';
							const className = t.status === 'completed' ? 'task-item completed' : 'task-item';
							html += '<div class="' + className + '">' +
									'<span class="material-icons" style="font-size: 16px;">' + icon + '</span>' +
									'<span class="task-title">' + t.title + '</span>' +
									'</div>';
						}
						tasksList.innerHTML = html;
					}
				</script>
				<script src="${markedUri}"></script>
				<script src="${prismJsUri}"></script>
				<script src="${socketIoUri}"></script>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

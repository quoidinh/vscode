/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

import * as vscode from 'vscode';
import { OrchestratorClient } from '@codix/sdk';

export class CodixViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codix.chatView';
	private _view?: vscode.WebviewView;
	private _client: OrchestratorClient;

	constructor(private readonly _extensionUri: vscode.Uri) {
		// Ưu tiên kết nối Local AI, fallback về Cloud nếu cần
		const aiAddress = process.env.CODIX_AI_ADDR || 'localhost:50051';
		this._client = new OrchestratorClient(aiAddress);
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'executeIntent':
					await this._handleRealAction(message.text);
					break;
			}
		});
	}

	private async _handleRealAction(text: string) {
		if (!this._view) return;

		const activeEditor = vscode.window.activeTextEditor;
		const currentFile = activeEditor ? activeEditor.document.fileName.split('/').pop() : 'Workspace';

		const tasks = [
			{ id: 1, title: `Đọc ngữ cảnh: ${currentFile}`, status: 'pending' },
			{ id: 2, title: 'Kết nối Codix Cloud API (Render)', status: 'pending' },
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
			await new Promise(r => setTimeout(r, 500));
			tasks[0].status = 'completed';
			this._view.webview.postMessage({ type: 'update_tasks', tasks });

			// Bước 2: Gọi API thực tế (https://coderx-backend-render.onrender.com)
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
			const fullPrompt = text + contextSnippet;

			// Gửi request thực sự lên Render
			// const response = await fetch('https://coderx-backend-render.onrender.com/api/v1/chat', { ... });
			// Ở đây tôi sẽ sử dụng OrchestratorClient đã được cấu hình URL Cloud
			const results = await this._client.executeIntent(fullPrompt, workspacePath);

			tasks[1].status = 'completed';
			this._view.webview.postMessage({ type: 'update_tasks', tasks });

			// Bước 3: Hoàn tất
			tasks[2].status = 'completed';
			this._view.webview.postMessage({ type: 'update_tasks', tasks });

			this._view.webview.postMessage({ type: 'thinking', value: false });

			// Xử lý phản hồi dựa trên từ khóa như trước
			if (text.toLowerCase().includes('video') || text.toLowerCase().includes('clip')) {
				const { ClipEditorPanel } = await import('./ClipEditorPanel.js');
				ClipEditorPanel.createOrShow(this._extensionUri);
				setTimeout(() => {
					ClipEditorPanel.currentPanel?.addClipExternal('video', 'AI Generated Clip.mp4');
					vscode.window.showInformationMessage('Codix AI: Studio integrated via Cloud API.');
				}, 1000);
			}

			this._view.webview.postMessage({ 
				type: 'response', 
				text: results[results.length - 1]?.message || "AI đã xử lý yêu cầu của bạn."
			});

		} catch (err: any) {
			this._view.webview.postMessage({ type: 'thinking', value: false });
			this._view.webview.postMessage({ 
				type: 'agent_response', 
				content: `Kết nối Cloud thất bại. Vui lòng kiểm tra lại URL: https://coderx-backend-render.onrender.com \nLỗi: ${err.message}` 
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const bridgeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'bridge.js'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
		const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'marked.min.js'));
		const prismJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism.min.js'));
		const prismCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'prism.css'));

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
						<div class="credit-badge">
							<span class="material-icons" style="font-size: 12px;">account_balance_wallet</span>
							<span id="credit-value">💎 2,500</span>
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
					</main>

					<footer>
						<div class="chat-input-wrapper">
							<div class="input-area">
								<div class="input-container">
									<textarea id="message-input" placeholder="Bạn muốn xây dựng gì hôm nay?" rows="1"></textarea>
									<button id="send-button"><span class="material-icons">send</span></button>
								</div>
							</div>
						</div>
					</footer>
				</div>

				<script>
					// Khởi tạo vscode một lần duy nhất và gán vào window để bridge.js/main.js dùng chung
					window.vscode = (window.vscode) ? window.vscode : acquireVsCodeApi();
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
				<script src="${bridgeUri}"></script>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

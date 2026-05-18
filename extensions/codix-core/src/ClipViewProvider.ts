/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

import * as vscode from 'vscode';
import { ClipEditorPanel } from './ClipEditorPanel.js';
import { OrchestratorClient } from '@codix/sdk';

export class ClipViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codix.clipView';
	private _view?: vscode.WebviewView;
	private _client: OrchestratorClient;

	constructor(private readonly _context: vscode.ExtensionContext) {
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
			localResourceRoots: [this._context.extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'openFullEditor':
					ClipEditorPanel.createOrShow(this._context.extensionUri);
					break;
				case 'executeIntent':
					await this._handleClipAction(message.text);
					break;
				case 'saveLLMSettings':
					// Persist LLM settings in extension globalState
					this._context.globalState.update('codix_llm_settings', message.settings);
					console.log('[Codix] LLM settings synced to extension globalState');
					break;
				case 'executeLocalTool':
					if (message.toolName === 'fetch') {
						try {
							const fetch = (await import('node-fetch')).default;
							const res = await fetch(message.args.url, {
								method: message.args.method || 'GET',
								headers: message.args.headers || {}
							});
							const data = await res.json();
							webviewView.webview.postMessage({
								type: 'toolResult',
								requestId: message.requestId,
								result: { body: data }
							});
						} catch (e: any) {
							webviewView.webview.postMessage({
								type: 'toolResult',
								requestId: message.requestId,
								result: { error: e.message }
							});
						}
					}
					break;
			}
		});
	}

	private async _handleClipAction(text: string) {
		if (!this._view) return;

		try {
			this._view.webview.postMessage({ type: 'thinking', value: true });

			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
			const results = await this._client.executeIntent(text, workspacePath);

			this._view.webview.postMessage({ type: 'thinking', value: false });
			this._view.webview.postMessage({ 
				type: 'response', 
				text: results[results.length - 1]?.message || "Studio AI đã xử lý yêu cầu của bạn."
			});

			// Logic tự động mở Editor nếu yêu cầu tạo video
			if (text.toLowerCase().includes('video') || text.toLowerCase().includes('clip')) {
				ClipEditorPanel.createOrShow(this._extensionUri);
			}

		} catch (err: any) {
			this._view.webview.postMessage({ type: 'thinking', value: false });
			this._view.webview.postMessage({ 
				type: 'response', 
				text: `Lỗi kết nối Local AI: ${err.message}` 
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const bridgeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'bridge.js'));

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
							<span id="open-settings-btn" class="material-icons toolbar-icon-btn" style="font-size: 16px;" title="Settings">settings</span>
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
						<div class="chat-input-wrapper">
							<div class="input-area">
								<div class="input-container">
									<textarea id="message-input" placeholder="Yêu cầu chỉnh sửa video..." rows="1"></textarea>
									<div class="input-rows">
										<div class="actions-row">
											<span class="material-icons action-icon">videocam</span>
											<span class="material-icons action-icon">mic</span>
											<button id="send-button"><span class="material-icons">send</span></button>
										</div>
									</div>
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
					const vscode = window.vscode;
					function openFullEditor() { vscode.postMessage({ type: 'openFullEditor' }); }
					
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
				</script>
				<script src="${bridgeUri}"></script>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

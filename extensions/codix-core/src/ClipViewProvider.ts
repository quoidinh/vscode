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

	constructor(private readonly _extensionUri: vscode.Uri) {
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
				case 'openFullEditor':
					ClipEditorPanel.createOrShow(this._extensionUri);
					break;
				case 'executeIntent':
					await this._handleClipAction(message.text);
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
					.studio-header { padding: 15px; background: rgba(168, 85, 247, 0.1); border-bottom: 1px solid rgba(255,255,255,0.05); text-align: center; }
					.btn-studio { width: 100%; background: linear-gradient(135deg, #A855F7, #3B82F6); color: white; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 10px; }
				</style>
			</head>
			<body class="authenticated">
				<div class="main-container" style="display: flex; flex-direction: column; height: 100vh;">
					<div class="studio-header">
						<button class="btn-studio" onclick="openFullEditor()">
							<span class="material-icons">movie_filter</span> OPEN FULL STUDIO
						</button>
						<div style="font-size: 10px; color: #94A3B8;">Talk to AI to edit your clips</div>
					</div>

					<main id="view-container" style="flex: 1; overflow-y: auto;">
						<div id="chat-container">
							<div id="messages-list">
								<div class="msg ai">
									<div class="content">Chào bạn! Tôi là Codix Studio AI. Hãy gửi yêu cầu để tôi giúp bạn dựng video nhé!</div>
								</div>
							</div>
						</div>
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
				</div>

				<script>
					window.vscode = (window.vscode) ? window.vscode : acquireVsCodeApi();
					const vscode = window.vscode;
					function openFullEditor() { vscode.postMessage({ type: 'openFullEditor' }); }
				</script>
				<script src="${bridgeUri}"></script>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

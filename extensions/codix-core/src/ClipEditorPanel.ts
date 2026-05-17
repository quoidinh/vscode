/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';


/**
 * CODIX STUDIO PRO - DYNAMIC ENGINE VERSION
 * // allow-any-unicode-next-line
 * Khôi phục logic xử lý động (State Management, Reducer, Real-time Playback)
 */
export class ClipEditorPanel {
	public static currentPanel: ClipEditorPanel | undefined;
	private static currentExtensionUri: vscode.Uri | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;

	private _disposables: vscode.Disposable[] = [];
	
	// allow-any-unicode-next-line
	// Initial State chuẩn xác cho hệ thống Layer Routing
	private _initialState: any = {
		isPlaying: false,
		playheadTime: 3.1,
		totalTime: 120,
		zoomScale: 100,
		activeTab: 'media',
		tracks: [
			{ id: 'f1', name: 'Filters', type: 'filter', icon: 'blur_on', color: '#DB2777', clips: [] },
			{ id: 'e1', name: 'Effects', type: 'effect', icon: 'auto_awesome', color: '#D4A017', clips: [] },
			{ id: 's1', name: 'Stickers', type: 'sticker', icon: 'emoji_emotions', color: '#8B5CF6', clips: [] },
			{ id: 'c1', name: 'Captions', type: 'caption', icon: 'closed_caption', color: '#2ABFBF', clips: [] },
			{ id: 't1', name: 'Text', type: 'text', icon: 'title', color: '#AA4F4F', clips: [] },
			{ id: 'v1', name: 'Video 1', type: 'video', icon: 'play_arrow', color: '#14532D', clips: [
				{ id: 'c1', name: '7803305037219.mp4', startAt: 3.1, duration: 15 }
			] },
			{ id: 'a1', name: 'Audio 1', type: 'audio', icon: 'music_note', color: '#164E63', clips: [
				{ id: 'ca1', name: 'Background Audio', startAt: 3.1, duration: 15 }
			] }
		],
		assets: {
			// allow-any-unicode-next-line
			media: [{ id: 'res1', name: '7803305037219.mp4', thumb: '🌿' }]
		}
	};

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				extensionUri,
				vscode.Uri.joinPath(extensionUri, 'media'),
				vscode.Uri.joinPath(extensionUri, 'media', 'editor'),
				vscode.Uri.joinPath(extensionUri, 'media', 'editor', 'assets'),
			]
		};
		this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(message => {
			if (message.type === 'ready') {
				this._sendState();
			}
		}, null, this._disposables);
	}

	private _sendState() {
		this._panel.webview.postMessage({ type: 'initState', state: this._initialState });
	}

	public static createOrShow(extensionUri: vscode.Uri) {
		ClipEditorPanel.currentExtensionUri = extensionUri;
		if (ClipEditorPanel.currentPanel) {
			ClipEditorPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
			return;
		}
		const panel = vscode.window.createWebviewPanel('clipEditor', 'Codix Studio Pro', vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true
		});
		ClipEditorPanel.currentPanel = new ClipEditorPanel(panel, extensionUri);
	}

	public addClipExternal(type: string, assetName: string) {
		if (this._panel) {
			this._panel.webview.postMessage({ type: 'addClip', assetType: type, name: assetName });
		}
	}

	public dispose() {
		ClipEditorPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
		const indexPath = vscode.Uri.joinPath(extensionUri, 'media', 'editor', 'index.html');
		
		try {
			let html = fs.readFileSync(indexPath.fsPath, 'utf8');
			
			// Transform root paths (assets, favicon, manifest, icons)
			const pathRegex = /(src|href)="(\/(assets|favicon|manifest|icons)[^"]*)"/g;
			
			html = html.replace(pathRegex, (match, attr, oldPath) => {
				const relativePath = oldPath.substring(1);
				const resourceUri = vscode.Uri.joinPath(extensionUri, 'media', 'editor', relativePath);
				const webviewUri = webview.asWebviewUri(resourceUri);
				return `${attr}="${webviewUri}"`;
			});

			// Inject VS Code API Bridge
			const bridgeScript = `
				<script>
					window.vscode = acquireVsCodeApi();
					window.isVsCode = true;
				</script>
			`;
			
			html = html.replace('</head>', `${bridgeScript}</head>`);
			
			return html;
		} catch (e) {
			return `<h1>Error loading editor</h1><p>${e}</p><p>Path: ${indexPath.fsPath}</p>`;
		}
	}

}

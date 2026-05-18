/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodixEventManager } from './CodixEventManager.js';


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

		// Lắng nghe lệnh từ Khung 2 (Codix Chat) và bắn sang Webview (Khung 1)
		CodixEventManager.getInstance().onDidReceiveOperations(operations => {
			if (this._panel) {
				console.log('[ClipEditorPanel] Forwarding operations to Webview:', operations);
				this._panel.webview.postMessage({ type: 'applyTimelineOperations', operations });
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
			retainContextWhenHidden: true,
			localResourceRoots: [
				extensionUri,
				vscode.Uri.joinPath(extensionUri, 'media'),
				vscode.Uri.joinPath(extensionUri, 'media', 'editor'),
				vscode.Uri.joinPath(extensionUri, 'media', 'editor', 'assets'),
			]
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
			
			const baseWebviewUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor'));
			
			// Make absolute paths (starting with /) in the HTML relative so they resolve through base href
			html = html.replace(/(src|href)="\/([^"]*)"/g, '$1="$2"');

			// Inject VS Code API Bridge and Base Href with Universal Asset URL Interceptor
			const bridgeScript = `
				<base href="${baseWebviewUri.toString()}/">
				<script>
					window.vscode = acquireVsCodeApi();
					window.isVsCode = true;
					
					// Base Webview URI provided by the extension host
					const baseWebviewUri = "${baseWebviewUri.toString()}";
					
					// Rewrite function to map unauthorized asset paths to authorized webview paths
					function rewriteAssetUrl(url) {
						if (!url || typeof url !== 'string') return url;
						if (url.includes('/assets/') && !url.includes('/media/editor/assets/')) {
							const parts = url.split('/assets/');
							const assetName = parts[parts.length - 1];
							const rewritten = baseWebviewUri + '/assets/' + assetName;
							console.log('[Codix URL Interceptor] Rewrote:', url, '->', rewritten);
							return rewritten;
						}
						return url;
					}

					// 1. Monkeypatch document.createElement to intercept script, link, and img elements
					const originalCreateElement = document.createElement;
					document.createElement = function(tagName, options) {
						const element = originalCreateElement.call(document, tagName, options);
						const tag = tagName.toLowerCase();
						if (tag === 'link' || tag === 'script' || tag === 'img') {
							const key = tag === 'link' ? 'href' : 'src';
							Object.defineProperty(element, key, {
								get: function() {
									return element.getAttribute(key);
								},
								set: function(val) {
									element.setAttribute(key, rewriteAssetUrl(val));
								},
								configurable: true
							});
						}
						return element;
					};

					// 2. Monkeypatch window.fetch to intercept API and chunk fetches
					const originalFetch = window.fetch;
					window.fetch = function(input, init) {
						if (typeof input === 'string') {
							input = rewriteAssetUrl(input);
						} else if (input && typeof input.url === 'string') {
							Object.defineProperty(input, 'url', {
								value: rewriteAssetUrl(input.url),
								writable: false
							});
						}
						return originalFetch.call(window, input, init);
					};

					// 3. Monkeypatch window.Worker to bypass Same-Origin Policy (SOP) blocks on local worker scripts
					const originalWorker = window.Worker;
					window.Worker = function(scriptURL, options) {
						// Convert URL object to string if necessary to prevent TypeError
						const urlStr = scriptURL instanceof URL ? scriptURL.toString() : scriptURL;
						const resolvedURL = rewriteAssetUrl(urlStr);
						console.log('[Codix Worker Interceptor] Intercepted worker creation for:', scriptURL, '->', resolvedURL, 'Options:', options);
						try {
							// Force classic worker type for all workers to allow internal importScripts calls flawlessly
							if (options) {
								options.type = 'classic';
							}

							// Classic Worker: use importScripts inside same-origin Blob wrapper
							const workerCode = 'importScripts("' + resolvedURL + '");';
							const blob = new Blob([workerCode], { type: 'application/javascript' });
							const blobURL = URL.createObjectURL(blob);
							console.log('[Codix Worker Interceptor] Successfully created Blob URL (Classic):', blobURL);
							return new originalWorker(blobURL, options);
						} catch (e) {
							console.error('[Codix Worker Interceptor] Failed to create Blob URL fallback:', e);
						}
						// Fallback to original
						return new originalWorker(resolvedURL, options);
					};

					// Disable Service Worker registration inside VS Code Webview to prevent 403 blocks
					if (navigator.serviceWorker) {
						navigator.serviceWorker.register = function() {
							console.log('[Codix Webview] Service Worker registration mocked as no-op.');
							return new Promise(() => {});
						};
					}
				</script>
			`;
			
			html = html.replace('<head>', `<head>${bridgeScript}`);
			
			return html;
		} catch (e) {
			return `<h1>Error loading editor</h1><p>${e}</p><p>Path: ${indexPath.fsPath}</p>`;
		}
	}

}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

import * as vscode from 'vscode';

export class ShipViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codix.shipView';
	private _view?: vscode.WebviewView;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<style>
					:root { --purple: #A855F7; --blue: #3B82F6; --bg: #0F172A; }
					body { font-family: 'Inter', sans-serif; background: var(--bg); color: white; padding: 15px; margin: 0; }

					.wallet-section {
						background: linear-gradient(135deg, #1E293B, #0F172A);
						border: 1px solid rgba(255,255,255,0.1);
						padding: 20px; border-radius: 16px; margin-bottom: 25px;
					}
					.balance { font-size: 32px; font-weight: 900; color: #10B981; }

					.node-card {
						background: rgba(30, 41, 59, 0.5);
						border: 1px solid rgba(255,255,255,0.05);
						border-radius: 12px; padding: 15px; margin-bottom: 12px;
						position: relative; overflow: hidden;
					}
					.status-dot { width: 8px; height: 8px; background: #10B981; border-radius: 50%; display: inline-block; margin-right: 5px; }
					.usage-bar { height: 4px; background: #334155; border-radius: 2px; margin-top: 10px; position: relative; }
					.usage-fill { height: 100%; background: var(--purple); border-radius: 2px; transition: width 0.5s; }

					.btn-action {
						width: 100%; padding: 10px; border-radius: 8px; border: none;
						background: var(--purple); color: white; font-weight: bold; cursor: pointer;
						margin-top: 15px;
					}
					.tag { font-size: 9px; background: rgba(168, 85, 247, 0.2); color: var(--purple); padding: 2px 6px; border-radius: 4px; font-weight: bold; }
				</style>
			</head>
			<body>
				<div class="wallet-section">
					<div style="font-size: 10px; opacity: 0.6; margin-bottom: 5px;">TOTAL CREDITS AVAILABLE</div>
					<div class="balance">💎 4,820.50</div>
				</div>

				<div style="font-weight: 800; font-size: 12px; color: #64748B; margin-bottom: 15px; letter-spacing: 1px;">ACTIVE COMPUTE NODES</div>

				<div class="node-card">
					<div style="display: flex; justify-content: space-between; align-items: center;">
						<div style="font-weight: bold; font-size: 14px;">NVIDIA H100 Cluster</div>
						<span class="tag">RENTED</span>
					</div>
					<div style="font-size: 11px; color: #94A3B8; margin-top: 5px;"><span class="status-dot"></span> Online • Region: US-East</div>

					<div style="margin-top: 15px;">
						<div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 5px;">
							<span>VRAM USAGE</span>
							<span>64.2GB / 80GB</span>
						</div>
						<div class="usage-bar"><div class="usage-fill" style="width: 75%;"></div></div>
					</div>
				</div>

				<div class="node-card" style="opacity: 0.6;">
					<div style="display: flex; justify-content: space-between;">
						<div style="font-weight: bold; font-size: 14px;">L40S Node (Spot)</div>
						<div style="font-weight: bold; color: #10B981;">$0.80/hr</div>
					</div>
					<div style="font-size: 11px; color: #94A3B8; margin-top: 5px;">Available for instant provisioning</div>
					<button class="btn-action" style="background: rgba(255,255,255,0.05); border: 1px solid var(--purple);">RENT NOW</button>
				</div>
			</body>
			</html>`;
	}
}

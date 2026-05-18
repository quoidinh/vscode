/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

import * as vscode from 'vscode';
import { CodixViewProvider } from './CodixViewProvider.js';
import { ClipViewProvider } from './ClipViewProvider.js';
import { ShipViewProvider } from './ShipViewProvider.js';

export function activate(context: vscode.ExtensionContext) {
	console.log('Codix Core AI is now active!');

	// Chat Provider
	const chatProvider = new CodixViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			CodixViewProvider.viewType,
			chatProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	// Clip Provider
	const clipProvider = new ClipViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ClipViewProvider.viewType,
			clipProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	// Ship Provider (Marketplace)
	const shipProvider = new ShipViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ShipViewProvider.viewType,
			shipProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codix.syncWorkspace', () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders) {
				vscode.window.showInformationMessage(`Syncing workspace: ${workspaceFolders[0].name}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codix.openChat', () => {
			vscode.commands.executeCommand('workbench.view.extension.codix-explorer');
		})
	);
}

export function deactivate() { }

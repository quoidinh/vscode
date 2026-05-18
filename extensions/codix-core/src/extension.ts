import * as vscode from 'vscode';
import { CodixViewProvider } from './CodixViewProvider.js';
import { ClipViewProvider } from './ClipViewProvider.js';
import { ShipViewProvider } from './ShipViewProvider.js';
import * as path from 'path';

const nodeFetch = (url: string, init?: any) => import('node-fetch').then(({default: fetch}) => fetch(url as any, init));

class CoderXUriHandler implements vscode.UriHandler {
	private _onDidReceiveAuthToken = new vscode.EventEmitter<string>();
	public readonly onDidReceiveAuthToken = this._onDidReceiveAuthToken.event;

	public handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
		if (uri.path === '/auth') {
			const query = new URL(uri.toString(true)).searchParams;
			const token = query.get('token');
			if (token) {
				this._onDidReceiveAuthToken.fire(token);
			}
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Codix Core AI is now active!');

	// Chat Provider
	const chatProvider = new CodixViewProvider(context);
	const uriHandler = new CoderXUriHandler();

	context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

	// Handle token received from UriHandler
	uriHandler.onDidReceiveAuthToken(async (token) => {
		await context.secrets.store('coderx.authToken', token);
		vscode.window.showInformationMessage('Successfully logged in to CoderX in Codix!');
		chatProvider.setAuthState(true, token);
		await syncUserInfo();
	});

	const syncUserInfo = async () => {
		const token = await context.secrets.get('coderx.authToken');
		if (token) {
			console.log('[CoderX] syncUserInfo: Fetching profile...');
			try {
				const res = await nodeFetch(`https://edge-gateway-rho.vercel.app/api/auth/profile`, {
					headers: { 'Authorization': `Bearer ${token}` }
				}) as any;

				if (!res.ok) {
					const text = await res.text();
					console.warn(`[CoderX] Profile fetch failed (${res.status}): ${text}`);
					chatProvider.setUserInfo('Guest', null, false);
					return;
				}

				const user = await res.json();
				console.log('[CoderX] Profile fetched successfully:', user.email);
				const userName = user.name || user.username || user.firstName || (user.email && user.email.includes('@') ? user.email.split('@')[0] : 'User');
				chatProvider.setUserInfo(userName, user.avatar, true);
			} catch (e) {
				console.error("[CoderX] syncUserInfo error:", e);
				chatProvider.setUserInfo('User', null, false);
			}
		} else {
			console.log('[CoderX] syncUserInfo: No token found in secrets.');
		}
	};

	// Check initial auth state
	context.secrets.get('coderx.authToken').then(token => {
		chatProvider.setAuthState(!!token, token);
		if (token) syncUserInfo();
	});

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			CodixViewProvider.viewType,
			chatProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	chatProvider.setMessageHandler(async (message) => {
		if (message.type === 'webviewReady') {
			updateOpenFiles();
			// Automatically sync workspace root when webview is ready
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				chatProvider.syncWorkspace(workspaceFolders[0].uri.fsPath);
			}
			syncUserInfo();
		}

		if (message.type === 'switchAgent') {
			vscode.window.showInformationMessage(`Switched to Agent: ${message.agentName}`);
		}

		if (message.type === 'searchOpenFiles') {
			const query = message.query.toLowerCase();
			const results: any[] = [];
			const seenPaths = new Set<string>();

			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (tab.input instanceof vscode.TabInputText) {
						const uri = tab.input.uri;
						const fsPath = uri.fsPath;
						if (seenPaths.has(fsPath)) continue;
						seenPaths.add(fsPath);

						const fileName = path.basename(fsPath);
						const relativePath = vscode.workspace.asRelativePath(uri);

						if (fileName.toLowerCase().includes(query) || relativePath.toLowerCase().includes(query)) {
							results.push({
								name: fileName,
								path: fsPath,
								relative: relativePath,
								type: 'file'
							});
						} else {
							if (query.length >= 3) {
								try {
									const doc = await vscode.workspace.openTextDocument(uri);
									const text = doc.getText();
									const index = text.toLowerCase().indexOf(query);
									if (index !== -1) {
										const line = doc.lineAt(doc.positionAt(index).line);
										results.push({
											name: fileName,
											path: fsPath,
											relative: relativePath,
											type: 'content',
											preview: line.text.trim()
										});
									}
								} catch (e) { /* ignore */ }
							}
						}
					}
				}
			}
			chatProvider.sendSearchResults(results);
		}

		if (message.type === 'acceptEdits') {
			message.files.forEach(async (path: string) => {
				try {
					const uri = vscode.Uri.file(path);
					const doc = await vscode.workspace.openTextDocument(uri);
					await doc.save();
				} catch (e) { console.error("Failed to accept edit", path, e); }
			});
		} else if (message.type === 'rejectEdits') {
			message.files.forEach(async (path: string) => {
				try {
					const uri = vscode.Uri.file(path);
					await vscode.commands.executeCommand('workbench.action.files.revert', uri);
				} catch (e) { console.error("Failed to reject edit", path, e); }
			});
		}

		if (message.type === 'attachFiles') {
			const uris = await vscode.window.showOpenDialog({
				canSelectMany: true,
				openLabel: 'Attach to Context'
			});
			if (uris && uris.length > 0) {
				const paths = uris.map(u => path.basename(u.fsPath));
				chatProvider.updateOpenFiles(paths);
			}
		}

		if (message.type === 'login') {
			vscode.commands.executeCommand('codix.login');
		}

		if (message.type === 'editProfile') {
			const profileUrl = `https://edge-gateway-rho.vercel.app/profile`;
			vscode.env.openExternal(vscode.Uri.parse(profileUrl));
		}

		if (message.type === 'openExternal') {
			vscode.env.openExternal(vscode.Uri.parse(message.url));
		}

		if (message.type === 'logout') {
			vscode.commands.executeCommand('codix.logout');
		}

		if (message.type === 'openFile') {
			const fileName = message.fileName;
			let targetUri: vscode.Uri | undefined = undefined;

			for (const doc of vscode.workspace.textDocuments) {
				if (path.basename(doc.uri.fsPath) === fileName) {
					targetUri = doc.uri;
					break;
				}
			}

			if (targetUri) {
				vscode.window.showTextDocument(targetUri, { preview: false });
			} else {
				vscode.workspace.findFiles(`**/${fileName}`, '**/node_modules/**', 1).then(files => {
					if (files.length > 0) {
						vscode.window.showTextDocument(files[0], { preview: false });
					}
				});
			}
		}

		if (message.type === 'invokeTool') {
			const action = message.action;
			try {
				if (action === 'read_file') {
					const uris = await vscode.window.showOpenDialog({ canSelectMany: true });
					if (uris) chatProvider.updateOpenFiles(uris.map((u: vscode.Uri) => path.basename(u.fsPath)));
				} else if (action === 'create_file') {
					const doc = await vscode.workspace.openTextDocument({ content: '' });
					vscode.window.showTextDocument(doc);
				} else if (action === 'run_terminal') {
					const terminal = vscode.window.createTerminal('Codix AI');
					terminal.show();
				} else if (action === 'view_subdir') {
					vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
				} else if (action === 'repo_map') {
					vscode.commands.executeCommand('workbench.view.explorer');
				} else if (action === 'exact_search') {
					vscode.commands.executeCommand('workbench.action.findInFiles');
				} else if (action === 'search_web') {
					const query = await vscode.window.showInputBox({ prompt: 'Enter search query' });
					if (query) vscode.env.openExternal(vscode.Uri.parse(`https://www.google.com/search?q=${encodeURIComponent(query)}`));
				} else if (action === 'view_diff') {
					vscode.commands.executeCommand('workbench.view.scm');
				} else if (action === 'read_active') {
					const editor = vscode.window.activeTextEditor;
					if (editor) {
						chatProvider.updateOpenFiles([path.basename(editor.document.uri.fsPath)]);
					} else {
						vscode.window.showInformationMessage('No active file to read.');
					}
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to execute tool: ${err}`);
			}
		}

		if (message.type === 'addMetaContext') {
			const label = message.label;
			try {
				if (label === 'Active File') {
					const editor = vscode.window.activeTextEditor;
					if (editor) {
						chatProvider.updateOpenFiles([path.basename(editor.document.uri.fsPath)]);
					} else {
						vscode.window.showInformationMessage('No active file found.');
					}
				} else if (label === 'Folder') {
					const uris = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: true });
					if (uris) chatProvider.updateOpenFiles(uris.map((u: vscode.Uri) => `@Folder: ${path.basename(u.fsPath)}`));
				} else if (label === 'URL') {
					const url = await vscode.window.showInputBox({ prompt: 'Enter URL to include as context' });
					if (url) chatProvider.updateOpenFiles([`@URL: ${url}`]);
				} else if (label === 'Problems') {
					const diagnostics = vscode.languages.getDiagnostics();
					let errorCount = 0;
					diagnostics.forEach(([uri, diags]: [vscode.Uri, vscode.Diagnostic[]]) => errorCount += diags.length);
					vscode.window.showInformationMessage(`Attached ${errorCount} problems to context.`);
					chatProvider.updateOpenFiles([`@Problems (${errorCount})`]);
				} else if (label === 'Terminal') {
					chatProvider.updateOpenFiles(['@Terminal Output']);
				} else if (label === 'Git Diff') {
					chatProvider.updateOpenFiles(['@Git Diff']);
				} else {
					chatProvider.updateOpenFiles([`@${label}`]);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to get context: ${err}`);
			}
		}

		if (message.type === 'setupProvider') {
			const provider = message.provider;
			vscode.commands.executeCommand('codix.setupProviders', provider);
		}
	});

	const updateOpenFiles = () => {
		const files: any[] = [];
		const seenPaths = new Set<string>();

		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (tab.input instanceof vscode.TabInputText) {
					const fsPath = tab.input.uri.fsPath;
					if (seenPaths.has(fsPath)) continue;
					seenPaths.add(fsPath);

					files.push({
						name: path.basename(fsPath),
						path: fsPath,
						relative: vscode.workspace.asRelativePath(tab.input.uri)
					});
				}
			}
		}
		chatProvider.updateOpenFiles(files);
	};

	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => updateOpenFiles()));
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabGroups(() => updateOpenFiles()));

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
			if (workspaceFolders && workspaceFolders.length > 0) {
				const projectPath = workspaceFolders[0].uri.fsPath;
				try {
					chatProvider.syncWorkspace(projectPath);
					vscode.window.showInformationMessage(`Codix synchronized with ${path.basename(projectPath)}`);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to sync with Codix server: ${error}`);
				}
			} else {
				vscode.window.showErrorMessage('No workspace folder open.');
			}
		})
	);

	const loginCommand = vscode.commands.registerCommand('codix.login', async () => {
		const authUrl = `https://edge-gateway-rho.vercel.app/auth/login?callback=vscode://quoidinh.coderx-vscode/auth`;
		vscode.env.openExternal(vscode.Uri.parse(authUrl));
	});

	const logoutCommand = vscode.commands.registerCommand('codix.logout', async () => {
		await context.secrets.delete('coderx.authToken');
		chatProvider.setAuthState(false);
		vscode.window.showInformationMessage('Logged out from Codix.');
	});

	const setupProvidersCommand = vscode.commands.registerCommand('codix.setupProviders', async (targetProvider?: string) => {
		const terminal = vscode.window.createTerminal({
			name: "Codix Setup",
			hideFromUser: false
		});
		terminal.show();

		terminal.sendText("# --- Codix Auto-Setup Script ---");
		terminal.sendText("echo '🚀 Starting Codix Provider Setup...'");
		terminal.sendText("python3 --version || (echo '❌ Python 3 not found. Please install it first.' && exit 1)");
		terminal.sendText("[ ! -d '.codix-env' ] && python3 -m venv .codix-env && echo '✅ Created virtual environment.'");
		terminal.sendText("source .codix-env/bin/activate");
		terminal.sendText("pip install --upgrade pip");

		if (targetProvider === 'vllm') {
			terminal.sendText("echo '📦 Installing vLLM...' && pip install vllm");
		} else if (targetProvider === 'airllm') {
			terminal.sendText("echo '📦 Installing AirLLM...' && pip install airllm");
		} else if (targetProvider === 'sglang') {
			terminal.sendText("echo '📦 Installing SGLang...' && pip install \"sglang[all]\"");
		} else if (targetProvider === 'transformers') {
			terminal.sendText("echo '📦 Installing Hugging Face Transformers & Torch...' && pip install torch transformers accelerate");
		} else {
			terminal.sendText("echo '📦 Installing common local providers (vLLM, AirLLM)...'");
			terminal.sendText("pip install vllm airllm");
		}

		terminal.sendText("echo '✨ Setup complete! You can now use these providers in Codix.'");
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('codix.openChat', () => {
			vscode.commands.executeCommand('workbench.view.extension.codix-explorer');
		})
	);

	context.subscriptions.push(loginCommand, logoutCommand, setupProvidersCommand);
}

export function deactivate() { }

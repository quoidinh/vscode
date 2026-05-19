/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

(function () {
	const vscode = window.vscode || acquireVsCodeApi();
	const serverUrl = 'https://coderx-backend-render.onrender.com';
	const socketUrl = 'https://coderx-backend-render.onrender.com';
	let socket;
	let currentSessionId = null;
	let currentProjectId = null;
	let isProcessing = false;
	let providerTypes = [];
	let selectedProviderType = null;
	let activeTerminalBlocks = {};
	let modelsData = { providers: [], llmConfig: {} };
	let lastModelInfo = null;

	// Restore persisted session from VS Code managed state
	// This survives webview hide/show cycles when retainContextWhenHidden is false
	const _savedState = vscode.getState() || {};
	if (_savedState.sessionId) currentSessionId = _savedState.sessionId;
	if (_savedState.projectId) currentProjectId = _savedState.projectId;
	let workspacePath = _savedState.workspacePath || null;
	let isAuthenticated = true;
	let authToken = _savedState.authToken || null;
	if (_savedState.modelsData) modelsData = _savedState.modelsData;
	console.log("auth Token: ", authToken);

	window.socketUrl = socketUrl;
	window.initSocket = initSocket;
	window.renderMCP = renderMCP;
	window.renderWorkflow = renderWorkflow;
	window.renderSettings = renderSettings;
	window.renderPlugins = renderPlugins;
	window.renderKnowledge = renderKnowledge;
	window.renderAgents = renderAgentsView;

	const pendingFetches = {};

	// Listen for proxyFetchResponse from extension host
	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'proxyFetchResponse') {
			const { requestId, success, data, status, headers, error } = message;
			const pending = pendingFetches[requestId];
			if (pending) {
				delete pendingFetches[requestId];
				if (success) {
					pending.resolve({
						status,
						ok: status >= 200 && status < 300,
						headers: {
							get: (name) => headers[name.toLowerCase()] || null
						},
						json: async () => data,
						text: async () => (typeof data === 'string' ? data : JSON.stringify(data))
					});
				} else {
					pending.reject(new Error(error || 'Failed to fetch via extension host proxy'));
				}
			}
		}
	});

	async function apiFetch(url, options = {}) {
		const headers = options.headers || {};
		if (authToken) {
			headers['Authorization'] = `Bearer ${authToken}`;
		}

		return new Promise((resolve, reject) => {
			const requestId = 'fetch_' + Math.random().toString(36).substr(2, 9);
			pendingFetches[requestId] = { resolve, reject };
			
			vscode.postMessage({
				type: 'proxyFetch',
				requestId,
				url,
				options: {
					method: options.method || 'GET',
					headers: headers,
					body: options.body
				}
			});
		});
	}

	async function handshakeAndInit() {
		console.log("[CoderX] Performing handshake with gateway...");
		try {
			// Gọi một API nhẹ để Gateway gán Backend và trả về Header
			await apiFetch(`${serverUrl}/api/projects`);
			// Sau khi apiFetch chạy, window.socketUrl đã được cập nhật
			if (authToken && (!socket || !socket.connected)) {
				initSocket();
			}
		} catch (e) {
			console.error("[CoderX] Handshake failed", e);
			// Fallback vẫn khởi tạo socket với URL mặc định nếu handshake lỗi
			if (authToken && (!socket || !socket.connected)) {
				initSocket();
			}
		}
	}
	window.handshakeAndInit = handshakeAndInit;

	function showToast(title, message) {
		console.log(`[Toast] ${title}: ${message}`);
		const container = document.getElementById('toast-container');
		if (!container) {
			const newContainer = document.createElement('div');
			newContainer.id = 'toast-container';
			newContainer.style.position = 'fixed';
			newContainer.style.bottom = '20px';
			newContainer.style.right = '20px';
			newContainer.style.zIndex = '9999';
			document.body.appendChild(newContainer);
		}

		const toast = document.createElement('div');
		toast.className = 'coderx-toast';
		toast.style.background = 'var(--vscode-notifications-background)';
		toast.style.color = 'var(--vscode-notifications-foreground)';
		toast.style.border = '1px solid var(--vscode-notifications-border)';
		toast.style.padding = '10px 15px';
		toast.style.marginBottom = '10px';
		toast.style.borderRadius = '4px';
		toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
		toast.style.animation = 'fadeIn 0.3s ease';

		toast.innerHTML = `
			<div style="font-weight: bold; margin-bottom: 5px;">${title}</div>
			<div>${message}</div>
		`;

		document.getElementById('toast-container').appendChild(toast);

		setTimeout(() => {
			toast.style.opacity = '0';
			toast.style.transition = 'opacity 0.5s ease';
			setTimeout(() => toast.remove(), 500);
		}, 4000);
	}

	function showNotification(message, type = 'info') {
		showToast(type.toUpperCase(), message);
	}
	window.showNotification = showNotification;

	function showModal(title, html) {
		const modalOverlay = document.getElementById('modal-overlay');
		const modalContent = modalOverlay.querySelector('.modal-content');
		if (!modalOverlay || !modalContent) return;

		modalContent.innerHTML = `
			<div class="modal-header">
				<span style="font-weight: 600;">${title}</span>
				<div style="flex: 1;"></div>
				<button class="icon-btn" onclick="window.closeModal()"><span class="material-icons">close</span></button>
			</div>
			<div style="padding: 12px 16px;">
				${html}
			</div>
		`;
		modalOverlay.style.display = 'flex';
	}
	window.showModal = showModal;

	window.showConfirm = (message, onConfirm) => {
		const modalOverlay = document.getElementById('modal-overlay');
		const modalContent = modalOverlay.querySelector('.modal-content');
		if (!modalOverlay || !modalContent) return;

		modalContent.innerHTML = `
			<div class="modal-header">
				<span class="material-icons" style="color: #ef4444;">warning</span>
				<span style="font-weight: 600;">Confirmation Required</span>
				<div style="flex: 1;"></div>
				<button class="icon-btn" onclick="window.closeModal()"><span class="material-icons">close</span></button>
			</div>
			<div style="padding: 16px; font-size: 13px; color: #ccc; line-height: 1.5;">
				${message}
			</div>
			<div class="modal-footer" style="display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; background: rgba(0,0,0,0.1);">
				<button class="secondary-btn" onclick="window.closeModal()" style="padding: 8px 16px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; cursor: pointer;">Cancel</button>
				<button id="modal-confirm-btn" class="upgrade-btn" style="padding: 8px 16px; border-radius: 6px; background: #ef4444; border: none; color: #fff; cursor: pointer; font-weight: 600;">Confirm</button>
			</div>
		`;
		modalOverlay.style.display = 'flex';
		document.getElementById('modal-confirm-btn').onclick = () => {
			window.closeModal();
			onConfirm();
		};
	};

	function persistSessionState() {
		vscode.setState({
			sessionId: currentSessionId,
			projectId: currentProjectId,
			workspacePath,
			isAuthenticated,
			authToken,
			modelsData
		});
	}

	function clearSessionState() {
		vscode.setState({});
		currentSessionId = null;
		currentProjectId = null;
	}

	// UI Elements
	const activeFilePill = document.getElementById('active-file-pill');
	const activeFileNameEl = document.getElementById('active-file-name');
	const chatContainer = document.getElementById('chat-container');
	const messagesList = document.getElementById('messages-list');
	const homeScreen = document.getElementById('home-screen');
	const messageInput = document.getElementById('message-input');
	const sendButton = document.getElementById('send-button');
	const connectionStatus = document.getElementById('connection-status');
	const thinkingContainer = document.getElementById('thinking-container');
	const thinkingText = document.getElementById('thinking-text');
	const currentModelNameEl = document.getElementById('current-model-name');

	const modelSelector = document.getElementById('model-selector');
	const modeSelector = document.getElementById('mode-selector');
	const contextTrigger = document.getElementById('context-trigger');
	const newSessionBtn = document.getElementById('new-session-btn');

	const menuModel = document.getElementById('menu-model');
	const menuTools = document.getElementById('menu-tools');
	const menuContext = document.getElementById('menu-context');
	const menuMore = document.getElementById('menu-more');
	const btnMore = document.getElementById('btn-more');

	const addContextBtn = document.getElementById('add-context-btn');
	const menuSearchFiles = document.getElementById('menu-search-files');
	const fileSearchInput = document.getElementById('file-search-input');
	const searchResultsList = document.getElementById('search-results-list');
	const openFilesContainer = document.getElementById('open-files-container');
	const loginBtn = document.getElementById('login-btn');
	const welcomeView = document.getElementById('welcome-view');
	const mainChatContainer = document.getElementById('main-chat-container');

	let serverOpenFiles = [];
	let attachedContextFiles = new Set();

	if (loginBtn) {
		loginBtn.onclick = () => {
			vscode.postMessage({ type: 'login' });
		};
	}

	// Modal elements
	const authModal = document.getElementById('auth-modal');
	const closeAuthModalBtn = document.getElementById('close-auth-modal');
	const loginNowBtn = document.getElementById('login-now-btn');

	if (closeAuthModalBtn) {
		closeAuthModalBtn.onclick = () => {
			if (authModal) authModal.style.display = 'none';
		};
	}

	if (loginNowBtn) {
		loginNowBtn.onclick = () => {
			vscode.postMessage({ type: 'login' });
			if (authModal) authModal.style.display = 'none';
		};
	}

	// Auth state listener
	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'auth_state_changed') {
			console.log(`[CoderX] auth_state_changed received. Auth: ${message.isAuthenticated}, Token present: ${!!message.token}`);
			isAuthenticated = message.isAuthenticated;
			authToken = message.token || null;
			persistSessionState();

			const userNameText = document.getElementById('user-name-text');
			const authActionIcon = document.getElementById('auth-action-icon');

			if (isAuthenticated) {
				document.body.classList.remove('not-authenticated');
				if (welcomeView) welcomeView.style.display = 'none';
				if (mainChatContainer) mainChatContainer.style.display = 'flex';
				if (authModal) authModal.style.display = 'none';

				if (userNameText) userNameText.textContent = "User";
				if (authActionIcon) {
					authActionIcon.textContent = "logout";
					authActionIcon.title = "Sign Out";
					authActionIcon.style.color = "#ef4444";
				}
				// Trigger a profile sync to get the real name
				vscode.postMessage({ type: 'webviewReady' });

				// Re-initialize socket if we just got a token and weren't connected
				// Handshake với Gateway để lấy Real Backend URL trước khi khởi tạo Socket
				handshakeAndInit();

				// If we are currently in a feature view, reload it now that we have a token
				const currentView = featureContent ? featureContent.dataset.view : null;
				if (currentView) {
					switch (currentView) {
						case 'settings': renderSettings(); break;
						case 'agents': renderAgentsView(); break;
						case 'plugins': renderPlugins(); break;
						case 'market': renderMarket(); break;
					}
				}
			} else {
				document.body.classList.add('not-authenticated');
				// Drop straight into chat view for guests and show modal
				if (welcomeView) welcomeView.style.display = 'none';
				if (mainChatContainer) mainChatContainer.style.display = 'flex';
				if (authModal) authModal.style.display = 'flex';

				if (userNameText) userNameText.textContent = "Guest";
				if (authActionIcon) {
					authActionIcon.textContent = "login";
					authActionIcon.title = "Sign In";
					authActionIcon.style.color = "#4caf50";
				}
			}
		}
		if (message.type === 'addContext') {
			if (messageInput) {
				const currentText = messageInput.value;
				messageInput.value = (currentText ? currentText + '\n\n' : '') + message.text;
				messageInput.focus();
				// Auto-expand textarea
				messageInput.style.height = 'auto';
				messageInput.style.height = messageInput.scrollHeight + 'px';
			}
		}
	});

	/**
		* Show a "Continue" button in the chat UI when the agent is paused in Step-by-Step mode.
		*/
	function showResumeButton(text = 'Resume Next Step') {
		const existing = document.getElementById('step-resume-btn');
		if (existing) {
			existing.innerHTML = `<span class="material-icons">play_arrow</span> <b>${text}</b>`;
			return;
		}

		const resumeBtn = document.createElement('button');
		resumeBtn.id = 'step-resume-btn';
		resumeBtn.className = 'upgrade-btn';
		resumeBtn.style.cssText = 'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 1000; padding: 10px 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px; border: 1px solid rgba(124, 77, 255, 0.4);';
		resumeBtn.innerHTML = `<span class="material-icons">play_arrow</span> <b>${text}</b>`;
		resumeBtn.onclick = () => {
			if (socket && currentSessionId) {
				socket.emit('resume_session', { sessionId: currentSessionId });
				hideResumeButton();
			}
		};
		document.body.appendChild(resumeBtn);
	}

	function hideResumeButton() {
		const btn = document.getElementById('step-resume-btn');
		if (btn) btn.remove();
	}

	window.toggleInteractionMode = () => {
		const newMode = (localStorage.getItem('coderx_interaction_mode') === 'step-by-step') ? 'continuous' : 'step-by-step';
		localStorage.setItem('coderx_interaction_mode', newMode);

		if (socket && currentSessionId) {
			socket.emit('set_interaction_mode', { sessionId: currentSessionId, mode: newMode });
		}

		// Update UI
		const toggleBtn = document.getElementById('interaction-mode-toggle');
		if (toggleBtn) {
			toggleBtn.querySelector('.material-icons').textContent = (newMode === 'step-by-step') ? 'touch_app' : 'bolt';
			toggleBtn.title = (newMode === 'step-by-step') ? 'Mode: Step-by-Step' : 'Mode: Continuous';
			toggleBtn.classList.toggle('active', newMode === 'step-by-step');
		}

		appendSystemMessage(`Execution mode changed to: ${newMode === 'step-by-step' ? '<b>Step-by-Step</b> (Pauses after each turn)' : '<b>Continuous</b>'}`, 'mode-change');
	};

	const backBtn = document.getElementById('back-btn');
	const headerTitleText = document.getElementById('header-title-text');
	const headerIcon = document.getElementById('header-icon');
	const chatView = document.getElementById('chat-view');
	const featureView = document.getElementById('feature-view');
	const featureContent = document.getElementById('feature-content');

	// Popover Toggle Logic
	if (addContextBtn) {
		addContextBtn.onclick = (e) => {
			e.stopPropagation();
			toggleMenu(menuSearchFiles, addContextBtn);
			if (menuSearchFiles && menuSearchFiles.style.display === 'block') {
				setTimeout(() => fileSearchInput?.focus(), 50);
			}
		};
	}

	// Initialize Socket.IO
	function initSocket() {
		const socketLib = window.io || (typeof io !== 'undefined' ? io : null);
		if (!socketLib) {
			console.error('[CoderX] Socket.io library (io) is undefined. Check index.html imports.');
			return;
		}

		const effectiveUrl = window.socketUrl || socketUrl; // Sockets must go direct to Render (Edge Gateways don't support Socket.io)
		console.log(`[CoderX] Initializing socket connection to: ${effectiveUrl} (Token present: ${!!authToken})`);

		// If we have a socket already, disconnect it before re-initializing
		if (socket) {
			socket.off(); // Remove all listeners
			socket.disconnect();
		}

		socket = socketLib(effectiveUrl, {
			auth: {
				token: authToken
			},
			transports: ['websocket', 'polling'],
			reconnection: true,
			reconnectionAttempts: Infinity,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			timeout: 45000
		});


		socket.on('connect', () => {
			console.log(`[CoderX] Socket connected: ${socket.id}`);
			if (connectionStatus) {
				connectionStatus.classList.add('connected');
				connectionStatus.title = `Connected to ${effectiveUrl}`;
			}
			// Update footer status
			const footerDot = document.getElementById('footer-status-dot');
			const footerText = document.getElementById('footer-status-text');
			if (footerDot) { footerDot.className = 'status-dot green'; }
			if (footerText) { footerText.textContent = 'Connected'; }

			fetchInitialState();

			// Auto-sync workspace if we have a path from VS Code
			if (_savedState.workspacePath) {
				socket.emit('set_working_directory', {
					sessionId: currentSessionId,
					directory: _savedState.workspacePath
				});
			}
		});

		socket.on('disconnect', () => {
			console.warn('[CoderX] Socket disconnected.');
			if (connectionStatus) {
				connectionStatus.classList.remove('connected');
				connectionStatus.title = 'Disconnected. Click to retry.';
			}
			// Update footer status
			const footerDot = document.getElementById('footer-status-dot');
			const footerText = document.getElementById('footer-status-text');
			if (footerDot) { footerDot.className = 'status-dot red'; }
			if (footerText) {
				footerText.textContent = 'Disconnected (Retry)';
				footerText.style.cursor = 'pointer';
				footerText.onclick = (e) => {
					e.stopPropagation();
					footerText.textContent = 'Connecting...';
					handshakeAndInit();
				};
			}
		});

		socket.on('model_info', (data) => {
			console.log('model_info', data);
			lastModelInfo = data;
			renderModelMenu(data);
		});

		socket.on('session_joined', (data) => {
			currentSessionId = data.sessionId;
			currentProjectId = data.projectId;
			persistSessionState(); // save so reconnect can rejoin same session
			renderHistory(data.history);

			// Sync UI processing state with the server's data
			if (data.reconnectedDuringProcessing) {
				setProcessing(true, data.agentState?.statusText || 'Reconnecting...');

				// Automatically request resume if it was paused off-line and internet is back
				if (data.agentState?.statusText === 'Waiting for Network...' && navigator.onLine) {
					setTimeout(() => {
						socket.emit('resume_session', { sessionId: currentSessionId });
					}, 500); // Slight delay to ensure connection stability
				}
			} else {
				setProcessing(false);
			}
		});

		socket.on('token_count', (data) => {
			const creditsRemainingEl = document.getElementById('credits-remaining');
			if (creditsRemainingEl && data.remaining !== undefined) {
				creditsRemainingEl.textContent = data.remaining;
			}
		});

		socket.on('agent_update', (update) => {
			handleAgentUpdate(update);

			// Handle background processing status
			if (update.status === 'thinking' || update.status === 'tool_running') {
				setProcessing(true, update.statusText || 'Processing...');
				connectionStatus?.classList.add('busy');
				hideResumeButton();
			} else if (update.status === 'paused') {
				setProcessing(true, update.statusText || 'Paused...');
				connectionStatus?.classList.add('busy');

				// Show "Continue/Retry" button in chat when paused
				if (update.statusText === 'Waiting for Approval' || update.statusText === 'Waiting for Network...') {
					showResumeButton(update.statusText === 'Waiting for Network...' ? 'Retry Connection' : 'Resume Next Step');
				}

				// Ensure Stop button is visible when paused
				const stopAgentBtn = document.getElementById('stop-agent-btn');
				if (stopAgentBtn) {
					stopAgentBtn.disabled = false;
					stopAgentBtn.innerHTML = '<span class="material-icons" style="font-size: 14px;">stop</span> Stop Agent';
				}
			} else if (update.status === 'idle' || update.type === 'error' || update.status === 'error') {
				setProcessing(false);
				connectionStatus?.classList.remove('busy');
				hideResumeButton();
			}
		});

		socket.on('agent_response', (response) => {
			// Only set processing to false if this is the final final response or task is done
			if (!response.isTurnOnly) {
				setProcessing(false);
			}

			// If there's streaming content, finalize it before showing new content
			if (streamingMessageEl && streamingContent) {
				streamingMessageEl = null;
				streamingContent = '';
			}

			// Extract content from turn message or direct content
			let content = '';
			if (response.message && response.message.content) {
				content = response.message.content;
			} else if (response.content) {
				content = response.content;
			}

			// Only append as new message if we didn't already stream this content
			if (content && !streamingMessageEl) {
				// Clean any tool call JSON from the final response content
				content = typeof cleanToolCallsFromContent === 'function' ? cleanToolCallsFromContent(content) : content;
				if (content) {
					// Check if we already streamed this content
					const lastMsg = messagesList ? messagesList.lastElementChild : null;
					const lastContent = lastMsg?.querySelector('.message-content')?.textContent || '';
					// Don't duplicate if streaming already delivered it
					if (!lastContent || !content.startsWith(lastContent.substring(0, 50))) {
						appendMessage('ai', content);
					}
				}
			}
		});

		// Server-side error handler — UNLOCK UI on errors
		socket.on('error', (err) => {
			console.error('[Socket] Server error:', err);
			setProcessing(false);
			const msg = err.message || err.error || 'Server error occurred';
			appendMessage('ai', `⚠️ **Error:** ${msg}`);
		});

		// Agent interrupted — unlock UI
		socket.on('message_queued', (data) => {
			console.log('[Socket] Message queued:', data);
			// Optionally show a toast or a small indicator in chat
			appendMessage('ai', `⏳ **Queued:** ${data.message}`);
		});

		socket.on('interrupt_complete', (data) => {
			console.log('[Socket] Agent interrupted:', data);
			setProcessing(false);
			const stopBtn = document.getElementById('stop-agent-btn');
			if (stopBtn) {
				stopBtn.disabled = false;
				stopBtn.innerHTML = '<span class="material-icons" style="font-size: 14px;">stop</span> Stop Agent';
			}
		});

		socket.on('execute_vscode_tool', (data) => {
			try {
				const { requestId, toolCall } = data;
				let args;
				try {
					args = typeof toolCall.function.arguments === 'string'
						? JSON.parse(toolCall.function.arguments) : toolCall.function.arguments;
				} catch (e) {
					args = toolCall.function.arguments; // fallback
				}

				const toolName = toolCall.function.name;

				// --- Build a human-readable line for this tool execution ---
				const isTerminalCmd = ['run_command', 'Bash', 'VSCodeTerminal'].includes(toolName);
				const isFileWrite = ['write_to_file', 'OverwriteFile', 'PatchFile', 'replace_file_content', 'multi_replace_file_content'].includes(toolName);
				const isFileRead = ['View', 'ReadFile', 'view_file', 'read_file'].includes(toolName);
				const isListDir = ['LS', 'listDir', 'list_dir'].includes(toolName);
				const isSearch = ['VSCodeSearch', 'grep_search', 'search_web'].includes(toolName);
				const isJump = ['jumpToFile', 'jump_to_line'].includes(toolName);
				const isTaskTool = ['AddOrEditTaskTool', 'TaskTrackingTool'].includes(toolName);

				let lineIcon = '⚙️';
				let lineColor = '#a3a3a3';
				let lineText = `${toolName}`;

				if (isTerminalCmd) {
					lineIcon = '▶';
					lineColor = '#4CAF50';
					lineText = `$ ${args.command || args.CommandLine || args.cmd || '...'}`;
				} else if (isFileWrite) {
					const fp = args.TargetFile || args.path || args.file_path || args.file || '?';
					const basename = fp.split('/').pop();
					lineIcon = '📝';
					lineColor = '#64B5F6';
					lineText = `Write → ${basename}`;
				} else if (isFileRead) {
					const fp = args.AbsolutePath || args.path || args.file || '?';
					const basename = fp.split('/').pop();
					lineIcon = '📖';
					lineColor = '#81C784';
					lineText = `Read → ${basename}`;
				} else if (isListDir) {
					const dp = args.DirectoryPath || args.path || args.directory || '.';
					lineIcon = '📂';
					lineColor = '#FFB74D';
					lineText = `List → ${dp}`;
				} else if (isSearch) {
					lineIcon = '🔍';
					lineColor = '#CE93D8';
					lineText = `Search: ${args.Query || args.query || '...'}`;
				} else if (isJump) {
					const fp = args.path || args.AbsolutePath || args.file || '?';
					const basename = fp.split('/').pop();
					lineIcon = '↗️';
					lineColor = '#4DD0E1';
					lineText = `Jump → ${basename}:${args.line || args.StartLine || ''}`;
				} else if (isTaskTool) {
					lineIcon = '📋';
					lineColor = '#FFF176';
					lineText = `Update task.md`;
				}

				// Clear any incomplete streaming message first
				streamingMessageEl = null;
				streamingContent = '';

				// --- Group consecutive tool calls into one execution block ---
				let lastWidgetMsg = null;
				let lastWidget = null;
				const emptyNodes = [];

				if (messagesList) {
					const children = Array.from(messagesList.children);
					for (let i = children.length - 1; i >= 0; i--) {
						const child = children[i];
						if (!child.classList.contains('ai')) break;

						const widget = child.querySelector('.terminal-widget');
						if (widget) {
							lastWidgetMsg = child;
							lastWidget = widget;
							break;
						}

						// Skip empty/whitespace text injected by streaming
						const content = child.querySelector('.message-content')?.textContent;
						if (!content || content.trim() === '') {
							emptyNodes.push(child);
						} else if (!child.querySelector('.loading-dots')) {
							break; // Real text — do not group past it
						}
					}
				}

				let msgEl;
				if (lastWidget && lastWidgetMsg) {
					// Remove empty spacing nodes to cleanly merge
					emptyNodes.forEach(node => node.remove());

					msgEl = lastWidgetMsg;
					const body = lastWidget.querySelector('.terminal-body');
					if (body) {
						const newEntry = document.createElement('div');
						newEntry.className = 'exec-entry';
						newEntry.innerHTML = `
							<div style="color: ${lineColor}; font-weight: 600; margin-top: 10px; margin-bottom: 4px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px;">
								<span style="margin-right: 6px;">${lineIcon}</span>${lineText}
							</div>
							<div class="terminal-output" id="term-out-${requestId}" style="color: #a3a3a3; white-space: pre-wrap; font-size: 11px; padding-left: 22px;">${isTerminalCmd ? '(Executing...)' : '(Processing...)'}</div>
						`;
						body.appendChild(newEntry);
					}

					const spinner = lastWidget.querySelector('.terminal-spinner');
					if (spinner) spinner.style.display = 'block';
					if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
				} else {
					// Create new execution block
					msgEl = appendMessage('ai', '');
					const contentEl = msgEl.querySelector('.message-content');
					if (contentEl) {
						contentEl.innerHTML = `
							<div class="terminal-widget">
								<div class="terminal-header">
									<span class="material-icons" style="font-size: 14px;">terminal</span>
									<span>Agent Execution</span>
									<div class="terminal-spinner"></div>
								</div>
								<div class="terminal-body">
									<div class="exec-entry">
										<div style="color: ${lineColor}; font-weight: 600; margin-bottom: 4px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px;">
											<span style="margin-right: 6px;">${lineIcon}</span>${lineText}
										</div>
										<div class="terminal-output" id="term-out-${requestId}" style="color: #a3a3a3; white-space: pre-wrap; font-size: 11px; padding-left: 22px;">${isTerminalCmd ? '(Executing...)' : '(Processing...)'}</div>
									</div>
								</div>
							</div>
						`;
					}
				}
				activeTerminalBlocks[requestId] = { msgEl, command: lineText, toolName };

				// Track file modifications for the Pending Edits UI
				if (isFileWrite) {
					const filePath = args.TargetFile || args.path || args.file || '';
					if (filePath) {
						addPendingEdit(filePath, toolName);
					}
				}

				vscode.postMessage({ type: 'executeLocalTool', toolName, args, requestId, sessionId: currentSessionId });
			} catch (err) {
				console.error("Execute tool error in main.js", err);
				appendMessage('ai', '⚠️ **Webview Error:** ' + err.message + '\n```json\n' + JSON.stringify(data.toolCall) + '\n```');
			}
		});

		// Handle Fetch Relay (Delegated fetch from backend to client)
		socket.on('execute_fetch_relay', async (data) => {
			const { requestId, url, method, headers, body, isStream } = data;
			console.log(`[FetchRelay] Delegating ${method} to ${url} via Extension Host (Stream: ${isStream}, ID: ${requestId})`);

			// Send to extension host
			vscode.postMessage({
				type: 'executeLocalTool',
				toolName: 'fetch',
				args: { url, method, headers, body, isStream, requestId },
				requestId,
				sessionId: currentSessionId
			});
		});
	}

	// Message listener for responses from extension host
	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'fetchRelayResult') {
			if (socket) {
				socket.emit('fetch_relay_result', {
					requestId: message.requestId,
					response: message.response
				});
			}
		} else if (message.type === 'fetchRelayChunk') {
			if (socket) {
				socket.emit('fetch_relay_chunk', {
					requestId: message.requestId,
					chunk: message.chunk,
					done: message.done,
					error: message.error
				});
			}
		} else if (message.type === 'toolResult') {
			// Relaying to server is handled by the main message listener below (line ~4627)
			// to avoid duplicate socket emissions and keep logic centralized.
			console.log(`[CoderX] Webview received toolResult for requestId: ${message.requestId}`);
		}
	});

	// --- PENDING EDITS UI LOGIC ---
	let pendingEdits = new Set();

	function addPendingEdit(path, toolName) {
		pendingEdits.add(path);
		renderPendingEdits();
	}

	function renderPendingEdits() {
		const container = document.getElementById('pending-edits-container');
		const list = document.getElementById('pending-edits-list');
		const count = document.getElementById('pending-files-count');
		if (!container || !list || !count) return;

		if (pendingEdits.size === 0) {
			container.style.display = 'none';
			return;
		}

		container.style.display = 'flex';
		count.textContent = `${pendingEdits.size} Files With Changes`;
		list.innerHTML = '';

		Array.from(pendingEdits).forEach(path => {
			const fileName = path.split('/').pop() || path;
			const item = document.createElement('div');
			item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border-radius: 4px;';
			item.innerHTML = `
				<div style="display: flex; gap: 8px; align-items: center;">
					<span class="material-icons" style="font-size: 14px; color: #d0a050;">fiber_manual_record</span>
					<span style="color: #4caf50; font-size:10px;">+M</span>
					<span style="color: #f44336; font-size:10px;">-M</span>
					<strong style="color: #d4d4d4; font-weight: 500;">${fileName}</strong>
					<span style="color: #666; font-size: 10px;">...${path.substring(Math.max(0, path.length - 20))}</span>
				</div>
			`;
			list.appendChild(item);
		});
	}

	const btnAcceptAll = document.getElementById('btn-accept-all');
	const btnRejectAll = document.getElementById('btn-reject-all');

	if (btnAcceptAll) {
		btnAcceptAll.onclick = () => {
			vscode.postMessage({ type: 'acceptEdits', files: Array.from(pendingEdits) });
			pendingEdits.clear();
			renderPendingEdits();
		};
	}

	if (btnRejectAll) {
		btnRejectAll.onclick = () => {
			vscode.postMessage({ type: 'rejectEdits', files: Array.from(pendingEdits) });
			pendingEdits.clear();
			renderPendingEdits();
		};
	}
	// --------------------------------

	async function fetchInitialState() {
		try {
			// Pre-load models/providers data via REST to ensure menu is ready
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000);

			apiFetch(`${serverUrl}/api/settings/models`, { signal: controller.signal })
				.then(r => r.json())
				.then(data => {
					clearTimeout(timeoutId);
					if (data && data.providers) {
						modelsData.providers = data.providers;
						modelsData.llmConfig = data.llmConfig || {};
						persistSessionState();
						refreshAllProviderModels();
						// Trigger a menu render if we have enough info
						if (lastModelInfo) renderModelMenu(lastModelInfo);
						if (currentSessionId) socket.emit('get_model_info');
					}
				}).catch(e => {
					clearTimeout(timeoutId);
					console.warn('[CoderX] Failed to pre-fetch models:', e);
				});

			// If we already know our session (from persisted state or previous join),
			// just rejoin it directly without asking the server for a new one.
			if (currentSessionId && currentProjectId) {
				console.log('[CoderX] Rejoing persisted session:', currentSessionId);
				socket.emit('join_session', { sessionId: currentSessionId, projectId: currentProjectId });
				socket.emit('get_model_info');
				refreshAllProviderModels();
				return;
			}

			// No saved session — ask the server which project/session is active
			const initController = new AbortController();
			const initTimeout = setTimeout(() => initController.abort(), 5000);
			const response = await apiFetch(`${serverUrl}/api/projects`, { signal: initController.signal }).catch(() => null);
			clearTimeout(initTimeout);

			if (!response) return;
			const data = await response.json();
			if (data.currentProjectId && data.currentSessionId) {
				currentProjectId = data.currentProjectId;
				currentSessionId = data.currentSessionId;
				socket.emit('join_session', { sessionId: currentSessionId, projectId: currentProjectId });
				socket.emit('get_model_info'); // Force sync on startup
				persistSessionState();
			}
		} catch (error) {
			console.error('Failed to fetch initial state:', error);
		}
	}

	function renderModelMenu(data) {
		console.log('renderModelMenu', data);
		if (!menuModel) return;
		const activeModels = data.activeModels || {};

		// Merge socket providers with locally loaded providers to ensure custom ones are never lost
		const socketProviders = data.availableProviders || data.providers || [];
		const localProvidersList = modelsData.providers || [];

		// Use a Map to deduplicate by name, preferring socket data if it has models
		const providerMap = new Map();

		// 1. Add all local providers first (as placeholders/fallback)
		localProvidersList.forEach(p => {
			providerMap.set(p.name, { ...p, models: p.models || [] });
		});

		// 2. Overwrite with socket data (which should have freshly discovered models)
		socketProviders.forEach(p => {
			const existing = providerMap.get(p.name);
			if (existing) {
				// If socket has models, use them. Otherwise keep local models if any.
				providerMap.set(p.name, {
					...existing,
					...p,
					models: (p.models && p.models.length > 0) ? p.models : existing.models
				});
			} else {
				providerMap.set(p.name, p);
			}
		});

		const availableProviders = Array.from(providerMap.values());

		let html = '<div style="padding:8px 12px; font-weight:700; font-size:10px; opacity:0.5; color: #7c4dff;">ACTIVE ROLES</div>';
		const roles = ['main', 'expert', 'aux'];
		const roleIcons = { main: 'stars', expert: 'psychology', aux: 'settings' };

		roles.forEach(roleKey => {
			const cfg = activeModels[roleKey];
			if (!cfg) return;
			const isActive = data.activeRole === roleKey || (!data.activeRole && roleKey === 'main');

			// Prefer local optimistic state for the active model name to avoid "reset to default" flickers
			const localActive = modelsData.activeModels?.[roleKey];
			const displayModel = (isActive && localActive) ? localActive.model : cfg.model;

			html += `
				<div class="menu-item role-item" onclick="window.setActiveRole('${roleKey}')" style="display:flex; flex-direction:column; padding:8px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); ${isActive ? 'background: rgba(124, 77, 255, 0.08); border-left: 2px solid #7c4dff;' : ''}">
					<div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
						<div style="display:flex; align-items:center; gap:8px;">
							<span class="material-icons" style="font-size:16px; color:#7c4dff;">${roleIcons[roleKey]}</span>
							<span style="font-weight:600; font-size:11px;">${cfg.role}</span>
						</div>
						${isActive ? '<span class="material-icons" style="font-size:14px; color:#7c4dff;">check</span>' : ''}
					</div>
				</div>
			`;

			if (isActive && currentModelNameEl) {
				currentModelNameEl.textContent = displayModel;
			}
		});

		// Provider Filter Chips (based on actual available providers)
		if (availableProviders.length > 0) {
			html += '<div style="padding:8px 12px 4px 12px; font-weight:700; font-size:10px; opacity:0.5; margin-top: 8px;">FILTER BY PROVIDER</div>';
			html += '<div class="menu-chips-container" style="padding: 4px 12px; display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">';

			// Add an "All" chip
			const isAll = !selectedProviderType;
			html += `
				<div class="menu-chip ${isAll ? 'active' : ''}" 
						onclick="window.toggleProviderFilter(event, null)"
						style="${isAll ? 'background: rgba(124, 77, 255, 0.2); border-color: #7c4dff; color: #fff;' : ''}">
					All
				</div>
			`;

			availableProviders.forEach(p => {
				const isSelected = selectedProviderType === p.name;
				const localTypes = ['ollama', 'vllm', 'sglang', 'lmstudio'];
				const isLocal = localTypes.includes(p.type);

				html += `
					<div class="menu-chip ${isSelected ? 'active' : ''} ${isLocal ? 'local' : ''}" 
							onclick="window.toggleProviderFilter(event, '${p.name}')"
							style="${isSelected ? 'background: rgba(124, 77, 255, 0.2); border-color: #7c4dff; color: #fff;' : ''}">
						${p.name}
					</div>
				`;
			});
			html += '</div>';
		}

		const filteredProviders = selectedProviderType
			? availableProviders.filter(p => p.name === selectedProviderType)
			: availableProviders;

		const localTypes = ['ollama', 'vllm', 'sglang', 'lmstudio', 'airllm', 'transformers'];
		const localProviders = filteredProviders.filter(p => localTypes.includes(p.type) || p.name.toLowerCase().includes('local') || p.name.toLowerCase().includes('lmstudio'));
		const cloudProviders = filteredProviders.filter(p => !localProviders.includes(p));

		if (localProviders.length > 0) {
			html += '<div style="padding:8px 12px 4px 12px; font-weight:700; font-size:10px; opacity:0.5; color: var(--accent-color);">LOCAL MODELS</div>';
			localProviders.forEach(p => {
				html += `<div style="padding:4px 12px; font-size:10px; font-weight:600; color: #888; background: rgba(124, 77, 255, 0.05); border-left: 2px solid var(--accent-color);">${p.name.toUpperCase()}</div>`;
				if (p.models && p.models.length > 0) {
					p.models.forEach(model => {
						const currentRole = modelsData.activeRole || 'main';
						const activeForRole = modelsData.activeModels?.[currentRole]?.model === model && modelsData.activeModels?.[currentRole]?.provider === p.name;

						html += `
							<div class="menu-item model-select-item" onclick="window.setSelectedModel('${p.name}', '${model}')" style="${activeForRole ? 'background: rgba(124, 77, 255, 0.1); border-left: 2px solid #7c4dff;' : ''}">
								<div class="menu-item-left">
									<span class="material-icons" style="font-size:14px; opacity:0.7;">computer</span>
									<span>${model}</span>
								</div>
								${activeForRole ? '<span class="material-icons" style="font-size:14px; color: #7c4dff;">check_circle</span>' : ''}
							</div>
						`;
					});
				}
			});
		}

		if (cloudProviders.length > 0) {
			html += '<div style="padding:8px 12px 4px 12px; font-weight:700; font-size:10px; opacity:0.5; margin-top: 8px;">CLOUD MODELS</div>';
			cloudProviders.forEach(p => {
				html += `<div style="padding:4px 12px; font-size:10px; font-weight:600; color: #888; background: rgba(255,255,255,0.02);">${p.name.toUpperCase()}</div>`;
				if (p.models && p.models.length > 0) {
					p.models.forEach(model => {
						const currentRole = modelsData.activeRole || 'main';
						const activeForRole = modelsData.activeModels?.[currentRole]?.model === model && modelsData.activeModels?.[currentRole]?.provider === p.name;

						html += `
							<div class="menu-item model-select-item" onclick="window.setSelectedModel('${p.name}', '${model}')" style="${activeForRole ? 'background: rgba(124, 77, 255, 0.1); border-left: 2px solid #7c4dff;' : ''}">
								<div class="menu-item-left">
									<span class="material-icons" style="font-size:14px; opacity:0.7;">cloud</span>
									<span>${model}</span>
								</div>
								${activeForRole ? '<span class="material-icons" style="font-size:14px; color: #7c4dff;">check_circle</span>' : ''}
							</div>
						`;
					});
				}
			});
		}

		if (filteredProviders.length === 0) {
			html += '<div style="padding:16px 12px; text-align:center; font-size:11px; color:#888;">No providers configured for this filter.<br><a href="#" onclick="window.openSettings(event)" style="color:#7c4dff;">Add one in Settings</a></div>';
		}

		menuModel.innerHTML = html;
	}

	window.toggleProviderFilter = (event, type) => {
		event.stopPropagation();
		selectedProviderType = (selectedProviderType === type) ? null : type;
		// The menu won't re-render automatically unless we trigger it or wait for next socket event
		// Better to trigger a re-render with the last known data
		if (socket) socket.emit('get_model_info');
	};

	window.setSelectedModel = (providerName, model) => {
		if (socket) {
			const role = modelsData.activeRole || 'main';
			socket.emit('set_model', { role, providerName, model });

			// Optimistic UI update
			if (!modelsData.activeModels) modelsData.activeModels = {};
			modelsData.activeModels[role] = { provider: providerName, model: model };
			if (currentModelNameEl) currentModelNameEl.textContent = model;

			// Re-render immediately for visual feedback
			renderModelMenu(modelsData);

			// Short delay before closing for better UX (so user sees the checkmark move)
			setTimeout(() => closeAllMenus(), 150);
		}
	};

	window.setActiveRole = (roleKey) => {
		if (socket) {
			socket.emit('set_active_role', { role: roleKey, sessionId: currentSessionId });

			// Optimistic UI update for the badge and menu
			modelsData.activeRole = roleKey;
			if (modelsData.activeModels && modelsData.activeModels[roleKey] && currentModelNameEl) {
				currentModelNameEl.textContent = modelsData.activeModels[roleKey].model;
			}

			// Re-render menu to show the correct checkmark and filtered models for the new role
			renderModelMenu(modelsData);
		}
	};

	function handleAgentUpdate(update) {
		if (update.type === 'thinking') {
			setProcessing(true, update.text || 'Thinking...');
		} else if (update.type === 'tool_running') {
			setProcessing(true, `Running ${update.tool}...`);
		} else if (update.type === 'tool_execution_start') {
			setProcessing(true, update.descriptiveText || `Running ${update.tool}...`);
		} else if (update.type === 'token' || update.type === 'llm_update' || update.type === 'content') {
			// Streaming token from the LLM response
			const tokenContent = update.token || update.content || '';
			if (tokenContent) {
				updateStreamingMessage(tokenContent);
			}
		} else if (update.type === 'agent_update') {
			// Sub-status update from agent nudge cycle
			if (update.status === 'thinking') {
				setProcessing(true, update.statusText || 'Thinking...');
			}
		} else if (update.type === 'error' || update.status === 'error') {
			// Error occurred — unlock UI immediately
			setProcessing(false);
			const errorText = update.text || update.message || update.statusText || 'An error occurred';

			if (errorText.includes('Insufficient Credits')) {
				const quotaModal = document.getElementById('quota-modal');
				if (quotaModal) quotaModal.style.display = 'flex';
			} else {
				appendMessage('ai', `⚠️ **Error:** ${errorText}`);
			}
		} else if (update.type === 'interjection_received') {
			console.log('[Socket] Interjection received:', update);
			appendSystemMessage(`✨ **Adjustment received:** ${update.text || "AI will adjust its next action."}`);
			// Pulse the thinking text to show it acknowledged
			if (thinkingText) {
				thinkingText.style.color = '#7c4dff';
				setTimeout(() => { if (thinkingText) thinkingText.style.color = ''; }, 1000);
			}
		} else if (update.token) {
			// Fallback: legacy token field
			updateStreamingMessage(update.token);
		}
	}

	let streamingMessageEl = null;
	let streamingContent = '';

	/**
		* Strips raw JSON tool-call blocks from streamed content.
		* These are already handled by StreamToolParser and rendered as execution blocks.
		* Patterns matched:
		*   - {"name": "ToolName", "arguments": {...}}
		*   - <tool_call>...</tool_call>
		*   - Consecutive whitespace-only remnants after stripping
		*/
	function cleanToolCallsFromContent(raw) {
		if (!raw) return '';
		let cleaned = raw;

		// 1. Remove <tool_call>...</tool_call> XML blocks
		cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

		// 2. Remove raw JSON tool call objects: {"name": "...", "arguments": {...}}
		//	AND tool result objects: {"success":true, ...}
		//	Only strip if it looks like a system/tool JSON object at the top level
		cleaned = cleaned.replace(/\{[\s]*"(name|success|status)"[\s]*:[\s\S]*?\}/g, (match) => {
			// Check if it's a valid JSON block (balanced braces)
			try {
				const parsed = JSON.parse(match);
				// If it's a tool call or tool result, strip it
				if (parsed.name && parsed.arguments) return '';
				if (parsed.success !== undefined || parsed.status !== undefined) return '';
				return match;
			} catch (e) {
				return match; // Not valid JSON, keep it
			}
		});

		// 3. Collapse excessive blank lines left after stripping
		cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

		return cleaned.trim();
	}

	function updateStreamingMessage(token) {
		setProcessing(false);
		if (!streamingMessageEl) {
			streamingMessageEl = appendMessage('ai', '');
			streamingContent = '';
		}
		streamingContent += token;

		// Clean tool call artifacts before rendering
		const displayContent = cleanToolCallsFromContent(streamingContent);

		// Find the content wrapping element and update it
		const contentEl = streamingMessageEl.querySelector('.message-content');
		if (contentEl) {
			if (displayContent) {
				contentEl.innerHTML = marked.parse(displayContent);
						if (typeof Prism !== 'undefined') Prism.highlightAllUnder(contentEl);
			} else {
				// All content was tool calls — show nothing yet (or a subtle indicator)
				contentEl.innerHTML = '';
			}
		}
		if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	function appendMessage(role, content, msgId = null) {
		if (homeScreen) homeScreen.style.display = 'none';
		const msgEl = document.createElement('div');
		msgEl.className = `message ${role}`;

		const contentEl = document.createElement('div');
		contentEl.className = 'message-content';
		contentEl.innerHTML = (typeof marked !== 'undefined') ? marked.parse(content) : content;
				if (typeof Prism !== 'undefined') Prism.highlightAllUnder(contentEl);
		msgEl.appendChild(contentEl);

		// Add action buttons
		const actionBar = document.createElement('div');
		actionBar.className = 'message-actions';

		if (role === 'user') {
			const reuseBtn = document.createElement('button');
			reuseBtn.className = 'icon-btn';
			reuseBtn.innerHTML = '<span class="material-icons" style="font-size:14px;">replay</span>';
			reuseBtn.title = 'Reuse this prompt';
			reuseBtn.onclick = () => {
				if (messageInput) {
					messageInput.value = content;
					messageInput.style.height = 'auto';
					messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
					messageInput.focus();
				}
			};
			actionBar.appendChild(reuseBtn);
		}

		const copyBtn = document.createElement('button');
		copyBtn.className = 'icon-btn';
		copyBtn.innerHTML = '<span class="material-icons" style="font-size:14px;">content_copy</span>';
		copyBtn.title = 'Copy message';
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(content);
			copyBtn.innerHTML = '<span class="material-icons" style="font-size:14px; color:#4caf50;">check</span>';
			setTimeout(() => copyBtn.innerHTML = '<span class="material-icons" style="font-size:14px;">content_copy</span>', 2000);
		};
		actionBar.appendChild(copyBtn);

		msgEl.appendChild(actionBar);

		if (messagesList) messagesList.appendChild(msgEl);
		if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;

		return msgEl; // return wrapper instead of internal content
	}

	function appendSystemMessage(content, className = '') {
		if (!messagesList) return;
		const msgEl = document.createElement('div');
		msgEl.className = `message system ${className}`;
		msgEl.style.cssText = 'padding: 8px 12px; margin: 8px 0; border-radius: 8px; background: rgba(124, 77, 255, 0.05); border-left: 3px solid #7c4dff; font-size: 11px; color: var(--text-muted); line-height: 1.4;';
		msgEl.innerHTML = content;
		messagesList.appendChild(msgEl);
		if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
		return msgEl;
	}

	function renderHistory(history) {
		if (messagesList) messagesList.innerHTML = '';
		const valid = (history || []).filter(m => m.role === 'user' || m.role === 'assistant');
		if (valid.length === 0) {
			if (homeScreen) homeScreen.style.display = 'flex';
		} else {
			if (homeScreen) homeScreen.style.display = 'none';
			valid.forEach(m => {
				const role = m.role === 'assistant' ? 'ai' : 'user';
				const text = Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n') : m.content;
				if (text) appendMessage(role, text);
			});
		}
	}

	function sendMessage() {
		if (!messageInput) return;
		const text = messageInput.value.trim();
		if (!text) return;

		const isClipStudio = window.codixViewType === 'clip';

		// Block unauthenticated users ONLY if they are trying to use Cloud AI
		if (!isAuthenticated && !isClipStudio) {
			const authModal = document.getElementById('auth-modal');
			if (authModal) authModal.style.display = 'flex';
			return;
		}

		let content;
		if (attachedImages.length > 0) {
			content = [{ type: 'text', text }];
			attachedImages.forEach(img => {
				content.push({
					type: 'image_url',
					image_url: { url: img.data }
				});
			});
		} else {
			content = text;
		}

		appendMessage('user', text); // UI shows just the text for now
		messageInput.value = '';
		messageInput.style.height = 'auto';

		// Clear images
		attachedImages = [];
		renderImagePreviews();

		// Resolve provider config dynamically from modelsData or vibe-model-selector
		const modelSelector = document.getElementById('vibe-model-selector');
		const selectedMode = modelSelector ? modelSelector.value : 'local';

		let providerConfig = null;
		if (modelsData && modelsData.llmConfig && modelsData.llmConfig.main) {
			const mainConfig = modelsData.llmConfig.main;
			const provider = modelsData.providers.find(p => p.name === mainConfig.provider);
			if (provider) {
				providerConfig = {
					providerName: provider.name,
					type: provider.type,
					apiKey: provider.apiKey || '',
					apiUrl: provider.apiUrl || '',
					model: mainConfig.model
				};
			}
		}

		if (selectedMode === 'local' && (!providerConfig || providerConfig.type === 'ollama')) {
			// Ensure high-fidelity default fallback for local Ollama
			const ollamaProv = modelsData.providers?.find(p => p.type === 'ollama');
			providerConfig = {
				providerName: ollamaProv ? ollamaProv.name : 'Ollama',
				type: 'ollama',
				apiKey: ollamaProv?.apiKey || '',
				apiUrl: ollamaProv?.apiUrl || 'http://localhost:11434',
				model: ollamaProv?.activeModel || (modelsData.llmConfig?.main?.model) || 'llama3'
			};
		}

		if (isClipStudio || !socket) {
			// Bypass socket, send via Extension Host
			vscode.postMessage({
				type: 'executeIntent',
				text: text,
				model: selectedMode,
				providerConfig: providerConfig
			});
			setProcessing(true, 'Thinking...');
			return;
		}

		if (isProcessing) {
			console.log(`[CoderX] Sending interjection for session: ${currentSessionId}`);
		}

		socket.emit('chat_message', { content, sessionId: currentSessionId, projectId: currentProjectId });
		setProcessing(true, 'Thinking...');
	}

	function setProcessing(active, text) {
		isProcessing = active;
		if (thinkingContainer) thinkingContainer.style.display = active ? 'flex' : 'none';
		if (text && thinkingText) thinkingText.textContent = text;

		// [Commercial UX] Keep send button active even when processing 
		// to allow queuing messages.
		if (sendButton) sendButton.disabled = false;

		// Show/hide Stop Agent and Resume Agent buttons
		const stopContainer = document.getElementById('stop-agent-container');
		const resumeBtn = document.getElementById('resume-agent-btn');

		if (stopContainer) stopContainer.style.display = active ? 'block' : 'none';

		if (resumeBtn) {
			const isPaused = active && (text === 'Waiting for Network...' || text?.includes('paused'));
			resumeBtn.style.display = isPaused ? 'inline-flex' : 'none';
		}

		if (active) { streamingMessageEl = null; streamingContent = ''; }
	}

	function toggleMenu(menu, trigger) {
		if (!menu) return;
		const isVisible = menu.style.display === 'block';
		closeAllMenus();
		if (!isVisible) {
			positionMenu(trigger, menu);
			menu.style.display = 'block';
		}
	}

	function positionMenu(trigger, menu) {
		const rect = trigger.getBoundingClientRect();
		const menuWidth = 260;
		if (rect.top < window.innerHeight / 2) {
			menu.style.bottom = 'auto';
			menu.style.top = `${rect.bottom + 8}px`;
		} else {
			menu.style.top = 'auto';
			menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
		}
		// Ensure menu doesn't overflow right edge
		const leftPos = Math.min(rect.left, window.innerWidth - menuWidth - 8);
		menu.style.left = `${Math.max(4, leftPos)}px`;
	}

	function closeAllMenus() {
		document.querySelectorAll('.popover-menu').forEach(m => m.style.display = 'none');
		const vibePopover = document.getElementById('vibe-model-popover');
		if (vibePopover) vibePopover.style.display = 'none';
	}

	// --- CONNECTIVITY MONITORING ---
	function handleConnectivityChange() {
		const footerDot = document.getElementById('footer-status-dot');
		const footerText = document.getElementById('footer-status-text');

		if (!navigator.onLine) {
			console.log('[Connectivity] Offline detected');
			if (footerDot) { footerDot.className = 'status-dot red'; }
			if (footerText) { footerText.textContent = 'Offline (Paused)'; }
			// Ensure UI shows as processing/paused so Stop button is visible
			if (isProcessing) {
				setProcessing(true, 'Offline (Paused)...');
			}
		} else {
			console.log('[Connectivity] Online restored');
			if (socket && socket.connected) {
				if (footerDot) { footerDot.className = 'status-dot green'; }
				if (footerText) { footerText.textContent = 'Connect'; }

				// If we are currently "processing" (or in a paused state from server),
				// notify server to resume any network-blocked turn.
				if (isProcessing && currentSessionId) {
					socket.emit('resume_session', { sessionId: currentSessionId });
				}
			}
		}
	}

	window.addEventListener('online', handleConnectivityChange);
	window.addEventListener('offline', handleConnectivityChange);
	// --------------------------------

	// Stop Agent Logic
	const stopAgentBtn = document.getElementById('stop-agent-btn');
	if (stopAgentBtn) {
		stopAgentBtn.onclick = () => {
			if (currentSessionId && socket) {
				console.log(`[CoderX] Requesting interruption for session: ${currentSessionId}`);
				socket.emit('request_interruption', { sessionId: currentSessionId });
				// Immediate manual feedback
				stopAgentBtn.disabled = true;
				stopAgentBtn.innerHTML = '<span class="material-icons spinning" style="font-size: 14px;">sync</span> Stopping...';
				setProcessing(true, 'Stopping agent...');
			}
		};
	}

	if (sendButton) sendButton.onclick = sendMessage;
	if (messageInput) {
		messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});
	}
	if (newSessionBtn) {
		newSessionBtn.onclick = () => {
			// Clear persisted session so reconnect doesn't rejoin old one
			clearSessionState();
			if (socket) {
				socket.emit('new_session', { projectId: currentProjectId });
			}
			if (messagesList) messagesList.innerHTML = '';
			if (homeScreen) homeScreen.style.display = 'flex';
		};

		// Create Interaction Mode Toggle
		const interactionToggle = document.createElement('div');
		interactionToggle.id = 'interaction-mode-toggle';
		interactionToggle.className = 'icon-btn';
		const currentMode = localStorage.getItem('coderx_interaction_mode') || 'continuous';
		interactionToggle.title = (currentMode === 'step-by-step') ? 'Mode: Step-by-Step' : 'Mode: Continuous';
		interactionToggle.innerHTML = `<span class="material-icons" style="font-size: 18px; color: ${currentMode === 'step-by-step' ? '#7c4dff' : 'inherit'}">${currentMode === 'step-by-step' ? 'touch_app' : 'bolt'}</span>`;
		if (currentMode === 'step-by-step') interactionToggle.classList.add('active');
		interactionToggle.onclick = (e) => {
			e.stopPropagation();
			window.toggleInteractionMode();
		};

		// Insert it next to new session button
		newSessionBtn.parentNode.insertBefore(interactionToggle, newSessionBtn.nextSibling);
	}

	if (modelSelector) modelSelector.onclick = (e) => {
		e.stopPropagation();
		if (socket) socket.emit('get_model_info');
		toggleMenu(menuModel, modelSelector);
	};
	if (modeSelector) modeSelector.onclick = (e) => { e.stopPropagation(); toggleMenu(menuTools, modeSelector); };
	if (btnMore) btnMore.onclick = (e) => { e.stopPropagation(); toggleMenu(menuMore, btnMore); };
	const btnAvatar = document.getElementById('btn-avatar');
	if (btnAvatar) {
		btnAvatar.onclick = (e) => {
			e.stopPropagation();
			if (isAuthenticated) {
				toggleMenu(menuMore, btnAvatar);
			} else {
				vscode.postMessage({ type: 'login' });
			}
		};
	}

	// Direct link to settings from the footer
	const footerSettingsBtn = document.getElementById('footer-settings-btn');
	if (footerSettingsBtn) {
		footerSettingsBtn.onclick = (e) => {
			e.stopPropagation();
			showView('settings', 'Settings', 'settings');
		};
	}

	// UX for Context trigger (@)
	if (contextTrigger) contextTrigger.onclick = (e) => {
		e.stopPropagation();
		if (messageInput) {
			messageInput.focus();
			const start = messageInput.selectionStart;
			const end = messageInput.selectionEnd;
			const text = messageInput.value;
			if (text.slice(start - 1, start) !== '@') {
				messageInput.value = text.substring(0, start) + '@' + text.substring(end);
				messageInput.setSelectionRange(start + 1, start + 1);
			}
		}
		toggleMenu(menuContext, contextTrigger);
	};

	if (messageInput) {
		messageInput.addEventListener('input', (e) => {
			messageInput.style.height = 'auto';
			messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
			const text = messageInput.value;
			if (e.data === '@' || text.endsWith('@')) {
				if (menuContext && menuContext.style.display !== 'block') {
					toggleMenu(menuContext, contextTrigger);
				}
			} else if (!text.includes('@') && menuContext && menuContext.style.display === 'block') {
				closeAllMenus();
			}
		});
	}

	const removeAtChar = () => {
		if (!messageInput) return;
		const text = messageInput.value;
		const lastAtIndex = text.lastIndexOf('@');
		if (lastAtIndex >= 0 && lastAtIndex === text.length - 1) {
			messageInput.value = text.substring(0, lastAtIndex) + text.substring(lastAtIndex + 1);
			messageInput.focus();
		}
	};


	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'syncWorkspace') {
			workspacePath = message.path;
			persistSessionState();
			if (socket && currentSessionId) {
				socket.emit('set_working_directory', { sessionId: currentSessionId, directory: workspacePath });
			}
		} else if (message.type === 'updateOpenFiles') {
			updateOpenFilesUI(message.files);
		} else if (message.type === 'search_results') {
			renderSearchResults(message.results);
		} else if (message.type === 'user_info') {
			const avatar = document.getElementById('btn-avatar');
			const name = document.getElementById('user-display-name');
			if (avatar) avatar.style.backgroundImage = `url(${message.avatar})`;
			if (name) name.textContent = message.name;
		}
	});

	function updateOpenFilesUI(files) {
		serverOpenFiles = files;
		// Optionally auto-render if the search menu is open
		if (menuSearchFiles && menuSearchFiles.style.display === 'block') {
			renderSearchResults(fileSearchInput.value);
		}
	}

	function renderSearchResults(results) {
		if (!searchResultsList) return;

		if (!results || results.length === 0) {
			searchResultsList.innerHTML = `<div style="padding: 12px; color: #888; font-size: 12px; text-align: center;">No matching files found.</div>`;
			return;
		}

		searchResultsList.innerHTML = results.map(f => `
			<div class="search-item" data-path="${f.path}" data-name="${f.name}" data-relative="${f.relative}">
				<span class="material-icons" style="font-size: 16px; color: ${f.type === 'content' ? '#7c4dff' : '#a3a3a3'};">
					${f.type === 'content' ? 'segment' : 'description'}
				</span>
				<div class="search-item-info">
					<div class="search-item-name">${f.name}</div>
					<div class="search-item-path">${f.relative}</div>
					${f.preview ? `<div class="search-item-preview">...${f.preview}...</div>` : ''}
				</div>
			</div>
		`).join('');

		// Add click listeners
		searchResultsList.querySelectorAll('.search-item').forEach(el => {
			el.onclick = () => {
				const path = el.dataset.path;
				const name = el.dataset.name;
				const relative = el.dataset.relative;
				addFileContextChip({ name, path, relative });
			};
		});
	}

	function getFileIcon(filename) {
		const ext = filename.split('.').pop().toLowerCase();
		const icons = {
			'js': '<span class="material-icons" style="color: #f7df1e;">code</span>',
			'ts': '<span class="material-icons" style="color: #007acc;">code</span>',
			'py': '<span class="material-icons" style="color: #3776ab;">code</span>',
			'json': '<span class="material-icons" style="color: #f59e0b;">settings</span>',
			'php': '<span class="material-icons" style="color: #777bb4;">code</span>',
			'html': '<span class="material-icons" style="color: #e34f26;">html</span>',
			'css': '<span class="material-icons" style="color: #1572b6;">style</span>',
			'md': '<span class="material-icons" style="color: #a3a3a3;">description</span>'
		};
		return icons[ext] || '<span class="material-icons">insert_drive_file</span>';
	}

	function addContextChip(fileData) {
		const name = typeof fileData === 'string' ? fileData : fileData.name;
		const path = typeof fileData === 'string' ? '' : fileData.path;

		const pillId = `pill-${name.replace(/[^a-z0-9]/gi, '_')}`;
		if (document.getElementById(pillId)) return;

		const pill = document.createElement('div');
		pill.id = pillId;
		pill.className = 'file-pill';
		pill.innerHTML = `
			<span class="file-icon">${getFileIcon(name)}</span>
			<span>${name}</span>
			<span class="material-icons pin-btn" title="Pin to context">push_pin</span>
			<span class="material-icons close-btn" title="Remove">close</span>
		`;

		pill.querySelector('.close-btn').onclick = (e) => {
			e.stopPropagation();
			pill.remove();
			attachedContextFiles.delete(name);
		};

		pill.querySelector('.pin-btn').onclick = (e) => {
			e.stopPropagation();
			pill.classList.toggle('pinned');
		};

		const addBtn = document.getElementById('add-context-btn');
		if (addBtn) addBtn.parentNode.insertBefore(pill, null);
		attachedContextFiles.add(name);
	}

	function updateContextFilesOnServer() {
		if (socket && currentSessionId) {
			// Inform server of current context files
			socket.emit('update_context_files', {
				sessionId: currentSessionId,
				files: Array.from(attachedContextFiles)
			});
		}
	}

	let searchDebounce;
	if (fileSearchInput) {
		fileSearchInput.oninput = (e) => {
			const query = e.target.value;

			// Immediately filter local list of open files for faster response
			const localFiltered = serverOpenFiles.filter(f =>
				f.name.toLowerCase().includes(query.toLowerCase()) ||
				f.relative.toLowerCase().includes(query.toLowerCase())
			).map(f => ({ ...f, type: 'file' }));

			if (localFiltered.length > 0) {
				renderSearchResults(localFiltered);
			}

			// Debounce server search for content searching
			clearTimeout(searchDebounce);
			if (query.length > 1) {
				searchDebounce = setTimeout(() => {
					vscode.postMessage({ type: 'searchOpenFiles', query });
				}, 250);
			} else if (!query) {
				renderSearchResults(serverOpenFiles.map(f => ({ ...f, type: 'file' })));
			}
		};
	}

	// --- VIEW ROUTER ---
	function showView(viewId, title, icon = 'auto_awesome') {
		closeAllMenus();
		chatView.style.display = 'none';
		featureView.style.display = 'flex';

		// Hide global footer when in feature views to avoid obscuring the UI
		const footer = document.querySelector('footer');
		if (footer) footer.style.display = 'none';

		backBtn.style.display = 'flex';
		headerTitleText.textContent = title;
		headerIcon.textContent = icon;
		featureContent.dataset.view = viewId;
		featureContent.innerHTML = '<div style="color: #a3a3a3; padding: 20px;">Loading...</div>';

		switch (viewId) {
			case 'history': renderHistoryView(); break;
			case 'agents': renderAgentsView(); break;
			case 'mcp': renderMCP(); break;
			case 'workflow': renderWorkflow(); break;
			case 'market': renderMarket(); break;
			case 'plugins':
				renderPlugins();
				fetchPluginsFromMarket();
				break;
			case 'settings': renderSettings(); break;
		}
	}

	function backToChat() {
		featureView.style.display = 'none';
		chatView.style.display = 'flex'; // Changed from 'block' to 'flex'

		// Restore global footer when returning to chat
		const footer = document.querySelector('footer');
		if (footer) footer.style.display = 'flex';

		backBtn.style.display = 'none';
		headerTitleText.textContent = 'CoderX Assistant';
		headerIcon.textContent = 'auto_awesome';
		featureContent.dataset.view = '';

		// FIX: Ensure body and containers are scrollable
		document.body.style.overflow = 'auto';
		if (chatContainer) {
			chatContainer.style.overflowY = 'auto';
			chatContainer.style.display = 'flex';
		}

		// Force scroll to bottom to ensure user can see latest messages and scroll is active
		setTimeout(() => {
			const chatContainer = document.getElementById('chat-container');
			if (chatContainer) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}
		}, 100);
	}

	if (backBtn) backBtn.onclick = backToChat;

	// Menu Item Handlers
	const setupMenuItem = (id, viewId, title, icon) => {
		const el = document.getElementById(id);
		if (el) el.onclick = (e) => { e.stopPropagation(); showView(viewId, title, icon); };
	};

	setupMenuItem('item-mcp', 'mcp', 'MCP Config', 'extension');
	setupMenuItem('item-workflow', 'workflow', 'Workflow Canvas', 'schema');
	setupMenuItem('item-market', 'market', 'Compute Market', 'storefront');
	setupMenuItem('item-plugins', 'plugins', 'Plugins Market', 'smart_toy');
	setupMenuItem('item-settings', 'settings', 'Settings', 'settings');
	setupMenuItem('btn-more', 'more', 'More', 'more_horiz');
	setupMenuItem('header-agent-selector', 'agents', 'Switch Agent', 'expand_more');

	const itemAccount = document.getElementById('item-account');
	if (itemAccount) {
		itemAccount.onclick = (e) => {
			e.stopPropagation();
			closeAllMenus();
			vscode.postMessage({ type: 'editProfile' });
		};
	}

	const btnLogout = document.getElementById('btn-logout');
	if (btnLogout) {
		btnLogout.onclick = (e) => {
			e.stopPropagation();
			closeAllMenus();
			if (isAuthenticated) {
				vscode.postMessage({ type: 'logout' });
			} else {
				vscode.postMessage({ type: 'login' });
			}
		};
	}

	// Tool Handlers
	const setupTool = (id, action) => {
		const el = document.getElementById(id);
		if (el) {
			el.onclick = (e) => {
				e.stopPropagation();
				closeAllMenus();
				vscode.postMessage({ type: 'invokeTool', action: action });
			};
		}
	};
	setupTool('tool-read-file', 'read_file');
	setupTool('tool-create-file', 'create_file');
	setupTool('tool-run-terminal', 'run_terminal');
	setupTool('tool-view-subdir', 'view_subdir');
	setupTool('tool-repo-map', 'repo_map');
	setupTool('tool-exact-search', 'exact_search');
	setupTool('tool-search-web', 'search_web');
	setupTool('tool-view-diff', 'view_diff');
	setupTool('tool-read-active', 'read_active');

	let attachedImages = []; // Array of { name: string, data: string }

	const imageUploadTrigger = document.getElementById('image-upload-trigger');
	const imageUploadInput = document.getElementById('image-upload-input');
	const imagePreviewContainer = document.getElementById('image-preview-container');

	if (imageUploadTrigger && imageUploadInput) {
		imageUploadTrigger.onclick = () => imageUploadInput.click();
		imageUploadInput.onchange = (e) => {
			const files = e.target.files;
			if (!files || files.length === 0) return;

			for (const file of files) {
				if (!file.type.startsWith('image/')) continue;
				const reader = new FileReader();
				reader.onload = (event) => {
					const base64Data = event.target.result;
					const imageId = 'img-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
					attachedImages.push({ id: imageId, name: file.name, data: base64Data });
					renderImagePreviews();
				};
				reader.readAsDataURL(file);
			}
			// Clear input so same file can be selected again
			imageUploadInput.value = '';
		};
	}

	function renderImagePreviews() {
		if (!imagePreviewContainer) return;
		if (attachedImages.length === 0) {
			imagePreviewContainer.style.display = 'none';
			return;
		}

		imagePreviewContainer.style.display = 'flex';
		imagePreviewContainer.innerHTML = '';
		attachedImages.forEach(img => {
			const pill = document.createElement('div');
			pill.className = 'file-pill image-pill';
			pill.style.padding = '2px 4px';
			pill.innerHTML = `
				<img src="${img.data}" style="width: 24px; height: 24px; border-radius: 4px; object-fit: cover;">
				<span style="font-size: 10px; max-width: 60px; overflow: hidden; text-overflow: ellipsis;">${img.name}</span>
				<span class="material-icons close-btn" style="font-size: 12px; cursor: pointer;">close</span>
			`;
			pill.querySelector('.close-btn').onclick = () => {
				attachedImages = attachedImages.filter(i => i.id !== img.id);
				renderImagePreviews();
			};
			imagePreviewContainer.appendChild(pill);
		});
	}

	const attachTrigger = document.getElementById('attach-trigger');
	if (attachTrigger) {
		attachTrigger.onclick = (e) => {
			e.stopPropagation();
			vscode.postMessage({ type: 'attachFiles' });
		};
	}

	const historyBtn = document.getElementById('btn-history');
	const headerHistoryBtn = document.getElementById('footer-history-btn');
	if (historyBtn) historyBtn.onclick = () => showView('history', 'Conversation History', 'history');
	if (headerHistoryBtn) headerHistoryBtn.onclick = () => showView('history', 'Conversation History', 'history');

	async function renderHistoryView() {
		featureContent.innerHTML = '<div style="color: #a3a3a3; padding: 20px;">Loading history...</div>';
		try {
			const response = await apiFetch(`${serverUrl}/api/projects/${currentProjectId}/sessions`);
			const sessions = await response.json();

			let html = '<div class="feature-scroll-container"><div style="display: flex; flex-direction: column; gap: 12px;">';
			sessions.forEach(s => {
				const date = new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleString();
				const activeStyle = s.id === currentSessionId ? 'border-color: #7c4dff; background: rgba(124, 77, 255, 0.05);' : '';
				html += `
					<div class="glassy-card" style="${activeStyle}" onclick="window.switchSession('${s.id}')">
						<div style="font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 4px;">${s.name || 'Untitled Conversation'}</div>
						<div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between;">
							<span>${date}</span>
							${s.id === currentSessionId ? '<span style="color:#7c4dff;">Active</span>' : ''}
						</div>
					</div>
				`;
			});
			html += '</div></div>';
			featureContent.innerHTML = html;
		} catch (err) {
			featureContent.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to load history: ${err.message}</div>`;
		}
	}

	// --- AGENTS UI ---
	const agentsBtn = document.getElementById('add-chat-btn');
	if (agentsBtn) {
		agentsBtn.title = 'Manage Agents';
		agentsBtn.onclick = () => showView('agents', 'Manage Agents', 'auto_awesome');
	}

	async function renderAgentsView() {
		const res = await apiFetch(`${serverUrl}/api/agents`);
		const agents = await res.json();

		if (featureContent && (document.getElementById('pane-agents')?.classList.contains('active') || (featureView && featureView.style.display !== 'none'))) {
			// Already rendering feature view...
		}

		// Update Header Selector Menu
		const agentMenu = document.getElementById('menu-agents');
		if (agentMenu) {
			const addBtn = agentMenu.querySelector('[onclick="window.createAgent()"]');
			agentMenu.innerHTML = '';
			agents.forEach(a => {
				const item = document.createElement('div');
				item.className = 'context-item';
				item.innerHTML = `<div style="display:flex; align-items:center; gap: 8px;"><span class="material-icons">person</span> ${a.name}</div>`;
				item.onclick = () => {
					document.getElementById('current-agent-name').textContent = a.name;
					closeAllMenus();
					vscode.postMessage({ type: 'switchAgent', agentId: a.id, agentName: a.name });
				};
				agentMenu.appendChild(item);
			});
			if (addBtn) agentMenu.appendChild(addBtn);
		}

		if (featureContent && featureContent.dataset.view === 'agents') {
			let html = `
				<div class="feature-scroll-container">
					<div style="margin-bottom: 20px;">
						<button class="upgrade-btn" onclick="window.createAgent()" style="width: 100%; justify-content: center;">
							<span class="material-icons">add</span> New Agent
						</button>
					</div>
					<div style="display: flex; flex-direction: column; gap: 12px;">
			`;
			agents.forEach(agent => {
				html += `
					<div class="glassy-card" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 12px 16px;">
						<div style="cursor: pointer; flex-grow: 1;" onclick="window.showAgentModal('${agent.id}')">
							<div style="font-size: 14px; font-weight: 700; color: #7c4dff; margin-bottom: 4px;">${agent.name}</div>
							<div style="font-size: 11px; color: var(--text-muted);">${agent.description || 'No description provided.'}</div>
						</div>
						<div style="display: flex; gap: 8px; margin-left: 12px;">
							<button class="icon-btn" onclick="window.showAgentModal('${agent.id}')" title="Edit Agent"><span class="material-icons" style="font-size: 16px; color:#7c4dff;">edit</span></button>
							${agent.id !== 'default' ? `<button class="icon-btn" onclick="window.deleteAgent('${agent.id}', '${agent.name}')" title="Delete Agent"><span class="material-icons" style="font-size: 16px; color:#ef4444;">delete</span></button>` : ''}
						</div>
					</div>
				`;
			});
			html += '</div></div>';
			featureContent.innerHTML = html;
		}
	}

	async function renderMCP() {
		featureContent.innerHTML = `
			<div class="plugins-container">
				<div class="plugins-search-bar">
					<span class="material-icons" style="font-size: 18px; color: var(--text-muted);">extension</span>
					<div style="flex: 1; font-size: 13px; font-weight: 700; color: #fff;">MCP Servers</div>
					<button class="icon-btn" id="btn-add-mcp" title="Add MCP Server">
						<span class="material-icons">add</span>
					</button>
					<button class="icon-btn" onclick="renderMCP()" title="Refresh List" style="margin-left: 4px;">
						<span class="material-icons">refresh</span>
					</button>
				</div>
				<div id="mcp-server-list" style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
					<div style="color: #888; padding: 20px; text-align: center;"><div class="terminal-spinner" style="display: inline-block;"></div></div>
				</div>
			</div>
		`;
		featureContent.dataset.view = 'mcp';

		const btnAdd = document.getElementById('btn-add-mcp');
		if (btnAdd) {
			btnAdd.onclick = () => {
				showModal('Add MCP Server', `
					<div style="display: flex; flex-direction: column; gap: 16px;">
						<div class="llm-config-card">
							<label>Server Alias (Unique Name)</label>
							<input type="text" id="mcp-alias" placeholder="e.g. weather-server" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; color: #fff; font-size: 13px; outline: none;">
						</div>
						<div class="llm-config-card">
							<label>Connection URL or Command</label>
							<input type="text" id="mcp-url" placeholder="https://edge-gateway-rho.vercel.app/sse OR npx @modelcontextprotocol/server-everything" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; color: #fff; font-size: 13px; outline: none;">
							<p style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Supports SSE (http/https) or Stdio (npx, node, python3).</p>
						</div>
						<div class="modal-footer">
							<button class="secondary-btn" onclick="closeModal()">Cancel</button>
							<button class="upgrade-btn" id="btn-save-mcp">
								<span class="material-icons">save</span> Save Server
							</button>
						</div>
					</div>
				`);

				const saveBtn = document.getElementById('btn-save-mcp');
				saveBtn.onclick = async () => {
					const alias = document.getElementById('mcp-alias').value;
					const url = document.getElementById('mcp-url').value;

					if (!alias || !url) {
						showNotification('Please fill all fields', 'error');
						return;
					}

					saveBtn.innerHTML = '<span class="material-icons rotating">sync</span> Saving...';
					saveBtn.disabled = true;

					try {
						const res = await apiFetch(`${serverUrl}/api/mcp/servers`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ alias, url })
						});
						if (res.ok) {
							closeModal();
							showNotification('MCP Server added successfully', 'success');
							renderMCP(); // Refresh list
						} else {
							const data = await res.json();
							throw new Error(data.error || 'Failed to save server');
						}
					} catch (err) {
						showNotification(err.message, 'error');
						saveBtn.innerHTML = '<span class="material-icons">save</span> Save Server';
						saveBtn.disabled = false;
					}
				};
			};
		}

		try {
			const response = await apiFetch(`${serverUrl}/api/mcp/servers`);
			if (!response.ok) {
				if (response.status === 404) {
					const pingRes = await apiFetch(`${serverUrl}/api/mcp/ping`).catch(() => ({ ok: false }));
					if (!pingRes.ok) throw new Error(`API server unreachable (404) at ${serverUrl}/api/mcp/servers`);
				}
				throw new Error(`Server returned ${response.status}: ${response.statusText}`);
			}
			const data = await response.json();
			renderMCPList(data.servers || []);
		} catch (err) {
			console.error('Failed to fetch MCP servers:', err);
			document.getElementById('mcp-server-list').innerHTML = `
				<div class="empty-state" style="padding: 32px 16px; border-color: #ef4444;">
					<span class="material-icons" style="color: #ef4444;">error_outline</span>
					<div class="empty-state-title" style="color: #ef4444;">Connection Error</div>
					<div class="empty-state-desc">${err.message}</div>
					<button class="upgrade-btn" onclick="renderMCP()" style="margin-top: 12px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2);">
						Retry Connection
					</button>
				</div>
			`;
		}
	}

	function renderMCPList(servers) {
		const list = document.getElementById('mcp-server-list');
		if (!list) return;

		if (servers.length === 0) {
			list.innerHTML = `
				<div class="empty-state" style="padding: 32px 16px;">
					<span class="material-icons">extension_off</span>
					<div class="empty-state-title">No MCP Servers</div>
					<div class="empty-state-desc">Connect external tools to provide your agent with extra capabilities.</div>
				</div>
			`;
			return;
		}

		list.innerHTML = servers.map(s => {
			const statusClass = s.status === 'connected' ? 'active' : (s.status === 'error' ? 'error' : '');
			const statusText = s.status === 'error' ? (s.error || 'Connection Failed') : (s.status.charAt(0).toUpperCase() + s.status.slice(1));

			return `
				<div class="glassy-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">
					<div style="display: flex; align-items: center; gap: 12px;">
						<span class="status-gem ${statusClass}"></span>
						<div style="overflow: hidden;">
							<div style="font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.alias}</div>
							<div style="font-size: 10px; color: ${s.status === 'error' ? '#ef4444' : 'var(--text-muted)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${statusText}</div>
						</div>
					</div>
					<div style="display: flex; gap: 8px;">
						<span class="material-icons mcp-delete-btn" data-alias="${s.alias}" style="font-size: 16px; color: #ef4444; cursor: pointer; opacity: 0.6;">delete</span>
					</div>
				</div>
			`;
		}).join('');

		// Handle delete
		list.querySelectorAll('.mcp-delete-btn').forEach(btn => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				const alias = btn.dataset.alias;
				window.showConfirm(`Are you sure you want to remove MCP server '${alias}'?`, async () => {
					btn.innerText = 'sync';
					btn.classList.add('rotating');

					try {
						const res = await apiFetch(`${serverUrl}/api/mcp/servers/${alias}`, { method: 'DELETE' });
						if (res.ok) {
							showNotification(`Removed MCP server ${alias}`, 'success');
							renderMCP();
						} else {
							throw new Error('Failed to remove server');
						}
					} catch (err) {
						showNotification(err.message, 'error');
						btn.innerText = 'delete';
						btn.classList.remove('rotating');
					}
				});
			};
		});
	}

	async function renderWorkflow() {
		featureContent.innerHTML = `
			<div class="plugins-container">
				<div class="plugins-search-bar">
					<span class="material-icons" style="font-size: 18px; color: var(--text-muted);">schema</span>
					<div style="flex: 1; font-size: 13px; font-weight: 700; color: #fff;">Workflows</div>
					<button class="icon-btn" id="btn-add-workflow" title="Add Workflow">
						<span class="material-icons">add</span>
					</button>
				</div>
				<div id="workflow-list" class="card-grid" style="margin-top: 10px;">
					<div style="color: #888; padding: 20px; text-align: center;"><div class="terminal-spinner" style="display: inline-block;"></div></div>
				</div>
			</div>
		`;
		featureContent.dataset.view = 'workflow';

		try {
			const response = await apiFetch(`${serverUrl}/api/workflows`);
			const workflows = await response.json();

			const list = document.getElementById('workflow-list');
			if (workflows.length === 0) {
				list.innerHTML = `
					<div class="empty-state" style="grid-column: span 2; padding: 32px 16px;">
						<span class="material-icons">schema</span>
						<div class="empty-state-title">No Workflows</div>
						<div class="empty-state-desc">Create automation flows to connect CoderX with your tools.</div>
					</div>
				`;
				return;
			}

			list.innerHTML = workflows.map(wf => `
				<div class="glassy-card" style="text-align: center; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
					<span class="material-icons" style="font-size: 32px; color: ${wf.status === 'active' ? '#10b981' : '#888'};">
						${wf.type === 'n8n' ? 'account_tree' : 'sync_alt'}
					</span>
					<div style="font-size: 11px; font-weight: 700; color: #fff;">${wf.name}</div>
					<div style="font-size: 9px; color: ${wf.status === 'active' ? '#10b981' : 'var(--text-muted)'}; text-transform: uppercase; font-weight: 800;">${wf.status || 'inactive'}</div>
					<div style="display: flex; gap: 4px; margin-top: 4px;">
						<button class="icon-btn" title="Execute" style="color: #3b82f6;"><span class="material-icons" style="font-size: 14px;">play_arrow</span></button>
						<button class="icon-btn" title="Delete" style="color: #ef4444;"><span class="material-icons" style="font-size: 14px;">delete</span></button>
					</div>
				</div>
			`).join('');
		} catch (err) {
			console.error('Failed to fetch workflows:', err);
			document.getElementById('workflow-list').innerHTML = `
				<div style="grid-column: span 2; color: #ef4444; padding: 20px; font-size: 11px; text-align: center;">
					Failed to load workflows: ${err.message}
				</div>
			`;
		}

		const btnAddWf = document.getElementById('btn-add-workflow');
		if (btnAddWf) {
			btnAddWf.onclick = () => window.addWorkflow();
		}
	}

	window.addWorkflow = () => {
		showModal('Add Workflow', `
			<div style="display: flex; flex-direction: column; gap: 16px;">
				<div class="llm-config-card">
					<label>Workflow Name</label>
					<input type="text" id="wf-name" placeholder="e.g. Daily CI Build" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; color: #fff; font-size: 13px; outline: none;">
				</div>
				<div class="llm-config-card">
					<label>Workflow Type</label>
					<select id="wf-type" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; color: #fff; font-size: 13px; outline: none; width: 100%;">
						<option value="n8n">n8n Automation</option>
						<option value="github">GitHub Action</option>
						<option value="custom">Custom Webhook</option>
					</select>
				</div>
				<div class="modal-footer">
					<button class="secondary-btn" onclick="closeModal()">Cancel</button>
					<button class="upgrade-btn" id="btn-save-wf">
						<span class="material-icons">save</span> Create Workflow
					</button>
				</div>
			</div>
		`);

		document.getElementById('btn-save-wf').onclick = async () => {
			const name = document.getElementById('wf-name').value;
			const type = document.getElementById('wf-type').value;
			if (!name) return showNotification('Name is required', 'error');

			try {
				const res = await apiFetch(`${serverUrl}/api/workflows`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name, type, status: 'active' })
				});
				if (res.ok) {
					closeModal();
					showNotification('Workflow created', 'success');
					renderWorkflow();
				}
			} catch (err) {
				showNotification(err.message, 'error');
			}
		};
	};

	async function renderS3List(configs) {
		const list = document.getElementById('s3-config-list');
		if (!list) return;

		if (!configs || configs.length === 0) {
			list.innerHTML = `<div style="color: #666; padding: 10px; text-align: center; font-size: 11px;">No storage providers configured.</div>`;
			return;
		}

		// Fetch status in background
		apiFetch(`${serverUrl}/api/storage/status`)
			.then(r => r.json())
			.then(status => {
				const statusBadge = document.getElementById('s3-status-badge-global');
				if (statusBadge) {
					statusBadge.innerHTML = status.success
						? `<span style="color: #10b981; font-size: 9px; font-weight: 800;">● CONNECTED</span>`
						: `<span style="color: #ef4444; font-size: 9px; font-weight: 800;">● DISCONNECTED</span>`;
				}
			})
			.catch(() => { });

		list.innerHTML = `
			<div id="s3-status-badge-global" style="margin-bottom: 8px;"></div>
			${configs.map(c => `
				<div class="glassy-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">
					<div style="display: flex; align-items: center; gap: 12px;">
						<span class="material-icons" style="color: #7c4dff;">storage</span>
						<div style="overflow: hidden;">
							<div style="font-size: 12px; font-weight: 600; color: #fff;">${c.bucket}</div>
							<div style="font-size: 9px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.endpoint || 'S3 Standard'} • ${c.region}</div>
						</div>
					</div>
					<div style="display: flex; gap: 8px;">
						<button class="icon-btn" onclick="window.editS3Config('${c.bucket}')"><span class="material-icons" style="font-size: 16px;">edit</span></button>
						<button class="icon-btn" onclick="window.removeS3('${c.bucket}')"><span class="material-icons" style="font-size: 16px; color: #ef4444;">delete</span></button>
					</div>
				</div>
			`).join('')}
		`;
	}

	window.addMCPServer = () => {
		const featureView = document.getElementById('feature-view');
		if (featureView && featureView.dataset.view === 'mcp') {
			document.getElementById('btn-add-mcp')?.click();
		} else {
			showModal('Add MCP Server', `
				<div style="display: flex; flex-direction: column; gap: 16px;">
					<div class="llm-config-card">
						<label>Server Alias</label>
						<input type="text" id="mcp-alias" placeholder="e.g. weather-server" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; color: #fff; font-size: 13px; outline: none;">
					</div>
					<div class="llm-config-card">
						<label>URL or Command</label>
						<input type="text" id="mcp-url" placeholder="http://... or npx ..." style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; color: #fff; font-size: 13px; outline: none;">
					</div>
					<div class="modal-footer">
						<button class="secondary-btn" onclick="closeModal()">Cancel</button>
						<button class="upgrade-btn" id="btn-save-mcp-alt">Save Server</button>
					</div>
				</div>
			`);
			document.getElementById('btn-save-mcp-alt').onclick = async () => {
				const alias = document.getElementById('mcp-alias').value;
				const url = document.getElementById('mcp-url').value;
				if (!alias || !url) return;
				try {
					const res = await apiFetch(`${serverUrl}/api/mcp/servers`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ alias, url })
					});
					if (res.ok) {
						closeModal();
						showNotification('MCP Server added', 'success');
						if (typeof renderMCP === 'function') renderMCP();
					}
				} catch (err) { showNotification(err.message, 'error'); }
			};
		}
	};

	async function renderKnowledge() {
		featureContent.innerHTML = `
			<div class="feature-scroll-container">
				<div style="margin-bottom: 20px;">
					<button class="upgrade-btn" style="width: 100%; justify-content: center;">
						<span class="material-icons">upload_file</span> Add Knowledge Source
					</button>
				</div>
				<div style="display: flex; flex-direction: column; gap: 8px;">
					<div class="glassy-card">
						<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
							<div style="display: flex; align-items: center; gap: 8px;">
								<span class="material-icons" style="font-size: 16px; color: #7c4dff;">folder</span>
								<span style="font-size: 12px; font-weight: 600; color: #fff;">src/docs</span>
							</div>
							<span style="font-size: 10px; color: #10b981;">Synced</span>
						</div>
						<div style="height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px;">
							<div style="width: 100%; height: 100%; background: #10b981; border-radius: 2px;"></div>
						</div>
					</div>
					<div class="glassy-card">
						<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
							<div style="display: flex; align-items: center; gap: 8px;">
								<span class="material-icons" style="font-size: 16px; color: #7c4dff;">public</span>
								<span style="font-size: 12px; font-weight: 600; color: #fff;">MDN Web Docs</span>
							</div>
							<span style="font-size: 10px; color: var(--text-muted);">Syncing 75%</span>
						</div>
						<div style="height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px;">
							<div style="width: 75%; height: 100%; background: #7c4dff; border-radius: 2px; box-shadow: 0 0 10px #7c4dff;"></div>
						</div>
					</div>
				</div>
			</div>
		`;
	}

	// --- GPU COMPUTE MARKET (Aggregated) ---
	let _marketTab = 'browse'; // 'browse' | 'instances' | 'settings'
	let _marketTypeFilter = 'GPU'; // 'GPU' | 'CPU'
	let _marketGpuFilter = 'all';
	let _marketSort = 'score';
	let _marketOffers = [];
	let _myInstances = [];
	let _accountInfo = { balance: 0 };

	async function renderMarket() {
		featureContent.innerHTML = '<div style="color: #a3a3a3; padding: 20px; text-align: center;"><div class="terminal-spinner" style="display: inline-block; margin-bottom: 8px;"></div><br>Loading GPU marketplace...</div>';

		// Fetch account info in parallel
		try {
			const [acctRes] = await Promise.all([
				apiFetch(`${serverUrl}/api/compute/account`).then(r => r.json()).catch(() => ({ balance: 0 }))
			]);
			_accountInfo = acctRes;
		} catch (e) { /* ignore */ }

		_renderMarketShell();

		if (_marketTab === 'browse') {
			await _loadMarketOffers();
		} else if (_marketTab === 'instances') {
			await _loadMyInstances();
		} else if (_marketTab === 'settings') {
			await _loadMarketSettings();
		}
	}

	function _renderMarketShell() {
		const balanceColor = _accountInfo.balance > 5 ? '#10b981' : (_accountInfo.balance > 1 ? '#f59e0b' : '#ef4444');

		featureContent.innerHTML = `
			<div class="feature-scroll-container" style="padding: 0;">
				<!-- Account Stats Bar -->
				<div style="display: flex; gap: 12px; padding: 12px 16px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 0;">
					<div style="flex: 1; text-align: center;">
						<div style="font-size: 18px; font-weight: 800; color: ${balanceColor};">$${Number(_accountInfo?.balance || 0).toFixed(2)}</div>
						<div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Balance</div>
					</div>
					<div style="width: 1px; background: rgba(255,255,255,0.06);"></div>
					<div style="flex: 1; text-align: center;">
						<div style="font-size: 18px; font-weight: 800; color: #7c4dff;" id="market-active-count">—</div>
						<div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Active</div>
					</div>
					<div style="width: 1px; background: rgba(255,255,255,0.06);"></div>
					<div style="flex: 1; text-align: center;">
						<div style="font-size: 18px; font-weight: 800; color: #a3a3a3;" id="market-offers-count">—</div>
						<div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Offers</div>
					</div>
				</div>

				<!-- Tab Bar -->
				<div style="display: flex; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.15);">
					<div class="market-tab ${_marketTab === 'browse' ? 'active' : ''}" onclick="window._setMarketTab('browse')" style="flex: 1; padding: 10px; text-align: center; font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid ${_marketTab === 'browse' ? '#7c4dff' : 'transparent'}; color: ${_marketTab === 'browse' ? '#fff' : '#888'}; transition: all 0.2s;">
						<span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">storefront</span>Browse
					</div>
					<div class="market-tab ${_marketTab === 'instances' ? 'active' : ''}" onclick="window._setMarketTab('instances')" style="flex: 1; padding: 10px; text-align: center; font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid ${_marketTab === 'instances' ? '#10b981' : 'transparent'}; color: ${_marketTab === 'instances' ? '#fff' : '#888'}; transition: all 0.2s;">
						<span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">dns</span>My Instances
					</div>
					<div class="market-tab ${_marketTab === 'settings' ? 'active' : ''}" onclick="window._setMarketTab('settings')" style="flex: 1; padding: 10px; text-align: center; font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid ${_marketTab === 'settings' ? '#f59e0b' : 'transparent'}; color: ${_marketTab === 'settings' ? '#fff' : '#888'}; transition: all 0.2s;">
						<span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">settings</span>Settings
					</div>
				</div>

				<!-- Category Selector -->
				${_marketTab === 'browse' ? `
				<div style="display: flex; padding: 8px 16px; background: rgba(0,0,0,0.1); border-bottom: 1px solid rgba(255,255,255,0.05); gap: 12px;">
					<div onclick="window._setMarketType('GPU')" style="font-size: 10px; font-weight: 700; color: ${_marketTypeFilter === 'GPU' ? '#7c4dff' : '#666'}; cursor: pointer; text-transform: uppercase;">GPU Marketplace</div>
					<div onclick="window._setMarketType('CPU')" style="font-size: 10px; font-weight: 700; color: ${_marketTypeFilter === 'CPU' ? '#7c4dff' : '#666'}; cursor: pointer; text-transform: uppercase;">CPU Clusters</div>
				</div>
				` : ''}

				<!-- Content Area -->
				<div id="market-content" style="padding: 12px 16px;"></div>
			</div>
		`;
	}

	window._setMarketType = (type) => {
		_marketTypeFilter = type;
		_renderMarketShell();
		_loadMarketOffers();
	};

	window._setMarketTab = (tab) => {
		_marketTab = tab;
		renderMarket();
	};

	async function _loadMarketOffers() {
		const container = document.getElementById('market-content');
		if (!container) return;
		container.innerHTML = '<div style="color: #888; padding: 20px; text-align: center;"><div class="terminal-spinner" style="display: inline-block;"></div></div>';

		try {
			const params = new URLSearchParams();
			if (_marketGpuFilter !== 'all') params.set('gpu', _marketGpuFilter);
			params.set('order', _marketSort);
			params.set('type', _marketTypeFilter);

			const response = await apiFetch(`${serverUrl}/api/compute/instances?${params.toString()}`);
			const data = await response.json();
			_marketOffers = data.instances || [];

			// Update counters
			const offersCountEl = document.getElementById('market-offers-count');
			if (offersCountEl) offersCountEl.textContent = _marketOffers.filter(o => o.type !== 'local').length;

			// Fetch active count
			apiFetch(`${serverUrl}/api/compute/my-instances`).then(r => r.json()).then(d => {
				const el = document.getElementById('market-active-count');
				if (el) el.textContent = (d.instances || []).length;
			}).catch(() => { });

			// GPU filter chips
			const gpuTypes = ['all', 'RTX 4090', 'RTX 3090', 'A100', 'H100', 'L40', 'RTX 4080', 'RTX 3080'];
			let html = `
				<!-- Filter Bar -->
				<div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
					${gpuTypes.map(g => `
						<div onclick="window._filterMarketGpu('${g}')" style="padding: 4px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; cursor: pointer; transition: all 0.2s; ${_marketGpuFilter === g ? 'background: #7c4dff; color: #fff;' : 'background: rgba(255,255,255,0.05); color: #888; border: 1px solid rgba(255,255,255,0.08);'}">${g === 'all' ? 'All GPUs' : g}</div>
					`).join('')}
				</div>

				<!-- Sort -->
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
					<div style="font-size: 10px; color: #888;">${_marketOffers.filter(o => o.type !== 'local').length} offers found</div>
					<select id="market-sort" onchange="window._sortMarket(this.value)" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #ccc; font-size: 10px; padding: 4px 8px; border-radius: 6px;">
						<option value="score" ${_marketSort === 'score' ? 'selected' : ''}>Best Score</option>
						<option value="dph_total" ${_marketSort === 'dph_total' ? 'selected' : ''}>Price: Low→High</option>
						<option value="gpu_ram" ${_marketSort === 'gpu_ram' ? 'selected' : ''}>VRAM: High→Low</option>
						<option value="dlperf" ${_marketSort === 'dlperf' ? 'selected' : ''}>DL Performance</option>
					</select>
				</div>

				<!-- GPU Cards -->
				<div style="display: flex; flex-direction: column; gap: 8px;">
			`;

			_marketOffers.forEach(inst => {
				if (inst.type === 'local') {
					html += `
						<div class="glassy-card" style="border-left: 3px solid #10b981; padding: 10px 14px;">
							<div style="display: flex; justify-content: space-between; align-items: center;">
								<div>
									<div style="font-size: 13px; font-weight: 700; color: #10b981;">🖥 Local Machine</div>
									<div style="font-size: 10px; color: var(--text-muted);">${inst.cpuName} • ${inst.cpuCores} cores • ${inst.ramGb}GB RAM</div>
								</div>
								<div style="font-size: 12px; font-weight: 700; color: #10b981;">FREE</div>
							</div>
						</div>
					`;
					return;
				}

				const priceColor = inst.pricePerHour < 0.5 ? '#10b981' : (inst.pricePerHour < 1.5 ? '#f59e0b' : '#ef4444');
				const reliPct = Math.round((inst.reliability || 0) * 100);
				const reliColor = reliPct > 95 ? '#10b981' : (reliPct > 80 ? '#f59e0b' : '#ef4444');
				const verifiedBadge = inst.verified === 'verified' ? '<span style="color: #3b82f6; font-size: 10px;" title="Verified">✓</span>' : '';

				html += `
					<div class="glassy-card" style="padding: 10px 14px; border-left: 3px solid ${priceColor}; transition: transform 0.15s; cursor: default;" onmouseover="this.style.transform='translateX(2px)'" onmouseout="this.style.transform='none'">
						<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
							<div style="flex: 1; min-width: 0;">
								<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
									<span style="font-size: 13px; font-weight: 700; color: #fff;">${inst.gpuName}</span>
									<span style="font-size: 10px; color: #7c4dff; font-weight: 600;">×${inst.gpuCount}</span>
									${verifiedBadge}
								</div>
								<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;">
									<span style="font-size: 9px; background: rgba(124,77,255,0.12); color: #b794f6; padding: 2px 6px; border-radius: 4px;">${inst.gpuMemoryGb}GB VRAM</span>
									<span style="font-size: 9px; background: rgba(59,130,246,0.12); color: #93c5fd; padding: 2px 6px; border-radius: 4px;">${inst.cpuCores} CPU</span>
									<span style="font-size: 9px; background: rgba(16,185,129,0.12); color: #6ee7b7; padding: 2px 6px; border-radius: 4px;">${inst.ramGb}GB RAM</span>
									<span style="font-size: 9px; background: rgba(245,158,11,0.12); color: #fcd34d; padding: 2px 6px; border-radius: 4px;">${inst.diskGb}GB SSD</span>
								</div>
								<div style="display: flex; gap: 10px; font-size: 9px; color: #888;">
									<span title="Reliability"><span style="color: ${reliColor};">●</span> ${reliPct}%</span>
									<span title="Region">📍 ${inst.region}</span>
									<span title="Network">↓${inst.internetSpeed?.down || 0} ↑${inst.internetSpeed?.up || 0} Mbps</span>
								</div>
							</div>
							<div style="text-align: right; flex-shrink: 0;">
								<div style="font-size: 16px; font-weight: 800; color: ${priceColor};">$${(Number(inst.pricePerHour) || 0).toFixed(3)}</div>
								<div style="font-size: 9px; color: #888; margin-bottom: 6px;">/hour</div>
								<button class="upgrade-btn" style="padding: 5px 14px; font-size: 10px; font-weight: 700;" onclick="window._confirmRent('${inst.provider}', '${inst.id}', '${inst.gpuName}', ${inst.gpuCount}, ${inst.pricePerHour})">Rent</button>
							</div>
						</div>
						<div style="font-size: 8px; color: #555; text-align: right; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Provider: ${inst.provider}</div>
					</div>
				`;
			});

			html += '</div>';
			container.innerHTML = html;
		} catch (err) {
			container.innerHTML = `<div style="color: #ef4444; padding: 20px; text-align: center;"><span class="material-icons" style="font-size: 32px; display: block; margin-bottom: 8px;">error_outline</span>Failed to load marketplace<br><span style="font-size: 10px; opacity: 0.7;">${err.message}</span></div>`;
		}
	}

	window._filterMarketGpu = (gpu) => {
		_marketGpuFilter = gpu;
		_loadMarketOffers();
	};

	window._sortMarket = (order) => {
		_marketSort = order;
		_loadMarketOffers();
	};

	window._confirmRent = (provider, offerId, gpuName, gpuCount, price) => {
		const container = document.getElementById('market-content');
		if (!container) return;

		// Inject confirmation dialog overlay
		const overlay = document.createElement('div');
		overlay.id = 'rent-confirm-overlay';
		overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.15s;';
		overlay.innerHTML = `
			<div style="background: #1e1e2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px; max-width: 320px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
				<div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 4px;">🚀 Confirm Rental</div>
				<div style="font-size: 11px; color: #888; margin-bottom: 16px;">This will create a billable instance on ${provider === 'vast' ? 'Vast.ai' : provider}</div>

				<div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
					<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
						<span style="font-size: 11px; color: #888;">GPU</span>
						<span style="font-size: 11px; color: #fff; font-weight: 600;">${gpuName} ×${gpuCount}</span>
					</div>
					<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
						<span style="font-size: 11px; color: #888;">Price</span>
						<span style="font-size: 11px; color: #f59e0b; font-weight: 600;">$${(Number(price) || 0).toFixed(3)}/hr</span>
					</div>
					<div style="display: flex; justify-content: space-between;">
						<span style="font-size: 11px; color: #888;">Balance</span>
						<span style="font-size: 11px; color: #10b981; font-weight: 600;">$${Number(_accountInfo?.balance || 0).toFixed(2)}</span>
					</div>
				</div>

				<div style="display: flex; gap: 8px;">
					<button onclick="document.getElementById('rent-confirm-overlay')?.remove()" style="flex: 1; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #888; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer;">Cancel</button>
					<button onclick="window._executeRent('${provider}', '${offerId}')" style="flex: 1; padding: 8px; background: #7c4dff; border: none; color: #fff; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">Confirm Rent</button>
				</div>
			</div>
		`;
		document.body.appendChild(overlay);
		overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
	};

	window._executeRent = async (provider, offerId) => {
		const overlay = document.getElementById('rent-confirm-overlay');
		if (overlay) {
			const btn = overlay.querySelector('button:last-child');
			if (btn) { btn.textContent = 'Renting...'; btn.disabled = true; }
		}

		try {
			const res = await apiFetch(`${serverUrl}/api/compute/rent`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider, offerId })
			});
			const data = await res.json();
			overlay?.remove();

			if (data.success) {
				showToast('Success', `GPU instance created! ID: ${data.allocation?.vastInstanceId || offerId}`);
				_marketTab = 'instances';
				renderMarket();
			} else {
				showToast('Error', data.error || 'Rental failed');
			}
		} catch (err) {
			overlay?.remove();
			showToast('Error', `Rental failed: ${err.message}`);
		}
	};

	async function _loadMyInstances() {
		const container = document.getElementById('market-content');
		if (!container) return;
		container.innerHTML = '<div style="color: #888; padding: 20px; text-align: center;"><div class="terminal-spinner" style="display: inline-block;"></div></div>';

		try {
			const response = await apiFetch(`${serverUrl}/api/compute/my-instances`);
			const data = await response.json();
			_myInstances = data.instances || [];

			const activeCountEl = document.getElementById('market-active-count');
			if (activeCountEl) activeCountEl.textContent = _myInstances.length;

			if (_myInstances.length === 0) {
				container.innerHTML = `
					<div style="text-align: center; padding: 40px 20px; color: #888;">
						<span class="material-icons" style="font-size: 48px; color: #333; display: block; margin-bottom: 12px;">cloud_off</span>
						<div style="font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 4px;">No Active Instances</div>
						<div style="font-size: 11px;">Browse the marketplace to rent GPU compute</div>
						<button class="upgrade-btn" style="margin-top: 16px; padding: 8px 20px;" onclick="window._setMarketTab('browse')">
							<span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 4px;">storefront</span>Browse GPUs
						</button>
					</div>
				`;
				return;
			}

			let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
			_myInstances.forEach(inst => {
				const statusColor = inst.status === 'running' ? '#10b981' : (inst.status === 'loading' || inst.status === 'starting' ? '#f59e0b' : '#ef4444');
				const statusLabel = inst.status.charAt(0).toUpperCase() + inst.status.slice(1);

				html += `
					<div class="glassy-card" style="padding: 12px 14px;">
						<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
							<div>
								<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
									<span style="width: 7px; height: 7px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 6px ${statusColor}; display: inline-block;"></span>
									<span style="font-size: 13px; font-weight: 700; color: #fff;">${inst.gpuName} ×${inst.gpuCount}</span>
								</div>
								<div style="font-size: 10px; color: ${statusColor}; font-weight: 600;">${statusLabel}</div>
							</div>
							<div style="text-align: right;">
								<div style="font-size: 14px; font-weight: 800; color: #f59e0b;">$${(inst.price || inst.pricePerHour || 0).toFixed(3)}/hr</div>
								<div style="font-size: 9px; color: #888;">Spent: $${Number(inst.currentCost || 0).toFixed(2)}</div>
							</div>
						</div>

						<!-- Specs -->
						<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
							<span style="font-size: 9px; background: rgba(124,77,255,0.12); color: #b794f6; padding: 2px 6px; border-radius: 4px;">${inst.memory || inst.gpuMemory || 0}GB VRAM</span>
							<span style="font-size: 9px; background: rgba(59,130,246,0.12); color: #93c5fd; padding: 2px 6px; border-radius: 4px;">${inst.specs?.cpu || inst.cpuCores || 0} CPU</span>
							<span style="font-size: 9px; background: rgba(16,185,129,0.12); color: #6ee7b7; padding: 2px 6px; border-radius: 4px;">${inst.specs?.ram || inst.ramGb || 0}GB RAM</span>
							<span style="font-size: 9px; background: rgba(245,158,11,0.12); color: #fcd34d; padding: 2px 6px; border-radius: 4px;">📍 ${inst.location}</span>
						</div>

						<!-- Connection Info -->
						${inst.sshHost ? `<div style="background: rgba(0,0,0,0.2); border-radius: 6px; padding: 8px; font-family: monospace; font-size: 10px; margin-bottom: 8px;">
							<div style="color: #10b981; margin-bottom: 2px;">SSH Connection:</div>
							<div style="color: #ccc; user-select: all;">ssh root@${inst.sshHost} -p ${inst.sshPort}</div>
						</div>` : ''}

						<!-- Actions -->
						<div style="display: flex; gap: 8px; justify-content: flex-end;">
							<button onclick="window._refreshInstanceStatus('${inst.providerId || 'vast'}', '${inst.id}')" style="padding: 4px 10px; font-size: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #888; border-radius: 6px; cursor: pointer; font-weight: 600;">
								<span class="material-icons" style="font-size: 12px; vertical-align: middle;">refresh</span> Refresh
							</button>
							<button onclick="window._terminateInstance('${inst.providerId || 'vast'}', '${inst.id}', '${inst.gpuName || inst.name}')" style="padding: 4px 10px; font-size: 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #ef4444; border-radius: 6px; cursor: pointer; font-weight: 600;">
								<span class="material-icons" style="font-size: 12px; vertical-align: middle;">power_settings_new</span> Terminate
							</button>
						</div>
					</div>
				`;
			});

			html += '</div>';
			container.innerHTML = html;
		} catch (err) {
			container.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to load instances: ${err.message}</div>`;
		}
	}

	window._refreshInstanceStatus = async (instanceId) => {
		try {
			showToast('Info', 'Refreshing instance status...');
			await _loadMyInstances();
		} catch (err) { /* ignore */ }
	};

	window._terminateInstance = async (providerId, instanceId, name) => {
		const overlay = document.createElement('div');
		overlay.id = 'terminate-confirm-overlay';
		overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center;';
		overlay.innerHTML = `
			<div style="background: #1e1e2e; border: 1px solid rgba(239,68,68,0.2); border-radius: 12px; padding: 24px; max-width: 300px; width: 90%;">
				<div style="font-size: 16px; font-weight: 800; color: #ef4444; margin-bottom: 8px;">⚠ Terminate Instance</div>
				<div style="font-size: 11px; color: #888; margin-bottom: 16px;">Are you sure you want to terminate <strong style="color:#fff;">${name}</strong> (ID: ${instanceId})?<br>This action cannot be undone.</div>
				<div style="display: flex; gap: 8px;">
					<button onclick="document.getElementById('terminate-confirm-overlay')?.remove()" style="flex: 1; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #888; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer;">Cancel</button>
					<button onclick="window._doTerminate('${providerId}', '${instanceId}')" style="flex: 1; padding: 8px; background: #ef4444; border: none; color: #fff; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">Terminate</button>
				</div>
			</div>
		`;
		document.body.appendChild(overlay);
		overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
	};

	window._doTerminate = async (providerId, instanceId) => {
		document.getElementById('terminate-confirm-overlay')?.remove();
		try {
			const res = await apiFetch(`${serverUrl}/api/compute/instances/${providerId}/${instanceId}`, { method: 'DELETE' });
			const data = await res.json();
			showToast('Success', `Instance ${instanceId} terminated`);
			_loadMyInstances();
		} catch (err) {
			showToast('Error', `Failed to terminate: ${err.message}`);
		}
	};

	async function _loadMarketSettings() {
		const container = document.getElementById('market-content');
		if (!container) return;

		try {
			const res = await apiFetch(`${serverUrl}/api/compute/settings`);
			const settings = await res.json();

			container.innerHTML = `
				<div style="display: flex; flex-direction: column; gap: 16px;">
					<!-- Vast.ai -->
					<div class="glassy-card" style="padding: 16px; border-left: 2px solid #7c4dff;">
						<div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 4px;">Vast.ai API Key</div>
						<div style="font-size: 10px; color: #888; margin-bottom: 12px;">Primary GPU marketplace. Get key at <span style="color: #7c4dff;">cloud.vast.ai</span></div>
						<div style="display: flex; gap: 8px; margin-bottom: 8px;">
							<input id="vast-api-key-input" type="password" placeholder="Enter Vast.ai API Key..." value="" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-family: monospace;">
							<button onclick="window._saveMarketKey('vast')" style="padding: 8px 16px; background: #7c4dff; border: none; color: #fff; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">Save</button>
						</div>
						<div style="font-size: 10px; color: ${settings.vast ? '#10b981' : '#ef4444'};">
							${settings.vast ? `✓ Key configured: ${settings.vast}` : '✗ No API key configured'}
						</div>
					</div>

					<!-- RunPod -->
					<div class="glassy-card" style="padding: 16px; border-left: 2px solid #f59e0b;">
						<div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 4px;">RunPod API Key</div>
						<div style="font-size: 10px; color: #888; margin-bottom: 12px;">Alternative GPU cloud. Get key at <span style="color: #f59e0b;">runpod.io</span></div>
						<div style="display: flex; gap: 8px; margin-bottom: 8px;">
							<input id="runpod-api-key-input" type="password" placeholder="Enter RunPod API Key..." value="" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-family: monospace;">
							<button onclick="window._saveMarketKey('runpod')" style="padding: 8px 16px; background: #f59e0b; border: none; color: #fff; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">Save</button>
						</div>
						<div style="font-size: 10px; color: ${settings.runpod ? '#10b981' : '#ef4444'};">
							${settings.runpod ? `✓ Key configured: ${settings.runpod}` : '✗ No API key configured'}
						</div>
					</div>

					<!-- AWS -->
					<div class="glassy-card" style="padding: 16px; border-left: 2px solid #3b82f6;">
						<div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 4px;">AWS (EC2 CPU)</div>
						<div style="font-size: 10px; color: #888; margin-bottom: 12px;">Enterprise CPU/GPU clusters.</div>
						<div style="display: flex; gap: 8px; margin-bottom: 8px;">
							<input id="aws-api-key-input" type="password" placeholder="Enter AWS Key/Secret..." value="" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-family: monospace;">
							<button onclick="window._saveMarketKey('aws')" style="padding: 8px 16px; background: #3b82f6; border: none; color: #fff; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">Save</button>
						</div>
						<div style="font-size: 10px; color: ${settings.aws ? '#10b981' : '#ef4444'};">
							${settings.aws ? `✓ Key configured: ${settings.aws}` : '✗ No API key configured'}
						</div>
					</div>

					<div class="glassy-card" style="padding: 16px;">
						<div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 4px;">Account Info</div>
						<div style="font-size: 10px; color: #888; margin-bottom: 8px;">Aggregated billing details</div>
						<div style="display: flex; flex-direction: column; gap: 6px;">
							<div style="display: flex; justify-content: space-between;">
								<span style="font-size: 11px; color: #888;">Total Balance</span>
								<span style="font-size: 11px; color: #10b981; font-weight: 700;">$${Number(_accountInfo.balance || 0).toFixed(2)}</span>
							</div>
						</div>
					</div>
				</div>
			`;
		} catch (err) {
			container.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to load settings: ${err.message}</div>`;
		}
	}

	window._saveMarketKey = async (provider) => {
		const input = document.getElementById(`${provider}-api-key-input`);
		const apiKey = input?.value;
		if (!apiKey) return showToast('Error', 'API key is required');

		try {
			const res = await apiFetch(`${serverUrl}/api/compute/settings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ provider, apiKey })
			});
			const data = await res.json();
			if (data.success) {
				showToast('Success', `API key for ${provider} saved`);
				_loadMarketSettings();
			} else {
				showToast('Error', data.error);
			}
		} catch (err) {
			showToast('Error', `Failed to save key: ${err.message}`);
		}
	};

	window.rentCompute = async (gpuId) => {
		window._confirmRent(gpuId, 'GPU', 1, 0);
	};

	// --- PLUGINS MARKET ---
	let pluginsCatalog = [];
	let installedPlugins = new Set();
	let pluginFilterCategory = 'all';
	let pluginSearchQuery = '';

	async function fetchPluginsFromMarket() {
		console.log('[CoderX] Fetching plugins from marketplace...');
		try {
			const res = await apiFetch(`${serverUrl}/api/plugins/catalog`);
			if (!res.ok) throw new Error('Marketplace unavailable');
			const data = await res.json();
			pluginsCatalog = data.plugins || [];
			if (featureContent && (featureContent.dataset.view === 'plugins' || featureContent.dataset.view === 'market')) {
				renderPlugins();
			}
		} catch (err) {
			console.error('[CoderX] Failed to fetch plugins:', err);
		}
	}

	const pluginCategories = [
		{ id: 'all', label: 'All', icon: 'apps' },
		{ id: 'ai', label: 'AI Agents', icon: 'psychology' },
		{ id: 'tools', label: 'Code Tools', icon: 'build' },
		{ id: 'testing', label: 'Testing', icon: 'science' },
		{ id: 'devops', label: 'DevOps', icon: 'cloud' },
		{ id: 'uiux', label: 'UI/UX', icon: 'palette' },
		{ id: 'analytics', label: 'Analytics', icon: 'analytics' }
	];

	function renderPlugins() {
		const filtered = (pluginsCatalog || []).filter(p => {
			const matchCategory = pluginFilterCategory === 'all' || p.category === pluginFilterCategory;
			const matchSearch = !pluginSearchQuery ||
				p.name.toLowerCase().includes(pluginSearchQuery.toLowerCase()) ||
				p.description.toLowerCase().includes(pluginSearchQuery.toLowerCase()) ||
				(p.tags || []).some(t => t.toLowerCase().includes(pluginSearchQuery.toLowerCase()));
			return matchCategory && matchSearch;
		});

		const featuredPlugins = filtered.filter(p => p.featured);
		const regularPlugins = filtered.filter(p => !p.featured);

		featureContent.innerHTML = `
			<div class="plugins-container">
				<!-- Search Bar -->
				<div class="plugins-search-bar">
					<span class="material-icons" style="font-size: 18px; color: var(--text-muted);">search</span>
					<input type="text" id="plugins-search-input" placeholder="Search plugins..." value="${pluginSearchQuery}">
					<span class="plugins-result-count">${filtered.length} plugins</span>
					<button class="icon-btn" onclick="window.fetchPluginsFromMarket()" title="Refresh Marketplace" style="margin-left: 8px;">
						<span class="material-icons" style="font-size: 16px;">refresh</span>
					</button>
				</div>

				<!-- Category Chips -->
				<div class="plugins-categories">
					${pluginCategories.map(c => `
						<div class="plugin-category-chip ${pluginFilterCategory === c.id ? 'active' : ''}" 
								onclick="window.filterPlugins('${c.id}')">
							<span class="material-icons" style="font-size: 14px;">${c.icon}</span>
							${c.label}
						</div>
					`).join('')}
				</div>

				<!-- Featured Section -->
				${featuredPlugins.length > 0 ? `
					<div class="plugins-section-title">
						<span class="material-icons" style="font-size: 14px; color: #f59e0b;">star</span>
						Featured
					</div>
					<div class="plugins-featured-grid">
						${featuredPlugins.map(p => renderPluginCard(p, true)).join('')}
					</div>
				` : ''}

				<!-- All Plugins -->
				<div class="plugins-section-title" style="margin-top: 8px;">
					<span class="material-icons" style="font-size: 14px; color: var(--accent-color);">grid_view</span>
					${pluginFilterCategory === 'all' ? 'All Plugins' : pluginCategories.find(c => c.id === pluginFilterCategory)?.label || 'Plugins'}
				</div>
				<div class="plugins-list">
					${(regularPlugins.length > 0 ? regularPlugins : (featuredPlugins.length === 0 ? [{ empty: true }] : [])).map(p => {
			if (p.empty) return '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 32px;">No plugins found matching your search.</div>';
			return renderPluginCard(p, false);
		}).join('')}
				</div>
			</div>
		`;

		// Attach search handler
		const searchInput = document.getElementById('plugins-search-input');
		if (searchInput) {
			searchInput.addEventListener('input', (e) => {
				pluginSearchQuery = e.target.value;
				renderPlugins();
			});
			searchInput.focus();
			// Restore cursor position
			searchInput.setSelectionRange(pluginSearchQuery.length, pluginSearchQuery.length);
		}
	}

	function renderPluginCard(plugin, isFeatured) {
		const isInstalled = installedPlugins.has(plugin.id);
		const hasUpdate = plugin.updateAvailable && isInstalled;
		const starsHtml = renderStars(plugin.stars);

		let actionBtn;
		if (plugin.deployedOn?.status === 'deploying') {
			actionBtn = `<button class="plugin-btn plugin-btn-installing" disabled>
				<span class="material-icons rotating" style="font-size: 13px;">sync</span> Deploying...
			</button>`;
		} else if (hasUpdate) {
			actionBtn = `<button class="plugin-btn plugin-btn-update" onclick="event.stopPropagation(); window.updatePlugin('${plugin.id}', '${plugin.updateAvailable}')">
				<span class="material-icons" style="font-size: 13px;">upgrade</span> Update
			</button>`;
		} else if (isInstalled) {
			actionBtn = `<button class="plugin-btn plugin-btn-installed" onclick="event.stopPropagation(); window.uninstallPlugin('${plugin.id}')">
				<span class="material-icons" style="font-size: 13px;">check_circle</span> Active
			</button>`;
		} else {
			actionBtn = `<button class="plugin-btn plugin-btn-install" onclick="event.stopPropagation(); window.installPlugin('${plugin.id}')">
				<span class="material-icons" style="font-size: 13px;">download</span> Install
			</button>`;
		}

		return `
			<div class="plugin-card ${isFeatured ? 'featured' : ''} ${isInstalled ? 'installed' : ''}">
				<div class="plugin-card-header">
					<div class="plugin-icon" style="background: linear-gradient(135deg, ${plugin.iconColor}22, ${plugin.iconColor}44); border: 1px solid ${plugin.iconColor}55;">
						<span class="material-icons" style="color: ${plugin.iconColor}; font-size: 20px;">${plugin.icon}</span>
					</div>
					<div class="plugin-info">
						<div class="plugin-name">${plugin.name}</div>
						<div class="plugin-author">${plugin.author} • v${plugin.version}</div>
					</div>
					${hasUpdate ? '<span class="plugin-update-badge">NEW</span>' : ''}
				</div>
				<div class="plugin-desc">${plugin.description}</div>
				<div class="plugin-card-footer">
					<div class="plugin-meta">
						<div class="plugin-stars">${starsHtml} <span>${plugin.stars}</span></div>
						<div class="plugin-downloads">
							<span class="material-icons" style="font-size: 12px;">arrow_downward</span>
							${plugin.downloads}
						</div>
					</div>
					<div class="plugin-tags">
						${(plugin.tags || []).map(t => `<span class="plugin-tag">${t}</span>`).join('')}
					</div>
				</div>
				<div class="plugin-action-row">
					${actionBtn}
				</div>
			</div>
		`;
	}

	function renderStars(rating) {
		const full = Math.floor(rating);
		const half = rating % 1 >= 0.5 ? 1 : 0;
		const empty = 5 - full - half;
		let html = '';
		for (let i = 0; i < full; i++) html += '<span class="material-icons star-icon filled">star</span>';
		if (half) html += '<span class="material-icons star-icon filled">star_half</span>';
		for (let i = 0; i < empty; i++) html += '<span class="material-icons star-icon">star_border</span>';
		return html;
	}

	window.filterPlugins = (category) => {
		pluginFilterCategory = category;
		renderPlugins();
	};

	window.installPlugin = async (id) => {
		const plugin = pluginsCatalog.find(p => p.id === id);
		if (!plugin) return;

		showModal('Suggesting Compute...', `
			<div style="display: flex; flex-direction: column; gap: 16px;">
				<p style="font-size: 13px; color: var(--text-muted);">
					Installing <b>${plugin.name}</b>. This plugin requires 
					${plugin.requirements.gpu ? `a GPU (min ${plugin.requirements.minVram}GB VRAM)` : `${plugin.requirements.cpu} CPU Cores`}.
				</p>
				<div id="compute-suggestions-container">
					<div class="loading-container" style="padding: 20px; text-align: center;">
						<span class="material-icons rotating" style="color: var(--accent-color);">sync</span>
						<p style="font-size: 11px; margin-top: 8px;">Finding best value instances...</p>
					</div>
				</div>
				<div class="modal-footer" id="suggestion-footer" style="display: none;">
					<button class="secondary-btn" onclick="closeModal()">Cancel</button>
					<button class="upgrade-btn" id="confirm-rent-plugin-btn" disabled>
						<span class="material-icons">rocket_launch</span> Confirm & Rent
					</button>
				</div>
			</div>
		`);

		try {
			const res = await apiFetch(`${serverUrl}/api/plugins/suggest-compute/${id}`);
			const data = await res.json();
			const suggestions = data.suggestions || [];
			const container = document.getElementById('compute-suggestions-container');
			const footer = document.getElementById('suggestion-footer');

			if (!suggestions || suggestions.length === 0) {
				container.innerHTML = `<p style="color: #ef4444; font-size: 12px; text-align: center;">No suitable compute found. Try again later.</p>`;
				return;
			}

			container.innerHTML = `
				<div class="suggestion-list">
					${suggestions.map((s, idx) => `
						<div class="suggestion-card ${idx === 0 ? 'selected' : ''}" data-gpu-id="${s.id}" data-provider="${s.provider}">
							<div class="suggestion-header">
								<div class="suggestion-title">${s.gpuName}</div>
								<div class="suggestion-price">$${s.pricePerHour}/hr</div>
							</div>
							<div class="suggestion-specs">
								<span><span class="material-icons">memory</span> ${s.gpuMemoryGb}GB</span>
								<span><span class="material-icons">settings_input_component</span> ${s.gpuCount}x</span>
								<span><span class="material-icons">public</span> ${s.region}</span>
							</div>
							<div class="suggestion-footer">
								<div class="suggestion-provider">${s.provider}</div>
								<div style="font-size: 10px; color: #10b981;">Best Value</div>
							</div>
						</div>
					`).join('')}
				</div>
			`;

			footer.style.display = 'flex';
			const confirmBtn = document.getElementById('confirm-rent-plugin-btn');
			confirmBtn.disabled = false;

			let selectedGpuId = suggestions[0].id;
			let selectedProvider = suggestions[0].provider;

			// Handle selection
			container.querySelectorAll('.suggestion-card').forEach(card => {
				card.onclick = () => {
					container.querySelectorAll('.suggestion-card').forEach(c => c.classList.remove('selected'));
					card.classList.add('selected');
					selectedGpuId = card.dataset.gpuId;
					selectedProvider = card.dataset.provider;
				};
			});

			confirmBtn.onclick = async () => {
				confirmBtn.innerHTML = '<span class="material-icons rotating">sync</span> Renting...';
				confirmBtn.disabled = true;

				try {
					const rentRes = await apiFetch(`${serverUrl}/api/plugins/${id}/rent`, {
						method: 'POST',
						body: JSON.stringify({ gpuId: selectedGpuId, provider: selectedProvider, userId: 'local_user' })
					});

					if (rentRes.ok) {
						const rentData = await rentRes.json();
						closeModal();
						showNotification(`Installing ${plugin.name} on ${selectedProvider}...`, 'success');
						fetchPluginsFromMarket(); // Refresh list

						if (rentData.id) {
							trackDeployment(rentData.id);
						}
					} else {
						throw new Error('Rental failed');
					}
				} catch (err) {
					showNotification('Failed to rent plugin: ' + err.message, 'error');
					confirmBtn.disabled = false;
					confirmBtn.innerHTML = '<span class="material-icons">rocket_launch</span> Confirm & Rent';
				}
			};

		} catch (err) {
			console.error('Failed to get suggestions:', err);
			if (document.getElementById('compute-suggestions-container')) {
				document.getElementById('compute-suggestions-container').innerHTML = `<p style="color: #ef4444; font-size: 12px;">Error: ${err.message}</p>`;
			}
		}
	};

	function trackDeployment(deploymentId) {
		console.log(`[Plugins] Tracking deployment ${deploymentId}...`);

		let progress = 10;
		const pollInterval = setInterval(async () => {
			try {
				await fetchPluginsFromMarket();

				const catalog = pluginsCatalog;
				const activeDeployments = catalog.filter(p => p.deployedOn?.status === 'deploying');

				// Update UI progress
				progress = Math.min(progress + 15, 95);
				const bar = document.getElementById('deploy-progress-bar');
				const stepText = document.getElementById('deploy-step-text');
				const logs = document.getElementById('deploy-logs');
				const badge = document.getElementById('deploy-status-badge');

				if (bar) bar.style.width = `${progress}%`;
				if (stepText) {
					if (progress < 30) stepText.innerText = 'Allocating GPU resources...';
					else if (progress < 60) stepText.innerText = 'Installing CoderX Runner agent...';
					else stepText.innerText = 'Uploading plugin module...';
				}
				if (logs) {
					const logLine = document.createElement('div');
					logLine.style.marginBottom = '4px';
					logLine.innerHTML = `<span style="color: #666;">[${new Date().toLocaleTimeString()}]</span> Processing step...`;
					logs.appendChild(logLine);
					logs.scrollTop = logs.scrollHeight;
				}

				if (activeDeployments.length === 0) {
					console.log('[Plugins] No more active deployments, stopping poll.');
					if (bar) bar.style.width = '100%';
					if (stepText) stepText.innerText = 'Deployment successful!';
					if (badge) {
						badge.innerText = 'ACTIVE';
						badge.style.background = '#10b981';
					}
					clearInterval(pollInterval);
				}
			} catch (err) {
				console.error('[Plugins] Polling error:', err);
				clearInterval(pollInterval);
			}
		}, 2000);

		// Show a dedicated UI for tracking
		featureContent.innerHTML = `
			<div class="feature-scroll-container">
				<div class="glassy-card" style="padding: 24px; text-align: center;">
					<div style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 24px;">Market Orchestration</div>
					<div id="deploy-status-badge" class="plugin-update-badge" style="display: inline-block; position: static; margin-bottom: 16px;">PROVISIONING</div>

					<div style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; margin: 16px 0;">
						<div id="deploy-progress-bar" style="width: 10%; height: 100%; background: #7c4dff; border-radius: 3px; box-shadow: 0 0 10px #7c4dff; transition: width 0.5s ease;"></div>
					</div>

					<div id="deploy-step-text" style="font-size: 12px; color: var(--text-muted); margin-bottom: 24px;">Allocating GPU resources...</div>

					<div id="deploy-logs" style="text-align: left; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; height: 120px; overflow-y: auto; color: #a3a3a3;">
						<div><span style="color: #666;">[${new Date().toLocaleTimeString()}]</span> Initializing pipeline...</div>
					</div>

					<button class="upgrade-btn" style="margin-top: 24px; width: 100%; justify-content: center;" onclick="window.backToMarket()">
						Finish & Return
					</button>
				</div>
			</div>
		`;

		const interval = setInterval(async () => {
			const res = await apiFetch(`${serverUrl}/api/plugins/deployment/${deploymentId}`);
			if (!res.ok) { clearInterval(interval); return; }
			const status = await res.json();

			const badge = document.getElementById('deploy-status-badge');
			const bar = document.getElementById('deploy-progress-bar');
			const stepText = document.getElementById('deploy-step-text');
			const logBox = document.getElementById('deploy-logs');

			if (badge) badge.innerText = status.state.toUpperCase();
			if (bar) bar.style.width = `${status.progress}%`;
			if (stepText) stepText.innerText = status.logs[status.logs.length - 1]?.message || 'Deploying...';

			if (logBox) {
				logBox.innerHTML = status.logs.map(l => `<div>[${new Date(l.time).toLocaleTimeString()}] ${l.message}</div>`).join('');
				logBox.scrollTop = logBox.scrollHeight;
			}

			if (status.state === 'active' || status.state === 'error') {
				clearInterval(interval);
			}
		}, 1000);
	}

	window.backToMarket = () => {
		renderPlugins();
	};

	window.uninstallPlugin = async (id) => {
		window.showConfirm('Uninstall this plugin and release compute?', async () => {
			try {
				const res = await apiFetch(`${serverUrl}/api/plugins/${id}/install`, { method: 'POST' }); // Mock toggle back
				if (res.ok) {
					installedPlugins.delete(id);
					renderPlugins();
				}
			} catch (err) {
				console.error("Failed to uninstall plugin", err);
			}
		});
	};


	window.setupProvider = (providerType) => {
		vscode.postMessage({ type: 'setupProvider', provider: providerType });
	};

	window.openBilling = () => {
		vscode.postMessage({ type: 'openExternal', url: 'https://edge-gateway-rho.vercel.app/pricing' });
	};

	window.closeQuotaModal = () => {
		const modal = document.getElementById('quota-modal');
		if (modal) modal.style.display = 'none';
	};

	async function renderSettings() {
		featureContent.innerHTML = `
			<div class="settings-container">
				<div class="settings-header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px 10px 16px;">
					<div class="settings-header-left" style="display: flex; align-items: center;">
						<span class="material-icons" style="font-size: 15px; color: #7c4dff; margin-right: 6px; font-weight: bold;">settings</span>
						<span class="settings-header-title" style="font-size: 12px; font-weight: bold; color: #fff; letter-spacing: 0.5px; text-transform: uppercase;">Settings</span>
					</div>
					<button class="settings-close-btn" onclick="if (typeof window.toggleSettings === 'function') window.toggleSettings();" title="Close Settings" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px; transition: all 0.2s;">
						<span class="material-icons" style="font-size: 16px;">close</span>
					</button>
				</div>
				<div class="settings-tabs" style="padding: 0 16px 12px 16px;">
					<button class="settings-tab-btn active" data-tab="models">Models</button>
					<button class="settings-tab-btn" data-tab="security">Security</button>
					<button class="settings-tab-btn" data-tab="mcp">MCP</button>
					<button class="settings-tab-btn" data-tab="s3">Cloud Storage</button>
				</div>

				<div class="settings-content-scrollable">
					<div id="pane-models" class="settings-pane active">
						<div class="settings-section">
							<div class="settings-section-title">Available Provider Types</div>
							<style>
								.provider-chip.cloud:hover {
									opacity: 1;
									filter: grayscale(0);
								}

								.setup-icon {
									font-size: 14px !important;
									margin-left: 6px;
									opacity: 0.6;
									transition: all 0.2s;
									cursor: pointer;
								}

								.setup-icon:hover {
									opacity: 1;
									color: #00e5ff;
									transform: scale(1.2);
								}

								.menu-chip.local {
									/* Additional local specific styles */
								}
							</style>
							<div id="provider-chips-container" class="provider-chips-container">
								<div style="color: var(--text-muted); font-size: 11px;">Loading types...</div>
							</div>
							<div class="recommendation-banner">
								<span class="material-icons">info</span>
								<span>Recommended: <b>o3-mini</b> or <b>gemini-2.0-pro</b> for expert, <b>gpt-4o</b> for main, and <b>gpt-4o-mini</b> for aux.</span>
							</div>
						</div>

						<div class="settings-section">
							<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
								<div class="settings-section-title" style="margin-bottom: 0;">Your Provider List</div>
								<button class="upgrade-btn" style="padding: 4px 10px; font-size: 11px;" id="add-provider-btn">
									<span class="material-icons">add</span> Add
								</button>
							</div>
							<div id="configured-providers-list" style="display: flex; flex-direction: column; gap: 8px;">
								<!-- Providers injected here -->
							</div>
						</div>

						<div class="settings-section">
							<div class="settings-section-title">LLM Configurations</div>
							<div class="llm-config-grid" id="llm-roles-container">
								<!-- Role cards injected here -->
							</div>
						</div>
					</div>

					<!-- Other panes kept consistent -->
					<div id="pane-security" class="settings-pane">
						<div class="settings-section">
							<div class="settings-section-title">Permissions</div>
							<div class="settings-row">
								<div class="setting-info">
									<div class="setting-title">Auto-execute Tools</div>
									<div class="setting-desc">Allow AI to run read-only tools without asking</div>
								</div>
								<div class="toggle-switch active" data-setting="autoExecute"><div style="left: 16px;"></div></div>
							</div>
							<div class="settings-row">
								<div class="setting-info">
									<div class="setting-title">Restricted Filesystem</div>
									<div class="setting-desc">Prevent AI from accessing files outside workspace</div>
								</div>
								<div class="toggle-switch active" data-setting="restrictedFs"><div style="left: 16px;"></div></div>
							</div>
							<div class="settings-row">
								<div class="setting-info">
									<div class="setting-title">Enable Web Access</div>
									<div class="setting-desc">Allow AI to search the web and fetch URL content</div>
								</div>
								<div class="toggle-switch active" data-setting="webAccess"><div style="left: 16px;"></div></div>
							</div>
						</div>

						<div class="settings-section">
							<div class="settings-section-title">Network / Web</div>
							<div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
								<div class="setting-title" style="font-size: 11px;">Agent Web Proxy (HTTP/S)</div>
								<input type="text" id="web-fetch-proxy" class="settings-input" placeholder="e.g. http://user:pass@proxy.com:8080">
								<div class="setting-desc">Used by WebFetchTool and Google Search to prevent IP blocks.</div>
							</div>
						</div>
					</div>



					<div id="pane-mcp" class="settings-pane">
						<div class="settings-section">
							<div class="settings-section-title" style="display: flex; justify-content: space-between; align-items: center;">
								MCP Servers
								<button class="upgrade-btn" style="padding: 4px 10px; font-size: 11px;" onclick="window.addMCPServer()">
									<span class="material-icons">add</span> Add
								</button>
							</div>
							<div id="mcp-server-list" style="display: flex; flex-direction: column; gap: 8px;">
								<!-- Dynamic list -->
							</div>
						</div>
					</div>

					<div id="pane-s3" class="settings-pane">
						<div class="settings-section">
							<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
								<div class="settings-section-title" style="margin-bottom: 0;">S3 Cloud Storage</div>
								<button class="upgrade-btn" style="padding: 4px 10px; font-size: 11px;" onclick="window.addS3Config()">
									<span class="material-icons">add</span> Add Storage
								</button>
							</div>
							<div class="recommendation-banner">
								<span class="material-icons">cloud</span>
								<span>Configure multiple S3-compatible storage providers (AWS, R2, MinIO, etc.).</span>
							</div>

							<div id="s3-config-list" style="display: flex; flex-direction: column; gap: 8px;">
								<!-- S3 configs injected here -->
							</div>
						</div>

						<div class="settings-section">
							<div class="settings-section-title">Options</div>
							<div class="settings-row">
								<div class="setting-info">
									<div class="setting-title">Auto Cloud Backup</div>
									<div class="setting-desc">Automatically upload project snapshots to active S3 storage</div>
								</div>
								<div class="toggle-switch active" data-setting="s3AutoBackup"><div style="left: 16px;"></div></div>
							</div>
						</div>
					</div>
				</div>

				<div class="settings-footer">
					<button class="upgrade-btn cancel-btn" id="btn-cancel-settings" style="background: rgba(255,255,255,0.05); color: #fff; margin-right: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s;">Cancel</button>
					<button class="upgrade-btn" id="btn-save-settings">Save Changes</button>
				</div>
			</div>
		`;

		// Tab Switching
		const tabs = featureContent.querySelectorAll('.settings-tab-btn');
		tabs.forEach(tab => {
			tab.onclick = () => {
				tabs.forEach(t => t.classList.remove('active'));
				tab.classList.add('active');
				featureContent.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
				document.getElementById(`pane-${tab.dataset.tab}`)?.classList.add('active');
			};
		});

		// Toggle Switches
		featureContent.addEventListener('click', (e) => {
			const toggle = e.target.closest('.toggle-switch');
			if (toggle) {
				toggle.classList.toggle('active');
				const dot = toggle.querySelector('div');
				if (dot) dot.style.left = toggle.classList.contains('active') ? '16px' : '2px';
			}
		});

		// Attach static listeners immediately after HTML injection
		const addBtn = document.getElementById('add-provider-btn');
		if (addBtn) {
			addBtn.onclick = () => {
				console.log('[CoderX] Add Provider button clicked');
				window.showProviderModal();
			};
		}

		const cancelBtn = document.getElementById('btn-cancel-settings');
		if (cancelBtn) {
			cancelBtn.onclick = () => {
				if (typeof window.toggleSettings === 'function') {
					window.toggleSettings();
				}
			};
		}

		const saveBtn = document.getElementById('btn-save-settings');
		if (saveBtn) {
			saveBtn.onclick = saveAllModelsSettings;
		}

		try {
			await loadSettings();
		} catch (e) {
			console.error('[CoderX] loadSettings() failed:', e);
		}
	}

	let agents = [];

	async function loadSettings() {
		console.log('[Codix] loadSettings() from localStorage...');
		try {
			// Hardcode providerTypes since we don't have a backend schema API in Codix Desktop
			providerTypes = [
				{ type: 'openai', name: 'OpenAI' },
				{ type: 'anthropic', name: 'Anthropic' },
				{ type: 'google', name: 'Google AI' },
				{ type: 'openrouter', name: 'OpenRouter' },
				{ type: 'groq', name: 'Groq' },
				{ type: 'deepseek', name: 'DeepSeek' },
				{ type: 'mistral', name: 'Mistral' },
				{ type: 'ollama', name: 'Ollama (Local)' },
				{ type: 'lmstudio', name: 'LM Studio (Local)' },
				{ type: 'vllm', name: 'vLLM (Local)' },
				{ type: 'custom', name: 'Custom OpenAI-compatible' }
			];

			// Load from localStorage
			const savedStr = localStorage.getItem('codix_llm_settings');
			const saved = savedStr ? JSON.parse(savedStr) : {};

			modelsData = {
				available: [],
				current: saved.current || { main: '' },
				llmConfig: saved.llmConfig || {},
				providers: Array.isArray(saved.providers) ? saved.providers : [],
				activeModels: saved.llmConfig || {},
				activeRole: 'main'
			};

			console.log('[Codix] Loaded', modelsData.providers.length, 'providers from localStorage');
			renderModelsView();
			if (typeof updateStatusModels === 'function') updateStatusModels();
		} catch (e) {
			console.error('[Codix] loadSettings failed:', e);
			providerTypes = [];
			modelsData = { available: [], current: { main: '' }, llmConfig: {}, providers: [], activeModels: {}, activeRole: 'main' };
			renderModelsView();
			if (typeof updateStatusModels === 'function') updateStatusModels();
		}
	}

	async function loadAgents() {
		try {
			const res = await apiFetch(`${serverUrl}/api/agents`);
			agents = await res.json();
			renderAgentsView();
		} catch (e) {
			console.error('Failed to load agents:', e);
		}
	}

	const addBtn = document.getElementById('add-agent-btn');
	if (addBtn) addBtn.onclick = () => window.showAgentModal();

	window.showAgentModal = async (agentId = null) => {
		const modalOverlay = document.getElementById('modal-overlay');
		const modalContent = modalOverlay.querySelector('.modal-content');

		// Fetch tools and potentially agent data
		const [toolsRes, agentData] = await Promise.all([
			apiFetch(`${serverUrl}/api/agents/tools`).then(r => r.json()),
			agentId ? apiFetch(`${serverUrl}/api/agents/${agentId}`).then(r => r.json()) : null
		]);

		const agent = agentData || { name: '', description: '', agent: { tool_list: [], "prompt-overrides": { "main-system": "", "expert-advice": "" } } };

		// Ensure agent.agent exists for property access safety
		if (!agent.agent) agent.agent = { tool_list: [], "prompt-overrides": {} };

		modalContent.innerHTML = `
			<div class="modal-header">
				<span class="material-icons" style="color: #7c4dff;">psychology</span>
				<span style="font-weight: 600;">${agentId ? 'Edit' : 'Create'} Agent</span>
				<div style="flex: 1;"></div>
				<button class="icon-btn" onclick="window.closeModal()"><span class="material-icons">close</span></button>
			</div>
			<div style="display: flex; flex-direction: column; gap: 16px; max-height: 70vh; overflow-y: auto; padding: 12px 16px;">
				<div class="settings-form-group">
					<label>Agent Name</label>
					<input type="text" id="agent-name" class="settings-input" value="${agent.name || ''}" placeholder="e.g. Code Architect">
				</div>
				<div class="settings-form-group">
					<label>Agent Model Configuration</label>
					<div style="display: flex; gap: 8px;">
						<select id="agent-provider" class="settings-input" style="flex: 1;">
							<option value="">(Use global default)</option>
							${modelsData.providers.map(p => `<option value="${p.name}" ${agent.agent?.llms?.main?.provider === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
						</select>
						<input type="text" id="agent-model" class="settings-input" list="model-recommendations" 
									value="${agent.agent?.llms?.main?.model || ''}" 
									placeholder="Model name" 
									style="flex: 1;">
					</div>
					<div class="setting-desc">Specific provider/model for this unique agent.</div>
				</div>
				<div class="settings-form-group">
					<label>Description</label>
					<input type="text" id="agent-desc" class="settings-input" value="${agent.description || ''}" placeholder="What is this agent specialized in?">
				</div>

				<div class="settings-form-group">
					<label>Available Tools</label>
					<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
						${toolsRes.map(tool => `
							<label style="display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer;">
								<input type="checkbox" class="tool-checkbox" value="${tool}" ${(agent.agent.tool_list || []).includes(tool) ? 'checked' : ''}>
								${tool}
							</label>
						`).join('')}
					</div>
				</div>

				<div class="settings-form-group">
					<label>System Prompt Override</label>
					<textarea id="agent-system-prompt" style="height: 100px; font-family: monospace; font-size: 11px; padding: 8px; background: rgba(0,0,0,0.3); color: #ccc;" placeholder="Leave empty for default...">${agent.agent["prompt-overrides"]?.["main-system"] || ''}</textarea>
				</div>

				<div class="settings-form-group">
					<label>Expert Advice Override</label>
					<textarea id="agent-expert-prompt" style="height: 100px; font-family: monospace; font-size: 11px; padding: 8px; background: rgba(0,0,0,0.3); color: #ccc;" placeholder="Leave empty for default...">${agent.agent["prompt-overrides"]?.["expert-advice"] || ''}</textarea>
				</div>
			</div>
			<div class="modal-footer">
				<button class="icon-btn" onclick="window.closeModal()" style="padding: 8px 16px;">Cancel</button>
				<button class="upgrade-btn" style="padding: 8px 16px;" id="agent-save-btn">Save Agent</button>
			</div>
		`;

		modalOverlay.style.display = 'flex';

		// Setup dynamic model fetching for the agent modal
		const agentProviderSelect = document.getElementById('agent-provider');
		const agentModelInput = document.getElementById('agent-model');
		if (agentProviderSelect && agentModelInput) {
			agentProviderSelect.addEventListener('change', () => fetchProviderModels(agentProviderSelect.value));
			agentModelInput.addEventListener('focus', () => fetchProviderModels(agentProviderSelect.value));
			// Pre-fetch if provider is selected
			if (agentProviderSelect.value) fetchProviderModels(agentProviderSelect.value);
		}

		document.getElementById('agent-save-btn').onclick = async () => {
			const saveBtn = document.getElementById('agent-save-btn');
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';

			const selectedTools = Array.from(document.querySelectorAll('.tool-checkbox:checked')).map(cb => cb.value);

			const payload = {
				name: document.getElementById('agent-name').value,
				description: document.getElementById('agent-desc').value,
				agent: {
					...agent.agent,
					name: document.getElementById('agent-name').value,
					tool_list: selectedTools,
					llms: {
						main: {
							provider: document.getElementById('agent-provider').value,
							model: document.getElementById('agent-model').value
						}
					},
					"prompt-overrides": {
						"main-system": document.getElementById('agent-system-prompt').value,
						"expert-advice": document.getElementById('agent-expert-prompt').value
					}
				}
			};

			try {
				const url = agentId ? `${serverUrl}/api/agents/${agentId}` : `${serverUrl}/api/agents`;
				const method = agentId ? 'PUT' : 'POST';
				await apiFetch(url, {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				window.closeModal();
				await loadAgents();
			} catch (e) {
				showNotification('Error saving agent: ' + e.message, 'error');
				saveBtn.disabled = false;
				saveBtn.textContent = 'Save Agent';
			}
		};
	}

	window.deleteAgent = async (id) => {
		window.showConfirm('Are you sure you want to delete this agent?', async () => {
			try {
				await apiFetch(`${serverUrl}/api/agents/${id}`, { method: 'DELETE' });
				await loadAgents();
			} catch (e) {
				showNotification('Failed to delete agent', 'error');
			}
		});
	}

	function renderMCPList(servers) {
		const container = document.getElementById('mcp-server-container');
		if (!container) return;

		if (!servers || servers.length === 0) {
			container.innerHTML = `
				<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 11px;">
					No MCP servers configured.
				</div>
			`;
			return;
		}

		container.innerHTML = servers.map(s => `
			<div class="glassy-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">
				<div style="display: flex; align-items: center; gap: 12px;">
					<span class="status-gem ${s.status === 'error' ? 'error' : 'active'}"></span>
					<div>
						<div style="font-size: 13px; font-weight: 600; color: #fff;">${s.alias || s.name}</div>
						<div style="font-size: 10px; color: ${s.status === 'error' ? '#ef4444' : 'var(--text-muted)'};">
							${s.version || 'v1.0.0'} • ${s.statusText || (s.status === 'error' ? 'Error' : 'Connected')}
						</div>
					</div>
				</div>
				<div style="display: flex; gap: 8px; align-items: center;">
					<span class="material-icons" style="font-size: 16px; color: var(--text-muted); cursor: pointer;" onclick="window.editMCPServer('${s.alias || s.name}')">settings</span>
					<span class="material-icons" style="font-size: 16px; color: #ef4444; cursor: pointer;" onclick="window.removeMCP('${s.alias || s.name}')">delete</span>
				</div>
			</div>
		`).join('');
	}


	function renderModelsView() {
		// 1. Render Chips
		const chipsContainer = document.getElementById('provider-chips-container');
		if (chipsContainer) {
			const localTypes = ['vllm', 'sglang', 'airllm']; // Providers that need pip setup
			if (Array.isArray(providerTypes) && providerTypes.length > 0) {
				chipsContainer.innerHTML = providerTypes.map(t => {
					const isLocal = localTypes.includes(t.type);
					const setupHtml = isLocal ? `<span class="material-icons setup-icon" onclick="event.stopPropagation(); window.setupProvider('${t.type}')" title="Auto-install dependencies in terminal">bolt</span>` : '';
					return `<div class="provider-chip ${['ollama', 'lmstudio', 'vllm', 'sglang', 'airllm'].includes(t.type) ? 'local' : 'cloud'}" 
									onclick="window.showProviderModal(null, '${t.type}')" 
									title="Quick add ${t.name}">
								${t.name} ${setupHtml}
							</div>`;
				}).join('');
			} else {
				chipsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 11px;">No provider types available from server.</div>';
			}
		}

		// 2. Render Configured Providers
		const providersList = document.getElementById('configured-providers-list');
		if (providersList) {
			const providers = Array.isArray(modelsData.providers) ? modelsData.providers : [];
			if (providers.length > 0) {
				providersList.innerHTML = providers.map(p => `
					<div class="settings-row" style="background: rgba(255,255,255,0.03);">
						<div class="setting-info">
							<div class="setting-title">${p.name}</div>
							<div class="setting-desc">${p.type} • ${p.options?.apiUrl || 'Cloud Service'}</div>
						</div>
						<div style="display: flex; gap: 4px;">
							<button class="icon-btn edit-provider-btn" data-name="${p.name}"><span class="material-icons">edit</span></button>
							<button class="icon-btn delete-provider-btn" style="color: #ff5252;" data-name="${p.name}"><span class="material-icons">delete</span></button>
						</div>
					</div>
				`).join('');

				// Attach listeners to dynamic buttons
				providersList.querySelectorAll('.edit-provider-btn').forEach(btn => {
					btn.onclick = () => window.showProviderModal(btn.dataset.name);
				});
				providersList.querySelectorAll('.delete-provider-btn').forEach(btn => {
					btn.onclick = () => window.deleteProvider(btn.dataset.name);
				});
			} else {
				providersList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 10px;">No custom providers added.</div>';
			}
		}

		// 3. Render Role Cards
		const rolesContainer = document.getElementById('llm-roles-container');
		if (rolesContainer) {
			const roles = [
				{ id: 'aux', label: 'Auxiliary Model', desc: 'Search & Summarization' },
				{ id: 'main', label: 'Main Model', desc: 'Logic & Coding' },
				{ id: 'expert', label: 'Expert Model', desc: 'Architecture & Review' },
				{ id: 'audio', label: 'Audio Engine', desc: 'Speech-to-Text & Voiceovers' },
				{ id: 'vision', label: 'Vision Engine', desc: 'SAM2 & Object Isolation' },
				{ id: 'video', label: 'Video Engine', desc: 'Timeline Operations & Scripts' }
			];

			rolesContainer.innerHTML = roles.map(role => `
				<div class="llm-config-card">
					<div class="setting-info">
						<div class="setting-title">${role.label}</div>
						<div class="setting-desc">${role.desc}</div>
					</div>
					<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
						<select id="role-${role.id}-provider" style="font-size: 12px; padding: 6px; border-radius: 4px; border: 1px solid #3c3c3c; background: #1e1e1e; color: #fff;">
							<option value="">-- Select Provider --</option>
							${modelsData.providers.map(p => `
								<option value="${p.name}" ${modelsData.llmConfig?.[role.id]?.provider === p.name ? 'selected' : ''}>
									${p.name} ${p.options?.isSystem ? '(System)' : ''}
								</option>
							`).join('')}
						</select>
						<input type="text" id="role-${role.id}-model" list="model-recommendations" 
									value="${modelsData.current?.[role.id] || modelsData.llmConfig?.[role.id]?.model || ''}" 
									placeholder="Select or type model name" 
									autocomplete="off"
									style="font-size: 12px; padding: 6px;">
					</div>
				</div>
			`).join('');

			// Add event listeners for provider changes to refresh model lists
			roles.forEach(role => {
				const providerSelect = document.getElementById(`role-${role.id}-provider`);
				const modelInput = document.getElementById(`role-${role.id}-model`);

				if (providerSelect && modelInput) {
					// Initial load for this role
					if (providerSelect.value) {
						fetchProviderModels(providerSelect.value);
					}

					providerSelect.onchange = () => {
						console.log(`[CoderX] Provider changed for role ${role.id}: ${providerSelect.value}`);
						fetchProviderModels(providerSelect.value);
					};

					// Also fetch when input gets focus to ensure datalist is fresh
					modelInput.onfocus = () => {
						if (providerSelect.value) fetchProviderModels(providerSelect.value);
					};
				}
			});
		}
	}

	async function refreshAllProviderModels() {
		if (modelsData.providers && Array.isArray(modelsData.providers)) {
			modelsData.providers.forEach(p => fetchProviderModels(p.name));
		}
	}

	async function fetchProviderModels(providerName) {
		if (!providerName) return;

		console.log(`[CoderX] Refreshing model list for provider: ${providerName}`);
		// Find provider object in current modelsData
		const providerObj = Array.isArray(modelsData.providers) ? modelsData.providers.find(p => p.name === providerName) : null;
		if (!providerObj) return;

		const apiUrl = providerObj?.options?.apiUrl || '';
		const isLocal = apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1') || apiUrl.includes('192.168.') || apiUrl.includes('10.');

		if (isLocal) {
			console.log(`[CoderX] Fetching local models directly via Extension Host for: ${providerName}`);
			const requestId = 'list-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
			const listListener = (event) => {
				const msg = event.data;
				if (msg.type === 'toolResult' && msg.requestId === requestId) {
					window.removeEventListener('message', listListener);
					const res = msg.result;
					if (res && res.body) {
						console.log(`[CoderX] Local fetch result for ${providerName}:`, res.body);

						// Check if the response itself is an error object
						if (res.body.error) {
							console.error(`[CoderX] Provider ${providerName} returned error:`, res.body.error);
							return;
						}

						let models = [];
						if (providerObj.type === 'ollama') {
							models = (res.body.models || []).map(m => m.name || m);
						} else {
							// OpenAI compatible (lmstudio, vllm, sglang, airllm)
							const dataArray = res.body.data || res.body.models || (Array.isArray(res.body) ? res.body : []);
							if (Array.isArray(dataArray)) {
								models = dataArray.map(m => {
									if (typeof m === 'string') return m;
									if (m && typeof m === 'object') {
										return m.id || m.name || m.model || JSON.stringify(m);
									}
									return String(m);
								});
							}
						}

						if (models.length > 0) {
							console.log(`[CoderX] Discovered ${models.length} models for ${providerName} locally.`);
							// Update global state
							const idx = modelsData.providers.findIndex(p => p.name === providerName);
							if (idx !== -1) {
								modelsData.providers[idx].models = models;
								persistSessionState();

								// Refresh Chat UI menu
								if (lastModelInfo) {
									renderModelMenu(lastModelInfo);
								} else {
									renderModelMenu(modelsData);
								}
							}
							updateModelRecommendations(models);
						} else {
							console.warn(`[CoderX] No models found in local response for ${providerName}`, res.body);
						}
					} else if (res && res.error) {
						console.error(`[CoderX] Local fetch error for ${providerName}:`, res.error);
					}
				}
			};
			window.addEventListener('message', listListener);

			// Robust URL construction
			let baseUrl = apiUrl.replace(/\/+$/, '');

			const isOllama = providerObj.type === 'ollama';

			let endpoint = '';
			if (isOllama) {
				if (!baseUrl.endsWith('/api/tags') && !baseUrl.endsWith('/tags')) {
					endpoint = baseUrl.includes('/api') ? '/tags' : '/api/tags';
				}
			} else {
				// OpenAI compatible (LMStudio, vLLM, etc.)
				if (!baseUrl.endsWith('/v1/models') && !baseUrl.endsWith('/models')) {
					endpoint = baseUrl.endsWith('/v1') ? '/models' : '/v1/models';
				}
			}
			const fetchUrl = baseUrl + endpoint;
			console.log(`[CoderX] Local fetch URL: ${fetchUrl}`);

			// Prepare headers (including API key if provided)
			const headers = { 'Accept': 'application/json' };
			if (providerObj.options?.apiKey) {
				headers['Authorization'] = `Bearer ${providerObj.options.apiKey}`;
			}

			vscode.postMessage({
				type: 'executeLocalTool',
				toolName: 'fetch',
				args: {
					url: fetchUrl,
					method: 'GET',
					headers
				},
				requestId
			});
			return;
		}

		const payload = { type: providerObj.type, options: providerObj.options };
		try {
			const res = await apiFetch(`${serverUrl}/api/settings/list-models`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...payload, socketId: socket?.id })
			});

			if (res.ok) {
				const data = await res.json();
				const models = data.models || [];

				// Update global state
				const idx = modelsData.providers.findIndex(p => p.name === providerName);
				if (idx !== -1) {
					modelsData.providers[idx].models = models;
					persistSessionState();
					if (lastModelInfo) renderModelMenu(lastModelInfo);
				}

				updateModelRecommendations(models);
			}
		} catch (e) {
			console.error('Failed to fetch provider models:', e);
		}
	}

	function updateModelRecommendations(models) {
		console.log(`[CoderX] Updating model recommendations with ${models?.length || 0} models:`, models);
		let datalist = document.getElementById('model-recommendations');
		if (!datalist) {
			datalist = document.createElement('datalist');
			datalist.id = 'model-recommendations';
			document.body.appendChild(datalist);
		}

		// Always clear the datalist entirely so it ONLY shows models 
		// for the currently selected/focused provider.
		datalist.innerHTML = '';

		if (models && models.length > 0) {
			models.forEach(m => {
				const option = document.createElement('option');
				option.value = m;
				datalist.appendChild(option);
			});
		}
	}

	window.showProviderModal = (providerName = null, defaultType = null) => {
		const modalOverlay = document.getElementById('modal-overlay');
		const modalContent = modalOverlay.querySelector('.modal-content');
		const provider = providerName ? modelsData.providers.find(p => p.name === providerName) : null;

		modalContent.innerHTML = `
			<div class="modal-header">
				<span class="material-icons">settings_input_component</span>
				<span>${provider ? 'Edit' : 'Add'} Provider</span>
			</div>
			<div style="display: flex; flex-direction: column; gap: 12px;">
				<div class="settings-form-group">
					<label>Provider Name</label>
					<input type="text" id="modal-provider-name" value="${provider ? provider.name : ''}" placeholder="e.g. My Custom OpenAI">
				</div>
				<div class="settings-form-group">
					<label>Provider Type</label>
					<select id="modal-provider-type">
						${providerTypes.map(t => `<option value="${t.type}" ${provider && provider.type === t.type ? 'selected' : ''}>${t.name}</option>`).join('')}
					</select>
				</div>
				<div class="settings-form-group">
					<label>API Key</label>
					<input type="password" id="modal-provider-key" value="${provider ? (provider.options?.apiKey || '') : ''}" placeholder="sk-...">
				</div>
				<div class="settings-form-group">
					<label>API URL</label>
					<input type="text" id="modal-provider-url" value="${provider ? (provider.options?.apiUrl || '') : ''}" placeholder="https://api.openai.com/v1">
				</div>
				<div id="test-result" style="font-size: 11px; padding: 4px; display: none; border-radius: 4px;"></div>
			</div>
			<div class="modal-footer">
				<button class="icon-btn" id="modal-test-btn" style="padding: 8px 12px; margin-right: auto;">
					<span class="material-icons">network_check</span> Test
				</button>
				<button class="icon-btn" onclick="window.closeModal()" style="padding: 8px 16px;">Cancel</button>
				<button class="upgrade-btn" style="padding: 8px 16px;" id="modal-save-btn">Save Provider</button>
			</div>
		`;

		modalOverlay.style.display = 'flex';

		const typeSelect = document.getElementById('modal-provider-type');
		const urlInput = document.getElementById('modal-provider-url');
		const testBtn = document.getElementById('modal-test-btn');
		const testResult = document.getElementById('test-result');

		const updateDefaults = (type) => {
			if (type === 'ollama') urlInput.value = 'http://localhost:11434';
			else if (type === 'vllm') urlInput.value = 'http://localhost:8000/v1';
			else if (type === 'sglang') urlInput.value = 'http://localhost:30000/v1';
			else if (type === 'lmstudio') urlInput.value = 'http://localhost:1234/api/v1';
		};

		if (defaultType) {
			typeSelect.value = defaultType;
			updateDefaults(defaultType);
		}

		typeSelect.onchange = () => updateDefaults(typeSelect.value);

		testBtn.onclick = async () => {
			testBtn.innerHTML = '<span class="material-icons rotating">sync</span> Testing...';
			testResult.style.display = 'none';

			const mode = typeSelect.value === 'huggingface' ? (document.querySelector('.hf-mode-card.active')?.dataset.mode || 'api') : 'api';
			const apiUrl = urlInput.value || '';
			const isLocal = apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1') || apiUrl.includes('192.168.') || apiUrl.includes('10.');

			if (isLocal) {
				console.log(`[CoderX] Testing LOCAL connection directly via Extension Host: ${apiUrl}`);
				const requestId = 'test-' + Date.now();
				const testListener = (event) => {
					const msg = event.data;
					if (msg.type === 'toolResult' && msg.requestId === requestId) {
						window.removeEventListener('message', testListener);
						const res = msg.result;
						if (res && !res.error) {
							testResult.style.display = 'block';
							testResult.innerHTML = `<span style="color: #4ade80;">● Connected to local AI successfully!</span>`;
							testResult.style.background = 'rgba(74, 222, 128, 0.1)';
						} else {
							testResult.style.display = 'block';
							testResult.innerHTML = `<span style="color: #ef4444;">● Local Connection Failed: ${res?.error || 'Unknown error'}</span>`;
							testResult.style.background = 'rgba(239, 68, 68, 0.1)';
						}
						testBtn.innerHTML = '<span class="material-icons">network_check</span> Test';
					}
				};
				window.addEventListener('message', testListener);
				let testBaseUrl = apiUrl.replace(/\/+$/, '');
				const isOllama = typeSelect.value === 'ollama' || testBaseUrl.includes(':11434');
				let isLMStudio = typeSelect.value === 'lmstudio' || testBaseUrl.includes(':1234');

				if (isLMStudio && !testBaseUrl.includes('/api/')) {
					if (testBaseUrl.endsWith('/v1')) {
						testBaseUrl = testBaseUrl.replace(/\/v1$/, '/api/v1');
					} else {
						testBaseUrl = testBaseUrl + '/api/v1';
					}
				}

				let testEndpoint = '';
				if (isOllama) {
					testEndpoint = testBaseUrl.includes('/api') ? '/tags' : '/api/tags';
				} else {
					if (testBaseUrl.endsWith('/v1/models') || testBaseUrl.endsWith('/models')) {
						testEndpoint = '';
					} else if (testBaseUrl.endsWith('/v1')) {
						testEndpoint = '/models';
					} else {
						testEndpoint = '/v1/models';
					}
				}
				const testUrl = testBaseUrl.replace(/\/+$/, '') + testEndpoint;

				vscode.postMessage({
					type: 'executeLocalTool',
					toolName: 'fetch',
					args: {
						url: testUrl,
						method: 'GET'
					},
					requestId
				});
				return;
			}

			try {
				const res = await apiFetch(`${serverUrl}/api/settings/test-connection`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: typeSelect.value,
						socketId: socket?.id,
						options: {
							apiKey: document.getElementById('modal-provider-key').value,
							apiUrl: urlInput.value,
							mode: mode
						}
					})
				});
				const data = await res.json();

				testResult.style.display = 'block';
				if (res.ok) {
					testResult.innerHTML = `<span style="color: #4ade80;">● ${data.message}</span>`;
					testResult.style.background = 'rgba(74, 222, 128, 0.1)';
					// Re-render views if needed
				} else {
					testResult.innerHTML = `<span style="color: #ef4444;">● ${data.error || 'Connection failed'}</span>`;
					testResult.style.background = 'rgba(239, 68, 68, 0.1)';
				}
			} catch (e) {
				testResult.style.display = 'block';
				testResult.innerHTML = `<span style="color: #ef4444;">● Error: ${e.message}</span>`;
			} finally {
				testBtn.innerHTML = '<span class="material-icons">network_check</span> Test';
			}
		};

		// specialized UI for Huggingface
		window.switchHFMode = (mode) => {
			document.querySelectorAll('.hf-mode-card').forEach(c => c.classList.remove('active'));
			document.querySelector(`.hf-mode-card[data-mode="${mode}"]`).classList.add('active');

			const apiFields = document.getElementById('hf-api-fields');
			const localFields = document.getElementById('hf-local-fields');

			if (mode === 'api') {
				apiFields.style.display = 'block';
				localFields.style.display = 'none';
			} else {
				apiFields.style.display = 'none';
				localFields.style.display = 'block';
			}
		};

		if (typeSelect.value === 'huggingface') {
			// Inject specialized HF UI
			const hfContainer = document.createElement('div');
			hfContainer.innerHTML = `
				<div class="hf-mode-container">
					<div class="hf-mode-card active" data-mode="api" onclick="window.switchHFMode('api')">
						<span class="material-icons">cloud</span>
						<div class="hf-mode-title">Inference API</div>
						<div class="hf-mode-desc">Serverless & Fast</div>
					</div>
					<div class="hf-mode-card" data-mode="local" onclick="window.switchHFMode('local')">
						<span class="material-icons">computer</span>
						<div class="hf-mode-title">Transformers</div>
						<div class="hf-mode-desc">Local GPU/CPU</div>
					</div>
				</div>
				<div id="hf-api-fields">
					<!-- Standard fields already exist -->
				</div>
				<div id="hf-local-fields" style="display: none; padding: 12px; background: rgba(124, 77, 255, 0.05); border-radius: 8px; border: 1px dashed rgba(124, 77, 255, 0.2);">
					<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">Requires Python, Torch and Transformers.</div>
					<button class="upgrade-btn" style="width: 100%; justify-content: center;" onclick="window.setupProvider('transformers')">
						<span class="material-icons">bolt</span> Auto-Setup Environment
					</button>
				</div>
			`;
			const formContainer = modalContent.querySelector('div[style*="flex-direction: column"]');
			formContainer.insertBefore(hfContainer, formContainer.children[2]);

			// Hide standard fields initially if it was local (but default is API)
			if (provider && provider.options?.mode === 'local') {
				window.switchHFMode('local');
			}
		}


		document.getElementById('modal-save-btn').onclick = () => saveProvider(providerName);
	};

	window.closeModal = () => {
		document.getElementById('modal-overlay').style.display = 'none';
	};

	function saveProvider(oldName) {
		const name = document.getElementById('modal-provider-name').value;
		const type = document.getElementById('modal-provider-type').value;
		const apiKey = document.getElementById('modal-provider-key').value;
		const apiUrl = document.getElementById('modal-provider-url').value;

		if (!name) return showNotification('Provider name is required', 'error');

		const newProvider = {
			name,
			type,
			options: { apiKey, apiUrl }
		};

		if (oldName) {
			const idx = modelsData.providers.findIndex(p => p.name === oldName);
			modelsData.providers[idx] = newProvider;
		} else {
			modelsData.providers.push(newProvider);
		}

		renderModelsView();
		window.closeModal();

		// Automatically persist to backend so the user doesn't lose it if they exit immediately
		saveAllModelsSettings();
	}

	window.deleteProvider = (name) => {
		window.showConfirm(`Delete provider "${name}"?`, () => {
			modelsData.providers = modelsData.providers.filter(p => p.name !== name);
			renderModelsView();
			saveAllModelsSettings();
		});
	}

	async function saveAllModelsSettings() {
		const btn = document.getElementById('btn-save-settings');
		if (btn) {
			btn.textContent = 'Saving...';
			btn.disabled = true;
		}

		const roles = ['main', 'expert', 'aux', 'audio', 'vision', 'video'];
		const llmConfig = {};

		roles.forEach(role => {
			const provElem = document.getElementById(`role-${role}-provider`);
			const modElem = document.getElementById(`role-${role}-model`);
			if (provElem && modElem) {
				llmConfig[role] = {
					provider: provElem.value,
					model: modElem.value
				};
			} else if (modelsData.llmConfig && modelsData.llmConfig[role]) {
				llmConfig[role] = modelsData.llmConfig[role];
			}
		});

		modelsData.current = {
			main: llmConfig.main?.model || '',
			expert: llmConfig.expert?.model || '',
			aux: llmConfig.aux?.model || '',
			audio: llmConfig.audio?.model || '',
			vision: llmConfig.vision?.model || '',
			video: llmConfig.video?.model || ''
		};
		modelsData.llmConfig = llmConfig;

		// Save to localStorage (offline-first)
		const saveData = {
			providers: modelsData.providers,
			llmConfig: llmConfig,
			current: modelsData.current
		};
		localStorage.setItem('codix_llm_settings', JSON.stringify(saveData));

		// Sync to extension host via postMessage
		vscode.postMessage({
			type: 'saveLLMSettings',
			settings: saveData
		});

		console.log('[Codix] LLM settings saved:', modelsData.providers.length, 'providers');

		if (btn) {
			btn.textContent = '✓ Saved!';
			setTimeout(() => { 
				btn.textContent = 'Save Changes'; 
				btn.disabled = false; 
				if (typeof window.toggleSettings === 'function') {
					window.toggleSettings();
				}
			}, 800);
		}
	}

	window.addMCPServer = () => window.editMCPServer();

	window.editMCPServer = (serverName = null) => {
		const modalOverlay = document.getElementById('modal-overlay');
		const modalContent = modalOverlay.querySelector('.modal-content');

		const settingsRaw = localStorage.getItem('coderx_settings');
		const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
		const servers = settings.mcpServers ? (typeof settings.mcpServers === 'string' ? JSON.parse(settings.mcpServers) : settings.mcpServers) : [];

		const existing = serverName ? servers.find(s => s.name === serverName) : null;
		const server = existing || { name: '', command: '', args: [], env: {} };

		modalContent.innerHTML = `
			<div class="modal-header">
				<span class="material-icons" style="color: #7c4dff;">extension</span>
				<span style="font-weight: 600;">${serverName ? 'Edit' : 'Add'} MCP Server</span>
				<div style="flex: 1;"></div>
				<button class="icon-btn" onclick="window.closeModal()"><span class="material-icons">close</span></button>
			</div>
			<div style="display: flex; flex-direction: column; gap: 16px; padding: 12px 16px;">
				<div class="settings-form-group">
					<label>Server Name</label>
					<input type="text" id="mcp-name" class="settings-input" value="${server.name}" placeholder="e.g. filesystem" ${serverName ? 'disabled' : ''}>
				</div>
				<div class="settings-form-group">
					<label>Command</label>
					<input type="text" id="mcp-command" class="settings-input" value="${server.command}" placeholder="e.g. npx">
				</div>
				<div class="settings-form-group">
					<label>Arguments (comma separated)</label>
					<input type="text" id="mcp-args" class="settings-input" value="${server.args.join(', ')}" placeholder="e.g. @modelcontextprotocol/server-filesystem, /path/to/allow">
				</div>
				<div class="settings-form-group">
					<label>Environment Variables (JSON)</label>
					<textarea id="mcp-env" class="settings-input" style="height: 60px; font-family: monospace;">${JSON.stringify(server.env || {})}</textarea>
				</div>
			</div>
			<div class="modal-footer">
				<button class="icon-btn" onclick="window.closeModal()" style="padding: 8px 16px;">Cancel</button>
				<button class="upgrade-btn" style="padding: 8px 16px;" id="mcp-save-btn">Save Server</button>
			</div>
		`;

		modalOverlay.style.display = 'flex';

		document.getElementById('mcp-save-btn').onclick = () => {
			const name = document.getElementById('mcp-name').value;
			const command = document.getElementById('mcp-command').value;
			const argsRaw = document.getElementById('mcp-args').value;
			const envRaw = document.getElementById('mcp-env').value;

			if (!name || !command) {
				showNotification('Name and Command are required', 'error');
				return;
			}

			let env = {};
			try {
				env = JSON.parse(envRaw);
			} catch (e) {
				showNotification('Invalid JSON in Environment Variables', 'error');
				return;
			}

			const newServer = {
				name,
				command,
				args: argsRaw ? argsRaw.split(',').map(a => a.trim()).filter(a => a) : [],
				env
			};

			if (serverName) {
				const idx = servers.findIndex(s => s.name === serverName);
				if (idx !== -1) servers[idx] = newServer;
			} else {
				if (servers.find(s => s.name === name)) {
					showNotification('Server with this name already exists', 'error');
					return;
				}
				servers.push(newServer);
			}

			settings.mcpServers = JSON.stringify(servers);
			localStorage.setItem('coderx_settings', JSON.stringify(settings));

			window.closeModal();
			document.getElementById('btn-save-settings')?.click();
			renderModelsView();
		};
	};

	window.removeMCP = async (name) => {
		window.showConfirm(`Delete MCP server ${name}?`, async () => {
			let settings = {};
			try {
				const settingsRaw = localStorage.getItem('coderx_settings');
				settings = settingsRaw ? JSON.parse(settingsRaw) : {};
			} catch (e) { }

			let servers = settings.mcpServers ? (typeof settings.mcpServers === 'string' ? JSON.parse(settings.mcpServers) : settings.mcpServers) : [];
			servers = servers.filter(s => s.name !== name);

			settings.mcpServers = JSON.stringify(servers);
			localStorage.setItem('coderx_settings', JSON.stringify(settings));

			// Force a save to server immediately
			const saveBtn = document.getElementById('btn-save-settings');
			if (saveBtn) {
				saveBtn.click();
			} else {
				// Fallback: trigger render which eventually syncs
				renderModelsView();
			}
		});
	};

	window.addS3Config = () => window.editS3Config();

	window.editS3Config = (bucketName = null) => {
		const modalOverlay = document.getElementById('modal-overlay');
		const modalContent = modalOverlay.querySelector('.modal-content');

		const settingsRaw = localStorage.getItem('coderx_settings');
		const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
		const configs = settings.s3_configs ? (typeof settings.s3_configs === 'string' ? JSON.parse(settings.s3_configs) : settings.s3_configs) : [];

		const existing = bucketName ? configs.find(c => c.bucket === bucketName) : null;
		const config = existing || { bucket: '', region: 'us-east-1', accessKey: '', secretKey: '', endpoint: '' };

		modalContent.innerHTML = `
			<div class="modal-header">
				<span class="material-icons" style="color: #7c4dff;">cloud</span>
				<span style="font-weight: 600;">${bucketName ? 'Edit' : 'Add'} Cloud Storage</span>
				<div style="flex: 1;"></div>
				<button class="icon-btn" onclick="window.closeModal()"><span class="material-icons">close</span></button>
			</div>
			<div style="display: flex; flex-direction: column; gap: 16px; padding: 12px 16px;">
				<div class="settings-form-group">
					<label>Bucket Name</label>
					<input type="text" id="s3-bucket" class="settings-input" value="${config.bucket}" placeholder="e.g. my-assets" ${bucketName ? 'disabled' : ''}>
				</div>
				<div class="settings-form-group">
					<label>Region</label>
					<input type="text" id="s3-region" class="settings-input" value="${config.region}" placeholder="e.g. us-east-1">
				</div>
				<div class="settings-form-group">
					<label>Access Key ID</label>
					<input type="text" id="s3-access-key" class="settings-input" value="${config.accessKey}" placeholder="Your AWS Access Key">
				</div>
				<div class="settings-form-group">
					<label>Secret Access Key</label>
					<input type="password" id="s3-secret-key" class="settings-input" value="${config.secretKey}" placeholder="Your AWS Secret Key">
				</div>
				<div class="settings-form-group">
					<label>Endpoint URL (Optional)</label>
					<input type="text" id="s3-endpoint" class="settings-input" value="${config.endpoint || ''}" placeholder="e.g. https://r2.cloudflare.com">
				</div>
			</div>
			<div class="modal-footer">
				<button class="icon-btn" onclick="window.closeModal()" style="padding: 8px 16px;">Cancel</button>
				<button class="upgrade-btn" style="padding: 8px 16px;" id="s3-save-btn">Save Storage</button>
			</div>
		`;

		modalOverlay.style.display = 'flex';

		document.getElementById('s3-save-btn').onclick = () => {
			const bucket = document.getElementById('s3-bucket').value;
			const region = document.getElementById('s3-region').value;
			const accessKey = document.getElementById('s3-access-key').value;
			const secretKey = document.getElementById('s3-secret-key').value;
			const endpoint = document.getElementById('s3-endpoint').value;

			if (!bucket || !accessKey || !secretKey) {
				showNotification('Bucket, Access Key, and Secret Key are required', 'error');
				return;
			}

			const newConfig = { bucket, region, accessKey, secretKey, endpoint };

			if (bucketName) {
				const idx = configs.findIndex(c => c.bucket === bucketName);
				if (idx !== -1) configs[idx] = newConfig;
			} else {
				if (configs.find(c => c.bucket === bucket)) {
					showNotification('Configuration for this bucket already exists', 'error');
					return;
				}
				configs.push(newConfig);
			}

			settings.s3_configs = JSON.stringify(configs);
			localStorage.setItem('coderx_settings', JSON.stringify(settings));

			window.closeModal();
			document.getElementById('btn-save-settings')?.click();
			renderS3List(configs); // Refresh UI immediately
		};
	};

	window.removeS3 = async (bucket) => {
		window.showConfirm(`Delete S3 configuration for ${bucket}?`, () => {
			let settings = {};
			try {
				const settingsRaw = localStorage.getItem('coderx_settings');
				settings = settingsRaw ? JSON.parse(settingsRaw) : {};
			} catch (e) { }

			let configs = settings.s3_configs ? (typeof settings.s3_configs === 'string' ? JSON.parse(settings.s3_configs) : settings.s3_configs) : [];
			configs = configs.filter(c => c.bucket !== bucket);

			settings.s3_configs = JSON.stringify(configs);
			localStorage.setItem('coderx_settings', JSON.stringify(settings));

			const saveBtn = document.getElementById('btn-save-settings');
			if (saveBtn) {
				saveBtn.click();
			}

			renderS3List(configs); // Refresh UI immediately
		});
	};

	window.createAgent = () => window.showAgentModal();

	window.deleteAgent = async (id, name) => {
		window.showConfirm(`Are you sure you want to delete the agent '${name}'?`, async () => {
			try {
				await apiFetch(`${serverUrl}/api/agents/${id}`, { method: 'DELETE' });
				await renderAgentsView();
			} catch (err) { }
		});
	};

	window.openAgent = (id) => {
		// Normally this would open configuration, but we just alert for now since there's no edit form
		vscode.postMessage({ type: 'executeLocalTool', toolName: 'Custom', args: { msg: `Selected agent ${id}` }, requestId: 'open_agent_' + id, sessionId: currentSessionId });
	};

	// Make switchSession globally available to the inline onClick handlers
	window.switchSession = (sessionId) => {
		if (socket && currentProjectId) {
			socket.emit('join_session', { sessionId, projectId: currentProjectId });
			const chatView = document.getElementById('chat-view');
			const featureView = document.getElementById('feature-view');
			if (chatView && featureView) {
				featureView.style.display = 'none';
				chatView.style.display = 'block';
			}
		}
	};

	const contextActionFiles = document.getElementById('context-action-files');
	if (contextActionFiles) {
		contextActionFiles.onclick = (e) => {
			e.stopPropagation();
			closeAllMenus();
			removeAtChar();

			const searchPopover = document.getElementById('menu-search-files');
			const localSearchInput = document.getElementById('file-search-input');
			const searchResults = document.getElementById('search-results-list');

			if (searchPopover) searchPopover.style.display = 'flex';
			if (localSearchInput) { localSearchInput.value = ''; localSearchInput.focus(); }
			if (searchResults) searchResults.innerHTML = '';
		};
	}

	// Context meta items
	const setupContextAction = (id, label) => {
		const el = document.getElementById(id);
		if (el) {
			el.onclick = (e) => {
				e.stopPropagation();
				closeAllMenus();
				removeAtChar();
				// Add a "meta context" chip rather than a real file
				vscode.postMessage({ type: 'addMetaContext', label: label });
			};
		}
	};
	setupContextAction('context-action-codebase', 'Codebase');
	setupContextAction('context-action-active-file', 'Active File');
	setupContextAction('context-action-git-diff', 'Git Diff');
	setupContextAction('context-action-terminal', 'Terminal');
	setupContextAction('context-action-problems', 'Problems');
	setupContextAction('context-action-folder', 'Folder');
	setupContextAction('context-action-url', 'URL');

	// Search Filtering
	let searchTimeout;
	if (fileSearchInput) {
		fileSearchInput.addEventListener('input', () => {
			clearTimeout(searchTimeout);
			const query = fileSearchInput.value.trim();
			if (query.length < 2) {
				if (searchResultsList) searchResultsList.innerHTML = '<div style="padding: 12px; color: #888; font-size: 12px; text-align: center;">Type to search files...</div>';
				return;
			}
			searchTimeout = setTimeout(() => {
				vscode.postMessage({ type: 'searchFiles', query: query });
			}, 300);
		});
	}

	function getFileIcon(filename) {
		const ext = filename.split('.').pop().toLowerCase();
		const icons = {
			'js': '<span class="material-icons" style="color: #f7df1e;">code</span>',
			'ts': '<span class="material-icons" style="color: #007acc;">code</span>',
			'py': '<span class="material-icons" style="color: #3776ab;">code</span>',
			'json': '<span class="material-icons" style="color: #f59e0b;">settings</span>',
			'php': '<span class="material-icons" style="color: #777bb4;">code</span>',
			'html': '<span class="material-icons" style="color: #e34f26;">html</span>',
			'css': '<span class="material-icons" style="color: #1572b6;">style</span>',
			'md': '<span class="material-icons" style="color: #a3a3a3;">description</span>'
		};
		return icons[ext] || '<span class="material-icons">insert_drive_file</span>';
	}

	function addContextChip(fileData) {
		const name = typeof fileData === 'string' ? fileData : fileData.name;
		const path = typeof fileData === 'string' ? '' : fileData.path;

		const pillId = `pill-${name.replace(/[^a-z0-9]/gi, '_')}`;
		if (document.getElementById(pillId)) return;

		const pill = document.createElement('div');
		pill.id = pillId;
		pill.className = 'file-pill';
		pill.innerHTML = `
			<span class="file-icon">${getFileIcon(name)}</span>
			<span>${name}</span>
			<span class="material-icons pin-btn" title="Pin to context">push_pin</span>
			<span class="material-icons close-btn" title="Remove">close</span>
		`;

		pill.querySelector('.close-btn').onclick = (e) => {
			e.stopPropagation();
			pill.remove();
			attachedContextFiles.delete(name);
		};

		pill.querySelector('.pin-btn').onclick = (e) => {
			e.stopPropagation();
			pill.classList.toggle('pinned');
		};

		pill.onclick = () => {
			vscode.postMessage({ type: 'openFile', fileName: name });
		};

		const addBtn = document.getElementById('add-context-btn');
		if (addBtn) addBtn.parentNode.insertBefore(pill, null);
		attachedContextFiles.add(name);
	}

	function renderSearchResults(results) {
		if (!searchResultsList) return;
		searchResultsList.innerHTML = '';

		const openEditors = results.filter(r => r.isOpen);
		const allFiles = results.filter(r => !r.isOpen);

		if (openEditors.length > 0) {
			const header = document.createElement('div');
			header.className = 'search-category';
			header.textContent = 'Open editors';
			searchResultsList.appendChild(header);
			openEditors.forEach(res => searchResultsList.appendChild(createSearchItem(res)));
		}

		if (allFiles.length > 0) {
			const header = document.createElement('div');
			header.className = 'search-category';
			header.textContent = 'All files';
			searchResultsList.appendChild(header);
			allFiles.forEach(res => searchResultsList.appendChild(createSearchItem(res)));
		}
	}

	function createSearchItem(res) {
		const item = document.createElement('div');
		item.className = 'search-result-item';
		item.innerHTML = `
			<div style="display: flex; align-items: center; gap: 8px;">
				${getFileIcon(res.name)}
				<div style="display: flex; flex-direction: column;">
					<span style="font-size: 13px;">${res.name}</span>
					<span style="font-size: 10px; opacity: 0.5;">${res.relative || res.path}</span>
				</div>
			</div>
		`;
		item.onclick = () => {
			addContextChip(res);
			closeAllMenus();
			if (fileSearchInput) fileSearchInput.value = '';
		};
		return item;
	}

	window.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); newSessionBtn.click(); }
		if (e.key === 'Escape') closeAllMenus();
	});

	document.addEventListener('click', closeAllMenus);

	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'userInfo') {
			const displayAvatar = document.getElementById('user-avatar');
			const displayName = document.getElementById('user-display-name');
			const displayNameText = document.getElementById('user-name-text');

			if (displayName) displayName.textContent = message.name || 'User';
			if (displayNameText) displayNameText.textContent = message.name || 'User';

			if (displayAvatar) {
				const placeholder = document.getElementById('user-avatar-placeholder');
				const footerImg = document.getElementById('footer-avatar-img');
				const footerIcon = document.getElementById('footer-avatar-icon');

				if (message.isAuthenticated && message.avatar) {
					displayAvatar.src = message.avatar;
					displayAvatar.style.display = 'block';
					if (placeholder) placeholder.style.display = 'none';

					if (footerImg) {
						footerImg.src = message.avatar;
						footerImg.style.display = 'block';
					}
					if (footerIcon) footerIcon.style.display = 'none';
				} else {
					displayAvatar.src = '';
					displayAvatar.style.display = 'none';
					if (placeholder) placeholder.style.display = 'block';

					if (footerImg) {
						footerImg.src = '';
						footerImg.style.display = 'none';
					}
					if (footerIcon) footerIcon.style.display = 'block';
				}
			}
		}

		if (message.type === 'syncWorkspace') {
			workspacePath = message.path;
			persistSessionState();
			if (socket && currentSessionId) {
				socket.emit('set_working_directory', { sessionId: currentSessionId, directory: workspacePath });
			}
		}
		if (message.type === 'search_results') renderSearchResults(message.results);
		if (message.type === 'updateOpenFiles') {
			const container = document.getElementById('open-files-container');
			if (!container) return;
			const addBtn = container.querySelector('#add-context-btn');
			container.innerHTML = '';
			if (addBtn) container.appendChild(addBtn);
			(message.fileNames || []).forEach(name => addContextChip(name));
		}

		if (message.type === 'toolResult') {
			console.log(`[CoderX] Relaying toolResult to server. RequestId: ${message.requestId}`, message.result);
			if (socket) {
				// Determine which event to use based on requestId prefix or content
				const eventName = message.requestId.startsWith('fetch_') ? 'fetch_relay_result' : 'vscode_tool_result';
				const payload = eventName === 'fetch_relay_result' ? { requestId: message.requestId, response: message.result } : { requestId: message.requestId, result: message.result };

				socket.emit(eventName, payload);
			}

			if (activeTerminalBlocks[message.requestId]) {
				const { msgEl, command, toolName } = activeTerminalBlocks[message.requestId];
				const res = message.result;
				const isTerminal = ['run_command', 'Bash', 'VSCodeTerminal'].includes(toolName);

				const outEl = msgEl.querySelector(`#term-out-${message.requestId}`);
				if (outEl) {
					if (isTerminal) {
						let fullLog = '';
						if (res && res.stdout) fullLog += `${res.stdout}`;
						if (res && res.stderr) fullLog += `\n${res.stderr}`;
						if (res && res.error) fullLog += `\nError: ${res.error}`;

						if (fullLog.trim()) {
							const grammar = Prism.languages.bash || Prism.languages.javascript || Prism.languages.markup;
							outEl.innerHTML = Prism.highlight(fullLog.trim(), grammar, grammar === Prism.languages.bash ? 'bash' : 'text');
						} else {
							outEl.innerHTML = '<span style="opacity:0.5;">(Done)</span>';
						}
					} else if (res && res.error) {
						outEl.innerHTML = `<span style="color: #EF5350;">✗ ${res.error}</span>`;
					} else if (res && res.content) {
						const preview = res.content.substring(0, 120).replace(/</g, '&lt;');
						outEl.innerHTML = `<span style="color: #81C784;">✓</span> <span style="opacity:0.6;">${preview}${res.content.length > 120 ? '...' : ''}</span>`;
					} else {
						outEl.innerHTML = '<span style="color: #81C784;">✓ Done</span>';
					}
					outEl.style.color = '#d4d4d4';
				}

				delete activeTerminalBlocks[message.requestId];
				const stillActive = Object.values(activeTerminalBlocks).some(b => b.msgEl === msgEl);
				if (!stillActive) {
					const spinner = msgEl.querySelector('.terminal-spinner');
					if (spinner) spinner.style.display = 'none';
				}
			}
		}
	});

	window.closeAllMenus = closeAllMenus;

	vscode.postMessage({ type: 'webviewReady' });
	handshakeAndInit();

	// Initialize Plugin Catalog
	if (typeof fetchPluginsFromMarket === 'function') {
		fetchPluginsFromMarket();
	}

	// --- UNIFIED AI MODEL SELECTOR POPOVER ---
	let vibeActiveTab = localStorage.getItem('vibe_ai_mode') || 'cloud';

	function initVibeModelSelector() {
		const pill = document.getElementById('vibe-model-selector-pill');
		const popover = document.getElementById('vibe-model-popover');
		if (!pill || !popover) return;

		// Initial display sync
		updatePillUI();
		if (typeof updateStatusModels === 'function') updateStatusModels();

		pill.onclick = (e) => {
			e.stopPropagation();
			const isVisible = popover.style.display === 'flex';
			closeAllMenus();
			if (!isVisible) {
				popover.style.display = 'flex';
				renderVibePopover();
			}
		};

		popover.onclick = (e) => {
			e.stopPropagation(); // Prevent closing popover when clicking inside
		};
	}

	function updatePillUI() {
		const label = document.getElementById('vibe-selected-model-text');
		const icon = document.getElementById('vibe-model-selector-icon');
		if (!label || !icon) return;

		if (vibeActiveTab === 'cloud') {
			label.textContent = 'Cloud AI';
			icon.textContent = 'cloud';
			icon.style.color = '#A855F7';
		} else {
			label.textContent = 'Local AI';
			icon.textContent = 'computer';
			icon.style.color = '#3B82F6';
		}
	}

	function renderVibePopover() {
		const popover = document.getElementById('vibe-model-popover');
		if (!popover) return;

		// Deduplicate and filter providers
		const providers = modelsData.providers || [];
		const isClipView = window.codixViewType === 'clip';

		let fieldsHtml = '';
		
		// Decide which engines to show
		const roles = isClipView 
			? [
				{ id: 'main', label: '📝 LLM Generator', desc: 'Logic & Scripts' },
				{ id: 'image', label: '🖼️ Image Engine', desc: 'Asset Generation' },
				{ id: 'audio', label: '🎙️ Audio Engine', desc: 'Text-to-Speech & Sound' },
				{ id: 'video', label: '🎬 Video Engine', desc: 'Timeline Operations & Render' }
			]
			: [
				{ id: 'main', label: '📝 LLM Generator', desc: 'Logic & Coding' }
			];

		fieldsHtml = roles.map(role => {
			// Find provider object
			const currentProv = modelsData.llmConfig?.[role.id]?.provider || '';
			const currentModel = modelsData.llmConfig?.[role.id]?.model || '';

			// Filter providers by tab: local types vs cloud types
			const localTypes = ['ollama', 'lmstudio', 'vllm', 'sglang', 'airllm', 'transformers'];
			const filteredProvs = providers.filter(p => {
				const isLocal = localTypes.includes(p.type) || p.name.toLowerCase().includes('local') || p.name.toLowerCase().includes('lmstudio');
				return vibeActiveTab === 'local' ? isLocal : !isLocal;
			});

			// Get the options for provider select
			let providerOptions = `<option value="">-- Select Provider --</option>`;
			filteredProvs.forEach(p => {
				providerOptions += `<option value="${p.name}" ${currentProv === p.name ? 'selected' : ''}>${p.name}</option>`;
			});

			// Find model recommendations for selected provider
			const matchedProv = filteredProvs.find(p => p.name === currentProv);
			let models = matchedProv ? [...(matchedProv.models || [])] : [];
			if (role.id === 'video') {
				if (!models.includes('flux')) models.push('flux');
				if (!models.includes('ltx studio 2.3')) models.push('ltx studio 2.3');
			}

			return `
				<div class="popover-field">
					<label>${role.label}</label>
					<div style="display: flex; flex-direction: column; gap: 4px;">
						<select id="popover-role-${role.id}-provider" onchange="window.handlePopoverProviderChange('${role.id}')">
							${providerOptions}
						</select>
						<input type="text" id="popover-role-${role.id}-model" list="popover-recommendations-${role.id}" 
									value="${currentModel}" placeholder="Select or type model" autocomplete="off">
						<datalist id="popover-recommendations-${role.id}">
							${models.map(m => `<option value="${m}">${m}</option>`).join('')}
						</datalist>
					</div>
				</div>
			`;
		}).join('');

		popover.innerHTML = `
			<div class="popover-header">
				<span class="popover-title">AI Engine Selector</span>
				<div style="display: flex; align-items: center; gap: 8px;">
					<span class="material-icons toolbar-icon-btn" style="font-size: 16px; opacity: 0.7; cursor: pointer; color: #94A3B8;" onclick="if (typeof window.toggleSettings === 'function') window.toggleSettings();" title="Settings">settings</span>
					<span class="material-icons" style="font-size: 14px; opacity: 0.5; cursor: pointer;" onclick="closeAllMenus()">close</span>
				</div>
			</div>
			<div class="popover-tabs">
				<div class="popover-tab ${vibeActiveTab === 'cloud' ? 'active' : ''}" onclick="window.switchPopoverTab('cloud')">
					<span style="font-size: 10px; margin-right: 4px;">☁️</span> Cloud AI
				</div>
				<div class="popover-tab ${vibeActiveTab === 'local' ? 'active' : ''}" onclick="window.switchPopoverTab('local')">
					<span style="font-size: 10px; margin-right: 4px;">💻</span> Local AI
				</div>
			</div>
			<div class="popover-content">
				${fieldsHtml}
			</div>
			<div class="popover-footer">
				<button class="popover-save-btn" onclick="window.savePopoverSettings()">Save & Apply</button>
			</div>
		`;
	}

	window.switchPopoverTab = (tab) => {
		vibeActiveTab = tab;
		localStorage.setItem('vibe_ai_mode', tab);
		updatePillUI();
		renderVibePopover();
	};

	window.handlePopoverProviderChange = (roleId) => {
		const provSelect = document.getElementById(`popover-role-${roleId}-provider`);
		const modelInput = document.getElementById(`popover-role-${roleId}-model`);
		const datalist = document.getElementById(`popover-recommendations-${roleId}`);
		if (!provSelect || !modelInput || !datalist) return;

		const providerName = provSelect.value;
		const matchedProv = modelsData.providers.find(p => p.name === providerName);
		let models = matchedProv ? [...(matchedProv.models || [])] : [];
		if (roleId === 'video') {
			if (!models.includes('flux')) models.push('flux');
			if (!models.includes('ltx studio 2.3')) models.push('ltx studio 2.3');
		}

		modelInput.value = models.length > 0 ? models[0] : '';
		datalist.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');

		// Trigger fetch if provider is local and has no models
		if (providerName && models.length === 0) {
			fetchProviderModels(providerName).then(() => {
				// Re-render recommendations after fetch
				const updatedProv = modelsData.providers.find(p => p.name === providerName);
				if (updatedProv && updatedProv.models) {
					datalist.innerHTML = updatedProv.models.map(m => `<option value="${m}">${m}</option>`).join('');
					if (modelInput.value === '') {
						modelInput.value = updatedProv.models[0] || '';
					}
				}
			});
		}
	};

	window.savePopoverSettings = () => {
		const isClipView = window.codixViewType === 'clip';
		const roles = isClipView ? ['main', 'image', 'audio', 'video'] : ['main'];
		
		if (!modelsData.llmConfig) modelsData.llmConfig = {};
		if (!modelsData.current) modelsData.current = {};

		roles.forEach(role => {
			const provSelect = document.getElementById(`popover-role-${role}-provider`);
			const modelInput = document.getElementById(`popover-role-${role}-model`);
			if (provSelect && modelInput) {
				modelsData.llmConfig[role] = {
					provider: provSelect.value,
					model: modelInput.value
				};
				modelsData.current[role] = modelInput.value;
			}
		});

		// Save to localStorage
		const saveData = {
			providers: modelsData.providers,
			llmConfig: modelsData.llmConfig,
			current: modelsData.current
		};
		localStorage.setItem('codix_llm_settings', JSON.stringify(saveData));

		// Sync with Extension Host
		vscode.postMessage({
			type: 'saveLLMSettings',
			settings: saveData
		});

		closeAllMenus();
		showNotification('✓ AI Settings saved successfully!', 'success');
		if (typeof updateStatusModels === 'function') updateStatusModels();

		// Dispatch a custom event so other components (like Titlebar) know settings loaded
		const event = new CustomEvent('aiConfigLoaded', { detail: saveData });
		window.dispatchEvent(event);
	};

	function updateStatusModels() {
		const sttVal = document.getElementById('status-stt-val');
		const visionVal = document.getElementById('status-vision-val');
		const videoVal = document.getElementById('status-video-val');
		
		if (sttVal) {
			sttVal.textContent = modelsData.llmConfig?.audio?.model || modelsData.current?.audio || 'Whisper';
		}
		if (visionVal) {
			visionVal.textContent = modelsData.llmConfig?.vision?.model || modelsData.current?.vision || 'SAM2';
		}
		if (videoVal) {
			videoVal.textContent = modelsData.llmConfig?.video?.model || modelsData.current?.video || 'OpenReel';
		}
	}

	window.updateStatusModels = updateStatusModels;

	// Initialize on load
	initVibeModelSelector();
})();

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

// Codix Bridge: Kết nối giao diện chat với Extension Host
// Hỗ trợ gửi provider config (type, apiKey, apiUrl, model) kèm theo mỗi message

(function () {
	console.log("[Codix Bridge] Initializing...");

	const vscode = window.vscode;

	// Helper: Lấy provider config đã lưu từ localStorage
	function getActiveProviderConfig() {
		try {
			const savedStr = localStorage.getItem('codix_llm_settings');
			if (!savedStr) return null;
			const saved = JSON.parse(savedStr);
			const llmConfig = saved.llmConfig || {};
			const mainConfig = llmConfig.main || {};
			const providerName = mainConfig.provider || '';
			const model = mainConfig.model || '';

			if (!providerName) return null;

			// Tìm provider object để lấy apiKey, apiUrl
			const providers = Array.isArray(saved.providers) ? saved.providers : [];
			const provider = providers.find(p => p.name === providerName);

			return {
				providerName,
				type: provider?.type || 'openai',
				apiKey: provider?.options?.apiKey || '',
				apiUrl: provider?.options?.apiUrl || '',
				model
			};
		} catch (e) {
			console.error('[Codix Bridge] Failed to read provider config:', e);
			return null;
		}
	}

	// Giả lập đối tượng Socket.io
	const socketMock = {
		connected: true,
		id: 'codix-local-socket',
		on: function (event, callback) {
			window.addEventListener('message', e => {
				const message = e.data;
				if (message.type === 'thinking' && event === 'agent_update') {
					callback({ status: message.value ? 'thinking' : 'idle', statusText: message.value ? 'Codix is thinking...' : '' });
				}
				if (message.type === 'response' && event === 'agent_response') {
					callback({ content: message.text, isTurnOnly: false });
				}
			});
		},
		emit: function (event, data) {
			console.log(`[Codix Bridge] Emitting ${event}`);
			if (event === 'chat_message' || event === 'sendMessage') {
				const selector = document.getElementById('vibe-model-selector');
				const model = selector ? selector.value : 'cloud';
				const providerConfig = getActiveProviderConfig();

				if (!providerConfig || !providerConfig.providerName) {
					// Gửi thông báo lỗi nếu chưa cấu hình provider
					window.dispatchEvent(new MessageEvent('message', {
						data: {
							type: 'response',
							text: '⚠️ **Chưa cấu hình LLM Provider.**\n\nHãy nhấp vào biểu tượng **Settings (⚙️)** ở **góc trên cùng bên phải** → tab **Models** → thêm Provider (OpenAI, Ollama, v.v.) và chọn Model cho vai trò "Main".\n\nSau khi cấu hình xong, nhấn **Save Changes** rồi thử lại.',
							model: model
						}
					}));
					return;
				}

				vscode.postMessage({
					type: 'executeIntent',
					text: data.message || data.text,
					model,
					providerConfig
				});
			}
		},
		off: () => { },
		disconnect: () => { }
	};

	// Override hàm io() toàn cục
	window.io = function () {
		console.log("[Codix Bridge] Socket.io intercepted.");
		return socketMock;
	};

	// Mock initial data
	const initMockData = () => {
		setTimeout(() => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'auth_state_changed', isAuthenticated: true, token: 'codix-local-token' }
			}));
		}, 500);
	};

	if (document.readyState === 'complete' || document.readyState === 'interactive') {
		initMockData();
	} else {
		window.addEventListener('DOMContentLoaded', initMockData);
		window.addEventListener('load', initMockData);
	}
})();

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/* eslint-disable */

// Codix gRPC to Legacy Socket Bridge
// Đóng vai trò cầu nối giữa giao diện cũ (Socket.io) và backend mới (gRPC)

(function () {
	console.log("[Codix Bridge] Initializing Compatibility Layer...");

	const vscode = window.vscode; // Sử dụng instance đã được khởi tạo

	// Giả lập đối tượng Socket.io mà main.js mong muốn
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
			console.log(`[Codix Bridge] Emitting ${event}:`, data);
			if (event === 'chat_message' || event === 'sendMessage') {
				vscode.postMessage({ type: 'executeIntent', text: data.message || data.text });
			}
		},
		off: () => { },
		disconnect: () => { }
	};

	// Override hàm io() toàn cục
	window.io = function () {
		console.log("[Codix Bridge] Socket.io intercepted. Using gRPC Bridge.");
		return socketMock;
	};

	// Mock initial data
	window.addEventListener('load', () => {
		// Gửi sự kiện giả lập để UI hiển thị trạng thái đã kết nối
		setTimeout(() => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'auth_state_changed', isAuthenticated: true, token: 'codix-local-token' }
			}));
		}, 500);
	});
})();

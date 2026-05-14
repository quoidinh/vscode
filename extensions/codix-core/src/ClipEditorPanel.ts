import * as vscode from 'vscode';
import * as path from 'path';

/**
 * CODIX STUDIO PRO - DYNAMIC ENGINE VERSION
 * Khôi phục logic xử lý động (State Management, Reducer, Real-time Playback)
 */
export class ClipEditorPanel {
	public static currentPanel: ClipEditorPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	
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
			media: [{ id: 'res1', name: '7803305037219.mp4', thumb: '🌿' }]
		}
	};

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._panel.webview.options = { enableScripts: true, localResourceRoots: [extensionUri] };
		this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(message => {
			if (message.type === 'ready') this._sendState();
		}, null, this._disposables);
	}

	private _sendState() {
		this._panel.webview.postMessage({ type: 'initState', state: this._initialState });
	}

	public static createOrShow(extensionUri: vscode.Uri) {
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
			if (x) x.dispose();
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
				<style>
					:root {
						--bg-app: #090909; --bg-panel: #121212; --bg-sidebar: #181818;
						--accent: #24CCCD; --border: rgba(255, 255, 255, 0.08);
						--text-main: #E1E1E1; --text-dim: #71717A;
					}
					* { box-sizing: border-box; }
					body { margin: 0; padding: 0; background: var(--bg-app); color: var(--text-main); font-family: 'Inter', sans-serif; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

					/* NAV */
					header { height: 48px; background: #1A1A1A; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 20px; gap: 24px; }
					.nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-dim); cursor: pointer; }
					.nav-item.active { color: var(--accent); }
					.nav-item span { font-size: 9px; font-weight: 700; }

					.layout { flex: 1; display: flex; overflow: hidden; }
					.sidebar-left { width: 280px; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
					.sb-tab-row { display: flex; padding: 12px; gap: 16px; border-bottom: 1px solid var(--border); }
					.sb-tab { font-size: 11px; font-weight: 800; color: var(--text-dim); cursor: pointer; }
					.sb-tab.active { color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 8px; }
					.import-btn { margin: 12px; background: #1E3131; color: var(--accent); height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 800; cursor: pointer; }
					.asset-grid { flex: 1; padding: 12px; overflow-y: auto; display: grid; grid-template-columns: 1fr; gap: 12px; }
					.asset-card { aspect-ratio: 16/9; background: #27272A; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 32px; cursor: pointer; position: relative; }
					.asset-card .name { position: absolute; bottom: 0; width: 100%; background: rgba(0,0,0,0.5); padding: 4px; font-size: 9px; color: #999; }

					/* PLAYER */
					.player-zone { flex: 1; background: #000; display: flex; flex-direction: column; position: relative; }
					.monitor { flex: 1; display: flex; align-items: center; justify-content: center; }
					.viewport { height: 90%; aspect-ratio: 9/16; background: #111; border: 1px solid #333; position: relative; }
					.player-footer { height: 50px; background: #121212; border-top: 1px solid var(--border); display: flex; align-items: center; padding: 0 20px; }
					.tc-display { font-family: monospace; font-size: 13px; color: var(--accent); }
					.transport { flex: 1; display: flex; justify-content: center; gap: 24px; }
					.t-btn { cursor: pointer; color: white; }

					/* INSPECTOR */
					.sidebar-right { width: 280px; background: var(--bg-sidebar); border-left: 1px solid var(--border); }
					.panel { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
					.card { background: #1F1F23; border-radius: 8px; padding: 16px; }
					.card-title { font-size: 11px; font-weight: 800; color: #888; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }

					/* TIMELINE */
					.timeline { height: 350px; background: #121212; border-top: 2px solid #000; display: flex; flex-direction: column; }
					.tl-toolbar { height: 40px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 16px; }
					.tl-main { flex: 1; display: flex; overflow: hidden; }
					.tl-headers { width: 60px; background: #18181B; border-right: 1px solid var(--border); }
					.tl-header-row { height: 40px; border-bottom: 1px solid #27272A; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #444; }
					.tl-header-row .material-icons { font-size: 14px; }
					
					.tl-view { flex: 1; position: relative; overflow-x: auto; background: #09090B; }
					.tl-ruler { height: 24px; background: #18181B; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; }
					.tl-lane { height: 40px; border-bottom: 1px solid #18181B; position: relative; }
					.playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: white; z-index: 100; pointer-events: none; }
					.playhead::after { content: ''; position: absolute; top: 0; left: -6px; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 10px solid white; }

					.clip { position: absolute; top: 2px; bottom: 2px; border-radius: 2px; background: #14532D; border: 1px solid #166534; display: flex; flex-direction: column; overflow: hidden; }
					.clip-frames { flex: 1; background: repeating-linear-gradient(90deg, transparent, transparent 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 11px); }
					.clip-label { padding: 2px 6px; font-size: 8px; font-weight: 800; color: #4ADE80; background: rgba(0,0,0,0.2); }
				</style>
			</head>
			<body>
				<header>
					<div class="nav-item active"><span class="material-icons">movie</span><span>Media</span></div>
					<div class="nav-item"><span class="material-icons">music_note</span><span>Audio</span></div>
					<div class="nav-item"><span class="material-icons">title</span><span>Text</span></div>
					<div class="nav-item"><span class="material-icons">emoji_emotions</span><span>Stickers</span></div>
					<div class="nav-item"><span class="material-icons">auto_awesome</span><span>Effects</span></div>
				</header>
				<div class="layout">
					<div class="sidebar-left">
						<div class="sb-tab-row"><div class="sb-tab active">Media</div><div class="sb-tab">Subprojects</div></div>
						<div class="import-btn"><span class="material-icons">add</span> Import</div>
						<div class="asset-grid" id="assets"></div>
					</div>
					<div class="player-zone">
						<div class="monitor"><div class="viewport" id="viewport"></div></div>
						<div class="player-footer">
							<div class="tc-display" id="tc">00:00:03:03 / 00:02:00:00</div>
							<div class="transport">
								<span class="material-icons t-btn" id="play-btn">play_arrow</span>
							</div>
						</div>
					</div>
					<div class="sidebar-right">
						<div class="panel">
							<div class="card"><div class="card-title">Smart Suggestions</div><div style="font-size:11px;font-weight:700;">Find out how your video can be improved</div></div>
						</div>
					</div>
				</div>
				<div class="timeline">
					<div class="tl-toolbar">
						<span class="material-icons" style="color:var(--accent);">near_me</span>
						<span class="material-icons" style="color:#555;">content_cut</span>
					</div>
					<div class="tl-main">
						<div class="tl-headers" id="headers"></div>
						<div class="tl-view">
							<div class="tl-ruler" id="ruler"></div>
							<div id="lanes"></div>
							<div class="playhead" id="playhead"></div>
						</div>
					</div>
				</div>
				<script>
					(function() {
						const vscode = acquireVsCodeApi();
						let state = null;

						window.addEventListener('message', event => {
							if (event.data.type === 'initState') {
								state = event.data.state;
								render();
							}
							if (event.data.type === 'addClip') {
								const track = state.tracks.find(t => t.type === event.data.assetType) || state.tracks[5];
								track.clips.push({ id: Math.random().toString(36), name: event.data.name, startAt: state.playheadTime, duration: 5 });
								render();
							}
						});

						function render() {
							if (!state) return;
							
							// Render Playhead
							document.getElementById('playhead').style.left = (state.playheadTime * state.zoomScale) + 'px';
							
							// Render Timecode
							const s = Math.floor(state.playheadTime);
							const f = Math.floor((state.playheadTime % 1) * 30);
							document.getElementById('tc').innerText = '00:00:' + s.toString().padStart(2, '0') + ':' + f.toString().padStart(2, '0') + ' / 00:02:00:00';

							// Render Headers
							document.getElementById('headers').innerHTML = state.tracks.map(t => \`
								<div class="tl-header-row"><span class="material-icons">\${t.icon}</span></div>
							\`).join('');

							// Render Lanes & Clips
							document.getElementById('lanes').innerHTML = state.tracks.map(t => \`
								<div class="tl-lane">
									\${t.clips.map(c => \`
										<div class="clip" style="left:\${c.startAt * state.zoomScale}px; width:\${c.duration * state.zoomScale}px; background:\${t.color}; border-color: rgba(255,255,255,0.1);">
											<div class="clip-frames"></div>
											<div class="clip-label">\${c.name}</div>
										</div>
									\`).join('')}
								</div>
							\`).join('');

							// Render Assets
							document.getElementById('assets').innerHTML = state.assets.media.map(a => \`
								<div class="asset-card" onclick="addClip('\${a.id}')">
									\${a.thumb}
									<div class="name">\${a.name}</div>
								</div>
							\`).join('');
						}

						window.addClip = (id) => {
							const a = state.assets.media.find(x => x.id === id);
							vscode.postMessage({ type: 'log', value: 'Adding clip: ' + a.name });
							state.tracks[5].clips.push({ id: Math.random().toString(36), name: a.name, startAt: state.playheadTime, duration: 15 });
							render();
						};

						document.getElementById('play-btn').onclick = () => {
							state.isPlaying = !state.isPlaying;
							document.getElementById('play-btn').innerText = state.isPlaying ? 'pause' : 'play_arrow';
							if (state.isPlaying) requestAnimationFrame(tick);
						};

						function tick() {
							if (!state.isPlaying) return;
							state.playheadTime += 0.05;
							render();
							requestAnimationFrame(tick);
						}

						document.getElementById('ruler').onmousedown = (e) => {
							const scrub = (ev) => {
								state.playheadTime = Math.max(0, (ev.pageX - 100) / state.zoomScale);
								render();
							};
							window.addEventListener('mousemove', scrub);
							window.addEventListener('mouseup', () => window.removeEventListener('mousemove', scrub), {once:true});
						};

						vscode.postMessage({ type: 'ready' });
					})();
				</script>
			</body>
			</html>`;
	}
}

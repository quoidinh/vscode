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
						--bg-app: #121212; 
						--bg-panel: #181818; 
						--bg-sidebar: #1E1E1E;
						--bg-header: #1E1E1E;
						--bg-track: #151515;
						--accent: #24CCCD; 
						--border: rgba(255, 255, 255, 0.08);
						--text-main: #E1E1E1; 
						--text-dim: #888888;
						
						/* Track Colors */
						--color-video: #14532D;
						--color-audio: #164E63;
						--color-text: #AA4F4F;
						--color-caption: #2ABFBF;
						--color-effect: #D4A017;
					}
					* { box-sizing: border-box; }
					body { 
						margin: 0; padding: 0; 
						background: var(--bg-app); 
						color: var(--text-main); 
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
						height: 100vh; 
						overflow: hidden; 
						display: flex; 
						flex-direction: column; 
						user-select: none;
					}

					/* HEADER / TOP NAV */
					header { 
						height: 50px; 
						background: var(--bg-header); 
						border-bottom: 1px solid var(--border); 
						display: flex; 
						align-items: center; 
						justify-content: center;
						gap: 32px; 
					}
					.nav-item { 
						display: flex; 
						flex-direction: column; 
						align-items: center; 
						justify-content: center;
						gap: 2px; 
						color: var(--text-dim); 
						cursor: pointer; 
						height: 100%;
						padding: 0 12px;
					}
					.nav-item:hover { color: var(--text-main); }
					.nav-item.active { 
						color: var(--accent); 
						border-bottom: 2px solid var(--accent);
					}
					.nav-item .material-icons { font-size: 20px; }
					.nav-item span { font-size: 10px; font-weight: 500; }

					/* MAIN LAYOUT (Top section) */
					.main-workspace { 
						flex: 1; 
						display: flex; 
						overflow: hidden; 
						height: calc(100vh - 50px - 320px);
					}

					/* LEFT SIDEBAR (Menu + Media Grid) */
					.sidebar-left { 
						display: flex;
						width: 340px; 
						background: var(--bg-panel); 
						border-right: 1px solid var(--border); 
					}
					.sidebar-menu {
						width: 72px;
						background: var(--bg-header);
						border-right: 1px solid var(--border);
						display: flex;
						flex-direction: column;
						align-items: center;
						padding-top: 16px;
						gap: 16px;
					}
					.side-menu-item {
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 4px;
						color: var(--text-dim);
						font-size: 10px;
						cursor: pointer;
						width: 100%;
					}
					.side-menu-item.active { color: var(--accent); }
					.side-menu-item .material-icons { font-size: 20px; }
					
					.sidebar-content {
						flex: 1;
						display: flex;
						flex-direction: column;
					}
					.sb-tab-row { 
						display: flex; 
						padding: 12px 16px; 
						gap: 16px; 
					}
					.sb-tab { 
						font-size: 12px; 
						font-weight: 600; 
						color: var(--text-dim); 
						cursor: pointer; 
						padding-bottom: 4px;
					}
					.sb-tab.active { 
						color: var(--text-main); 
						border-bottom: 2px solid var(--accent); 
					}
					.import-toolbar {
						padding: 0 16px 12px 16px;
						display: flex;
						gap: 8px;
					}
					.import-btn { 
						background: #1D3737; 
						color: var(--accent); 
						height: 32px; 
						border-radius: 4px; 
						display: flex; 
						align-items: center; 
						justify-content: center; 
						gap: 6px; 
						font-size: 12px; 
						font-weight: 600; 
						cursor: pointer; 
						flex: 1;
					}
					.import-btn:hover { background: #234545; }
					.record-btn {
						background: #2D2D2D;
						color: var(--text-main);
						height: 32px;
						border-radius: 4px;
						padding: 0 12px;
						display: flex;
						align-items: center;
						gap: 6px;
						font-size: 12px;
						font-weight: 600;
						cursor: pointer;
					}
					
					.asset-grid { 
						flex: 1; 
						padding: 0 16px 16px 16px; 
						overflow-y: auto; 
						display: grid; 
						grid-template-columns: repeat(2, 1fr); 
						gap: 12px; 
						align-content: start;
					}
					.asset-card { 
						aspect-ratio: 9/16; 
						background: #000; 
						border-radius: 6px; 
						display: flex; 
						flex-direction: column;
						position: relative; 
						overflow: hidden;
						cursor: pointer; 
						border: 1px solid transparent;
					}
					.asset-card:hover { border-color: var(--accent); }
					.asset-thumb {
						flex: 1;
						background: #27272A;
						display: flex;
						align-items: center;
						justify-content: center;
						font-size: 24px;
					}
					.asset-card .duration {
						position: absolute;
						top: 4px;
						right: 4px;
						background: rgba(0,0,0,0.6);
						border-radius: 2px;
						padding: 2px 4px;
						font-size: 9px;
					}
					.asset-card .name { 
						background: var(--bg-panel); 
						padding: 6px 4px; 
						font-size: 10px; 
						color: var(--text-dim); 
						text-overflow: ellipsis;
						white-space: nowrap;
						overflow: hidden;
					}

					/* CENTER PLAYER */
					.player-zone { 
						flex: 1; 
						background: #090909; 
						display: flex; 
						flex-direction: column; 
						position: relative; 
					}
					.player-header {
						height: 36px;
						display: flex;
						align-items: center;
						justify-content: space-between;
						padding: 0 16px;
						color: var(--text-dim);
						font-size: 12px;
					}
					.monitor { 
						flex: 1; 
						display: flex; 
						align-items: center; 
						justify-content: center; 
						padding: 16px;
					}
					.viewport { 
						height: 100%; 
						aspect-ratio: 9/16; 
						background: #000; 
						border-radius: 4px;
						box-shadow: 0 4px 12px rgba(0,0,0,0.5);
						position: relative; 
					}
					.player-footer { 
						height: 48px; 
						display: flex; 
						align-items: center; 
						padding: 0 16px; 
						justify-content: space-between;
					}
					.tc-display { 
						font-family: 'SF Mono', Consolas, monospace; 
						font-size: 12px; 
						color: var(--accent); 
					}
					.transport { 
						display: flex; 
						align-items: center; 
						gap: 16px; 
					}
					.t-btn { 
						cursor: pointer; 
						color: var(--text-main); 
						font-size: 24px;
					}
					.t-btn:hover { color: white; }
					.player-tools {
						display: flex;
						gap: 12px;
						color: var(--text-dim);
					}

					/* RIGHT SIDEBAR (Inspector) */
					.sidebar-right { 
						width: 320px; 
						background: var(--bg-panel); 
						border-left: 1px solid var(--border); 
						display: flex;
						flex-direction: column;
					}
					.inspector-tabs {
						display: flex;
						border-bottom: 1px solid var(--border);
					}
					.insp-tab {
						flex: 1;
						text-align: center;
						padding: 12px 0;
						font-size: 12px;
						font-weight: 600;
						color: var(--text-dim);
						cursor: pointer;
					}
					.insp-tab.active {
						color: var(--text-main);
						border-bottom: 2px solid var(--accent);
					}
					.panel-content { 
						padding: 16px; 
						display: flex; 
						flex-direction: column; 
						gap: 16px; 
						overflow-y: auto;
					}
					.card { 
						background: #242424; 
						border-radius: 6px; 
						padding: 16px; 
					}
					.card-title { 
						font-size: 12px; 
						font-weight: 600; 
						color: var(--text-main); 
						margin-bottom: 8px; 
						display: flex; 
						align-items: center; 
						gap: 6px; 
					}
					.analyze-btn {
						background: transparent;
						border: 1px solid var(--accent);
						color: var(--accent);
						padding: 6px 16px;
						border-radius: 16px;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						margin-top: 12px;
					}
					.analyze-btn:hover { background: rgba(36, 204, 205, 0.1); }
					.setting-row {
						display: flex;
						align-items: center;
						justify-content: space-between;
						padding: 12px 0;
						border-bottom: 1px solid rgba(255,255,255,0.05);
					}
					.setting-row:last-child { border-bottom: none; padding-bottom: 0; }
					.setting-label { font-size: 12px; display: flex; align-items: center; gap: 8px; }
					.toggle {
						width: 32px; height: 18px;
						background: #444;
						border-radius: 9px;
						position: relative;
						cursor: pointer;
					}
					.toggle::after {
						content: ''; position: absolute;
						width: 14px; height: 14px;
						background: white; border-radius: 50%;
						top: 2px; left: 2px;
						transition: 0.2s;
					}

					/* BOTTOM TIMELINE */
					.timeline { 
						height: 320px; 
						background: var(--bg-panel); 
						border-top: 1px solid #000; 
						display: flex; 
						flex-direction: column; 
					}
					.tl-toolbar { 
						height: 40px; 
						border-bottom: 1px solid var(--border); 
						display: flex; 
						align-items: center; 
						padding: 0 16px; 
						justify-content: space-between;
					}
					.tl-tools-left { display: flex; gap: 16px; color: var(--text-dim); }
					.tl-tools-left .material-icons { font-size: 18px; cursor: pointer; }
					.tl-tools-left .material-icons:hover { color: var(--text-main); }
					.tl-tools-right { display: flex; align-items: center; gap: 12px; }
					
					.zoom-slider {
						-webkit-appearance: none;
						width: 100px;
						height: 2px;
						background: #444;
						outline: none;
					}
					.zoom-slider::-webkit-slider-thumb {
						-webkit-appearance: none;
						width: 12px; height: 12px;
						border-radius: 50%;
						background: white;
						cursor: pointer;
					}

					.tl-main { 
						flex: 1; 
						display: flex; 
						overflow: hidden; 
					}
					.tl-headers { 
						width: 100px; 
						background: var(--bg-header); 
						border-right: 1px solid var(--border); 
					}
					.tl-header-row { 
						height: 40px; 
						border-bottom: 1px solid var(--border); 
						display: flex; 
						align-items: center; 
						padding: 0 12px; 
						color: var(--text-dim); 
						gap: 12px;
					}
					.tl-header-row .material-icons { font-size: 14px; cursor: pointer; }
					
					.tl-view { 
						flex: 1; 
						position: relative; 
						overflow-x: auto; 
						overflow-y: scroll;
						background: var(--bg-track); 
					}
					.tl-ruler { 
						height: 28px; 
						background: var(--bg-header); 
						border-bottom: 1px solid var(--border); 
						position: sticky; 
						top: 0; 
						z-index: 20; 
						cursor: text;
					}
					
					.tl-lane { 
						height: 40px; 
						border-bottom: 1px solid #1A1A1A; 
						position: relative; 
					}
					
					/* Playhead */
					.playhead { 
						position: absolute; 
						top: 0; bottom: 0; 
						width: 1px; 
						background: white; 
						z-index: 100; 
						pointer-events: none; 
						transform: translate3d(0, 0, 0);
					}
					.playhead::after { 
						content: ''; 
						position: absolute; 
						top: 0; left: -5px; 
						width: 11px; height: 14px;
						background: white;
						border-radius: 2px 2px 0 0;
					}
					.playhead::before {
						content: '';
						position: absolute;
						top: 14px; left: -5px;
						border-left: 5.5px solid transparent; 
						border-right: 5.5px solid transparent; 
						border-top: 6px solid white;
					}

					/* Clips */
					.clip { 
						position: absolute; 
						top: 2px; height: 35px; 
						border-radius: 4px; 
						background: var(--color-video); 
						display: flex; 
						flex-direction: column; 
						overflow: hidden; 
						cursor: grab;
						box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1);
					}
					.clip.selected {
						box-shadow: 0 0 0 2px white;
						z-index: 10;
					}
					.clip-frames { 
						flex: 1; 
						background: repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(255,255,255,0.05) 20px, rgba(255,255,255,0.05) 21px); 
					}
					.clip-label { 
						position: absolute;
						top: 2px; left: 6px;
						font-size: 10px; 
						color: white; 
						text-shadow: 0 1px 2px rgba(0,0,0,0.8);
						white-space: nowrap;
					}
					
					/* Clip Trimmers */
					.clip-trim-handle {
						position: absolute;
						top: 0; bottom: 0;
						width: 6px;
						cursor: col-resize;
						background: transparent;
					}
					.clip-trim-handle.left { left: 0; }
					.clip-trim-handle.right { right: 0; }
					.clip:hover .clip-trim-handle { background: rgba(255,255,255,0.2); }
				</style>
			</head>
			<body>
				<!-- TOP NAV -->
				<header>
					<div class="nav-item active"><span class="material-icons">movie</span><span>Media</span></div>
					<div class="nav-item"><span class="material-icons">music_note</span><span>Audio</span></div>
					<div class="nav-item"><span class="material-icons">title</span><span>Text</span></div>
					<div class="nav-item"><span class="material-icons">emoji_emotions</span><span>Stickers</span></div>
					<div class="nav-item"><span class="material-icons">auto_awesome</span><span>Effects</span></div>
					<div class="nav-item"><span class="material-icons">animation</span><span>Transitions</span></div>
					<div class="nav-item"><span class="material-icons">closed_caption</span><span>Captions</span></div>
					<div class="nav-item"><span class="material-icons">filter_b_and_w</span><span>Filters</span></div>
					<div class="nav-item"><span class="material-icons">tune</span><span>Adjustment</span></div>
					<div class="nav-item"><span class="material-icons">dashboard</span><span>Templates</span></div>
				</header>
				
				<div class="main-workspace">
					<!-- LEFT SIDEBAR -->
					<div class="sidebar-left">
						<div class="sidebar-menu">
							<div class="side-menu-item active"><span class="material-icons">download</span><span>Import</span></div>
							<div class="side-menu-item"><span class="material-icons">folder</span><span>Subprojects</span></div>
							<div class="side-menu-item"><span class="material-icons">smart_toy</span><span>AI media</span></div>
							<div class="side-menu-item"><span class="material-icons">cloud</span><span>Spaces</span></div>
							<div class="side-menu-item"><span class="material-icons">library_video</span><span>Library</span></div>
						</div>
						<div class="sidebar-content">
							<div class="sb-tab-row">
								<div class="sb-tab active">Media</div>
								<div class="sb-tab">Audio</div>
							</div>
							<div class="import-toolbar">
								<div class="import-btn"><span class="material-icons">add</span> Import</div>
								<div class="record-btn"><span class="material-icons">mic</span> Record</div>
							</div>
							<div class="asset-grid" id="assets">
								<!-- Dynamically populated -->
							</div>
						</div>
					</div>

					<!-- CENTER PLAYER -->
					<div class="player-zone">
						<div class="player-header">
							<span>Player</span>
							<span class="material-icons">menu</span>
						</div>
						<div class="monitor">
							<div class="viewport" id="viewport">
								<!-- Video frames go here -->
							</div>
						</div>
						<div class="player-footer">
							<div class="tc-display" id="tc">00:00:03:03 / 00:02:00:00</div>
							<div class="transport">
								<span class="material-icons t-btn">fast_rewind</span>
								<span class="material-icons t-btn" id="play-btn">play_arrow</span>
								<span class="material-icons t-btn">fast_forward</span>
							</div>
							<div class="player-tools">
								<span class="material-icons">fullscreen</span>
							</div>
						</div>
					</div>

					<!-- RIGHT SIDEBAR -->
					<div class="sidebar-right">
						<div class="inspector-tabs">
							<div class="insp-tab active">Project</div>
							<div class="insp-tab">Details</div>
						</div>
						<div class="panel-content">
							<div class="card">
								<div class="card-title"><span class="material-icons" style="font-size:14px;color:var(--accent);">auto_awesome</span> Smart suggestions</div>
								<div style="font-size:11px;color:var(--text-dim);line-height:1.4;">Find out how your video can be improved</div>
								<button class="analyze-btn"><span class="material-icons" style="font-size:12px;vertical-align:middle;">analytics</span> Analyze</button>
							</div>
							<div>
								<div class="card-title" style="margin-top:8px;">Global edits <span class="material-icons" style="font-size:14px;color:#A855F7;">auto_fix_high</span></div>
								<div class="setting-row">
									<div class="setting-label"><span class="material-icons" style="font-size:16px;">palette</span> Make colors better</div>
									<div class="toggle"></div>
								</div>
								<div class="setting-row">
									<div class="setting-label"><span class="material-icons" style="font-size:16px;">graphic_eq</span> Make voice clearer</div>
									<div class="toggle"></div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- BOTTOM TIMELINE -->
				<div class="timeline">
					<div class="tl-toolbar">
						<div class="tl-tools-left">
							<span class="material-icons">undo</span>
							<span class="material-icons">redo</span>
							<div style="width:1px;height:16px;background:var(--border);margin:0 8px;"></div>
							<span class="material-icons">content_cut</span>
							<span class="material-icons">delete</span>
							<span class="material-icons">ac_unit</span>
						</div>
						<div class="tl-tools-right">
							<span class="material-icons" style="font-size:16px;color:var(--text-dim);">mic</span>
							<div style="width:1px;height:16px;background:var(--border);margin:0 8px;"></div>
							<input type="range" class="zoom-slider" min="10" max="200" value="100" id="zoom-slider">
						</div>
					</div>
					<div class="tl-main">
						<div class="tl-headers" id="headers">
							<!-- Track headers -->
						</div>
						<div class="tl-view" id="tl-view">
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
						let zoom = 100;

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
							
							const pxPerSec = zoom;
							document.getElementById('playhead').style.transform = \`translate3d(\${state.playheadTime * pxPerSec}px, 0, 0)\`;
							
							const total = state.totalTime;
							const pt = state.playheadTime;
							const formatTC = (sec) => {
								const m = Math.floor(sec / 60);
								const s = Math.floor(sec % 60);
								const f = Math.floor((sec % 1) * 30);
								return \`00:\${m.toString().padStart(2,'0')}:\${s.toString().padStart(2,'0')}:\${f.toString().padStart(2,'0')}\`;
							};
							document.getElementById('tc').innerText = \`\${formatTC(pt)} / \${formatTC(total)}\`;

							document.getElementById('headers').innerHTML = state.tracks.map(t => \`
								<div class="tl-header-row">
									<span class="material-icons" style="font-size:16px;">\${t.icon}</span>
									<span class="material-icons" style="font-size:14px;margin-left:auto;">visibility</span>
									<span class="material-icons" style="font-size:14px;">lock_open</span>
								</div>
							\`).join('');

							document.getElementById('lanes').innerHTML = state.tracks.map(t => \`
								<div class="tl-lane">
									\${t.clips.map(c => \`
										<div class="clip" style="left:\${c.startAt * pxPerSec}px; width:\${c.duration * pxPerSec}px; background:var(--color-\${t.type}, \${t.color});">
											<div class="clip-label">\${c.name}</div>
											<div class="clip-frames"></div>
											<div class="clip-trim-handle left"></div>
											<div class="clip-trim-handle right"></div>
										</div>
									\`).join('')}
								</div>
							\`).join('');

							document.getElementById('assets').innerHTML = state.assets.media.map(a => \`
								<div class="asset-card" onclick="addClip('\${a.id}')">
									<div class="duration">00:15</div>
									<div class="asset-thumb">\${a.thumb}</div>
									<div class="name">\${a.name}</div>
								</div>
							\`).join('');
						}

						window.addClip = (id) => {
							const a = state.assets.media.find(x => x.id === id);
							state.tracks[5].clips.push({ id: Math.random().toString(36), name: a.name, startAt: state.playheadTime, duration: 15 });
							render();
						};

						document.getElementById('play-btn').onclick = () => {
							state.isPlaying = !state.isPlaying;
							document.getElementById('play-btn').innerText = state.isPlaying ? 'pause' : 'play_arrow';
							
							let lastTime = performance.now();
							const tick = (now) => {
								if (!state.isPlaying) return;
								const delta = (now - lastTime) / 1000;
								lastTime = now;
								state.playheadTime += delta;
								if (state.playheadTime > state.totalTime) {
									state.playheadTime = 0;
									state.isPlaying = false;
									document.getElementById('play-btn').innerText = 'play_arrow';
								}
								render();
								requestAnimationFrame(tick);
							};
							if (state.isPlaying) requestAnimationFrame(tick);
						};

						document.getElementById('ruler').onmousedown = (e) => {
							const viewRect = document.getElementById('tl-view').getBoundingClientRect();
							const updatePlayhead = (ev) => {
								const scrollLeft = document.getElementById('tl-view').scrollLeft;
								const x = ev.clientX - viewRect.left + scrollLeft - 100;
								state.playheadTime = Math.max(0, x / zoom);
								render();
							};
							updatePlayhead(e);
							window.addEventListener('mousemove', updatePlayhead);
							window.addEventListener('mouseup', () => window.removeEventListener('mousemove', updatePlayhead), {once:true});
						};

						document.getElementById('zoom-slider').oninput = (e) => {
							zoom = parseInt(e.target.value);
							render();
						};

						vscode.postMessage({ type: 'ready' });
					})();
				</script>
			</body>
			</html>`;
	}
}

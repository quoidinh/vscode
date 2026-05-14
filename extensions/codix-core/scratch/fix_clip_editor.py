import sys

content = """import * as vscode from 'vscode';
import * as path from 'path';

export class ClipEditorPanel {
    public static currentPanel: ClipEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _projectState: any = {
        isPlaying: false,
        playheadTime: 0,
        zoomScale: 50,
        selectedClipId: null,
        activeTab: 'media',
        tracks: [
            { id: 'v1', name: 'Video 1', type: 'video', clips: [] },
            { id: 'a1', name: 'Audio 1', type: 'audio', clips: [] },
            { id: 't1', name: 'Text 1', type: 'text', clips: [] }
        ],
        assets: []
    };

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._panel.webview.options = { enableScripts: true, localResourceRoots: [extensionUri] };
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (ClipEditorPanel.currentPanel) {
            ClipEditorPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel('clipEditor', 'Codix Studio', column || vscode.ViewColumn.One, { enableScripts: true });
        ClipEditorPanel.currentPanel = new ClipEditorPanel(panel, extensionUri);
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
                    :root { --bg: #0F0F0F; --sidebar: #161616; --teal: #24CCCD; --text: #E5E5E5; }
                    body { font-family: sans-serif; background: var(--bg); color: var(--text); margin: 0; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
                    .top-nav { height: 48px; background: #1B1B1B; border-bottom: 1px solid #222; display: flex; align-items: center; padding: 0 16px; gap: 20px; }
                    .nav-item { cursor: pointer; color: #888; font-size: 12px; display: flex; flex-direction: column; align-items: center; }
                    .nav-item.active { color: var(--teal); }
                    .main-view { flex: 1; display: flex; overflow: hidden; }
                    .side-left { width: 300px; background: var(--sidebar); border-right: 1px solid #222; overflow-y: auto; }
                    .player-zone { flex: 1; background: #000; display: flex; flex-direction: column; }
                    .monitor-wrap { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; }
                    .monitor-916 { height: 80%; aspect-ratio: 16/9; background: #111; position: relative; border: 1px solid #333; }
                    .timeline-box { height: 300px; background: #1a1a1a; border-top: 1px solid #000; display: flex; flex-direction: column; }
                    .tl-tools { height: 36px; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; padding: 0 12px; gap: 12px; }
                    .tl-track-area { flex: 1; display: flex; overflow: hidden; }
                    .tl-headers { width: 120px; border-right: 1px solid #2a2a2a; }
                    .tl-canvas { flex: 1; position: relative; overflow-x: auto; background: #111; }
                    .tl-playhead-line { position: absolute; top: 0; bottom: 0; width: 2px; background: #FFF; z-index: 100; pointer-events: none; }
                    .tl-clip-wrapper { position: absolute; height: 50px; background: var(--teal); border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); }
                    .toast-container { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1000; }
                    .toast { background: rgba(0,0,0,0.8); color: white; padding: 8px 16px; border-radius: 20px; margin-bottom: 8px; font-size: 12px; display: flex; align-items: center; gap: 8px; }
                </style>
            </head>
            <body>
                <div class="top-nav">
                    <div class="nav-item active"><span class="material-icons">movie</span>Media</div>
                    <div class="nav-item"><span class="material-icons">music_note</span>Audio</div>
                    <div class="nav-item"><span class="material-icons">title</span>Text</div>
                </div>
                <div class="main-view">
                    <div class="side-left" id="sidebar-content"></div>
                    <div class="player-zone">
                        <div class="monitor-wrap" ondragover="event.preventDefault()" ondrop="window.onDrop(event)">
                            <div class="monitor-916" id="player-monitor">
                                <div id="overlays-container" style="position:absolute; inset:0;"></div>
                            </div>
                        </div>
                        <div style="height:48px; display:flex; align-items:center; padding:0 16px; background:#111;">
                            <span id="player-timecode">00:00:00:00</span>
                            <span class="material-icons" id="play-pause-btn" onclick="window.togglePlay()" style="margin-left:auto; cursor:pointer; font-size:32px;">play_arrow</span>
                        </div>
                    </div>
                    <div style="width:300px; background:var(--sidebar); border-left:1px solid #222;" id="right-sidebar"></div>
                </div>
                <div class="timeline-box">
                    <div class="tl-tools">
                        <span class="material-icons" onclick="window.undoAction()">undo</span>
                        <span class="material-icons" onclick="window.redoAction()">redo</span>
                        <span class="material-icons" onclick="window.splitClip()">content_cut</span>
                    </div>
                    <div class="tl-track-area" ondragover="event.preventDefault()" ondrop="window.onDrop(event)">
                        <div class="tl-headers" id="track-headers"></div>
                        <div class="tl-canvas" id="timeline-canvas">
                            <div id="tracks-container"></div>
                            <div class="tl-playhead-line" id="playhead"></div>
                        </div>
                    </div>
                </div>
                <script>
                    (function() {
                        const vscode = acquireVsCodeApi();
                        let state = { isPlaying: false, playheadTime: 0, zoomScale: 50, tracks: [], assets: [] };

                        window.togglePlay = () => {
                            state.isPlaying = !state.isPlaying;
                            document.getElementById('play-pause-btn').innerText = state.isPlaying ? 'pause' : 'play_arrow';
                            if (state.isPlaying) requestAnimationFrame(tick);
                        };

                        function tick() {
                            if (!state.isPlaying) return;
                            state.playheadTime += 1/30;
                            updateUI();
                            requestAnimationFrame(tick);
                        }

                        function updateUI() {
                            document.getElementById('player-timecode').innerText = state.playheadTime.toFixed(2);
                            document.getElementById('playhead').style.transform = 'translateX(' + (state.playheadTime * state.zoomScale) + 'px)';
                        }

                        window.showToast = (msg, icon='info') => {
                            const container = document.getElementById('toast-root') || (()=>{
                                const div = document.createElement('div'); div.id = 'toast-root'; div.className = 'toast-container';
                                document.body.appendChild(div); return div;
                            })();
                            const toast = document.createElement('div'); toast.className = 'toast';
                            toast.innerHTML = '<span class="material-icons">' + icon + '</span>' + msg;
                            container.appendChild(toast);
                            setTimeout(() => toast.remove(), 2000);
                        };

                        window.onDrop = (e) => {
                            e.preventDefault();
                            window.showToast('Asset added to timeline', 'add_task');
                        };

                        window.addEventListener('keydown', (e) => {
                            if (e.code === 'Space') { e.preventDefault(); window.togglePlay(); }
                        });

                        updateUI();
                    })();
                </script>
            </body>
            </html>\`;
    }
}
"""

with open('/Users/mac/github/codix/apps/desktop/extensions/codix-core/src/ClipEditorPanel.ts', 'w') as f:
    f.write(content)

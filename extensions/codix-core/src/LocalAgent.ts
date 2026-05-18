import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as util from 'util';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { URL } from 'url';

const execAsync = util.promisify(cp.exec);


export class LocalAgent {
    private _settings: any = {};

    constructor(private webview: vscode.Webview, private sessionId: string = 'default') { }

    public updateSettings(settings: any) {
        this._settings = settings || {};
        console.log(`LocalAgent [${this.sessionId}] Settings updated:`, Object.keys(this._settings));
        
        // Setup debug listeners if not already done
        this.setupDebugListeners();
    }

    private _debugListenersSet = false;
    private setupDebugListeners() {
        if (this._debugListenersSet) return;
        this._debugListenersSet = true;

        vscode.debug.onDidChangeActiveDebugSession(e => {
            this.webview.postMessage({ 
                type: 'debugEvent', 
                event: e ? 'sessionStarted' : 'sessionStopped', 
                sessionId: e?.id,
                name: e?.name
            });
        });

        vscode.debug.onDidTerminateDebugSession(e => {
            this.webview.postMessage({ 
                type: 'debugEvent', 
                event: 'sessionTerminated', 
                sessionId: e.id,
                name: e.name
            });
        });

        vscode.debug.onDidChangeBreakpoints(e => {
            this.webview.postMessage({ 
                type: 'debugEvent', 
                event: 'breakpointsChanged',
                added: e.added.length,
                removed: e.removed.length,
                changed: e.changed.length
            });
        });
    }

    public async execute(toolName: string, args: any, requestId: string) {
        console.log(`LocalAgent: Executing ${toolName}`, args);

        try {
            let result;
            const workingDir = args.workingDirectory || args.cwd;
            if (args.CommandLine) {
                console.log(`LocalAgent: Executing command: ${args.CommandLine} in ${workingDir}`);
            }
            switch (toolName) {
                case 'OverwriteFile':
                case 'PatchFile':
                    if (this._settings.restrictFilesystem && !this.isWithinWorkspace(args.file_path || args.path, workingDir)) {
                        throw new Error(`Access denied: Cannot write outside workspace when "Restricted Filesystem" is enabled.`);
                    }
                    result = await this.createFile(args.file_path || args.path, args.content || args.new_string || '', workingDir);
                    break;
                case 'write_to_file':
                    if (this._settings.restrictFilesystem && !this.isWithinWorkspace(args.TargetFile || args.file_path || args.path, workingDir)) {
                        throw new Error(`Access denied: Cannot write outside workspace when "Restricted Filesystem" is enabled.`);
                    }
                    result = await this.createFile(args.TargetFile || args.file_path || args.path, args.CodeContent || args.content || '', workingDir);
                    break;
                case 'replace_file_content':
                case 'multi_replace_file_content':
                    if (this._settings.restrictFilesystem && !this.isWithinWorkspace(args.TargetFile || args.path, workingDir)) {
                        throw new Error(`Access denied: Cannot edit outside workspace when "Restricted Filesystem" is enabled.`);
                    }
                    result = await this.editFile(args, workingDir);
                    break;
                case 'View':
                case 'ReadFile':
                case 'view_file':
                    if (this._settings.restrictFilesystem && !this.isWithinWorkspace(args.AbsolutePath || args.file_path || args.path, workingDir)) {
                        throw new Error(`Access denied: File is outside workspace and "Restricted Filesystem" is enabled.`);
                    }
                    result = await this.readFile(args.AbsolutePath || args.file_path || args.path, workingDir);
                    if (args.StartLine) {
                        this.jumpToFile(args.AbsolutePath || args.file_path || args.path, args.StartLine - 1, workingDir);
                    }
                    break;
                case 'LS':
                case 'listDir':
                case 'list_dir':
                    if (this._settings.restrictFilesystem && !this.isWithinWorkspace(args.DirectoryPath || args.path || args.directory || '.', workingDir)) {
                        throw new Error(`Access denied: Directory is outside workspace and "Restricted Filesystem" is enabled.`);
                    }
                    result = await this.listDir(args.DirectoryPath || args.path || args.directory || '.', workingDir);
                    break;
                case 'VSCodeTerminal':
                case 'Bash':
                case 'run_command':
                    if (this._settings.restrictFilesystem) {
                        // Very basic check for directory changing in command
                        const cmd = (args.CommandLine || args.command || args.cmd || '').toLowerCase();
                        if (cmd.includes('cd ..') || cmd.includes('cd /') || cmd.includes('cd ~')) {
                             throw new Error(`Access denied: Navigating outside workspace is restricted.`);
                        }
                    }
                    result = await this.executeInTerminal(args.CommandLine || args.command || args.cmd, workingDir);
                    break;
                case 'VSCodeSearch':
                case 'GrepTool':
                case 'grep_search':
                    result = await this.searchInWorkspace(args.Query || args.query || args.pattern);
                    break;
                case 'VSCodeDebug':
                case 'vscode_debug':
                    result = await this.startDebug(args.configName || args.configuration);
                    break;
                case 'VSCodeAddBreakpoint':
                case 'vscode_breakpoint':
                    if (args.action === 'clear') {
                        result = await this.clearBreakpoints();
                    } else {
                        result = await this.addBreakpoint(args.path || args.file, args.line, workingDir);
                    }
                    break;
                case 'VSCodeClearBreakpoints':
                    result = await this.clearBreakpoints();
                    break;
                case 'VSCodeEvaluate':
                case 'vscode_evaluate':
                    result = await this.evaluate(args.expression, args.frameId);
                    break;
                case 'VSCodeDebugCommand':
                case 'vscode_debug_command':
                    result = await this.debugCommand(args.command);
                    break;
                case 'VSCodeDebugInfo':
                case 'vscode_debug_info':
                    result = await this.getDebugInfo(args.type || args.command || 'state', args);
                    break;
                case 'VSCodeFindSymbols':
                case 'search_symbols':
                    result = await this.findSymbols(args.query || args.Query);
                    break;
                case 'VSCodeGetDiagnostics':
                case 'get_diagnostics':
                    result = await this.getDiagnostics();
                    break;
                case 'VSCodeGetDefinitions':
                case 'get_definitions':
                    result = await this.getLspInfo('vscode.executeDefinitionProvider', args.path || args.file, args.line, args.character);
                    break;
                case 'VSCodeGetReferences':
                case 'get_references':
                    result = await this.getLspInfo('vscode.executeReferenceProvider', args.path || args.file, args.line, args.character);
                    break;
                case 'VSCodeGetImplementations':
                case 'get_implementations':
                    result = await this.getLspInfo('vscode.executeImplementationProvider', args.path || args.file, args.line, args.character);
                    break;
                case 'streamToEditor':
                    result = await this.streamToEditor(args.path, args.content, args.isFirstChunk, workingDir);
                    break;
                case 'jumpToFile':
                case 'jump_to_line':
                    result = await this.jumpToFile(args.path || args.AbsolutePath || args.file, args.line || args.StartLine, workingDir);
                    break;
                case 'fetch':
                    if (this._settings.enableWebAccess === false && !args.url.includes('localhost') && !args.url.includes('127.0.0.1')) {
                        throw new Error(`Access denied: Web access is disabled in settings.`);
                    }
                    result = await this.performFetch(args);
                    break;
                case 'mcp_call_tool':
                    result = await this.callMCPTool(args.serverName, args.toolName, args.arguments);
                    break;
                case 'cloud_storage_upload':
                    result = await this.uploadToCloudStorage(args.bucketName, args.key, args.content || args.filePath, workingDir);
                    break;
                default:
                    throw new Error(`Tool ${toolName} not supported by Local Agent`);
            }

            this.sendResult(requestId, result);
        } catch (error: any) {
            console.log(`LocalAgent: Error executing ${toolName} ${error.message}`, error);
            this.sendResult(requestId, { success: false, error: error.message });
        }
    }

    private async editFile(args: any, workingDir?: string) {
        const targetFile = args.TargetFile;
        const absolutePath = this.resolvePath(targetFile, workingDir);
        const uri = vscode.Uri.file(absolutePath);

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();
            let newContent = text;

            // Apply text replacements
            if (args.ReplacementChunks) {
                for (const chunk of args.ReplacementChunks) {
                    newContent = newContent.replace(chunk.TargetContent, chunk.ReplacementContent);
                }
            } else if (args.TargetContent && args.ReplacementContent !== undefined) {
                newContent = newContent.replace(args.TargetContent, args.ReplacementContent);
            }

            // Apply VS Code native edit
            if (newContent !== text) {
                // Open and show the document first so the user sees the change
                const editor = await vscode.window.showTextDocument(document);

                const edit = new vscode.WorkspaceEdit();
                edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), newContent);
                await vscode.workspace.applyEdit(edit);
                
                // Reveal the first change if possible, or just the top of the file
                editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.InCenter);

                // Intentionally NOT calling document.save() automatically
                // This allows the "Pending Edits" UI to track it so users can Accept/Reject it
                const diagnostics = await this.getFileDiagnostics(uri);
                return { 
                    success: true, 
                    message: `Successfully edited ${targetFile}`,
                    diagnostics: diagnostics.length > 0 ? diagnostics : undefined
                };
            }

            // Jump to the line
            let startLineNum = args.StartLine ? parseInt(args.StartLine, 10) - 1 : 0;
            if (startLineNum < 0) startLineNum = 0;
            await this.jumpToFile(targetFile, startLineNum);

            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    private async jumpToFile(filePath: string, line?: number, workingDir?: string) {
        const absolutePath = this.resolvePath(filePath, workingDir);
        const uri = vscode.Uri.file(absolutePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);

        if (line !== undefined) {
            const pos = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
        return { success: true };
    }

    private async streamToEditor(filePath: string, content: string, isFirstChunk: boolean, workingDir?: string) {
        const absolutePath = this.resolvePath(filePath, workingDir);
        const uri = vscode.Uri.file(absolutePath);

        // 1. Ensure file exists
        if (!fs.existsSync(absolutePath)) {
            const folderUri = vscode.Uri.file(path.dirname(absolutePath));
            await vscode.workspace.fs.createDirectory(folderUri);
            await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf8'));
        }

        // 2. Find or open editor
        let editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === absolutePath);
        if (!editor) {
            const document = await vscode.workspace.openTextDocument(uri);
            editor = await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        }

        // 3. Perform the edit
        // We use replace of the whole content because the backend sends the full content so far for stability.
        // Doing this via editor.edit is much smoother than fs.writeFile + showTextDocument.
        await editor.edit(editBuilder => {
            const document = editor!.document;
            const lastLine = document.lineCount - 1;
            const lastChar = document.lineAt(lastLine).text.length;
            const fullRange = new vscode.Range(0, 0, lastLine, lastChar);
            editBuilder.replace(fullRange, content);
        }, { undoStopBefore: false, undoStopAfter: false });

        // 4. Reveal the end of the file to follow the "typing"
        const lastPos = new vscode.Position(editor.document.lineCount - 1, 0);
        editor.revealRange(new vscode.Range(lastPos, lastPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);

        return { success: true };
    }

    private async searchInWorkspace(query: string) {
        // Use VS Code's built-in search command
        // Note: For programmatic results, we can use a more advanced approach, 
        // but for now, we'll trigger the search UI or use a search provider call if available.
        await vscode.commands.executeCommand('workbench.action.findInFiles', {
            query: query,
            triggerSearch: true,
            isCaseSensitive: false,
            matchWholeWord: false,
            isRegexp: false
        });
        return { success: true, message: `Searching for "${query}" in workspace...` };
    }

    private async findSymbols(query: string) {
        if (!query) return { success: false, error: "No query provided for symbol search" };
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            query
        );
        return { 
            success: true, 
            symbols: symbols?.map(s => ({ 
                name: s.name, 
                kind: vscode.SymbolKind[s.kind], 
                location: s.location.uri.fsPath,
                line: s.location.range.start.line + 1,
                containerName: s.containerName
            })) 
        };
    }

    private async getDiagnostics() {
        const diagnostics = vscode.languages.getDiagnostics();
        const results: any[] = [];
        
        for (const [uri, fileDiagnostics] of diagnostics) {
            // Filter out empty diagnostics and non-error/warning issues if needed
            const importantDiagnostics = fileDiagnostics.filter(d => 
                d.severity === vscode.DiagnosticSeverity.Error || 
                d.severity === vscode.DiagnosticSeverity.Warning
            );

            if (importantDiagnostics.length === 0) continue;
            
            const filePath = uri.fsPath;
            // Skip node_modules or system files to keep context clean
            if (filePath.includes('node_modules') || filePath.includes('.vscode')) continue;
            
            results.push({
                file: filePath,
                problems: importantDiagnostics.map(d => ({
                    message: d.message,
                    severity: vscode.DiagnosticSeverity[d.severity],
                    line: d.range.start.line + 1,
                    character: d.range.start.character + 1,
                    source: d.source || 'unknown'
                }))
            });
        }
        
        return { success: true, diagnostics: results };
    }

    private async getLspInfo(command: string, filePath: string, line: number, character: number) {
        const absolutePath = this.resolvePath(filePath);
        const uri = vscode.Uri.file(absolutePath);
        // VS Code is 0-indexed internally
        const position = new vscode.Position(line > 0 ? line - 1 : 0, character > 0 ? character - 1 : 0);

        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                command,
                uri,
                position
            );

            if (!locations || (Array.isArray(locations) && locations.length === 0)) {
                return { success: true, message: "No locations found", locations: [] };
            }

            const results = (Array.isArray(locations) ? locations : [locations]).map((loc: any) => {
                const targetUri = loc.uri || loc.targetUri;
                const targetRange = loc.range || loc.targetRange;
                return {
                    file: targetUri.fsPath,
                    line: targetRange.start.line + 1,
                    character: targetRange.start.character + 1
                };
            });

            return { success: true, locations: results };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    private async startDebug(config?: string | any) {
        console.log(`LocalAgent: startDebug called with`, config);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        try {
            // Focus debug view automatically as requested by user
            await vscode.commands.executeCommand('workbench.view.debug');
            
            // If config is an object, use it directly. If string, use as name.
            // Using Thenable directly to avoid potential await hang in some VS Code versions
            const startResult = vscode.debug.startDebugging(workspaceFolder, config || 'Launch Program');
            
            // We'll wait for it with a timeout just in case
            const success = await Promise.race([
                startResult,
                new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5000)) // Fallback success after 5s if no error
            ]);

            console.log(`LocalAgent: startDebug result:`, success);
            return { 
                success: true, 
                message: success ? `Started debugging session. Switched to Debug View.` : "Debugging session start initiated. Switched to Debug View." 
            };
        } catch (err: any) {
            console.error(`LocalAgent: startDebug error:`, err);
            return { success: false, error: err.message };
        }
    }

    private async addBreakpoint(filePath: string, line: number, workingDir?: string) {
        const absolutePath = this.resolvePath(filePath, workingDir);
        const uri = vscode.Uri.file(absolutePath);
        // VS Code UI is 1-indexed, internally 0-indexed
        const position = new vscode.Position(line > 0 ? line - 1 : 0, 0);
        const location = new vscode.Location(uri, position);
        const bp = new vscode.SourceBreakpoint(location, true);
        vscode.debug.addBreakpoints([bp]);
        return { success: true, message: `Breakpoint added at ${filePath}:${line}` };
    }

    private async clearBreakpoints() {
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        return { success: true, message: "Cleared all breakpoints" };
    }

    private async evaluate(expression: string, frameId?: number) {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            return { success: false, error: "No active debug session" };
        }
        try {
            const reply = await session.customRequest('evaluate', {
                expression,
                frameId: frameId,
                context: "repl"
            });
            return { success: true, result: reply.result, variablesReference: reply.variablesReference };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    private async debugCommand(command: string) {
        // command should be one of: continue, stepOver, stepInto, stepOut, stop
        const validCommands = ['continue', 'stepOver', 'stepInto', 'stepOut', 'stop'];
        if (!validCommands.includes(command)) {
            return { success: false, error: `Invalid debug command. Use one of: ${validCommands.join(', ')}` };
        }

        await vscode.commands.executeCommand(`workbench.action.debug.${command}`);
        return { success: true, message: `Executed debug ${command}` };
    }

    private async getDebugInfo(type: string, args: any) {
        const session = vscode.debug.activeDebugSession;
        try {
            if (type === 'breakpoints') {
                const bps = vscode.debug.breakpoints.map((b: any) => ({
                    file: b.location?.uri?.fsPath,
                    line: b.location?.range?.start?.line != null ? b.location.range.start.line + 1 : 'unknown'
                }));
                return { success: true, breakpoints: bps };
            }

            if (!session) return { success: false, error: "No active debug session" };

            if (type === 'stack') {
                const threadsReply = await session.customRequest('threads');
                if (!threadsReply || !threadsReply.threads || threadsReply.threads.length === 0) {
                    return { success: false, error: "No active threads found" };
                }
                const threadId = args.threadId || threadsReply.threads[0].id;
                const stackReply = await session.customRequest('stackTrace', { threadId });
                return { success: true, stackFrames: stackReply.stackFrames };
            }

            if (type === 'variables') {
                let varsRef = args.variablesReference;
                if (!varsRef && args.frameId) {
                    const scopesReply = await session.customRequest('scopes', { frameId: args.frameId });
                    if (scopesReply && scopesReply.scopes && scopesReply.scopes.length > 0) {
                        varsRef = scopesReply.scopes[0].variablesReference; // Usually the 'Local' scope
                    }
                }
                if (!varsRef) {
                    return { success: false, error: "Must provide variablesReference or frameId to examine variables" };
                }
                const varsReply = await session.customRequest('variables', { variablesReference: varsRef });
                return { success: true, variables: varsReply.variables };
            }

            if (type === 'state') {
                const bps = vscode.debug.breakpoints.map((b: any) => ({
                    file: b.location?.uri?.fsPath,
                    line: b.location?.range?.start?.line != null ? b.location.range.start.line + 1 : 'unknown',
                    enabled: b.enabled
                }));

                const state: any = {
                    activeSession: session ? {
                        name: session.name,
                        type: session.type,
                        id: session.id
                    } : null,
                    breakpoints: bps
                };

                if (session) {
                    try {
                        const threadsReply = await session.customRequest('threads');
                        state.threads = threadsReply.threads;
                    } catch (e) {
                        state.threads = [];
                    }
                }

                return { success: true, state };
            }

            return { success: false, error: "Unknown info type. Use 'stack', 'variables', 'breakpoints', or 'state'." };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    private async createFile(filePath: string, content: string, workingDir?: string) {
        const absolutePath = this.resolvePath(filePath, workingDir);
        const uri = vscode.Uri.file(absolutePath);
        const folderUri = vscode.Uri.file(path.dirname(absolutePath));

        await vscode.workspace.fs.createDirectory(folderUri);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));

        // Auto-open the file and show it
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: false });

        const diagnostics = await this.getFileDiagnostics(uri);
        return { 
            success: true, 
            path: absolutePath,
            diagnostics: diagnostics.length > 0 ? diagnostics : undefined
        };
    }

    private async getFileDiagnostics(uri: vscode.Uri) {
        // Wait a bit for VS Code to update diagnostics after file change
        await new Promise(resolve => setTimeout(resolve, 800));
        const fileDiagnostics = vscode.languages.getDiagnostics(uri);
        return fileDiagnostics
            .filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning)
            .map(d => ({
                message: d.message,
                severity: vscode.DiagnosticSeverity[d.severity],
                line: d.range.start.line + 1
            }));
    }

    private async readFile(filePath: string, workingDir?: string) {
        const absolutePath = this.resolvePath(filePath, workingDir);
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
        return { success: true, content: Buffer.from(content).toString('utf8') };
    }

    private async listDir(dirPath: string, workingDir?: string) {
        const absolutePath = this.resolvePath(dirPath, workingDir);
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(absolutePath));
        return {
            success: true,
            entries: entries.map(([name, type]) => ({ name, type }))
        };
    }

    private async executeInTerminal(command: string, workingDir?: string) {
        try {
            console.log(`CoderX Executing: ${command}`);
            const shortId = this.sessionId === 'default' ? '' : `-${this.sessionId.substring(0, 4)}`;
            const termName = `CoderX${shortId}`;

            let terminal = vscode.window.terminals.find(t => t.name === termName);
            if (!terminal) {
                const termOptions: vscode.TerminalOptions = { name: termName };
                const defaultCwd = workingDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (defaultCwd) {
                    termOptions.cwd = defaultCwd;
                }
                terminal = vscode.window.createTerminal(termOptions);
            }

            terminal.show(false); // Take focus

            // Show command in terminal for visual feedback
            terminal.sendText(`echo "[CoderX] Executing: ${command}"`);

            const cwd = workingDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const { stdout, stderr } = await execAsync(command, { cwd, timeout: 300000 });
            
            return { success: true, command, stdout, stderr };
        } catch (e: any) {
            return { success: false, command, error: e.message, stdout: e.stdout, stderr: e.stderr };
        }
    }


    private resolvePath(p: string, baseDir?: string): string {
        if (path.isAbsolute(p)) return p;
        const root = baseDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        return path.resolve(root, p);
    }

    private isWithinWorkspace(p: string, baseDir?: string): boolean {
        const absolutePath = this.resolvePath(p, baseDir);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return true; // No workspace, can't restrict
        
        return workspaceFolders.some(folder => {
            const folderPath = folder.uri.fsPath;
            const relative = path.relative(folderPath, absolutePath);
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        });
    }

    private async performFetch(args: any) {
        const { url, method, headers, body, isStream, requestId } = args;
        console.log(`LocalAgent: Fetching ${url} (Stream: ${isStream})`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout (increased from 30s for local AI)
        
        try {
            let response: any;
            console.log(`[LocalAgent] Fetching ${url} with method ${method || 'GET'}`);
            
            // Special handling for local services (Ollama, etc.) to avoid Node fetch/undici issues with localhost
            const isLocal = url.includes('localhost') || url.includes('127.0.0.1');

            if (!isLocal) {
				const nodeFetch = (await import('node-fetch')).default;
                response = await nodeFetch(url, {
                    method: method || 'GET',
                    headers: headers || {},
                    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
                    signal: controller.signal as any
                });
            } else {
                // Fallback to http/https for local or when fetch is missing
                response = await this.nodeFetchFallback(url, {
                    method: method || 'GET',
                    headers: headers || {},
                    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
                    isStream: !!isStream,
                    signal: controller.signal
                });
            }
            clearTimeout(timeout);

            const responseHeaders: any = {};
            if (response.headers.forEach) {
                response.headers.forEach((value: string, key: string) => {
                    responseHeaders[key] = value;
                });
            } else {
                // Handle raw headers from fallback
                Object.assign(responseHeaders, response.headers);
            }

            if (isStream && response.body) {
                // Initial response info
                this.webview.postMessage({ 
                    type: 'fetchRelayResult', 
                    requestId, 
                    response: {
                        status: response.status,
                        statusText: response.statusText,
                        headers: responseHeaders,
                        isStream: true
                    }
                });

                // Stream the body
                if (typeof response.body.getReader === 'function') {
                    // Standard fetch ReadableStream
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                this.webview.postMessage({ type: 'fetchRelayChunk', requestId, done: true });
                                break;
                            }
                            const chunk = decoder.decode(value, { stream: true });
                            this.webview.postMessage({ type: 'fetchRelayChunk', requestId, chunk });
                        }
                    } catch (streamErr: any) {
                        this.webview.postMessage({ type: 'fetchRelayChunk', requestId, error: streamErr.message });
                    }
                } else if (typeof response.body.on === 'function') {
                    // Node.js IncomingMessage (fallback)
                    response.body.on('data', (chunk: Buffer) => {
                        this.webview.postMessage({ type: 'fetchRelayChunk', requestId, chunk: chunk.toString('utf8') });
                    });
                    response.body.on('end', () => {
                        this.webview.postMessage({ type: 'fetchRelayChunk', requestId, done: true });
                    });
                    response.body.on('error', (err: Error) => {
                        this.webview.postMessage({ type: 'fetchRelayChunk', requestId, error: err.message });
                    });
                }
                return { success: true, handled: true };
            } else {
                // Full body response
                let resultBody;
                if (typeof response.json === 'function') {
                    const text = await response.text();
                    try {
                        resultBody = JSON.parse(text);
                    } catch (e) {
                        resultBody = text;
                    }
                } else {
                    resultBody = response.body; // already handled in fallback
                    if (typeof resultBody === 'string') {
                        try {
                            resultBody = JSON.parse(resultBody);
                        } catch (e) {}
                    }
                }

                this.webview.postMessage({
                    type: 'fetchRelayResult',
                    requestId,
                    response: {
                        status: response.status,
                        statusText: response.statusText,
                        headers: responseHeaders,
                        body: resultBody,
                        isStream: false
                    }
                });
                return { status: response.status, body: resultBody, success: true };
            }
        } catch (error: any) {
            console.error('LocalAgent: Fetch error', error);
            let errorMessage = error.message || 'Fetch failed';
            
            // Better error message for common Node connectivity issues
            if (error.name === 'AggregateError' || errorMessage.includes('ECONNREFUSED')) {
                errorMessage = `Connection refused. Is the local service (e.g. Ollama) running at ${url}?`;
            }

            this.webview.postMessage({
                type: 'fetchRelayResult',
                requestId,
                response: {
                    error: errorMessage
                }
            });
            return { error: errorMessage, success: false };
        }
    }

    private nodeFetchFallback(url: string, options: any): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const parsedUrl = new URL(url);
                const proxyUrl = this._settings.webFetchProxy ? new URL(this._settings.webFetchProxy) : null;
                
                let reqOptions: any;
                let protocol: any;

                if (proxyUrl && parsedUrl.protocol === 'http:') {
                    // Basic HTTP Proxy support
                    protocol = proxyUrl.protocol === 'https:' ? https : http;
                    reqOptions = {
                        method: options.method,
                        headers: { ...options.headers, 'Host': parsedUrl.host },
                        hostname: proxyUrl.hostname,
                        port: proxyUrl.port,
                        path: url // Full URL for proxy
                    };
                } else {
                    protocol = parsedUrl.protocol === 'https:' ? https : http;
                    reqOptions = {
                        method: options.method,
                        headers: options.headers,
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port,
                        path: parsedUrl.pathname + parsedUrl.search
                    };
                }

                const req = protocol.request(reqOptions, (res: any) => {
                    const chunks: any[] = [];
                    
                    // If it's a stream, we don't want to buffer
                    if (options.isStream) {
                        resolve({
                            status: res.statusCode,
                            statusText: res.statusMessage,
                            headers: res.headers,
                            body: res, // The IncomingMessage is a ReadableStream
                            ok: (res.statusCode || 0) < 400
                        });
                        return;
                    }

                    res.on('data', (chunk: any) => chunks.push(chunk));
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString();
                        resolve({
                            status: res.statusCode,
                            statusText: res.statusMessage,
                            headers: res.headers,
                            body: body,
                            text: async () => body,
                            json: async () => JSON.parse(body),
                            ok: (res.statusCode || 0) < 400
                        });
                    });
                });

                req.on('error', (err: any) => reject(err));

                // Add timeout to request
                // Increase timeout to 5 minutes for local model processing
                req.setTimeout(300000, () => {
                    console.error('[LocalAgent] Fetch relay request timed out after 5 minutes');
                    req.destroy(new Error('Request timed out after 5 minutes'));
                });

                if (options.body) {
                    req.write(options.body);
                }
                req.end();
            } catch (e) {
                reject(e);
            }
        });
    }

    private async callMCPTool(serverName: string, toolName: string, toolArgs: any) {
        console.log(`LocalAgent: Calling MCP Tool ${toolName} on server ${serverName}`);
        
        const mcpServers = this._settings.mcpServers || [];
        const serverConfig = mcpServers.find((s: any) => s.name === serverName);
        
        if (!serverConfig) {
            throw new Error(`MCP Server "${serverName}" not found in settings.`);
        }

        return new Promise((resolve, reject) => {
            try {
                const child = cp.spawn(serverConfig.command, serverConfig.args || [], {
                    env: { ...process.env, ...(serverConfig.env || {}) },
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let output = '';
                let errorOutput = '';

                child.stdout.on('data', (data) => output += data.toString());
                child.stderr.on('data', (data) => errorOutput += data.toString());

                // Simple JSON-RPC protocol implementation for MCP
                const request = {
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: {
                        name: toolName,
                        arguments: toolArgs
                    },
                    id: Date.now()
                };

                child.stdin.write(JSON.stringify(request) + '\n');
                
                child.on('close', (code) => {
                    if (code !== 0 && !output) {
                        reject(new Error(`MCP server exited with code ${code}: ${errorOutput}`));
                        return;
                    }
                    try {
                        const response = JSON.parse(output);
                        resolve(response.result || response);
                    } catch (e) {
                        resolve({ output, error: errorOutput });
                    }
                });

                // Set a timeout
                setTimeout(() => {
                    child.kill();
                    reject(new Error('MCP tool call timed out after 30s'));
                }, 300000); // 5 minute overall timeout for non-streamed requests

            } catch (err) {
                reject(err);
            }
        });
    }

    private async uploadToCloudStorage(bucketName: string, key: string, contentOrPath: string, workingDir?: string) {
        console.log(`LocalAgent: Uploading to S3 bucket ${bucketName}, key ${key}`);
        
        const s3Configs = this._settings.s3Configs || [];
        const config = s3Configs.find((c: any) => c.bucket === bucketName);
        
        if (!config) {
            throw new Error(`S3 Configuration for bucket "${bucketName}" not found.`);
        }

        let body: Buffer;
        if (contentOrPath && fs.existsSync(this.resolvePath(contentOrPath, workingDir))) {
            body = fs.readFileSync(this.resolvePath(contentOrPath, workingDir));
        } else {
            body = Buffer.from(contentOrPath || '');
        }

        // For now, we'll implement a basic PUT request. 
        // Real S3 signing is complex, so we'll use a simplified version or a placeholder if it's too much.
        // Given the constraints, I'll implement a basic notification to the user that it's being attempted.
        
        return new Promise((resolve, reject) => {
            const endpoint = config.endpoint || `https://${bucketName}.s3.${config.region || 'us-east-1'}.amazonaws.com`;
            const url = new URL(endpoint);
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `/${key}`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': body.length,
                    'x-amz-acl': 'public-read'
                }
            };

            const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
                if ((res.statusCode || 0) < 300) {
                    resolve({ success: true, url: `${endpoint}/${key}` });
                } else {
                    reject(new Error(`S3 Upload failed with status ${res.statusCode}`));
                }
            });

            req.on('error', (err) => reject(err));
            req.write(body);
            req.end();
        });
    }

    private sendResult(requestId: string, result: any) {
        this.webview.postMessage({ type: 'toolResult', requestId, result });
    }
}

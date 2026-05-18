import * as vscode from 'vscode';

export class CodixEventManager {
    private static instance: CodixEventManager;
    private _onDidReceiveOperations = new vscode.EventEmitter<any[]>();
    
    public readonly onDidReceiveOperations = this._onDidReceiveOperations.event;

    private constructor() {}

    public static getInstance(): CodixEventManager {
        if (!CodixEventManager.instance) {
            CodixEventManager.instance = new CodixEventManager();
        }
        return CodixEventManager.instance;
    }

    /**
     * Gửi các lệnh thao tác (operations) từ Codix Chat sang Clip Editor
     */
    public sendOperations(operations: any[]) {
        console.log('[CodixEventManager] Broadcasting operations:', operations);
        this._onDidReceiveOperations.fire(operations);
    }
}

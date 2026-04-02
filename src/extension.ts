import * as vscode from 'vscode';

/** 虚拟 Diff：自定义 scheme，只读、不落盘，关闭时不提示保存 */
const VIRTUAL_SCHEME = 'cursor-ai-monitor';

let statusBarItem: vscode.StatusBarItem;
let debounceTimer: NodeJS.Timeout;
let changeAccumulator: Map<string, number> = new Map();
let activeFileInfo: { name: string; startTime: number; originalContent: string; filePath: string } | null = null;
let currentDiffView: {
    sessionId: string;
    filePath: string;
    originalUri: vscode.Uri;
    modifiedUri: vscode.Uri;
    closed: boolean;
} | null = null;

class VirtualDiffDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    private readonly sessions = new Map<string, { original: string; modified: string }>();

    dispose(): void {
        this._onDidChange.dispose();
        this.sessions.clear();
    }

    setSessionContent(sessionId: string, original: string, modified: string): void {
        this.sessions.set(sessionId, { original, modified });
    }

    removeSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    /** 通知 Diff 两侧文档内容已变，触发视图刷新 */
    fireSessionChanged(sessionId: string, originalUri: vscode.Uri, modifiedUri: vscode.Uri): void {
        this._onDidChange.fire(originalUri);
        this._onDidChange.fire(modifiedUri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const sessionId = this.parseSessionId(uri);
        const side = this.parseSide(uri);
        if (!sessionId || !side) {
            return '';
        }
        const data = this.sessions.get(sessionId);
        if (!data) {
            return '';
        }
        return side === 'original' ? data.original : data.modified;
    }

    private parseSessionId(uri: vscode.Uri): string | undefined {
        const parts = uri.path.split('/').filter((p) => p.length > 0);
        if (parts.length < 3 || parts[0] !== 'diff') {
            return undefined;
        }
        return parts[1];
    }

    private parseSide(uri: vscode.Uri): 'original' | 'modified' | undefined {
        const parts = uri.path.split('/').filter((p) => p.length > 0);
        if (parts.length < 3 || parts[0] !== 'diff') {
            return undefined;
        }
        const s = parts[2];
        return s === 'original' || s === 'modified' ? s : undefined;
    }
}

let virtualDiffProvider: VirtualDiffDocumentProvider;

function buildVirtualUri(sessionId: string, side: 'original' | 'modified', labelFileName: string): vscode.Uri {
    const label = encodeURIComponent(labelFileName.replace(/\\/g, '/'));
    return vscode.Uri.from({
        scheme: VIRTUAL_SCHEME,
        path: `/diff/${sessionId}/${side}/${label}`,
    });
}

// 只读监测模式 - 日志面板
let logPanel: vscode.WebviewPanel | null = null;
let logEntries: string[] = [];
const MAX_LOG_ENTRIES = 500;

function getTimestamp(): string {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { hour12: false });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function addLogEntry(entry: string, type: 'info' | 'create' | 'edit' | 'save' | 'complete' = 'info') {
    const timestamp = getTimestamp();
    const iconMap = {
        info: '🔍',
        create: '📄',
        edit: '✏️',
        save: '💾',
        complete: '✅'
    };
    const icon = iconMap[type];
    const escapedEntry = escapeHtml(entry);
    logEntries.push(`<div class="log-entry ${type}">[<span class="time">${timestamp}</span>] ${icon} ${escapedEntry}</div>`);
    
    // 限制日志数量
    if (logEntries.length > MAX_LOG_ENTRIES) {
        logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
    }
    
    updateLogPanel();
}

function updateLogPanel() {
    if (!logPanel) return;
    
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 13px;
            padding: 10px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .log-entry {
            padding: 4px 0;
            border-bottom: 1px solid rgba(128, 128, 128, 0.2);
            white-space: pre-wrap;
            word-break: break-all;
        }
        .log-entry.create { color: #4ec9b0; }
        .log-entry.edit { color: #dcdcaa; }
        .log-entry.save { color: #569cd6; }
        .log-entry.complete { color: #6a9955; }
        .time {
            color: #858585;
            font-size: 11px;
        }
        #log-container {
            height: calc(100vh - 20px);
            overflow-y: auto;
        }
        #log-container::-webkit-scrollbar {
            width: 8px;
        }
        #log-container::-webkit-scrollbar-thumb {
            background-color: rgba(128, 128, 128, 0.4);
            border-radius: 4px;
        }
        .header {
            background: var(--vscode-sideBar-background);
            padding: 10px;
            margin: -10px -10px 10px -10px;
            border-bottom: 1px solid rgba(128, 128, 128, 0.3);
        }
        .header h3 {
            margin: 0 0 5px 0;
            color: var(--vscode-textLink-foreground);
        }
        .header p {
            margin: 0;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h3>🔍 AI 操作监测日志</h3>
        <p>只读监测模式 - 仅显示操作，不保存任何文件</p>
    </div>
    <div id="log-container">
        ${logEntries.join('\n')}
    </div>
    <script>
        // 自动滚动到底部
        const container = document.getElementById('log-container');
        container.scrollTop = container.scrollHeight;
        
        // 每秒检查新内容
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>`;
    
    logPanel.webview.html = html;
}

function createLogPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'cursor-ai-monitor-log',
        'AI 监测日志',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true }
    );
    
    panel.onDidDispose(() => {
        logPanel = null;
    });
    
    updateLogPanel();
    return panel;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Cursor AI Monitor - 只读监测模式已激活');

    virtualDiffProvider = new VirtualDiffDocumentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, virtualDiffProvider),
        virtualDiffProvider,
    );
    
    // 创建状态栏
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9999);
    statusBarItem.text = "$(eye) 监控 AI 操作...";
    statusBarItem.tooltip = "Cursor AI Monitor - 只读监测模式";
    statusBarItem.command = 'cursor-ai-monitor.toggleLog';
    statusBarItem.show();
    
    // 初始化日志面板
    addLogEntry('🚀 只读监测模式已启动', 'info');
    addLogEntry('📋 创建文件：显示文件名和内容预览', 'info');
    addLogEntry('✏️ 编辑文件：显示实时 Diff 视图', 'info');
    addLogEntry('⚠️ 所有操作仅监测，不保存任何文件', 'info');
    
    // 监听文件变化
    const textChangeListener = vscode.workspace.onDidChangeTextDocument(async (event) => {
        const doc = event.document;
        const fileName = vscode.workspace.asRelativePath(doc.uri);
        const filePath = doc.uri.fsPath;
        const currentContent = doc.getText();
        
        // 计算变化量
        let changeSize = 0;
        for (const change of event.contentChanges) {
            changeSize += change.text.length;
        }
        
        // 累积变化
        const total = (changeAccumulator.get(filePath) || 0) + changeSize;
        changeAccumulator.set(filePath, total);
        
        // 首次编辑时，保存原始内容
        if (!activeFileInfo || activeFileInfo.filePath !== filePath) {
            closeDiffView();
            
            activeFileInfo = { 
                name: fileName, 
                startTime: Date.now(),
                originalContent: currentContent,
                filePath: filePath
            };
            
            addLogEntry(`✏️ 开始编辑: ${fileName}`, 'edit');
        }
        
        // 更新状态栏
        updateStatusBar('streaming', fileName, total);
        
        // 清除之前的定时器
        if (debounceTimer) clearTimeout(debounceTimer);
        
        // 实时显示 Diff
        await showLiveDiff(filePath, activeFileInfo.originalContent, currentContent, fileName);
        
        // 1.5秒无新变化，认为操作完成
        debounceTimer = setTimeout(() => {
            const finalTotal = changeAccumulator.get(filePath) || total;
            const duration = activeFileInfo ? (Date.now() - activeFileInfo.startTime) / 1000 : 0;
            
            updateStatusBar('complete', fileName, finalTotal, duration);
            addLogEntry(`✅ 编辑完成: ${fileName} (${finalTotal} 字符, ${duration.toFixed(1)}s)`, 'complete');
            
            // 2秒后关闭 Diff 视图并恢复空闲
            setTimeout(() => {
                closeDiffView();
                updateStatusBar('idle');
                changeAccumulator.delete(filePath);
                activeFileInfo = null;
            }, 2000);
        }, 1500);
    });
    
    // 监听文件创建 - 只读模式：只显示信息，不打开文件
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    fileWatcher.onDidCreate(async (uri) => {
        const fileName = vscode.workspace.asRelativePath(uri);
        const filePath = uri.fsPath;
        
        updateStatusBar('creating', fileName);
        addLogEntry(`📄 创建文件: ${fileName}`, 'create');
        
        // 尝试读取文件内容预览（仅读取，不修改）
        try {
            const content = await readFilePreview(uri, 500);
            if (content) {
                addLogEntry(`📝 内容预览 (前500字符):\n${content}`, 'info');
            }
        } catch (e) {
            // 忽略读取错误
        }
        
        // 关闭之前的 Diff 视图
        closeDiffView();
        
        // 3秒后恢复空闲状态
        setTimeout(() => {
            updateStatusBar('idle');
        }, 3000);
    });
    
    // 读取文件内容预览
    async function readFilePreview(uri: vscode.Uri, maxChars: number): Promise<string> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const content = doc.getText();
            const preview = content.slice(0, maxChars);
            return escapeHtml(preview) + (content.length > maxChars ? '\n... (内容截断)' : '');
        } catch {
            return '';
        }
    }
    
    // 监听保存事件 - 只显示，不干预
    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        const fileName = vscode.workspace.asRelativePath(doc.uri);
        updateStatusBar('saved', fileName);
        addLogEntry(`💾 保存文件: ${fileName}`, 'save');
        
        setTimeout(() => {
            if (statusBarItem.text.includes('保存')) {
                updateStatusBar('idle');
            }
        }, 2000);
    });
    
    // 切换日志面板显示
    const toggleLogCommand = vscode.commands.registerCommand('cursor-ai-monitor.toggleLog', () => {
        if (logPanel) {
            logPanel.reveal(vscode.ViewColumn.Beside, true);
        } else {
            logPanel = createLogPanel();
        }
    });
    
    // 显示日志面板
    const showLogCommand = vscode.commands.registerCommand('cursor-ai-monitor.showLog', () => {
        if (!logPanel) {
            logPanel = createLogPanel();
        } else {
            logPanel.reveal(vscode.ViewColumn.Beside, true);
        }
    });
    
    // 清空日志
    const clearLogCommand = vscode.commands.registerCommand('cursor-ai-monitor.clearLog', () => {
        logEntries = [];
        updateLogPanel();
        addLogEntry('🗑️ 日志已清空', 'info');
    });
    
    // 重置命令
    const resetCommand = vscode.commands.registerCommand('cursor-ai-monitor.reset', () => {
        updateStatusBar('idle');
        changeAccumulator.clear();
        activeFileInfo = null;
        closeDiffView();
        if (debounceTimer) clearTimeout(debounceTimer);
        logEntries = [];
        addLogEntry('🔄 状态已重置', 'info');
        vscode.window.showInformationMessage('AI Monitor 状态已重置');
    });
    
    // 状态查询命令
    const statusCommand = vscode.commands.registerCommand('cursor-ai-monitor.status', () => {
        if (activeFileInfo) {
            vscode.window.showInformationMessage(`AI 正在操作: ${activeFileInfo.name}`);
        } else {
            vscode.window.showInformationMessage('暂无 AI 操作');
        }
    });
    
    context.subscriptions.push(
        statusBarItem, 
        textChangeListener, 
        fileWatcher, 
        saveListener,
        resetCommand,
        statusCommand,
        toggleLogCommand,
        showLogCommand,
        clearLogCommand
    );
}

// 显示实时 Diff 视图（基于虚拟 URI，只读，关闭不提示保存）
async function showLiveDiff(
    filePath: string,
    originalContent: string,
    modifiedContent: string,
    fileName: string,
    isNewFile: boolean = false,
) {
    if (originalContent === modifiedContent && !isNewFile) {
        return;
    }

    const left = originalContent || (isNewFile ? '' : '// （空）\n');
    const right = modifiedContent;

    // 同一文件、已有 Diff：只更新内存中的虚拟内容并刷新
    if (currentDiffView && currentDiffView.filePath === filePath && !currentDiffView.closed) {
        virtualDiffProvider.setSessionContent(currentDiffView.sessionId, left, right);
        virtualDiffProvider.fireSessionChanged(
            currentDiffView.sessionId,
            currentDiffView.originalUri,
            currentDiffView.modifiedUri,
        );
        return;
    }

    await closeDiffView();

    const sessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    virtualDiffProvider.setSessionContent(sessionId, left, right);

    const originalUri = buildVirtualUri(sessionId, 'original', fileName);
    const modifiedUri = buildVirtualUri(sessionId, 'modified', fileName);

    const title = isNewFile ? `AI 正在创建: ${fileName}` : `AI 正在编辑: ${fileName}`;
    await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title);

    currentDiffView = {
        sessionId,
        filePath,
        originalUri,
        modifiedUri,
        closed: false,
    };
}

/** 关闭监测 Diff 标签页并释放虚拟会话（无磁盘文件、无保存提示） */
async function closeDiffView(): Promise<void> {
    if (!currentDiffView || currentDiffView.closed) {
        return;
    }
    const sessionId = currentDiffView.sessionId;
    currentDiffView.closed = true;

    await closeDiffTabForSession(sessionId);

    virtualDiffProvider.removeSession(sessionId);
    currentDiffView = null;
}

async function closeDiffTabForSession(sessionId: string): Promise<void> {
    const needle = `/diff/${sessionId}/`;
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputTextDiff) {
                const mod = input.modified;
                if (mod.scheme === VIRTUAL_SCHEME && mod.path.includes(needle)) {
                    await vscode.window.tabGroups.close(tab);
                    return;
                }
            }
        }
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

function updateStatusBar(
    state: 'streaming' | 'creating' | 'complete' | 'saved' | 'idle', 
    fileName?: string, 
    size?: number,
    duration?: number
) {
    const config = {
        streaming: {
            icon: '$(sync~spin)',
            bg: new vscode.ThemeColor('statusBarItem.warningBackground'),
            text: (n?: string, s?: number) => {
                const sizeStr = s && s > 100 ? ` ${Math.round(s/1024)}KB` : s ? ` ${s}字符` : '';
                return `[只读] ✏️ ${n}${sizeStr}`;
            }
        },
        creating: {
            icon: '$(new-file)',
            bg: new vscode.ThemeColor('statusBarItem.warningBackground'),
            text: (n?: string) => `[只读] 📄 ${n}`
        },
        complete: {
            icon: '$(check)',
            bg: undefined,
            text: (n?: string, s?: number, d?: number) => {
                const sizeStr = s ? ` ${Math.round(s/1024)}KB` : '';
                const timeStr = d ? ` ${d.toFixed(1)}s` : '';
                return `[只读] ✅ ${n}${sizeStr}${timeStr}`;
            }
        },
        saved: {
            icon: '$(save)',
            bg: undefined,
            text: (n?: string) => `[只读] 💾 ${n}`
        },
        idle: {
            icon: '$(eye)',
            bg: undefined,
            text: () => `🔍 只读监测...`
        }
    };
    
    const cfg = config[state];
    const text = cfg.text(fileName, size, duration);
    statusBarItem.text = `${cfg.icon} ${text}`;
    statusBarItem.backgroundColor = cfg.bg;
}

export function deactivate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    closeDiffView();
}
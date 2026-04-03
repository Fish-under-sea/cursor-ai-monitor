import * as vscode from 'vscode';

/** 虚拟 Diff：自定义 scheme，只读、不落盘 */
const VIRTUAL_SCHEME = 'cursor-ai-monitor';

/** 监测模式枚举 */
type MonitorMode = 'auto' | 'agent' | 'user';

/** 当前监测模式 */
let currentMode: MonitorMode = 'auto';

/** Agent 操作置信度 */
let agentConfidence = 0;

/** 上一次修改的文件路径 */
let lastModifiedFile: string | null = null;

/** 文件修改历史 */
const fileChangeHistory: { path: string; time: number; size: number }[] = [];

// ============================================================
// URI / 路径工具（用 vscode.Uri 而非 Node path，保持跨平台）
// ============================================================

function soulUriFromUri(uri: vscode.Uri): vscode.Uri {
    const fsPath = uri.fsPath;
    const dir = fsPath.substring(0, fsPath.lastIndexOf(/[/\\]/.test(fsPath) ? (fsPath.includes('\\') ? '\\' : '/') : '/'));
    const base = uri.path.substring(uri.path.lastIndexOf('/') + 1);
    const lastDot = base.lastIndexOf('.');
    const name = lastDot >= 0 ? base.substring(0, lastDot) : base;
    const ext = lastDot >= 0 ? base.substring(lastDot) : '';
    const soulName = name + '_soul' + ext;
    const soulPath = dir + '/' + soulName;
    return vscode.Uri.file(soulPath);
}

function isSoulMirrorUri(uri: vscode.Uri): boolean {
    return uri.path.endsWith('_soul') ||
        uri.path.includes('/_soul') ||
        uri.path.includes('\\_soul');
}

function fileNameFromUri(uri: vscode.Uri): string {
    const p = uri.path;
    return p.substring(p.lastIndexOf('/') + 1);
}

// ============================================================
// 监测状态管理
// ============================================================

interface MonitorSession {
    fileUri: vscode.Uri;
    soulUri: vscode.Uri;
    sessionId: string;
    startTime: number;
    isNewFile: boolean;
    originalContent: string;
    changeCount: number;
    debounceTimer: NodeJS.Timeout | undefined;
    closed: boolean;
    lastChangeTime: number;
}

let activeSession: MonitorSession | null = null;
let statusBarItem: vscode.StatusBarItem;

// ============================================================
// 虚拟 Diff Provider（虚拟文件，不落盘）
// ============================================================

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
        this._fire(sessionId);
    }

    removeSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    private _fire(sessionId: string): void {
        const parts = Array.from(this.sessions.keys());
        if (!parts.includes(sessionId)) return;
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const sessionId = this._parseSessionId(uri);
        const side = this._parseSide(uri);
        if (!sessionId || !side) return '';
        return this.sessions.get(sessionId)?.[side] ?? '';
    }

    private _parseSessionId(uri: vscode.Uri): string | undefined {
        const seg = uri.path.split('/').filter(Boolean);
        return seg[1];
    }

    private _parseSide(uri: vscode.Uri): 'original' | 'modified' | undefined {
        const seg = uri.path.split('/').filter(Boolean);
        const s = seg[2];
        return s === 'original' || s === 'modified' ? s : undefined;
    }
}

let virtualDiffProvider: VirtualDiffDocumentProvider;

let currentDiffView: {
    sessionId: string;
    fileUri: vscode.Uri;
    originalUri: vscode.Uri;
    modifiedUri: vscode.Uri;
    closed: boolean;
} | null = null;

function buildVirtualUri(sessionId: string, side: 'original' | 'modified', labelFileName: string): vscode.Uri {
    const label = encodeURIComponent(labelFileName.replace(/\\/g, '/'));
    return vscode.Uri.from({
        scheme: VIRTUAL_SCHEME,
        path: `/diff/${sessionId}/${side}/${label}`,
    });
}

// ============================================================
// 日志面板
// ============================================================

let logPanel: vscode.WebviewPanel | null = null;
let logEntries: string[] = [];
const MAX_LOG_ENTRIES = 200;

function getTimestamp(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function addLog(entry: string, type: 'read' | 'edit' | 'create' | 'complete' | 'info' | 'mode' | 'agent' = 'info') {
    const iconMap: Record<string, string> = {
        read: '📖', edit: '✏️', create: '🆕', complete: '✅', info: 'ℹ️', mode: '🎛️', agent: '🤖'
    };
    const colorMap: Record<string, string> = {
        read: '#569cd6', edit: '#dcdcaa', create: '#4ec9b0', complete: '#6a9955', info: '#858585', mode: '#c586c0', agent: '#dcdcaa'
    };
    logEntries.push(
        `<div style="color:${colorMap[type]};padding:3px 0;border-bottom:1px solid rgba(128,128,128,0.15)">` +
        `[<span style="color:#858585">${getTimestamp()}</span>] ${iconMap[type]} ${escapeHtml(entry)}` +
        `</div>`
    );
    if (logEntries.length > MAX_LOG_ENTRIES) logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
    updateLogPanel();
}

function updateLogPanel() {
    if (!logPanel) return;
    const modeColor = currentMode === 'auto' ? '#6a9955' : currentMode === 'agent' ? '#dcdcaa' : '#569cd6';
    const modeText = currentMode === 'auto' ? '🤖 自动模式' : currentMode === 'agent' ? '🔴 Agent监测中' : '🛡️ 用户模式';
    logPanel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Consolas,monospace;font-size:13px;padding:10px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}
        #mode{background:${modeColor}20;color:${modeColor};padding:8px 12px;border-radius:4px;margin-bottom:10px;font-weight:bold}
        #container{height:calc(100vh - 60px);overflow-y:auto}
        #container::-webkit-scrollbar{width:8px}#container::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.4);border-radius:4px}
    </style></head><body>
    <div id="mode">${modeText}</div>
    <div id="container">${logEntries.join('\n')}</div>
    <script>const c=document.getElementById('container');c.scrollTop=c.scrollHeight;setTimeout(()=>location.reload(),5000)</script>
    </body></html>`;
}

function createLogPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'cursor-ai-monitor-log',
        'AI 监测日志',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => { logPanel = null; });
    updateLogPanel();
    return panel;
}

// ============================================================
// _soul 文件操作（使用 vscode.workspace.fs 而非 Node fs）
// ============================================================

async function createSoulFile(uri: vscode.Uri, content: string): Promise<vscode.Uri | null> {
    try {
        const soulUri = soulUriFromUri(uri);
        await vscode.workspace.fs.writeFile(soulUri, Buffer.from(content, 'utf-8'));
        return soulUri;
    } catch (e) {
        console.error('[CursorAI] 创建 _soul 文件失败:', e);
        addLog(`⚠️ 无法写入 _soul: ${e}`, 'info');
        return null;
    }
}

async function deleteSoulFile(soulUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(soulUri);
    } catch {
        // ignore
    }
}

async function readFileContent(uri: vscode.Uri): Promise<string> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf-8');
    } catch {
        return '';
    }
}

// ============================================================
// Diff 视图管理
// ============================================================

async function showLiveDiff(session: MonitorSession, currentContent: string) {
    const fileName = fileNameFromUri(session.fileUri);
    const left = session.originalContent || (session.isNewFile ? '' : '// （空）\n');
    const right = currentContent;

    if (left === right && !session.isNewFile) return;

    if (currentDiffView && currentDiffView.fileUri.toString() === session.fileUri.toString() && !currentDiffView.closed) {
        virtualDiffProvider.setSessionContent(currentDiffView.sessionId, left, right);
        return;
    }

    await closeDiffView();

    const sessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    virtualDiffProvider.setSessionContent(sessionId, left, right);

    const originalUri = buildVirtualUri(sessionId, 'original', fileName);
    const modifiedUri = buildVirtualUri(sessionId, 'modified', fileName);

    const title = session.isNewFile ? `🆕 AI 创建: ${fileName}` : `✏️ AI 修改: ${fileName}`;
    await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title);

    currentDiffView = { sessionId, fileUri: session.fileUri, originalUri, modifiedUri, closed: false };
    session.sessionId = sessionId;
}

async function closeDiffView(): Promise<void> {
    if (!currentDiffView || currentDiffView.closed) return;
    const sessionId = currentDiffView.sessionId;
    currentDiffView.closed = true;

    const needle = `/diff/${sessionId}/`;
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputTextDiff) {
                const mod = tab.input.modified;
                if (mod.scheme === VIRTUAL_SCHEME && mod.path.includes(needle)) {
                    await vscode.window.tabGroups.close(tab);
                    return;
                }
            }
        }
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    virtualDiffProvider.removeSession(sessionId);
    currentDiffView = null;
}

// ============================================================
// 状态栏管理
// ============================================================

function bindStatusBarClick(): void {
    statusBarItem.command = 'cursor-ai-monitor.toggleMode';
}

function updateStatusBar(state: 'reading' | 'streaming' | 'complete' | 'idle', fileName?: string, size?: number, duration?: number) {
    const modeEmoji: Record<MonitorMode, string> = { auto: '🤖', agent: '🔴', user: '🛡️' };
    const modeShort: Record<MonitorMode, string> = { auto: '自动', agent: '监测', user: '用户' };

    const configs: Record<string, { icon: string; text: string; bg: vscode.ThemeColor | undefined }> = {
        reading: { icon: '$(eye)', text: `📖 ${fileName || ''}`, bg: undefined },
        streaming: {
            icon: '$(sync~spin)',
            text: `[监测] ✏️ ${fileName}${size && size > 100 ? ` ${Math.round(size / 1024)}KB` : ''}`,
            bg: new vscode.ThemeColor('statusBarItem.warningBackground'),
        },
        complete: {
            icon: '$(check)',
            text: `[完成] ✅ ${fileName}${duration ? ` (${duration.toFixed(1)}s)` : ''}`,
            bg: undefined,
        },
        idle: {
            icon: '$(eye)',
            text: `${modeEmoji[currentMode]} ${modeShort[currentMode]} · 只读监测（点击切换）`,
            bg: undefined,
        },
    };
    const cfg = configs[state];
    statusBarItem.text = `${cfg.icon} ${cfg.text}`;
    statusBarItem.backgroundColor = cfg.bg;
    bindStatusBarClick();
}

// ============================================================
// 监测完成后的清理
// ============================================================

async function finishMonitoring(session: MonitorSession) {
    if (session.closed) return;
    session.closed = true;

    if (session.debounceTimer) clearTimeout(session.debounceTimer);

    const duration = (Date.now() - session.startTime) / 1000;
    updateStatusBar('complete', fileNameFromUri(session.fileUri), undefined, duration);
    addLog(`✅ ${session.isNewFile ? '创建' : '修改'}完成: ${fileNameFromUri(session.fileUri)} (${duration.toFixed(1)}s)`, 'complete');

    await closeDiffView();
    await deleteSoulFile(session.soulUri);

    if (activeSession === session) activeSession = null;

    if (currentMode === 'agent') {
        setTimeout(() => setMode('auto'), 3000);
    } else {
        setTimeout(() => updateStatusBar('idle'), 3000);
    }
}

// ============================================================
// 模式切换
// ============================================================

function setMode(mode: MonitorMode) {
    const oldMode = currentMode;
    currentMode = mode;

    if (oldMode === 'agent' && mode !== 'agent' && activeSession) {
        finishMonitoring(activeSession);
    }

    const modeIcons: Record<MonitorMode, string> = { auto: '🤖', agent: '🔴', user: '🛡️' };
    const modeLabels: Record<MonitorMode, string> = { auto: '自动', agent: '监测中', user: '仅用户' };
    statusBarItem.text = `${modeIcons[mode]} ${modeLabels[mode]}（点击切换）`;
    statusBarItem.tooltip =
        `AI Monitor — 当前：${modeLabels[mode]}\n点击状态栏切换：自动 ↔ 仅用户 ↔ 强制监测`;
    bindStatusBarClick();

    updateLogPanel();
    addLog(`🎛️ 切换到${mode === 'auto' ? '自动' : mode === 'agent' ? 'Agent监测' : '用户模式'}模式`, 'mode');
}

// ============================================================
// Agent 操作检测
// ============================================================

function detectAgentByTerminal(cmd: string): boolean {
    const lower = cmd.toLowerCase();
    const aiTools = /cursor|copilot|claude|gpt|openai|gemini|anthropic|aider|agent/i;
    const fileWrites = /cat\s+.*>>|tee\s+|set-content\s+|out-file\s+|>.*\.(ts|tsx|js|jsx|py|json|md)/i;
    const compilers = /python3?\s+|node\s+|tsx\s+|bun\s+|deno\s+|cargo\s+(run|build)|go\s+(run|build)/i;
    const packageMgrs = /npm\s+(install|add)|pip\s+install|yarn\s+add|pnpm\s+add/i;
    return aiTools.test(lower) || fileWrites.test(cmd) || compilers.test(cmd) || packageMgrs.test(cmd);
}

function detectAgentByBehavior(filePath: string, changeSize: number, timeSinceLastChange: number): boolean {
    if (currentMode === 'user') return false;

    const now = Date.now();
    const finite = Number.isFinite(timeSinceLastChange);

    // 清理 30 秒前的旧记录
    while (fileChangeHistory.length > 0 && now - fileChangeHistory[0].time > 30000) {
        fileChangeHistory.shift();
    }

    fileChangeHistory.push({ path: filePath, time: now, size: changeSize });

    // 核心：Composer/API 整块写入不经终端，停顿后首次写入（>=64 字符）强烈暗示 AI
    if ((!finite || timeSinceLastChange > 2500) && changeSize >= 64) {
        agentConfidence = Math.min(100, agentConfidence + 55);
        addLog(`🤖 大块写入（API/Agent）: +55，约 ${changeSize} 字符`, 'agent');
    }

    // 批量快速写入
    if (finite && timeSinceLastChange < 200 && changeSize > 200) {
        agentConfidence = Math.min(100, agentConfidence + 30);
        addLog(`🤖 批量快速写入: ${changeSize} 字符 / ${timeSinceLastChange}ms`, 'agent');
    }

    // 连续修改多个文件
    const recent = fileChangeHistory.filter(h => now - h.time < 5000);
    const unique = new Set(recent.map(h => h.path));
    if (unique.size >= 3) {
        agentConfidence = Math.min(100, agentConfidence + 20);
        addLog(`🤖 多文件操作: ${unique.size} 个文件在 5 秒内`, 'agent');
    }

    // 大段代码
    if (changeSize > 1000) {
        agentConfidence = Math.min(100, agentConfidence + 25);
        addLog(`🤖 大段代码检测: ${Math.round(changeSize / 1024)}KB`, 'agent');
    }

    // 仅在有限时间间隔时计算衰减，避免 Infinity 误伤
    if (finite) {
        if (changeSize <= 3 && timeSinceLastChange > 100) {
            agentConfidence = Math.max(0, agentConfidence - 15);
        }
        if (timeSinceLastChange > 500 && changeSize < 100) {
            agentConfidence = Math.max(0, agentConfidence - 10);
        }
        if (timeSinceLastChange > 15000) {
            agentConfidence = Math.max(0, agentConfidence - 20);
        }
    }

    lastModifiedFile = filePath;
    return agentConfidence >= 42;
}

// ============================================================
// 主激活逻辑
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('[CursorAI] 插件已激活 - Cursor Agent 智能检测模式（使用 workspace.fs）');

    virtualDiffProvider = new VirtualDiffDocumentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, virtualDiffProvider),
        virtualDiffProvider,
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9999);
    statusBarItem.text = '🤖 自动（点击切换）';
    statusBarItem.tooltip =
        'AI Monitor\n点击此处循环切换：自动检测 Agent ↔ 仅用户（不监测）↔ 强制监测';
    bindStatusBarClick();
    statusBarItem.show();

    addLog('🚀 Cursor AI 监测已启动', 'info');
    addLog('🤖 自动模式：新文件/大块写入即 Diff（Agent 不经终端也会抓到）', 'info');
    addLog('🛡️ 点状态栏切「仅用户」可暂停监测', 'info');

    // --------------------------------------------------------
    // 1. 监听文件读取
    // --------------------------------------------------------
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (doc.uri.scheme !== 'file') return;
            if (isSoulMirrorUri(doc.uri)) return;
            const fileName = fileNameFromUri(doc.uri);
            updateStatusBar('reading', fileName);
            addLog(`📖 读取: ${fileName}`, 'read');

            setTimeout(() => {
                if (statusBarItem.text.includes('📖')) updateStatusBar('idle');
            }, 2000);
        })
    );

    // --------------------------------------------------------
    // 2. 监听文件创建
    // --------------------------------------------------------
    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles(async (event) => {
            for (const uri of event.files) {
                if (uri.scheme !== 'file') continue;
                if (isSoulMirrorUri(uri)) continue;

                const fileName = fileNameFromUri(uri);
                if (currentMode === 'user') {
                    updateStatusBar('reading', fileName);
                    addLog(`📄 创建: ${fileName}`, 'create');
                    setTimeout(() => {
                        if (statusBarItem.text.includes('📄')) updateStatusBar('idle');
                    }, 2000);
                    continue;
                }

                const content = await readFileContent(uri);
                const soulUri = await createSoulFile(uri, content);
                if (!soulUri) {
                    updateStatusBar('idle');
                    continue;
                }

                const session: MonitorSession = {
                    fileUri: uri,
                    soulUri,
                    sessionId: '',
                    startTime: Date.now(),
                    isNewFile: true,
                    originalContent: '',
                    changeCount: content.length,
                    debounceTimer: undefined,
                    closed: false,
                    lastChangeTime: Date.now(),
                };

                activeSession = session;
                updateStatusBar('streaming', fileName, content.length);
                addLog(`🆕 创建文件: ${fileName} (实时监测中)`, 'create');

                await showLiveDiff(session, content);
                session.debounceTimer = setTimeout(() => finishMonitoring(session), 3000);
            }
        })
    );

    // --------------------------------------------------------
    // 3. 监听文件修改
    // --------------------------------------------------------
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (event) => {
            const doc = event.document;
            if (doc.uri.scheme !== 'file') return;
            if (isSoulMirrorUri(doc.uri)) return;

            const filePath = doc.uri.fsPath;
            const fileName = fileNameFromUri(doc.uri);
            const currentContent = doc.getText();

            let changeSize = 0;
            for (const change of event.contentChanges) {
                changeSize += change.text.length;
            }

            if (currentMode === 'user') {
                updateStatusBar('reading', fileName);
                setTimeout(() => {
                    if (statusBarItem.text.includes('📖')) updateStatusBar('idle');
                }, 1000);
                return;
            }

            const timeSinceLastChange = activeSession
                ? Date.now() - activeSession.lastChangeTime
                : Number.POSITIVE_INFINITY;

            const likelyAgent = detectAgentByBehavior(filePath, changeSize, timeSinceLastChange);
            const shouldDiff = currentMode === 'agent' || (currentMode === 'auto' && likelyAgent);

            if (!shouldDiff) {
                updateStatusBar('reading', fileName);
                return;
            }

            if (activeSession && activeSession.fileUri.toString() === doc.uri.toString() && !activeSession.closed) {
                await vscode.workspace.fs.writeFile(
                    activeSession.soulUri,
                    Buffer.from(currentContent, 'utf-8'),
                );
                activeSession.changeCount += changeSize;
                activeSession.lastChangeTime = Date.now();
                updateStatusBar('streaming', fileName, activeSession.changeCount);
                await showLiveDiff(activeSession, currentContent);

                if (activeSession.debounceTimer) clearTimeout(activeSession.debounceTimer);
                activeSession.debounceTimer = setTimeout(() => finishMonitoring(activeSession!), 1500);
            } else {
                const originalContent = await readFileContent(doc.uri);
                const soulUri = await createSoulFile(doc.uri, currentContent);
                if (!soulUri) {
                    updateStatusBar('idle');
                    return;
                }

                const session: MonitorSession = {
                    fileUri: doc.uri,
                    soulUri,
                    sessionId: '',
                    startTime: Date.now(),
                    isNewFile: originalContent.length === 0,
                    originalContent,
                    changeCount: changeSize,
                    debounceTimer: undefined,
                    closed: false,
                    lastChangeTime: Date.now(),
                };

                activeSession = session;
                updateStatusBar('streaming', fileName, changeSize);
                addLog(`✏️ 修改文件: ${fileName} (实时监测中)`, 'edit');
                await showLiveDiff(session, currentContent);
                session.debounceTimer = setTimeout(() => finishMonitoring(session), 1500);
            }
        })
    );

    // --------------------------------------------------------
    // 4. 监听终端执行
    // --------------------------------------------------------
    context.subscriptions.push(
        vscode.window.onDidStartTerminalShellExecution(async (e) => {
            const cmd = e.execution.commandLine.value;
            if (!cmd?.trim()) return;

            if (detectAgentByTerminal(cmd)) {
                const wasAuto = currentMode === 'auto';
                setMode('agent');
                if (wasAuto) {
                    addLog(`🤖 检测到 Agent 命令: ${cmd.substring(0, 80)}${cmd.length > 80 ? '…' : ''}`, 'agent');
                }
            }
        })
    );

    // --------------------------------------------------------
    // 5. 命令注册
    // --------------------------------------------------------
    context.subscriptions.push(
        vscode.commands.registerCommand('cursor-ai-monitor.toggleMode', () => {
            const modes: MonitorMode[] = ['auto', 'user', 'agent'];
            const idx = modes.indexOf(currentMode);
            const next = modes[(idx + 1) % modes.length];
            setMode(next);

            const labels: Record<MonitorMode, string> = { auto: '🤖 自动模式', agent: '🔴 Agent 监测', user: '🛡️ 仅用户' };
            addLog(`切换到 ${labels[next]}`, 'mode');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cursor-ai-monitor.toggleLog', () => {
            if (logPanel) logPanel.reveal(vscode.ViewColumn.Beside, true);
            else logPanel = createLogPanel();
        }),
        vscode.commands.registerCommand('cursor-ai-monitor.showLog', () => {
            if (!logPanel) logPanel = createLogPanel();
            else logPanel.reveal(vscode.ViewColumn.Beside, true);
        }),
        vscode.commands.registerCommand('cursor-ai-monitor.clearLog', () => {
            logEntries = [];
            updateLogPanel();
            addLog('🗑️ 日志已清空', 'info');
        }),
        vscode.commands.registerCommand('cursor-ai-monitor.reset', async () => {
            updateStatusBar('idle');
            if (activeSession) await finishMonitoring(activeSession);
            agentConfidence = 0;
            fileChangeHistory.length = 0;
            setMode('auto');
            addLog('🔄 状态已重置', 'info');
            vscode.window.showInformationMessage('AI Monitor 已重置');
        })
    );
}

export function deactivate() {
    if (activeSession) {
        deleteSoulFile(activeSession.soulUri);
    }
    closeDiffView();
}

> **⏸️ Paused** · Last commit: 2026-04-13 (about 5 months ago)
>
> The extension prototype has validated its core idea (three monitoring modes + virtual diff) and is functional; there is no clear new requirement on the schedule yet.

<div align="center">

# Cursor AI Monitor Pro

**See in real time which files the Cursor AI Agent is modifying — watch code changes as they happen, the way Cline does**

![version](https://img.shields.io/badge/version-0.2.1-3b82f6?style=flat-square) ![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.105.0-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)

[简体中文](README.md) · **English**

</div>

---

## 📖 What is this

A **VS Code / Cursor extension**. While an AI Agent edits your code, it will:

- Show in the **status bar** which file is being written, how large it is, and how long it takes
- Open a **live diff view** automatically (green for additions, red for deletions)
- Stay **read-only throughout** — it writes no files and never interferes with Cursor's normal work

## ✨ Features

| Feature | Notes |
|---------|-------|
| **Three monitoring modes** | Auto-detect / Agent monitoring / User-only, switchable at any time |
| **Live diff view** | Opens a comparison view automatically as the AI edits code — green additions, red deletions |
| **Smart Agent detection** | Identifies AI activity through behavioural analysis (terminal commands, bulk writes, large code blocks, and more) |
| **Virtual diff mechanism** | Virtual files that never touch disk — safe and reliable |
| **Status bar monitoring** | The bottom status bar shows the current monitoring mode and operation state |
| **Log panel** | A visual monitoring log that tracks every operation in real time |
| **Pure monitoring mode** | Read-only, never writing, so Cursor's normal work is entirely unaffected |

## 🎛️ The three monitoring modes

| Mode | Icon | Notes |
|------|:----:|-------|
| **Auto mode** | 🤖 | Detects AI activity intelligently and enables diff automatically |
| **Agent monitoring** | 🔴 | Forces monitoring of all file modifications |
| **User-only** | 🛡️ | Pauses monitoring and records file reads only |

## 🖼️ Preview

**The status bar's three states**:

| Moment | Display |
|--------|---------|
| Idle | `🤖 自动 · 只读监测（点击切换）` |
| Monitoring | `🔴 [监测] ✏️ main.c 2.3KB` |
| Done | `✅ [完成] ✅ main.c (1.2s)` |

**The diff view it opens automatically**:

- `🆕 AI 创建: main.c` — new-file comparison
- `✏️ AI 修改: main.c` — file-modification comparison

> The status-bar and diff-title strings above are **literal UI text shipped in Chinese**; they are shown here exactly as the extension renders them.

## 🚀 Usage

### Install and go

The extension **activates automatically** once installed; a status bar showing `🤖 自动` means it is running normally.

### Switching modes

| Method | Action |
|--------|--------|
| Click the status bar | Cycles through: Auto ↔ User-only ↔ Agent monitoring |
| Keyboard shortcut | **`Ctrl+Shift+M`** to switch quickly |
| Command palette | `Ctrl+Shift+P` → type `AI Monitor: 切换监测模式` |

### Command list (7 in total)

Press `Ctrl+Shift+P` to open the command palette:

| Command | Function |
|---------|----------|
| `AI Monitor: 切换监测模式` | Cycles through the three monitoring modes (**`Ctrl+Shift+M`**) |
| `AI Monitor: 开启手动监测模式` | Forces Agent monitoring on |
| `AI Monitor: 关闭监测（切回安全模式）` | Switches to User-only mode |
| `AI Monitor: 显示/隐藏监测日志` | Opens or focuses the log panel |
| `AI Monitor: 打开监测日志` | Opens the log in a new window |
| `AI Monitor: 清空日志` | Clears all log records |
| `AI Monitor: 重置状态` | Resets all state and records |

> Command names are **registered verbatim in Chinese** by the extension, so keep them as shown here — that is what you type into the palette.

## 🔬 How it works

### The Agent detection algorithm

It identifies AI activity through **multi-dimensional behavioural analysis**:

| Dimension | Rule and weight |
|-----------|-----------------|
| **Terminal command detection** | Recognises AI tooling, compiler, and package manager commands |
| Large block write | ≥64 characters, first after a pause → **+55** confidence |
| Rapid bulk write | <200 ms and >200 characters → **+30** confidence |
| Multi-file activity | ≥3 files within 5 seconds → **+20** confidence |
| Large code block | >1 KB → **+25** confidence |
| **Confidence decay** | Normal user activity **lowers** confidence |

> The accumulated confidence determines whether it concludes "an AI is operating" and enables the diff view accordingly.

### The virtual diff mechanism

| Point | Implementation |
|-------|----------------|
| File reading | Uses the `vscode.workspace.fs` API instead of Node `fs` |
| Staging original content | Creates a `_soul` temporary file |
| Diff view | **A virtual view that never touches disk** |
| Cleanup | Temporary files are cleaned up automatically once the operation finishes |

## ❓ FAQ

**Q: Will it affect Cursor's normal work?**
No. The extension **only reads** file contents for comparison; it writes no files.

**Q: How do I choose among the three modes?**
**Auto mode** covers most situations. Use **Agent monitoring** when you need to force monitoring of all modifications, and switch to **User-only** when you want to pause monitoring.

**Q: How do I confirm the extension is active?**
Check whether the bottom status bar shows the monitoring icon and text.

## 🛠️ Tech stack

| Item | Implementation |
|------|----------------|
| Language | TypeScript 5.3 |
| Runtime | VS Code extension host (`engines.vscode: ^1.105.0`) |
| Entry point | `out/extension.js` (compiled from `src/extension.ts`) |
| Target | Cursor (VS Code compatible) |
| Dev dependencies | `@types/vscode`, `@types/node` (20.x) |
| Scripts | `compile` · `watch` · `vscode:prepublish` |

**Development**:

```bash
npm install
npm run compile      # Compile TypeScript
npm run watch        # Watch mode
```

## 📁 Project structure

```text
cursor-ai-monitor/
├── src/extension.ts              Main extension logic
├── images/icon.png               Extension icon
├── proxy-server.js               Streaming status proxy (Express, listens on 18790)
├── CHANGELOG.md                  Changelog
├── package.json                  Extension manifest (7 commands + 1 keybinding)
├── eslint.config.mjs             ESLint configuration
├── .vscode-test.mjs              Test entry point
└── tsconfig.json
```

## 📜 Changelog

<details>
<summary><b>Click to expand the version history</b></summary>

### v0.2.1
- Added three monitoring modes (Auto / Agent / User)
- Added the monitoring log panel
- Improved the Agent activity detection algorithm
- Added the `Ctrl+Shift+M` shortcut for quick switching

### v0.1.1
- Added the live diff view
- Improved the AI activity detection algorithm
- Added modification size and duration statistics

### v0.1.0
- Initial release
- Basic status bar monitoring

</details>

## ⚠️ Known situation

| Item | Notes |
|------|-------|
| **License** | An **MIT LICENSE** has been added (root `LICENSE`). `package.json` still declares no `license` field; add `"license": "MIT"` if you want to |
| **Not published to the marketplace** | The repository contains no release record, so compile it yourself or install the VSIX locally |

### About `proxy-server.js` (a helper script)

The repository also contains a separate **Express streaming status proxy** that is not part of the extension itself:

| Item | Details |
|------|---------|
| Listening port | **18790** |
| Dependencies | `express` + `cors` |
| Status file | `.cursor-stream-status.json` (records `isStreaming` / `currentFile` / `currentContent` / `startTime` / `chunks`) |
| Purpose | Receives the AI's streaming write progress and writes it to a status file, so the extension side can read "which file is being written and how far along it is" |

> It is **not on the extension's activation path**; it is an optional external bridge.

---

<sub>Cursor AI Monitor Pro v0.2.1 · pure read-only monitoring that never interferes with Cursor's normal work</sub>

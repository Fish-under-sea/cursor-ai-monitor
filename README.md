> **⏸️ 暂停维护** · 最近提交：2026-04-13（约 5 个月前）
>
> 扩展原型已验证完核心想法（三种监测模式 + 虚拟 Diff），功能可用；暂无明确的新需求排期。

<div align="center">

# Cursor AI Monitor Pro

**实时显示 Cursor AI Agent 正在修改的文件，像 Cline 一样实时查看代码修改过程**

![version](https://img.shields.io/badge/version-0.2.1-3b82f6?style=flat-square) ![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.105.0-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)

</div>

---

## 📖 这是什么

一个 **VS Code / Cursor 扩展**。当 AI Agent 在改你的代码时，它会：

- 在**状态栏**实时显示正在写入哪个文件、多大、耗时多久
- 自动弹出**实时 Diff 视图**（绿色新增、红色删除）
- 全程**只读监测**，不写入任何文件、不干预 Cursor 的正常工作

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| **三种监测模式** | 自动检测 / Agent 监测 / 仅用户，随时切换 |
| **实时 Diff 视图** | AI 修改代码时自动打开对比视图，绿色新增、红色删除 |
| **智能 Agent 检测** | 通过行为分析识别 AI 操作（终端命令、批量写入、大段代码等） |
| **虚拟 Diff 机制** | 不落盘的虚拟文件，安全可靠 |
| **状态栏监控** | 底部状态栏显示当前监测模式与操作状态 |
| **日志面板** | 可视化监测日志，实时追踪所有操作 |
| **纯监控模式** | 只读取不写入，完全不干预 Cursor 正常工作 |

## 🎛️ 三种监测模式

| 模式 | 图标 | 说明 |
|------|:----:|------|
| **自动模式** | 🤖 | 智能检测 AI 操作，自动开启 Diff |
| **Agent 监测** | 🔴 | 强制监测所有文件修改 |
| **仅用户** | 🛡️ | 暂停监测，仅记录文件读取 |

## 🖼️ 效果预览

**状态栏的三种形态**：

| 时机 | 显示 |
|------|------|
| 空闲 | `🤖 自动 · 只读监测（点击切换）` |
| 监测中 | `🔴 [监测] ✏️ main.c 2.3KB` |
| 完成 | `✅ [完成] ✅ main.c (1.2s)` |

**自动打开的 Diff 视图**：

- `🆕 AI 创建: main.c` —— 新文件对比
- `✏️ AI 修改: main.c` —— 文件修改对比

## 🚀 使用方法

### 安装即用

扩展安装后**自动激活**，状态栏显示 `🤖 自动` 即表示正常运行。

### 切换模式

| 方式 | 操作 |
|------|------|
| 点击状态栏 | 循环切换：自动模式 ↔ 仅用户 ↔ Agent 监测 |
| 快捷键 | **`Ctrl+Shift+M`** 快速切换 |
| 命令面板 | `Ctrl+Shift+P` → 输入 `AI Monitor: 切换监测模式` |

### 命令列表（共 7 个）

按 `Ctrl+Shift+P` 打开命令面板：

| 命令 | 功能 |
|------|------|
| `AI Monitor: 切换监测模式` | 循环切换三种监测模式（**`Ctrl+Shift+M`**） |
| `AI Monitor: 开启手动监测模式` | 强制开启 Agent 监测 |
| `AI Monitor: 关闭监测（切回安全模式）` | 切换到仅用户模式 |
| `AI Monitor: 显示/隐藏监测日志` | 打开/聚焦日志面板 |
| `AI Monitor: 打开监测日志` | 新窗口打开日志 |
| `AI Monitor: 清空日志` | 清空所有日志记录 |
| `AI Monitor: 重置状态` | 重置所有状态和记录 |

## 🔬 工作原理

### Agent 检测算法

通过**多维度行为分析**识别 AI 操作：

| 维度 | 判定与权重 |
|------|-----------|
| **终端命令检测** | 识别 AI 工具、编译器、包管理器命令 |
| 大块写入 | ≥64 字符、停顿后首次 → **+55** 置信度 |
| 批量快速写入 | <200ms 且 >200 字符 → **+30** 置信度 |
| 多文件操作 | 5 秒内 ≥3 个文件 → **+20** 置信度 |
| 大段代码 | >1KB → **+25** 置信度 |
| **置信度衰减** | 正常用户操作会**降低**置信度 |

> 累计置信度决定是否判定为「AI 正在操作」，并据此自动开启 Diff 视图。

### 虚拟 Diff 机制

| 要点 | 实现 |
|------|------|
| 文件读取 | 使用 `vscode.workspace.fs` API 替代 Node `fs` |
| 原始内容暂存 | 创建 `_soul` 临时文件 |
| Diff 视图 | **虚拟视图，不落盘** |
| 清理 | 操作完成后自动清理临时文件 |

## ❓ 常见问题

**Q：会影响 Cursor 的正常工作吗？**
不会。扩展**只读取**文件内容用于对比，不写入任何文件。

**Q：三种模式如何选择？**
大部分情况用**自动模式**即可。需要强制监测所有修改时用 **Agent 监测**；需要暂停监测时切到**仅用户**模式。

**Q：如何确认扩展是否激活？**
查看底部状态栏是否有监测图标和文字。

## 🛠️ 技术栈

| 项 | 实现 |
|----|------|
| 语言 | TypeScript 5.3 |
| 运行环境 | VS Code 扩展宿主（`engines.vscode: ^1.105.0`） |
| 入口 | `out/extension.js`（由 `src/extension.ts` 编译） |
| 目标 | Cursor（VS Code 兼容） |
| 开发依赖 | `@types/vscode` `@types/node`（20.x） |
| 脚本 | `compile` · `watch` · `vscode:prepublish` |

**开发**：

```bash
npm install
npm run compile      # 编译 TypeScript
npm run watch        # 监听模式
```

## 📁 项目结构

```text
cursor-ai-monitor/
├── src/extension.ts              扩展主逻辑
├── images/icon.png               扩展图标
├── proxy-server.js               流式状态代理（Express，监听 18790）
├── CHANGELOG.md                  更新日志
├── package.json                  扩展清单（7 个命令 + 1 个快捷键）
├── eslint.config.mjs             ESLint 配置
├── .vscode-test.mjs              测试入口
└── tsconfig.json
```

## 📜 更新日志

<details>
<summary><b>点击展开版本历史</b></summary>

### v0.2.1
- 新增三种监测模式（自动 / Agent / 用户）
- 新增监测日志面板
- 优化 Agent 操作检测算法
- 支持 `Ctrl+Shift+M` 快捷键快速切换

### v0.1.1
- 新增实时 Diff 视图功能
- 优化 AI 操作检测算法
- 添加修改大小和耗时统计

### v0.1.0
- 初始版本
- 基础状态栏监控功能

</details>

## ⚠️ 已知情况

| 项 | 说明 |
|----|------|
| **许可** | 已添加 **MIT LICENSE**（根目录 `LICENSE`）。`package.json` 中仍未声明 `license` 字段，可按需补为 `"license": "MIT"` |
| **未发布到市场** | 仓库内无发布记录，需自行编译或用 VSIX 本地安装 |

### 关于 `proxy-server.js`（辅助脚本）

仓库内另有一个独立的 **Express 流式状态代理**，不属于扩展本体：

| 项 | 内容 |
|----|------|
| 监听端口 | **18790** |
| 依赖 | `express` + `cors` |
| 状态文件 | `.cursor-stream-status.json`（记录 `isStreaming` / `currentFile` / `currentContent` / `startTime` / `chunks`） |
| 作用 | 接收 AI 流式写入的进度并落为状态文件，供扩展侧读取「正在写哪个文件、写到哪了」 |

> 它**不在扩展的激活路径上**，是可选的外部桥接方案。

---

<sub>Cursor AI Monitor Pro v0.2.1 · 纯只读监测，不干预 Cursor 正常工作</sub>
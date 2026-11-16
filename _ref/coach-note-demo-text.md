---
title: "Git 入门 · 学习记录"
tool: "Git"
level: "会基础"
goal: "学会在本地完成提交与分支操作"
mode: "learn"
session: "3f2a9c1e"
stateVersion: 12
variant: "text"
generatedAt: 2026-11-13T21:18:24.614Z
generator: "coach-mode 0.5.0"
full: "2026-11-13-2218-git.md"
redactions: 0
---

# Git 入门 · 学习记录

> **给 agent**：这是纯文字版，可安全读取。`2026-11-13-2218-git.md` 内嵌 base64 图片，**不要用 `read` 读取它**；
> 需要看图片时请让用户打开完整版。

> 事实区由插件从会话日志计算，解释区由模型撰写。本文件是纯文字版；完整版含截图。

## 1. 目标与结果
- 原始目标：学会在本地完成提交与分支操作
- 结果：共 3 步，通过 1 / 跳过 0 / 未完成 2
- 检索：0 次
- 复盘：完成了第一次提交，正在处理 README 提交时报的 pathspec 错误。
- 下一步建议：
  - 修好 README 的提交，再练习一次分支切换。

## 2. 学习路径
| # | 板块 · 步骤 | 状态 | 证据 | 失败 |
|---|---|---|---|---|
| 1 | 基础 · 初始化仓库并提交第一版 | 通过 | 用户工质 | 0 |
| 2 | 基础 · 修改 README 再提交 | 未完成 | 用户工质 | 1 |
| 3 | 分支 · 创建并切换 feature 分支 | 未开始 | 用户工质 | 0 |

## 3. 关键概念

### 暂存区
`git add` 把工作区改动放进暂存区，`git commit` 只提交暂存区里的内容。

### 分支指针
`HEAD` 指向当前分支；`git switch -c` 会新建分支并把 HEAD 移过去。

## 4. 踩过的坑

### `error: pathspec 'README.md' did not match any file(s) known to git`
- 原因：文件名拼写不一致，或者 README 还没保存到磁盘。
- 解决：先 `git status` 看真实文件名，再 `git add <正确路径>`。

## 5. 证据

### 图 1 · 用户提供（seq 12）
> 图片见完整版 `2026-11-13-2218-git.md`。

### 图 2 · 教练截图（窗口「Git Bash」，printwindow）
> 图片见完整版 `2026-11-13-2218-git.md`。

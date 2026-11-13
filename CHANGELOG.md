# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；`stateVersion` 是折叠语义的版本号，改它代表"旧会话要用新规则重新推导状态"。

## [0.4.5] - 2026-11-13

**评审修复轮**（按 P0 → P1 → Linux/macOS → P2 的顺序）。行为有变化，装完要重启。

### 修复（P0）
- **截图默认关闭**：随包 `cordis.patch.yml` 从 `screenshotEnabled: true` 改回 `false`，与
  `config.js` 默认值和 README 一致。
- **截图不再写盘**：抓屏脚本把 PNG 编码成 base64 从 stdout 回传，适配层解码后直接进
  `ctx.attachments`；去掉 PowerShell 的 `-ExecutionPolicy Bypass`，移除 `screenshotKeepFiles`
  配置项与工作区 `.coach/shots/` 第二份副本。解码增加三重完整性校验：stdout `lossy` 检测、
  脚本声明字节数与解码长度比对、PNG 文件签名校验——被截断的输出会明确报错，而不是把半张图
  送进附件服务。
- **守卫补 `apply_patch`**：`write` / `edit` / `apply_patch` 三个写入口都确定性拒绝；
  人设明确禁止用 `pwsh` / `bash` 替用户写文件。

### 修复（P1）
- **纯图片/文件反馈不再误计失败**：`user/message` 带 image/file 块、文本为空时，
  `applyUserFeedback` 不再按「零信息」+1，也不会触发强制出口。
- **失败的核查不能判「通过」**：`file` / `command` 要求最近一条 `coach_check` 的 `ok === true`
  （错误码 `COACH_VERIFY_CHECK_FAILED`），与截图口径对齐。
- **相位校验先于副作用**：抽出 `preflightCheck`，`coach_check` 在截屏 / 跑命令 / 读文件之前
  就拒绝非法阶段（PAUSED / COMPLETE 不再先截一张再报错）。
- **`read_file` 加上限**：新增 `readFileMaxBytes`（默认 1 MiB），超过直接拒绝；回传长度按
  `readFileMaxChars`，不再被 600 字预算砍半。

### 修复（Linux / macOS）
- 状态块只在 `win32` 显示【可截图】；旧会话里的 `screen` 步骤改为提示「截图不可用，请用户发截图」。
- 计划受理前拒绝 `screen` 证据：非 Windows（`COACH_PLAN_PLATFORM_UNSUPPORTED`）或
  `screenshotEnabled` 未开（`COACH_PLAN_SCREEN_DISABLED`），避免造出永远过不了的步骤。
- 默认白名单补 `python3 --version`（8 条）。
- 检索脱敏补 `/root` `/etc` `/srv` `/usr` POSIX 前缀。

### 修复（P2）
- **`user_artifact` 工质必须来自用户消息**：`evidenceRef` 必须命中用户附件 id 或用户原话里的
  路径/报错原文（≥ 4 字符），否则 `COACH_VERIFY_USER_ARTIFACT`；状态块新增【用户工质】列出附件 id。
- `imageBlocks` 缓存上限 16 条，不再无界增长。
- 文档与代码注释对齐：截图不再落盘、白名单 8 条、`readFileMaxBytes`、`apply_patch`、
  已知限制补充读文件与 `read_image` 旁路。

### 变更
- `stateVersion` **10 → 11**：新增 `userArtifacts` / `userText`。
- 单测 **171 → 204**（新增 `guard.test.js`、`check-tool.test.js`、`plan-tool.test.js` 与
  媒体反馈 / 失败核查 / 工质来源 / 平台收口用例）。

## [0.4.2] - 2026-10-18

### 新增
- **检索预算**：同一步最多检索 `maxResearchPerStep`（默认 3）次，超出在联网前直接拒绝（`COACH_RESEARCH_BUDGET`）；失败调用也计数，换步重置。
- **状态块预算**：`maxStateBlockChars`（默认 4000）超限时按 检索缓存 → 回退/跳过 → 历史证据 → 环境/命令/位置 的顺序裁剪；当前步骤、【请执行】、【合格标准】、【核查结论】、错误提示永不裁。
- **检索正文上限**：`researchContentMaxChars`（默认 2000），只截存进状态的正文。
- **【用量】**：`本步检索 X/N；本会话检索 M；本步核查 K 次`。

### 变更
- `research` 条目新增 `stepKey`；折叠语义变化 → `stateVersion` **9**。
- 新增测试 `test/budget.test.js`（7 条），单测总数 **149**。

### 已知
- 宿主 `web.search` 目前不返回正文，`researchContentMaxChars` 实测不会触发（记为 N/A）。

## [0.4.1] - 2026-10-18

### 新增
- **脚手架递减**：`core/support.js` 按板块表现算出 1–3 级支撑等级，状态块新增 `【支撑等级】`。
  - 3 手把手 / 2 给要点 / 1 放手；整板块一次过降级，跳过/回退/重复失败升级，当前步失败 2 次立即升级。
  - 等级只改"讲多细"，核查标准不变；不新增工具/相位，`stateVersion` 保持 8。

### 修复
- 等级依据在被上下限夹住时不再谎报"降 1 / 升 1"。

### 变更
- 单测 **142**；A14 实机通过（含 3→2、2→1 两个方向）。

## [0.4.0] - 2026-10-18

### 新增
- **进度摘要**：`【进度摘要】` 显示已完成/跳过/剩余、当前板块、本步失败、检索次数。
- **暂停 / 恢复**：新相位 `PAUSED` 与第 8 个工具 `coach_pause({action})`；暂停期间除恢复外所有教练工具被拒绝，恢复不作废证据。

### 变更
- `stateVersion` **8**；单测 **132**；工具 **8**；相位 **11**。

## [0.3.4] - 2026-10-17

### 新增
- **同会话回退** `coach_back`：只能往回退；回退之前的 `checks` / `verifications` / `skips` 全部失效。

### 修复
- 工具定义漏写 `description` 导致宿主写 `request/header` 硬失败；新增 `tool-shape.test.js` 回归。

### 变更
- `stateVersion` **7**；单测 **110**。

## [0.3.3] - 2026-10-17

### 新增
- 安装分支**受控早退**：工具其实可用时，一次 `coach_plan(toolAvailable:"yes", …)` 即可退出安装分支，保留原目标。

### 修复
- 安装计划推进到第 2 步会掉回「等待反馈」的相位缺陷（0.3.3 起全程 `INSTALL_TOOL`）。

### 变更
- `stateVersion` **6**；单测 **93**。

## [0.3.2] - 2026-10-17

### 新增
- `INSTALL_TOOL` 成为独立驻留相位：`coach_plan(toolAvailable:"no")` 直接落到「安装工具」，走完最后一步恢复原目标。

### 变更
- `stateVersion` **5**；单测 **84**。

## [0.3.1] - 2026-10-17

### 修复
- `【可跑命令】` 在计划建立前也显示。
- 检索失败不再自动降级（只记缓存，是否降级由 `coach_verify` 决定）。
- 移除模型可写的 `consent`，检索始终自动脱敏。

### 变更
- `stateVersion` **4**；单测 **83**。

## [0.3.0] - 2026-10-17

### 新增
- `coach_research` 工具、`research_cache`、`RESEARCH` 过渡态、检索词脱敏。

### 变更
- `stateVersion` **3**；单测 **82**；工具 **6**。

## [0.2.5] - 2026-10-17

### 新增
- 默认 7 条只读命令白名单（显式写 `[]` 可关闭）。

### 修复
- 空 `sections` 的 `coach_plan` 死循环；`coach_check` 的非法 `kind`。

### 变更
- `stateVersion` **2**；单测 **70**。

## [0.2.4] - 2026-10-17

### 修复
- 适配 DSH 0.2.1-rc.1：去掉宿主已删除的 `{{cwd}}` 提示词变量（引用它会导致每一轮请求硬失败）。
- 人设固定格式字段之间补空行（渲染器只认硬换行）。

### 说明
- 档 1 最小切片交付：状态机骨架、强制核查、合格标准进状态；单测 **63**。

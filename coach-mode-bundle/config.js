/**
 * 插件配置的默认值与归一化。
 *
 * **本文件不导出 `Config` schema**，也不 import `@deepseek-ai/schemastery`——
 * profile 里装的 bundle 解析不到 dsh 自己的包（`ERR_MODULE_NOT_FOUND`），
 * 导出 `Config` 会让整行加载失败、preset 显示「加载失败」。
 *
 * 代价：`cordis.patch.yml` 里这一行的 `config` 不会被 schema 校验，
 * Plugin Manager 里也看不到字段表单。因此 `resolveCoachConfig` 必须自己兜住
 * 缺字段、类型不对、白名单写成字符串等所有情况。字段含义见 README 第八节。
 */

/**
 * v0.2.5（Q5 B）：默认只读命令白名单。
 *
 * 只放**只读**、且能直接确认环境的命令；命令按完整字符串精确匹配。
 * 用户仍可在 `cordis.patch.yml` 里显式写 `allowCommands: []` 关闭命令核查。
 */
export const DEFAULT_ALLOW_COMMANDS = Object.freeze([
  'git --version',
  'git status',
  'git config --global --list',
  'git log --oneline -5',
  'node -v',
  'npm -v',
  'python --version',
])

/** 配置默认值。 */
export const CONFIG_DEFAULTS = {
  failureThreshold: 3,
  maxPlanSteps: 12,
  allowCommands: [...DEFAULT_ALLOW_COMMANDS],
  sameMachine: true,
  commandTimeoutMs: 15000,
  readFileMaxChars: 1200,
  listDirMaxEntries: 30,
  // v0.4.2 成本控制（SPEC §14）：三个上限都必须能在 YAML 里改。
  /** 同一步最多检索几次（第 N+1 次直接拒绝，失败调用也计数）。 */
  maxResearchPerStep: 3,
  /** 状态块字符预算；超出后按固定优先级裁剪（当前步骤/标准/结论永不裁）。 */
  maxStateBlockChars: 4000,
  /** 存进状态的检索正文上限；不影响工具单次回传给模型的文本。 */
  researchContentMaxChars: 2000,
  // v0.4.3 截图取证（SPEC §15）：默认关闭——截屏会把用户屏幕上的一切发给模型。
  /** 总开关：false 时 coach_check(kind="screenshot") 直接拒绝，状态块也不显示【可截图】。 */
  screenshotEnabled: false,
  /** 同一步最多截图几张（第 N+1 张直接拒绝，失败也计数）。 */
  screenshotMaxPerStep: 2,
  /** 截图宽度上限（像素），超过会等比缩放——一张 1080p 图约 1.7k 视觉 token。 */
  screenshotMaxWidth: 1600,
  /** 截图高度上限（像素）。 */
  screenshotMaxHeight: 1000,
  /** 截图脚本超时。 */
  screenshotTimeoutMs: 20000,
  /** 读回 PNG 的字节上限。 */
  screenshotMaxBytes: 8388608,
  /** 永不作为截图目标的进程名（小写、去 .exe）——默认把自己和 Electron 挡掉。 */
  screenshotBlockProcesses: ['deepseek harness', 'electron', 'dsh'],
  /** 永不作为截图目标的窗口标题片段（小写）——进程名读不到时的兜底。 */
  screenshotBlockTitles: ['deepseek harness'],
  /** true 时把截图 PNG 留在工作区 `.coach/shots/`（附件里另有一份），false 时存完就删。 */
  screenshotKeepFiles: true,
}

/** 取正整数，非法就用默认值。 */
function naturalOf(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

/** 字符串数组：去空白、去空项；非数组回落默认值。 */
function stringListOf(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  return value.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
}

/**
 * 把用户写的配置补成完整、类型正确的对象。
 * @param {unknown} config `cordis.patch.yml` 里该行的 `config`。
 * @returns {object} 完整配置。
 */
export function resolveCoachConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}

  // 显式写 [] 仍然表示"关闭命令核查"；只有缺字段/非数组才回落默认白名单。
  const allowCommands = stringListOf(raw.allowCommands, DEFAULT_ALLOW_COMMANDS)

  return {
    failureThreshold: naturalOf(raw.failureThreshold, CONFIG_DEFAULTS.failureThreshold),
    maxPlanSteps: naturalOf(raw.maxPlanSteps, CONFIG_DEFAULTS.maxPlanSteps),
    allowCommands,
    sameMachine: raw.sameMachine === undefined ? CONFIG_DEFAULTS.sameMachine : raw.sameMachine !== false,
    commandTimeoutMs: naturalOf(raw.commandTimeoutMs, CONFIG_DEFAULTS.commandTimeoutMs),
    readFileMaxChars: naturalOf(raw.readFileMaxChars, CONFIG_DEFAULTS.readFileMaxChars),
    listDirMaxEntries: naturalOf(raw.listDirMaxEntries, CONFIG_DEFAULTS.listDirMaxEntries),
    maxResearchPerStep: naturalOf(raw.maxResearchPerStep, CONFIG_DEFAULTS.maxResearchPerStep),
    maxStateBlockChars: naturalOf(raw.maxStateBlockChars, CONFIG_DEFAULTS.maxStateBlockChars),
    researchContentMaxChars: naturalOf(
      raw.researchContentMaxChars,
      CONFIG_DEFAULTS.researchContentMaxChars,
    ),
    // v0.4.3：只有显式写 true 才开——截屏是「把用户屏幕发给模型」，不能靠默认值兜。
    screenshotEnabled: raw.screenshotEnabled === true,
    screenshotMaxPerStep: naturalOf(raw.screenshotMaxPerStep, CONFIG_DEFAULTS.screenshotMaxPerStep),
    screenshotMaxWidth: naturalOf(raw.screenshotMaxWidth, CONFIG_DEFAULTS.screenshotMaxWidth),
    screenshotMaxHeight: naturalOf(raw.screenshotMaxHeight, CONFIG_DEFAULTS.screenshotMaxHeight),
    screenshotTimeoutMs: naturalOf(raw.screenshotTimeoutMs, CONFIG_DEFAULTS.screenshotTimeoutMs),
    screenshotMaxBytes: naturalOf(raw.screenshotMaxBytes, CONFIG_DEFAULTS.screenshotMaxBytes),
    screenshotBlockProcesses: stringListOf(
      raw.screenshotBlockProcesses,
      CONFIG_DEFAULTS.screenshotBlockProcesses,
    ).map((entry) => entry.toLowerCase()),
    screenshotBlockTitles: stringListOf(
      raw.screenshotBlockTitles,
      CONFIG_DEFAULTS.screenshotBlockTitles,
    ).map((entry) => entry.toLowerCase()),
    screenshotKeepFiles: raw.screenshotKeepFiles === undefined
      ? CONFIG_DEFAULTS.screenshotKeepFiles
      : raw.screenshotKeepFiles === true,
  }
}

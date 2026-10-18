/**
 * 不代做的强制手段（决策 D8）：用 `ctx.tools.guard()` 确定性拒绝 `write` / `edit`。
 *
 * guard 是同步的、单调的（任一层返回字符串即拒绝，没有任何插件能强制放行），
 * 所以"不代做"在文件编辑这一项上物理成立，不靠提示词。
 *
 * `pwsh` / `bash` 本切片**不守卫**（用户已确认；命令副作用难以可靠判定），
 * 见 README【已知限制】。
 */

/** 被守卫的工具名。 */
export const GUARDED_TOOLS = ['write', 'edit']

/**
 * `tools.guard()` 回调：返回字符串即拒绝，返回 `undefined` 放行。
 * @param {Readonly<object>} execution 工具执行快照（`{ name, arguments, agent }`）。
 * @returns {string | undefined}
 */
export function coachGuard(execution) {
  const name = execution?.name
  if (typeof name !== 'string' || !GUARDED_TOOLS.includes(name)) return undefined
  return `教练模式不做代做：${name} 已被拒绝。`
    + '请把操作步骤指示给用户，由用户自己动手；可以帮用户核对结果，但不能替他改文件。'
}

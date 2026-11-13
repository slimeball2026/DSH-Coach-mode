/**
 * 不代做的强制手段（决策 D8）：用 `ctx.tools.guard()` 确定性拒绝会写文件的工具。
 *
 * guard 是同步的、单调的（任一层返回字符串即拒绝，没有任何插件能强制放行），
 * 所以"不代做"在文件编辑这一项上物理成立，不靠提示词。
 *
 * v0.4.5：把 `apply_patch` 也纳入。它是 tool-fs 里第三个写入口，本 preset 默认没开
 * （applyPatch: false），但守卫不能靠"当前没注册"——换一个 preset 就会漏。
 * 按名字守卫天然是 fail-open 的：宿主/其他插件新增写工具时不会自动覆盖。
 *
 * `pwsh` / `bash` 本切片**不守卫**（用户已确认；命令副作用难以可靠判定），
 * 由人设明确禁止"用 shell 替用户写文件"，见 README【已知限制】。
 */

/** 被守卫的工具名。 */
export const GUARDED_TOOLS = ['write', 'edit', 'apply_patch']

/**
 * `tools.guard()` 回调：返回字符串即拒绝，返回 `undefined` 放行。
 * @param {Readonly<object>} execution 工具执行快照（`{ name, arguments, agent }`）。
 * @returns {string | undefined}
 */
export function coachGuard(execution) {
  const name = execution?.name
  if (typeof name !== 'string' || !GUARDED_TOOLS.includes(name)) return undefined
  return `教练模式不代做：${name} 已被拒绝。`
    + '请把操作步骤指示给用户，由用户自己动手；可以帮用户核对结果，但不能替他改文件。'
}

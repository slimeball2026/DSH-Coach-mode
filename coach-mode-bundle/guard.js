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
 * v0.5.0：`coach_note` 会写两种记录：
 * - `foo.md`：完整版，内嵌 base64 图片，给用户看；
 * - `foo-text.md`：文字版，零 base64，给 agent 读。
 * 这里拦截 `read` 完整版（含 `read` 的绝对/相对路径），并指向文字版；
 * 这是确定性的，提示词里那两句提醒只是补充。
 *
 * `pwsh` / `bash` 本切片**不守卫**（用户已确认；命令副作用难以可靠判定），
 * 由人设明确禁止"用 shell 替用户写文件"，见 README【已知限制】。
 */

import path from 'node:path'

/** 被守卫的工具名。 */
export const GUARDED_TOOLS = ['write', 'edit', 'apply_patch']

/** 记录文字版的后缀。 */
export const NOTE_TEXT_SUFFIX = '-text.md'

/** 默认记录目录（与 config 默认值保持一致）。 */
const DEFAULT_NOTES_DIR = '.coach/notes'

/** 目标是否在 root 目录内（含 root 本身）。 */
function containsPath(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * 把完整版记录名映射成文字版：`foo.md` → `foo-text.md`；`foo-2.md` → `foo-2-text.md`。
 * @param {string} filePath 完整版路径。
 * @returns {string}
 */
export function textNotePathOf(filePath) {
  const base = path.basename(filePath)
  const text = base.replace(/\.md$/i, NOTE_TEXT_SUFFIX)
  return path.join(path.dirname(filePath), text)
}

/**
 * v0.5.0：`read` 完整版记录时返回拒绝理由；文字版 / 其它文件返回 `undefined`。
 * @param {object} execution 工具执行快照。
 * @param {string} notesDir 记录目录（相对工作区）。
 * @returns {string | undefined}
 */
function checkRead(execution, notesDir) {
  const raw = execution?.arguments?.file_path
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const cwd = execution?.agent?.session?.header?.cwd
  const base = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
  const target = path.resolve(base, raw)
  const root = path.resolve(base, notesDir)
  if (!containsPath(root, target)) return undefined
  if (path.basename(target).toLowerCase().endsWith(NOTE_TEXT_SUFFIX)) return undefined
  const textPath = textNotePathOf(target)
  return '这份学习记录（完整版）内嵌了 base64 图片，不要用 read 读取——会把大量无效内容读进上下文。'
    + `请改读文字版：${textPath}。完整版留给用户自己打开。`
}

/**
 * 创建配置感知的守卫。
 * @param {object} [config] 插件配置（只用到 `notesDir`）。
 * @returns {(execution: object) => string | undefined}
 */
export function createCoachGuard(config = {}) {
  const notesDir = typeof config?.notesDir === 'string' && config.notesDir.trim() !== ''
    ? config.notesDir.trim()
    : DEFAULT_NOTES_DIR
  return (execution) => {
    const name = execution?.name
    if (typeof name !== 'string') return undefined
    if (GUARDED_TOOLS.includes(name)) {
      return `教练模式不代做：${name} 已被拒绝。`
        + '请把操作步骤指示给用户，由用户自己动手；可以帮用户核对结果，但不能替他改文件。'
    }
    if (name === 'read') return checkRead(execution, notesDir)
    return undefined
  }
}

/**
 * 默认配置的守卫（单测与旧调用方用；实际挂载走 `createCoachGuard(config)`）。
 * @type {(execution: object) => string | undefined}
 */
export const coachGuard = createCoachGuard()

/**
 * `coach_check` —— 采集只读证据（决策 D7：只做只读动作，且必须走宿主 fs 服务）。
 *
 * 三条只读 kind 全部经 `ctx.fs`，不碰 `node:fs`，因此不绕过沙箱与审批策略；
 * `kind = "command"` 只在命令命中 `Config.allowCommands` 白名单时才执行，
 * 默认白名单为空 = 默认不支持命令核查（用户已确认）。
 */

import { defineTool } from './define-tool.js'
import { CHECK_KINDS, CoachError } from '../core/machine.js'
import { applyCheck } from '../core/verify.js'

const DETAIL_BUDGET = 600

const DESCRIPTION = [
  '采集一步的只读核查证据。这是核查的唯一取证通道：evidence 为 file / command 的步骤，',
  '必须先调用本工具拿到证据，coach_verify 才会受理。',
  'kind=path_exists 查路径是否存在；kind=list_dir 列目录；kind=read_file 读文本；',
  'kind=command 执行一条只读命令（默认有 7 条只读白名单，可直接跑；白名单外的命令会失败）。',
  '结果原样记录，不做解释、不做判断。',
].join('')

/** 截断，保持 meta 与回传文本可读。 */
function clip(text, budget = DETAIL_BUDGET) {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim()
  return value.length <= budget ? value : `${value.slice(0, budget - 1)}…`
}

/** 会话工作目录。 */
function cwdOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/** 文件系统类核查。 */
async function observeFile(fs, kind, target, config, exec) {
  const resolved = await fs.resolve(target, { cwd: cwdOf(exec) })

  if (kind === 'path_exists') {
    const info = await fs.stat(resolved)
    if (info === undefined) return { ok: false, detail: '路径不存在' }
    const size = info.size === undefined ? '' : `，${info.size} 字节`
    return { ok: true, detail: `存在（类型 ${info.type}${size}）` }
  }

  const info = await fs.stat(resolved)
  if (info === undefined) return { ok: false, detail: kind === 'list_dir' ? '目录不存在' : '文件不存在' }

  if (kind === 'list_dir') {
    if (info.type !== 'directory') return { ok: false, detail: `该路径不是目录（类型 ${info.type}）` }
    const entries = await fs.listDir(resolved)
    const shown = entries.slice(0, config.listDirMaxEntries)
    const names = shown.map((entry) => `${entry.name}${entry.type === 'directory' ? '/' : ''}`)
    const more = entries.length > shown.length ? ` …（共 ${entries.length} 个条目）` : ''
    return { ok: true, detail: `共 ${entries.length} 个条目：${names.join(', ')}${more}` }
  }

  if (info.type !== 'file') return { ok: false, detail: `该路径不是普通文件（类型 ${info.type}）` }
  const text = await fs.readText(resolved)
  return {
    ok: true,
    detail: `共 ${text.length} 字符，前 ${Math.min(text.length, config.readFileMaxChars)} 字符：\n`
      + text.slice(0, config.readFileMaxChars),
  }
}

/** 命令类核查（默认关闭）。 */
async function observeCommand(subprocess, command, config, exec) {
  const allowed = config.allowCommands ?? []
  if (!allowed.includes(command)) {
    // v2.2：把"下一步该怎么办"直接写进错误里——实测模型会在这里空转。
    throw new CoachError(
      '命令核查未启用：这条命令不在 Config.allowCommands 白名单里（默认白名单为空）。'
        + '**不要重复试命令核查**。三条可行的替代：'
        + '(1) 改用文件核查：path_exists / list_dir / read_file；'
        + '(2) 如果这一小步确实只能靠命令输出判断，把该步的 evidence 设成 user_artifact，'
        + '让用户把终端回显贴过来；'
        + '(3) 想真正开启命令核查，请用户把这条命令加进插件的 allowCommands 配置后重启。',
      'COACH_CHECK_COMMAND_DISABLED',
    )
  }
  const argv = process.platform === 'win32'
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', command]
    : ['/bin/sh', '-c', command]
  const timeout = AbortSignal.timeout(config.commandTimeoutMs)
  const signal = exec?.signal === undefined ? timeout : AbortSignal.any([exec.signal, timeout])
  const handle = subprocess.spawn({
    argv,
    cwd: cwdOf(exec),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 65536 },
      stderr: { maxBytes: 65536 },
    },
    graceMs: 2000,
    signal,
  })
  const outcome = await handle.done
  const stdout = clip(handle.collected?.stdout?.readFrom(0)?.text ?? '')
  const stderr = clip(handle.collected?.stderr?.readFrom(0)?.text ?? '')
  return {
    ok: outcome.exitCode === 0,
    detail: `exit=${String(outcome.exitCode)}；stdout：${stdout === '' ? '（空）' : stdout}；`
      + `stderr：${stderr === '' ? '（空）' : stderr}`,
  }
}

export function createCheckTool(deps) {
  const { config, projection, ctx } = deps
  return defineTool({
    name: 'coach_check',
    description: DESCRIPTION,
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: CHECK_KINDS,
        description: '核查种类：path_exists / list_dir / read_file / command。',
      },
      target: {
        type: 'string',
        required: true,
        description: '要核查的路径，或（kind=command 时）要执行的只读命令。用户只描述现象时，自己推断出对应路径来核对。',
      },
      stepKey: {
        type: 'string',
        description: '可选：当前步骤的键（形如 "0:1"）。给出时必须是当前步骤，否则失败。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          kind: { type: 'string', required: true },
          target: { type: 'string', required: true },
          stepKey: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const isEnvProbe = value.stepKey === 'env'
        const head = isEnvProbe
          ? `已记录**环境核查**（${value.kind} ${value.target}）——计划还没建立，所以它不绑定任何步骤、也不推进状态。\n`
          : `已记录核查证据（步骤 ${value.stepKey}，${value.kind} ${value.target}）。\n`
        const tail = isEnvProbe
          ? '这是环境事实，不是对某一步的判定。接下来按状态块的【下一步】做：确认完可用性就调用 coach_plan。'
          : '这是插件读到的原始事实，不是判定。判定请用 coach_verify，按状态块里的【合格标准】给出结论。'
        return [{
          type: 'text',
          text: `${head}核查结果：${value.ok ? '成功' : '未通过'}\n原始事实：${value.detail}\n${tail}`,
        }]
      },
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_check',
        stepKey: value.stepKey,
        kind: value.kind,
        target: value.target,
        ok: value.ok,
        detail: value.detail,
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const kind = args.kind
      const target = typeof args.target === 'string' ? args.target.trim() : ''

      // v0.2.5：先拦非法 kind，避免 kind:"none" 落进文件分支真的去读路径。
      // 核心 `applyCheck` 里还有一层同样的校验（双保险，且单测可直接覆盖）。
      if (!CHECK_KINDS.includes(kind)) {
        throw new CoachError(
          `kind 必须是 ${CHECK_KINDS.join(' / ')} 之一，收到 ${JSON.stringify(kind)}。`,
          'COACH_CHECK_KIND',
        )
      }

      let observation
      if (kind === 'command') {
        const subprocess = ctx.get('subprocess')
        if (subprocess === undefined) {
          throw new CoachError('宿主的 subprocess 服务不可用，无法做命令核查。', 'COACH_CHECK_NO_SUBPROCESS')
        }
        observation = await observeCommand(subprocess, target, config, exec)
      } else {
        const fs = ctx.get('fs')
        if (fs === undefined) {
          throw new CoachError('宿主的 fs 服务不可用，无法做文件核查。', 'COACH_CHECK_NO_FS')
        }
        try {
          observation = await observeFile(fs, kind, target, config, exec)
        } catch (error) {
          observation = {
            ok: false,
            detail: `读取失败：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      const detail = clip(observation.detail)
      const next = applyCheck(state, {
        stepKey: args.stepKey,
        kind,
        target,
        ok: observation.ok,
        detail,
      }, 0)

      return {
        ok: observation.ok,
        kind,
        target,
        stepKey: next.checks[next.checks.length - 1].stepKey,
        phase: next.phase,
        detail,
      }
    },
  })
}

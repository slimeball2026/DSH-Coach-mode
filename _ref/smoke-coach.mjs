#!/usr/bin/env node
/**
 * 装配冒烟（零宿主依赖）：不需要 dsh 的 node_modules，直接跑本 bundle。
 *
 * 这件事本身就是回归测试：插件代码**不许** import 任何 `@deepseek-ai/*`。
 * （事故记录：曾经 import `defineTool` / `Config`，装到 profile 里立即
 *  `ERR_MODULE_NOT_FOUND`，preset 显示「加载失败」。）
 *
 * 用法（任意目录）：node _ref/smoke-coach.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PKG = new URL('../coach-mode-bundle/', import.meta.url).href

const { resolveCoachConfig } = await import(`${PKG}config.js`)
const { createProjection } = await import(`${PKG}projection.js`)
const { coachGuard } = await import(`${PKG}guard.js`)
const { renderStateBlock } = await import(`${PKG}core/render.js`)
const { supportLevel } = await import(`${PKG}core/support.js`)
const { createPlanTool } = await import(`${PKG}tools/coach-plan.js`)
const { createCheckTool } = await import(`${PKG}tools/coach-check.js`)
const { createVerifyTool } = await import(`${PKG}tools/coach-verify.js`)
const { createAdvanceTool } = await import(`${PKG}tools/coach-advance.js`)
const { createSkipTool } = await import(`${PKG}tools/coach-skip.js`)
const { createResearchTool } = await import(`${PKG}tools/coach-research.js`)
const { createBackTool } = await import(`${PKG}tools/coach-back.js`)
const { createPauseTool } = await import(`${PKG}tools/coach-pause.js`)
const { compileParameters, compileValueSchema } = await import(`${PKG}tools/define-tool.js`)

let failures = 0
async function check(label, fn) {
  try {
    const note = await fn()
    console.log(`  ok   ${label}${note === undefined ? '' : ` — ${note}`}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label} — ${error?.message ?? error}`)
  }
}

/** 假 Session：只实现插件用到的三个成员。 */
function fakeSession(cwd) {
  const events = []
  let seq = 0
  return {
    header: { cwd },
    get seq() { return seq },
    snapshotEvents(from = 0, to = seq) {
      return events.filter((event) => event.seq >= from && event.seq < to)
    },
    record(name, args, meta) {
      const callId = `call-${seq}`
      events.push({ type: 'tool/call', seq, data: { callId, name, arguments: JSON.stringify(args ?? {}) } })
      seq += 1
      events.push({
        type: 'tool/result',
        seq,
        data: {
          message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [] },
          ...(meta === undefined ? {} : { meta }),
        },
      })
      seq += 1
    },
    recordFailure(name, args, code) {
      const callId = `call-${seq}`
      events.push({ type: 'tool/call', seq, data: { callId, name, arguments: JSON.stringify(args ?? {}) } })
      seq += 1
      events.push({
        type: 'tool/result',
        seq,
        data: {
          message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [], isError: true },
          error: { name: 'CoachError', code },
        },
      })
      seq += 1
    },
  }
}

/** 模拟宿主 ctx.subprocess：只实现 coach_check 用到的 spawn/done/collected。 */
function fakeSubprocess() {
  return {
    spawn({ argv }) {
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: {
          stdout: { readFrom: () => ({ text: `ran ${argv.join(' ')}` }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      }
    },
  }
}

/** 模拟宿主 ctx.web：返回固定来源；查询含 fail 时抛错。 */
function fakeWeb() {
  return {
    async search({ query }) {
      if (query.includes('fail')) throw new Error('网络超时')
      return {
        sources: [{ url: 'https://example.com/docs', title: '官方文档', snippet: '示例来源' }],
        truncated: false,
        content: `关于「${query}」的示例摘要`,
      }
    },
  }
}

/** 用真实磁盘实现一个最小的 fs 服务（模拟宿主 ctx.fs）。 */
function fakeFs() {
  return {
    async resolve(path) { return { targetKey: path, displayPath: path } },
    async stat(target) {
      try {
        const info = statSync(target.targetKey)
        return { version: 'v1', type: info.isDirectory() ? 'directory' : 'file', size: info.size }
      } catch {
        return undefined
      }
    },
    async listDir(target) {
      return readdirSync(target.targetKey, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        target: { targetKey: join(target.targetKey, entry.name), displayPath: entry.name },
      }))
    },
    async readText(target) { return readFileSync(target.targetKey, 'utf8') },
  }
}

const workdir = mkdtempSync(join(tmpdir(), 'coach-smoke-'))
mkdirSync(join(workdir, '.git'), { recursive: true })
writeFileSync(join(workdir, 'notes.txt'), 'hello 教练模式\n', 'utf8')
const gitDir = join(workdir, '.git')
const notesFile = join(workdir, 'notes.txt')

const config = resolveCoachConfig({})
const ctx = {
  get: (name) => {
    if (name === 'fs') return fakeFs()
    // 故意提供一个"一被调用就报错"的 subprocess：用来证明白名单外的命令
    // 会先被拦住，不会真的去 spawn。
    if (name === 'subprocess') {
      return { spawn() { throw new Error('不应该走到 spawn：白名单外的命令必须先拦住') } }
    }
    if (name === 'web') return fakeWeb()
    return undefined
  },
  logger: { debug() {} },
}

console.log('0) 零宿主依赖')
await check('resolveCoachConfig 补齐全部默认值', () => JSON.stringify(config))
await check('allowCommands 默认是只读白名单（Q5 B）', () => {
  if (!config.allowCommands.includes('git --version')) throw new Error('缺 git --version')
  if (config.allowCommands.includes('git push')) throw new Error('不该包含 git push')
  return `${config.allowCommands.length} 条`
})

console.log('1) 工具定义编译（本地 define-tool，不再 import dsh-tools）')
const projection = createProjection(config)
const tools = [
  createPlanTool({ config, projection }),
  createCheckTool({ config, projection, ctx }),
  createVerifyTool({ config, projection }),
  createAdvanceTool({ config, projection }),
  createSkipTool({ config, projection }),
  createResearchTool({ config, projection, ctx }),
  createBackTool({ config, projection }),
  createPauseTool({ config, projection }),
]
await check('8 个工具定义已构建', () => tools.map((tool) => tool.name).join(', '))
for (const tool of tools) {
  await check(`${tool.name} 的 parameters / output 是合法原始 JSON Schema`, () => {
    if (typeof tool.description !== 'string' || tool.description.trim() === '') {
      throw new Error('缺 description：会让 request/header 写出 non-JSON-serializable data')
    }
    const params = tool.parameters
    if (params.type !== 'object' || typeof params.properties !== 'object') throw new Error('parameters 根不是 object')
    // 全是可选参数时不产生 required 数组——与 defineTool 的行为一致，不是缺陷。
    if (params.required !== undefined && !Array.isArray(params.required)) {
      throw new Error('parameters.required 不是数组')
    }
    if (tool.output.schema === null || typeof tool.output.schema !== 'object') throw new Error('缺 output.schema')
    if (tool.output.schema.type !== 'object') throw new Error('output.schema 必须是 object 根（assertObjectJsonSchema）')
    if (typeof tool.output.render !== 'function') throw new Error('缺 output.render')
    if (JSON.stringify(params).includes('"required":true')) throw new Error('required 没有被提升成数组')
    return `${Object.keys(params.properties).length} 参数 / required ${(params.required ?? []).length}`
  })
}
await check('嵌套 required 正确提升到父级', () => {
  const params = compileParameters({
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: { type: 'string', required: true },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { goal: { type: 'string', required: true } },
            },
          },
        },
      },
    },
  })
  const item = params.properties.sections.items
  if (JSON.stringify(item).includes('"required":true')) throw new Error('required 没有从属性节点上摘掉')
  if (JSON.stringify(item.required) !== '["section","steps"]') {
    throw new Error(`required 提升不对：${JSON.stringify(item.required)}`)
  }
  return 'items.required = ["section","steps"]'
})
await check('输出 schema 编译成 raw JSON Schema', () => {
  const schema = compileValueSchema({
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean', required: true }, detail: { type: 'string', required: true } },
  })
  if (JSON.stringify(schema.required) !== '["ok","detail"]') throw new Error('required 不对')
  return JSON.stringify(schema.required)
})

console.log('2) plan → check（真磁盘）→ verify → advance')
const planTool = tools[0]
const checkTool = tools[1]
const verifyTool = tools[2]
const advanceTool = tools[3]
// 同一个工具、换一个"会真的返回成功"的 subprocess，用来验证白名单命令能走通。
const checkToolAllowed = createCheckTool({
  config,
  projection,
  ctx: {
    get: (name) => name === 'fs' ? fakeFs() : name === 'subprocess' ? fakeSubprocess() : undefined,
  },
})
const session = fakeSession(workdir)
const exec = { agent: { session }, signal: new AbortController().signal, callId: 'c' }
const facts = { failureThreshold: 3, sameMachine: true, platform: process.platform, cwd: workdir }

console.log('2a) 空 sections 的 coach_plan（v0.2.5）')
const emptySession = fakeSession(workdir)
const emptyExec = { agent: { session: emptySession }, signal: new AbortController().signal }
const emptyArgs = { toolName: 'Git', toolAvailable: 'yes', originalGoal: '学会提交代码' }
await check('空 sections + yes：不接计划，留在 INIT', async () => {
  const value = await planTool.execute(emptyArgs, emptyExec)
  if (value.accepted !== false || value.needsSections !== true) throw new Error(JSON.stringify(value))
  if (value.phase !== 'INIT') throw new Error(`phase=${value.phase}`)
  return JSON.stringify(value)
})
emptySession.record('coach_plan', emptyArgs, undefined)
await check('折叠后仍是 INIT，且记住了可用性', () => {
  const state = projection.stateFor(emptySession)
  if (state.phase !== 'INIT') throw new Error(`phase=${state.phase}`)
  if (state.toolAvailable !== true) throw new Error(`toolAvailable=${state.toolAvailable}`)
  return `phase=${state.phase}, available=${state.toolAvailable}`
})
await check('状态块显示【工具可用性】和【待补计划】', () => {
  const block = renderStateBlock(projection.stateFor(emptySession), facts)
  if (!block.includes('【工具可用性】已确认可以打开并使用')) throw new Error('缺可用性行')
  if (!block.includes('【待补计划】')) throw new Error('缺待补计划行')
  return 'ok'
})

const planArgs = {
  toolName: 'Git',
  toolAvailable: 'yes',
  userLevel: '从未用过',
  originalGoal: '学会提交代码',
  difficulty: '低',
  sections: [{
    section: '基础',
    steps: [{
      goal: '建立仓库',
      action: '在目标目录执行 git init',
      expected: '目录里出现 .git',
      standard: '目标目录下存在 .git',
      evidence: 'file',
      check: { kind: 'path_exists', target: gitDir },
    }],
  }],
}
await check('coach_plan 成功', async () => JSON.stringify(await planTool.execute(planArgs, exec)))
session.record('coach_plan', planArgs, undefined)
await check('折叠进入 WAIT_FEEDBACK', () => projection.stateFor(session).phase)
await check('状态块提示"尚未采集"', () => {
  const block = renderStateBlock(projection.stateFor(session), facts)
  if (!block.includes('尚未采集')) throw new Error('应当提示尚未采集')
  return block.split('\n').find((line) => line.startsWith('【核查证据】'))
})

await check('未取证时 coach_verify 被拒（5.2(1)）', async () => {
  try {
    await verifyTool.execute({ verdict: '通过', reason: '用户说做完了' }, exec)
    throw new Error('本应失败')
  } catch (error) {
    return String(error.code)
  }
})
session.recordFailure('coach_verify', { verdict: '通过' }, 'COACH_VERIFY_NO_CHECK')
await check('失败结果没有推进状态（R4）', () => {
  const state = projection.stateFor(session)
  if (state.verifications.length !== 0) throw new Error('失败调用被记成了结论')
  return `phase=${state.phase}, verifications=0`
})

let checkValue
await check('coach_check(path_exists) 真的读了磁盘', async () => {
  checkValue = await checkTool.execute({ kind: 'path_exists', target: gitDir }, exec)
  if (checkValue.ok !== true) throw new Error(`ok=${checkValue.ok}`)
  return checkValue.detail
})
await check('coach_check(list_dir) 列出条目', async () => {
  const value = await checkTool.execute({ kind: 'list_dir', target: workdir }, exec)
  if (!value.detail.includes('notes.txt')) throw new Error('没列出 notes.txt')
  return value.detail.slice(0, 56)
})
await check('coach_check(read_file) 读到内容', async () => {
  const value = await checkTool.execute({ kind: 'read_file', target: notesFile }, exec)
  if (!value.detail.includes('hello 教练模式')) throw new Error('没读到内容')
  return value.detail.split('\n')[0]
})
await check('路径不存在时返回 ok=false 而不是崩', async () => {
  const value = await checkTool.execute({ kind: 'path_exists', target: join(workdir, 'nope') }, exec)
  if (value.ok !== false) throw new Error('应当 ok=false')
  return value.detail
})
await check('kind=command 在白名单外仍被拒（不会去 spawn）', async () => {
  try {
    await checkTool.execute({ kind: 'command', target: 'git push' }, exec)
    throw new Error('本应失败')
  } catch (error) {
    if (error.code !== 'COACH_CHECK_COMMAND_DISABLED') throw new Error(`错误码不对：${error.code}`)
    return error.code
  }
})
await check('白名单命令会走到 subprocess 并返回 ok（Q5 B）', async () => {
  const allowedSession = fakeSession(workdir)
  const allowedExec = { agent: { session: allowedSession }, signal: new AbortController().signal }
  const value = await checkToolAllowed.execute({ kind: 'command', target: 'git --version' }, allowedExec)
  if (value.ok !== true) throw new Error(`ok=${value.ok}`)
  if (!value.detail.includes('git --version')) throw new Error(value.detail)
  return value.detail.slice(0, 56)
})
await check('kind:"none" 被拒（v0.2.5）', async () => {
  try {
    await checkTool.execute({ kind: 'none', target: 'none' }, exec)
    throw new Error('本应失败')
  } catch (error) {
    if (error.code !== 'COACH_CHECK_KIND') throw new Error(`错误码不对：${error.code}`)
    return error.code
  }
})

session.record('coach_check', { kind: 'path_exists', target: gitDir }, {
  coachTool: 'coach_check', stepKey: '0:0', kind: 'path_exists',
  target: gitDir, ok: true, detail: '存在（类型 directory）',
})
await check('状态块把证据渲染出来', () => {
  const block = renderStateBlock(projection.stateFor(session), facts)
  if (!block.includes('path_exists')) throw new Error('证据没进状态块')
  return block.split('\n').find((line) => line.startsWith('【核查证据】')).slice(0, 60)
})
await check('coach_verify 受理 → NEXT_STEP', async () => JSON.stringify(await verifyTool.execute({
  verdict: '通过', evidenceRef: gitDir, reason: '存在 .git',
}, exec)))
session.record('coach_verify', { verdict: '通过' }, {
  coachTool: 'coach_verify', verdict: '通过', evidenceRef: gitDir, reason: '存在 .git',
})
await check('折叠出 NEXT_STEP', () => projection.stateFor(session).phase)
await check('coach_advance 放行 → COMPLETE', async () => JSON.stringify(await advanceTool.execute({}, exec)))
session.record('coach_advance', {}, undefined)
await check('折叠出 COMPLETE', () => projection.stateFor(session).phase)

console.log('2c) coach_back（v0.3.4）')
const backSession = fakeSession(workdir)
const backExec = { agent: { session: backSession }, signal: new AbortController().signal }
const backProjection = createProjection(config)
const backPlanTool = createPlanTool({ config, projection: backProjection })
const backVerifyTool = createVerifyTool({ config, projection: backProjection })
const backAdvanceTool = createAdvanceTool({ config, projection: backProjection })
const backTool = createBackTool({ config, projection: backProjection })
const backPlanArgs = {
  toolName: 'Git',
  toolAvailable: 'yes',
  userLevel: '从未用过',
  originalGoal: '学会提交代码',
  difficulty: '低',
  sections: [{
    section: '基础',
    steps: [
      {
        goal: '建立仓库', action: 'git init', expected: '有 .git',
        standard: '存在 .git', evidence: 'user_artifact',
      },
      {
        goal: '暂存文件', action: 'git add', expected: '已暂存',
        standard: '状态里是 staged', evidence: 'user_artifact',
      },
    ],
  }],
}
await check('两步计划推进到第 2 步', async () => {
  await backPlanTool.execute(backPlanArgs, backExec)
  backSession.record('coach_plan', backPlanArgs, undefined)
  await backVerifyTool.execute({ verdict: '通过', evidenceRef: '截图1.png', reason: '完成' }, backExec)
  backSession.record('coach_verify', { verdict: '通过', evidenceRef: '截图1.png' }, {
    coachTool: 'coach_verify', verdict: '通过', evidenceRef: '截图1.png', reason: '完成',
  })
  await backAdvanceTool.execute({}, backExec)
  backSession.record('coach_advance', {}, undefined)
  const state = backProjection.stateFor(backSession)
  if (state.stepIndex !== 1) throw new Error(`stepIndex=${state.stepIndex}`)
  return '第 2 步'
})
await check('coach_back 回退到第 1 步，旧结论作废', async () => {
  const value = await backTool.execute({ stepKey: '0:0', reason: '第一步重做' }, backExec)
  backSession.record('coach_back', { stepKey: '0:0', reason: '第一步重做' }, {
    coachTool: 'coach_back', stepKey: '0:0', reason: '第一步重做',
  })
  const state = backProjection.stateFor(backSession)
  const { hasPassedOrSkipped } = await import(`${PKG}core/machine.js`)
  if (value.phase !== 'WAIT_FEEDBACK') throw new Error(`value.phase=${value.phase}`)
  if (state.phase !== 'WAIT_FEEDBACK') throw new Error(`phase=${state.phase}`)
  if (state.stepIndex !== 0) throw new Error(`stepIndex=${state.stepIndex}`)
  if (state.backs.length !== 1) throw new Error(`backs=${state.backs.length}`)
  if (hasPassedOrSkipped(state, '0:0')) throw new Error('旧通过没有失效')
  return 'WAIT_FEEDBACK @ 0:0'
})
await check('回退后状态块显示【回退记录】与旧结论作废', () => {
  const block = renderStateBlock(backProjection.stateFor(backSession), facts)
  if (!block.includes('【回退记录】')) throw new Error('缺回退记录')
  if (!block.includes('回退后旧结论已作废')) throw new Error('旧结论没有作废')
  return 'ok'
})
await check('回退后 coach_advance 被拒', async () => {
  try {
    await backAdvanceTool.execute({}, backExec)
    throw new Error('本应失败')
  } catch (error) {
    return String(error.code ?? error.message).slice(0, 40)
  }
})
await check('重新 coach_verify 通过后可以继续', async () => {
  await backVerifyTool.execute({ verdict: '通过', evidenceRef: '新截图.png', reason: '重做完成' }, backExec)
  backSession.record('coach_verify', { verdict: '通过', evidenceRef: '新截图.png' }, {
    coachTool: 'coach_verify', verdict: '通过', evidenceRef: '新截图.png', reason: '重做完成',
  })
  await backAdvanceTool.execute({}, backExec)
  backSession.record('coach_advance', {}, undefined)
  const state = backProjection.stateFor(backSession)
  if (state.stepIndex !== 1) throw new Error(`stepIndex=${state.stepIndex}`)
  return `第 ${state.stepIndex + 1} 步`
})

console.log('2d) 暂停 / 恢复（v0.4.0）')
const pauseSession = fakeSession(workdir)
const pauseExec = { agent: { session: pauseSession }, signal: new AbortController().signal }
const pauseProjection = createProjection(config)
const pausePlanTool = createPlanTool({ config, projection: pauseProjection })
const pauseTool = createPauseTool({ config, projection: pauseProjection })
const pauseVerifyTool = createVerifyTool({ config, projection: pauseProjection })
const pauseAdvanceTool = createAdvanceTool({ config, projection: pauseProjection })
const pausePlanArgs = {
  toolName: 'Git',
  toolAvailable: 'yes',
  userLevel: '从未用过',
  originalGoal: '学会提交代码',
  difficulty: '低',
  sections: [{
    section: '基础',
    steps: [
      {
        goal: '建立仓库', action: 'git init', expected: '有 .git',
        standard: '存在 .git', evidence: 'user_artifact',
      },
      {
        goal: '暂存文件', action: 'git add', expected: '已暂存',
        standard: '状态里是 staged', evidence: 'user_artifact',
      },
    ],
  }],
}
await check('计划后暂停：进入 PAUSED，状态块不再给执行步骤', async () => {
  await pausePlanTool.execute(pausePlanArgs, pauseExec)
  pauseSession.record('coach_plan', pausePlanArgs, undefined)
  const value = await pauseTool.execute({ action: 'pause', note: '今天先到这' }, pauseExec)
  pauseSession.record('coach_pause', { action: 'pause', note: '今天先到这' }, {
    coachTool: 'coach_pause', action: 'pause', fromPhase: 'WAIT_FEEDBACK', stepKey: '0:0', note: '今天先到这',
  })
  const state = pauseProjection.stateFor(pauseSession)
  if (value.phase !== 'PAUSED' || state.phase !== 'PAUSED') throw new Error(`phase=${state.phase}`)
  const block = renderStateBlock(state, facts)
  if (!block.includes('【暂停位置】')) throw new Error('缺暂停位置')
  if (block.includes('【请执行】')) throw new Error('暂停时不该继续给执行步骤')
  return `${value.phase} @ ${value.stepKey}`
})
await check('暂停期间 coach_verify 被拒', async () => {
  try {
    await pauseVerifyTool.execute({ verdict: '通过', evidenceRef: '截图.png' }, pauseExec)
    throw new Error('本应失败')
  } catch (error) {
    return String(error.code ?? error.message).slice(0, 40)
  }
})
await check('恢复：回到 WAIT_FEEDBACK，暂停记录闭合', async () => {
  const value = await pauseTool.execute({ action: 'resume' }, pauseExec)
  pauseSession.record('coach_pause', { action: 'resume' }, {
    coachTool: 'coach_pause', action: 'resume', fromPhase: '', stepKey: '0:0', note: '今天先到这',
  })
  const state = pauseProjection.stateFor(pauseSession)
  if (value.phase !== 'WAIT_FEEDBACK' || state.phase !== 'WAIT_FEEDBACK') {
    throw new Error(`phase=${state.phase}`)
  }
  if (state.pauses[0].resumedAt === null) throw new Error('resume 没有闭合暂停记录')
  return `${state.phase} @ ${state.stepIndex}`
})
await check('恢复后可以重新核查并推进', async () => {
  await pauseVerifyTool.execute({ verdict: '通过', evidenceRef: '截图.png' }, pauseExec)
  pauseSession.record('coach_verify', { verdict: '通过', evidenceRef: '截图.png' }, {
    coachTool: 'coach_verify', verdict: '通过', evidenceRef: '截图.png', reason: '',
  })
  const advanced = await pauseAdvanceTool.execute({}, pauseExec)
  pauseSession.record('coach_advance', {}, undefined)
  if (advanced.phase !== 'WAIT_FEEDBACK' || advanced.stepIndex !== 1) {
    throw new Error(`phase=${advanced.phase}, step=${advanced.stepIndex}`)
  }
  return `第 ${advanced.stepIndex + 1} 步`
})

console.log('3) 守卫')
await check('write 被拒绝', () => String(coachGuard({ name: 'write' })).slice(0, 28))
await check('edit 被拒绝', () => String(coachGuard({ name: 'edit' })).slice(0, 28))
await check('pwsh 放行（用户决定本切片不守卫）', () => {
  if (coachGuard({ name: 'pwsh' }) !== undefined) throw new Error('意外拒绝')
  return 'undefined'
})

console.log('4) 安装分支（A6）')
const installSession = fakeSession(workdir)
const installExec = { agent: { session: installSession }, signal: new AbortController().signal }
const installProjection = createProjection(config)
const installArgs = {
  toolName: 'Photoshop',
  toolAvailable: 'no',
  userLevel: '从未用过',
  originalGoal: '学会抠图',
  difficulty: '低',
  sections: [{
    section: '安装',
    steps: [{
      goal: '装上 Photoshop', action: '跑安装包', expected: '能打开',
      standard: '能打开并新建文档', evidence: 'user_artifact',
    }],
  }],
}
await check('coach_plan（安装分支）成功', async () => JSON.stringify(
  await createPlanTool({ config, projection: installProjection }).execute(installArgs, installExec),
))
installSession.record('coach_plan', installArgs, undefined)
await check('goalMode=install 且 currentGoal 自动补齐', () => {
  const state = installProjection.stateFor(installSession)
  if (state.phase !== 'INSTALL_TOOL') throw new Error(`phase=${state.phase}`)
  if (state.goalMode !== 'install') throw new Error(`goalMode=${state.goalMode}`)
  return `${state.phase}；${state.currentGoal} / 原始 ${state.originalGoal}`
})
await check('状态块带【安装分支】且保留原始目标', () => {
  const block = renderStateBlock(installProjection.stateFor(installSession), facts)
  if (!block.includes('【安装分支】') || !block.includes('学会抠图')) throw new Error('原始目标丢了')
  return 'ok'
})
await check('安装分支核查通过 → NEXT_STEP', async () => {
  const value = await createVerifyTool({ config, projection: installProjection })
    .execute({ verdict: '通过', evidenceRef: '安装截图' }, installExec)
  if (value.phase !== 'NEXT_STEP') throw new Error(`phase=${value.phase}`)
  installSession.record('coach_verify', { verdict: '通过', evidenceRef: '安装截图' }, {
    coachTool: 'coach_verify', verdict: '通过', evidenceRef: '安装截图', reason: '',
  })
  return value.phase
})
await check('安装分支走完最后一步 → PLAN 且 originalGoal 保留', async () => {
  const value = await createAdvanceTool({ config, projection: installProjection })
    .execute({}, installExec)
  installSession.record('coach_advance', {}, undefined)
  const state = installProjection.stateFor(installSession)
  if (value.phase !== 'PLAN') throw new Error(`phase=${value.phase}`)
  if (state.phase !== 'PLAN') throw new Error(`state.phase=${state.phase}`)
  if (state.goalMode !== 'learn' || state.originalGoal !== '学会抠图') {
    throw new Error(`goalMode=${state.goalMode}, originalGoal=${state.originalGoal}`)
  }
  return `${value.phase}；${state.originalGoal}`
})

console.log('4b) 安装分支受控早退（v0.3.3）')
const exitSession = fakeSession(workdir)
const exitExec = { agent: { session: exitSession }, signal: new AbortController().signal }
const exitProjection = createProjection(config)
const exitPlanTool = createPlanTool({ config, projection: exitProjection })
const installTwo = {
  toolName: 'Photoshop',
  toolAvailable: 'no',
  userLevel: '从未用过',
  originalGoal: '学会抠图',
  difficulty: '低',
  sections: [{
    section: '安装',
    steps: [
      {
        goal: '下载安装包', action: '从官网下载', expected: '有安装包',
        standard: '安装包可执行', evidence: 'user_artifact',
      },
      {
        goal: '启动并新建文档', action: '启动并新建', expected: '有空白画布',
        standard: '能新建空白文档', evidence: 'user_artifact',
      },
    ],
  }],
}
await check('进入安装分支并推进到第 2 步（相位仍是 INSTALL_TOOL）', async () => {
  await exitPlanTool.execute(installTwo, exitExec)
  exitSession.record('coach_plan', installTwo, undefined)
  await createVerifyTool({ config, projection: exitProjection })
    .execute({ verdict: '通过', evidenceRef: '安装包截图' }, exitExec)
  exitSession.record('coach_verify', { verdict: '通过', evidenceRef: '安装包截图' }, {
    coachTool: 'coach_verify', verdict: '通过', evidenceRef: '安装包截图', reason: '',
  })
  await createAdvanceTool({ config, projection: exitProjection }).execute({}, exitExec)
  exitSession.record('coach_advance', {}, undefined)
  const state = exitProjection.stateFor(exitSession)
  if (state.phase !== 'INSTALL_TOOL') throw new Error(`phase=${state.phase}`)
  if (state.stepIndex !== 1) throw new Error(`stepIndex=${state.stepIndex}`)
  return `${state.phase} @ 第 ${state.stepIndex + 1} 步`
})
await check('状态块在第 2 步仍给出【安装分支·可早退】', () => {
  const block = renderStateBlock(exitProjection.stateFor(exitSession), facts)
  if (!block.includes('【安装分支·可早退】')) throw new Error('缺早退提示')
  return block.split('\n').find((line) => line.startsWith('【安装分支·可早退】')).slice(0, 32)
})
const learnAfterInstall = {
  toolName: 'Photoshop',
  toolAvailable: 'yes',
  goalMode: 'learn',
  originalGoal: '学会抠图',
  sections: [{
    section: '选区基础',
    steps: [{
      goal: '选中主体', action: '打开图片用快速选择', expected: '有选区',
      standard: '选区覆盖主体', evidence: 'user_artifact',
    }],
  }],
}
await check('一次 coach_plan 早退 → WAIT_FEEDBACK，原目标保留、旧证据作废', async () => {
  const value = await exitPlanTool.execute(learnAfterInstall, exitExec)
  exitSession.record('coach_plan', learnAfterInstall, undefined)
  const state = exitProjection.stateFor(exitSession)
  if (value.exitedInstallBranch !== true) throw new Error('没有标记为早退')
  if (state.phase !== 'WAIT_FEEDBACK') throw new Error(`phase=${state.phase}`)
  if (state.goalMode !== 'learn') throw new Error(`goalMode=${state.goalMode}`)
  if (state.originalGoal !== '学会抠图') throw new Error(`originalGoal=${state.originalGoal}`)
  if (state.currentGoal !== '学会抠图') throw new Error(`currentGoal=${state.currentGoal}`)
  if (state.verifications.length !== 0) throw new Error('旧安装结论没有作废')
  return `${state.currentGoal} / ${state.plan[0].section}`
})
await check('早退后状态块不再出现安装分支文案', () => {
  const block = renderStateBlock(exitProjection.stateFor(exitSession), facts)
  if (block.includes('【安装分支】') || block.includes('【安装分支·可早退】')) {
    throw new Error('安装分支文案还在')
  }
  return 'ok'
})
await check('早退时 sections 留空 → PLAN（等补学习计划）', async () => {
  const emptyExitSession = fakeSession(workdir)
  const emptyExitExec = { agent: { session: emptyExitSession }, signal: new AbortController().signal }
  const emptyExitProjection = createProjection(config)
  const tool = createPlanTool({ config, projection: emptyExitProjection })
  await tool.execute(installTwo, emptyExitExec)
  emptyExitSession.record('coach_plan', installTwo, undefined)
  const value = await tool.execute({
    toolName: 'Photoshop', toolAvailable: 'yes', goalMode: 'learn', originalGoal: '学会抠图',
  }, emptyExitExec)
  emptyExitSession.record('coach_plan', {
    toolName: 'Photoshop', toolAvailable: 'yes', goalMode: 'learn', originalGoal: '学会抠图',
  }, undefined)
  const state = emptyExitProjection.stateFor(emptyExitSession)
  if (value.phase !== 'PLAN') throw new Error(`value.phase=${value.phase}`)
  if (state.phase !== 'PLAN') throw new Error(`state.phase=${state.phase}`)
  if (state.plan.length !== 0) throw new Error('不该接空计划')
  return `${state.phase} / ${state.originalGoal}`
})
await check('反向：早退时 toolAvailable=no 被拒，仍留在安装分支', async () => {
  const reverseSession = fakeSession(workdir)
  const reverseExec = { agent: { session: reverseSession }, signal: new AbortController().signal }
  const reverseProjection = createProjection(config)
  const tool = createPlanTool({ config, projection: reverseProjection })
  await tool.execute(installTwo, reverseExec)
  reverseSession.record('coach_plan', installTwo, undefined)
  try {
    await tool.execute({
      ...learnAfterInstall, toolAvailable: 'no', goalMode: 'install',
    }, reverseExec)
    throw new Error('本应失败')
  } catch (error) {
    if (error.code !== 'COACH_PLAN_INSTALL_EXIT') throw new Error(`错误码不对：${error.code}`)
    const state = reverseProjection.stateFor(reverseSession)
    if (state.phase !== 'INSTALL_TOOL') throw new Error(`被拒后离开了安装分支：${state.phase}`)
    return error.code
  }
})

console.log('5) 跳过 + 阈值')
const skipSession = fakeSession(workdir)
const skipExec = { agent: { session: skipSession }, signal: new AbortController().signal }
const skipProjection = createProjection(config)
await check('plan 后 coach_skip 返回确认文本', async () => {
  await createPlanTool({ config, projection: skipProjection }).execute(planArgs, skipExec)
  skipSession.record('coach_plan', planArgs, undefined)
  const value = await createSkipTool({ config, projection: skipProjection })
    .execute({ reason: '用户说先往下走' }, skipExec)
  if (!value.confirmation.includes('已记录跳过')) throw new Error('缺确认文本')
  return value.confirmation.split('\n')[0]
})
skipSession.record('coach_skip', { reason: '用户说先往下走' }, {
  coachTool: 'coach_skip', stepKey: '0:0', reason: '用户说先往下走',
})
await check('跳过后 coach_advance 放行', async () => (
  await createAdvanceTool({ config, projection: skipProjection }).execute({}, skipExec)
).phase)

console.log('6) coach_research（检索缓存 + 失败留痕）')
const researchSession = fakeSession(workdir)
const researchExec = { agent: { session: researchSession }, signal: new AbortController().signal }
const researchProjection = createProjection(config)
const researchTool = createResearchTool({ config, projection: researchProjection, ctx })
await check('plan 后 coach_research 成功、脱敏并写缓存', async () => {
  await createPlanTool({ config, projection: researchProjection }).execute(planArgs, researchExec)
  researchSession.record('coach_plan', planArgs, undefined)
  const query = 'git 版本 C:\\Users\\me\\secret.txt'
  const value = await researchTool.execute({ query }, researchExec)
  if (value.ok !== true) throw new Error(`ok=${value.ok}`)
  if (value.redacted !== true) throw new Error('路径没有被脱敏')
  if (!value.query.includes('<path>')) throw new Error(`query=${value.query}`)
  if (value.sources.length !== 1) throw new Error(`sources=${value.sources.length}`)
  researchSession.record('coach_research', { query }, {
    coachTool: 'coach_research', ...value,
  })
  const state = researchProjection.stateFor(researchSession)
  if (state.phase !== 'WAIT_FEEDBACK') throw new Error(`phase=${state.phase}`)
  if (state.research.length !== 1) throw new Error(`research=${state.research.length}`)
  const block = renderStateBlock(state, facts)
  if (!block.includes('【检索缓存】')) throw new Error('状态块没有检索缓存')
  return `${value.sources.length} 个来源；${value.query}`
})
await check('检索失败且有当前步骤 → 保持原阶段、只留失败记录（v0.3.1）', async () => {
  const query = 'fail 网络超时'
  const value = await researchTool.execute({ query }, researchExec)
  if (value.ok !== false) throw new Error(`ok=${value.ok}`)
  researchSession.record('coach_research', { query }, {
    coachTool: 'coach_research', ...value,
  })
  const state = researchProjection.stateFor(researchSession)
  if (state.phase !== 'WAIT_FEEDBACK') throw new Error(`phase=${state.phase}`)
  if (state.research.length !== 2) throw new Error(`research=${state.research.length}`)
  const block = renderStateBlock(state, facts)
  if (!block.includes('【检索缓存】')) throw new Error('状态块没有检索缓存')
  if (!block.includes('检索失败不等于本步判定失败')) throw new Error('缺少不自动降级的说明')
  return state.phase
})

console.log('7) 支撑等级（v0.4.1：只调讲多细，不调查多严）')
const supportSession = fakeSession(workdir)
const supportExec = { agent: { session: supportSession }, signal: new AbortController().signal }
const supportProjection = createProjection(config)
/** 一步的合法形状（user_artifact，不需要 coach_check）。 */
function supportStep(goal) {
  return {
    goal,
    action: `做「${goal}」`,
    expected: '有结果',
    standard: '结果符合预期',
    evidence: 'user_artifact',
    check: null,
  }
}
const supportPlanArgs = {
  toolName: 'Git',
  toolAvailable: 'yes',
  userLevel: '会基础',
  originalGoal: '学会提交代码',
  difficulty: '低',
  sections: [
    { section: '基础', steps: [supportStep('建立仓库'), supportStep('查看状态')] },
    { section: '进阶', steps: [supportStep('暂存改动'), supportStep('提交')] },
  ],
}
await check('计划建立后【支撑等级】= 2（会基础）', async () => {
  await createPlanTool({ config, projection: supportProjection }).execute(supportPlanArgs, supportExec)
  supportSession.record('coach_plan', supportPlanArgs, undefined)
  const state = supportProjection.stateFor(supportSession)
  const level = supportLevel(state)
  if (level.level !== 2) throw new Error(`level=${level.level}`)
  const block = renderStateBlock(state, facts)
  if (!block.includes('【支撑等级】2（给要点）')) throw new Error('状态块缺少【支撑等级】')
  if (!block.includes('核查标准不变')) throw new Error('缺少“核查标准不变”的说明')
  return `level=${level.level}`
})
/** 判通过 + 推进，并在会话里落 meta（与工具调用一致）。 */
async function supportPass(at) {
  await createVerifyTool({ config, projection: supportProjection })
    .execute({ verdict: '通过', evidenceRef: `截图-${at}.png`, reason: '完成' }, supportExec)
  supportSession.record('coach_verify', { verdict: '通过' }, {
    coachTool: 'coach_verify', verdict: '通过', evidenceRef: `截图-${at}.png`, reason: '完成',
  })
  await createAdvanceTool({ config, projection: supportProjection }).execute({}, supportExec)
  supportSession.record('coach_advance', {}, undefined)
}
await check('整板块一次过 → 降为 1（放手），状态块同步', async () => {
  await supportPass(101)
  await supportPass(102)
  const state = supportProjection.stateFor(supportSession)
  if (state.sectionIndex !== 1) throw new Error(`sectionIndex=${state.sectionIndex}`)
  const level = supportLevel(state)
  if (level.level !== 1) throw new Error(`level=${level.level}`)
  const block = renderStateBlock(state, facts)
  if (!block.includes('【支撑等级】1（放手）')) throw new Error('状态块没有降级')
  if (!block.includes('【合格标准】结果符合预期')) throw new Error('合格标准不该被等级影响')
  return `level=${level.level}；${level.reason}`
})
await check('当前步失败 2 次 → 立即升为 3（板块内只升不降）', async () => {
  const failSession = fakeSession(workdir)
  const failExec = { agent: { session: failSession }, signal: new AbortController().signal }
  const failProjection = createProjection(config)
  await createPlanTool({ config, projection: failProjection }).execute(supportPlanArgs, failExec)
  failSession.record('coach_plan', supportPlanArgs, undefined)
  for (const at of [201, 202]) {
    await createVerifyTool({ config, projection: failProjection })
      .execute({ verdict: '不通过', reason: '结果不符' }, failExec)
    failSession.record('coach_verify', { verdict: '不通过' }, {
      coachTool: 'coach_verify', verdict: '不通过', reason: '结果不符',
    })
    if (at === 201) {
      if (supportLevel(failProjection.stateFor(failSession)).level !== 2) {
        throw new Error('失败 1 次不该升级')
      }
    }
  }
  const state = failProjection.stateFor(failSession)
  if (state.plan[0].steps[0].failedAttempts !== 2) {
    throw new Error(`failedAttempts=${state.plan[0].steps[0].failedAttempts}`)
  }
  const level = supportLevel(state)
  if (level.level !== 3) throw new Error(`level=${level.level}`)
  const block = renderStateBlock(state, facts)
  if (!block.includes('【支撑等级】3（手把手）')) throw new Error('状态块没有升级')
  return `level=${level.level}；${level.reason}`
})

console.log('8) 成本控制（v0.4.2）')
const budgetSession = fakeSession(workdir)
const budgetExec = { agent: { session: budgetSession }, signal: new AbortController().signal }
const budgetProjection = createProjection(config)
const budgetTool = createResearchTool({ config, projection: budgetProjection, ctx })
await check('同一步第 4 次检索被拒（COACH_RESEARCH_BUDGET），且前 3 次带 stepKey', async () => {
  await createPlanTool({ config, projection: budgetProjection }).execute(supportPlanArgs, budgetExec)
  budgetSession.record('coach_plan', supportPlanArgs, undefined)
  for (let index = 0; index < 3; index += 1) {
    const query = `git 版本 ${index}`
    const value = await budgetTool.execute({ query }, budgetExec)
    if (value.ok !== true) throw new Error(`ok=${value.ok}`)
    if (value.stepKey !== '0:0') throw new Error(`stepKey=${value.stepKey}`)
    budgetSession.record('coach_research', { query }, { coachTool: 'coach_research', ...value })
  }
  const state = budgetProjection.stateFor(budgetSession)
  if (state.research.length !== 3) throw new Error(`research=${state.research.length}`)
  try {
    await budgetTool.execute({ query: '第 4 次' }, budgetExec)
    throw new Error('本应被拒')
  } catch (error) {
    if (error.code !== 'COACH_RESEARCH_BUDGET') throw new Error(`错误码不对：${error.code}`)
    return error.code
  }
})
await check('状态块带【用量】，数字与状态一致', () => {
  const state = budgetProjection.stateFor(budgetSession)
  const block = renderStateBlock(state, { ...facts, maxResearchPerStep: config.maxResearchPerStep })
  if (!block.includes('【用量】本步检索 3/3；本会话检索 3；')) {
    throw new Error(block.split('\n').find((line) => line.startsWith('【用量】')) ?? '缺【用量】')
  }
  return '3/3；会话 3'
})
await check('状态块超预算被裁剪，但当前步骤/标准/结论仍在', () => {
  const state = budgetProjection.stateFor(budgetSession)
  const long = {
    ...state,
    skips: Array.from({ length: 8 }, (_value, index) => ({
      stepKey: `0:${index}`,
      reason: '很长的跳过原因'.repeat(80),
      at: 500 + index,
    })),
  }
  const block = renderStateBlock(long, { ...facts, maxStateBlockChars: 4000 })
  if (block.length > 4000) throw new Error(`长度 ${block.length}`)
  for (const tag of ['【当前步骤】', '【请执行】', '【合格标准】', '【核查结论】']) {
    if (!block.includes(tag)) throw new Error(`裁剪掉了 ${tag}`)
  }
  if (!block.includes('【跳过提醒】有步骤被跳过')) throw new Error('跳过提醒没被换成短提示')
  return `${block.length} 字符`
})

rmSync(workdir, { recursive: true, force: true })

console.log(failures === 0 ? '\nALL GOOD' : `\n${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1

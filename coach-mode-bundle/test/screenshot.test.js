/**
 * v0.4.3 截图软核查（screen 证据 / screenshot 取证）的规则测试。
 * v0.4.4 增加抓取方式（PrintWindow / 屏幕像素 / 被遮挡）的规则测试。
 *
 * 重点不是"能不能截"，而是"截图不能替用户交作业"：
 * 这四条规则必须是代码里的 if，模型绕不过去。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan, normalizeSections } from '../core/plan.js'
import { renderStateBlock } from '../core/render.js'
import { applyUserFeedback } from '../core/skip.js'
import { applyCheck, applyVerify, normalizeShot } from '../core/verify.js'
import { applyToolCall } from '../core/reduce.js'
import { applyPause } from '../core/pause.js'
import { resolveCoachConfig } from '../config.js'
import { captureScript, parseCaptureOutput, createCheckTool } from '../tools/coach-check.js'

/** 造一个"只看界面"的单步计划。 */
function screenPlan(overrides = {}) {
  const plan = normalizeSections([{
    section: '基础',
    steps: [{
      goal: '打开材质属性面板',
      action: '点右侧材质标签',
      expected: '出现材质属性面板',
      standard: '右侧出现材质属性面板',
      evidence: 'screen',
      check: { kind: 'screenshot', target: 'blender' },
      ...overrides,
    }],
  }], { maxPlanSteps: 12 })
  return applyPlan(initialState(), {
    toolName: 'Blender',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '打开材质面板',
    currentGoal: '打开材质面板',
    goalMode: 'learn',
    difficulty: '低',
    plan,
  }, 10)
}

/** 一条成功的截图核查。 */
function shotCheck(at, overrides = {}) {
  return {
    kind: 'screenshot',
    target: 'blender',
    ok: true,
    detail: '窗口「Blender」已截图 800×600',
    shot: {
      id: 'att-shot-1',
      path: 'C:\\work\\.coach\\shots\\shot-1.png',
      width: 800,
      height: 600,
      window: 'Blender',
      process: 'blender',
      pid: 4242,
    },
    at,
    ...overrides,
  }
}

test('v0.4.3 计划：evidence=screen 必须带 check.kind=screenshot', () => {
  assert.throws(
    () => normalizeSections([{
      section: '基础',
      steps: [{
        goal: '打开面板',
        action: '点一下',
        expected: '面板出现',
        standard: '面板在',
        evidence: 'screen',
      }],
    }], { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_NO_CHECK')
      assert.match(error.message, /screenshot/)
      return true
    },
  )
})

test('v0.4.3 计划：证据类型与核查种类必须配对', () => {
  const step = (evidence, check) => ({
    section: '基础',
    steps: [{
      goal: '打开面板',
      action: '点一下',
      expected: '面板出现',
      standard: '面板在',
      evidence,
      check,
    }],
  })
  assert.throws(
    () => normalizeSections([step('screen', { kind: 'path_exists', target: 'C:/work' })], { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_CHECK_MISMATCH')
      return true
    },
  )
  assert.throws(
    () => normalizeSections([step('file', { kind: 'screenshot', target: 'blender' })], { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_CHECK_MISMATCH')
      return true
    },
  )
})

test('v0.4.3 判定：没有任何截图取证 → 不能判「通过」', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, { kind: 'read_file', target: 'C:/work/notes.txt', ok: true, detail: '文本' }, 21)
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '应该没问题' }, 22),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_NO_SCREEN')
      return true
    },
  )
})

test('v0.4.3 判定：截图必须是用户这次反馈之后抓的', () => {
  let state = screenPlan()
  // 先截图、后反馈：这张图是用户动手之前的画面。
  state = applyCheck(state, {
    kind: 'screenshot', target: 'blender', ok: true, detail: '旧图',
    shot: shotCheck(15).shot,
  }, 15)
  state = applyUserFeedback(state, '打开了', 20)
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '截图里有面板' }, 21),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_SCREEN_STALE')
      return true
    },
  )
})

test('v0.4.3 判定：反馈之后抓的截图才放行', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, shotCheck(21), 21)
  state = applyVerify(state, { verdict: '通过', reason: '截图里有材质面板' }, 22)
  assert.equal(state.phase, 'NEXT_STEP')
  assert.equal(state.checks.at(-1).shot.window, 'Blender')
})

test('v0.4.3 判定：最近一次截图失败 → 不允许判通过（不能拿旧图顶替）', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, shotCheck(21), 21)
  state = applyCheck(state, {
    kind: 'screenshot', target: 'blender', ok: false, detail: '窗口最小化，抓不到画面',
  }, 23)
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '前一张看着像' }, 24),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_SCREEN_FAILED')
      return true
    },
  )
})

test('v0.4.3 漏洞修复：自截的截图不能冒充用户工质', () => {
  const state = applyPlan(initialState(), {
    toolName: 'Blender',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '看面板',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{
      section: '基础',
      steps: [{
        goal: '打开面板',
        action: '点一下',
        expected: '面板出现',
        standard: '面板在',
        evidence: 'user_artifact',
      }],
    }],
  }, 10)
  let next = applyCheck(state, shotCheck(11), 11)
  assert.throws(
    () => applyVerify(next, {
      verdict: '通过',
      evidenceRef: 'C:\\work\\.coach\\shots\\shot-1.png',
      reason: '截图里有',
    }, 12),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_SELF_EVIDENCE')
      return true
    },
  )
  // 用户自己发的截图照常受理。
  next = applyVerify(next, { verdict: '通过', evidenceRef: '用户截图 2026-11-06.png', reason: '面板在' }, 13)
  assert.equal(next.phase, 'NEXT_STEP')
})

test('v0.4.3 折叠：presentationMeta 里的 shot 会进状态，重启后能重算', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyToolCall(state, {
    id: 'c1',
    name: 'coach_check',
    args: { kind: 'screenshot', target: 'blender' },
    meta: {
      coachTool: 'coach_check',
      stepKey: '0:0',
      kind: 'screenshot',
      target: 'blender',
      ok: true,
      detail: '已截图 800×600',
      shot: shotCheck(21).shot,
    },
    at: 21,
  })
  const recorded = state.checks.at(-1)
  assert.equal(recorded.kind, 'screenshot')
  assert.equal(recorded.shot.id, 'att-shot-1')
  assert.equal(recorded.shot.pid, 4242)
})

test('v0.4.3 渲染：这一步给出【截图取证】和已存证摘要', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, shotCheck(21), 21)
  const block = renderStateBlock(state, { screenshotEnabled: true, screenshotMaxPerStep: 2, platform: 'win32' })
  assert.match(block, /【截图取证】/)
  assert.match(block, /coach_check\(kind="screenshot", target="blender"\)/)
  assert.match(block, /截图「Blender」 800×600 → 已存证/)
  assert.doesNotMatch(block, /【可跑命令】/)
})

test('v0.4.3 渲染：计划建立前提示【可截图】怎么用', () => {
  const block = renderStateBlock(initialState(), { screenshotEnabled: true, screenshotMaxPerStep: 2, platform: 'win32' })
  assert.match(block, /【可截图】/)
  assert.match(block, /同一步最多 2 张/)
})

test('v0.4.3 渲染：没开截图时不显示【可截图】（避免模型去试被拒的功能）', () => {
  const block = renderStateBlock(screenPlan(), {})
  assert.doesNotMatch(block, /【可截图】/)
})

test('v0.4.3 配置：截图默认关闭，只有显式 true 才开；非法值回落', () => {
  const defaults = resolveCoachConfig({})
  assert.equal(defaults.screenshotEnabled, false)
  assert.equal(defaults.screenshotMaxPerStep, 2)
  assert.equal(defaults.screenshotMaxWidth, 1600)
  assert.equal(defaults.screenshotMaxHeight, 1000)

  assert.equal(resolveCoachConfig({ screenshotEnabled: 'true' }).screenshotEnabled, false)
  assert.equal(resolveCoachConfig({ screenshotEnabled: true }).screenshotEnabled, true)
  assert.equal(resolveCoachConfig({ screenshotMaxPerStep: 0 }).screenshotMaxPerStep, 2)
  assert.equal(defaults.screenshotMaxBytes, 8388608)
  assert.equal('screenshotKeepFiles' in defaults, false, 'v0.4.5 起截图不再写盘，该配置已移除')
  assert.deepEqual(defaults.screenshotBlockTitles, ['deepseek harness'])
  assert.deepEqual(
    resolveCoachConfig({ screenshotBlockProcesses: ['DeepSeek Harness'] }).screenshotBlockProcesses,
    ['deepseek harness'],
  )
})

test('v0.4.3 normalizeShot：缺 id 的一律丢弃，尺寸只收正整数', () => {
  assert.equal(normalizeShot(null), null)
  assert.equal(normalizeShot({ path: 'x.png' }), null)
  assert.deepEqual(normalizeShot({ id: 'att-1', width: -3, height: 'x', pid: 0 }), {
    id: 'att-1',
    path: '',
    width: 0,
    height: 0,
    window: '',
    process: '',
    pid: null,
    method: '',
  })
})

// ── v0.4.4：抓取方式 ────────────────────────────────────────────────────────

/** 抓屏脚本的一次典型调用参数。 */
function scriptOptions(overrides = {}) {
  return {
    target: 'notepad',
    maxWidth: 1600,
    maxHeight: 1000,
    maxBytes: 8388608,
    blocked: ['deepseek harness'],
    blockedTitles: ['deepseek harness'],
    selfPid: 4242,
    ...overrides,
  }
}

test('v0.4.4 抓屏脚本：PrintWindow 在 CopyFromScreen 之前，且用 PW_RENDERFULLCONTENT', () => {
  const script = captureScript(scriptOptions())
  const printAt = script.indexOf('PrintWindow($pick.hwnd')
  const screenAt = script.indexOf('$graphics.CopyFromScreen($rect')
  assert.ok(printAt > 0, '脚本里必须有 PrintWindow')
  assert.ok(screenAt > 0, '回退路径仍保留 CopyFromScreen')
  assert.ok(printAt < screenAt, 'PrintWindow 必须先尝试，CopyFromScreen 只能作为回退')
  assert.match(script, /PW_RENDERFULLCONTENT/)
  assert.match(script, /PrintWindow\(\$pick\.hwnd, \[IntPtr\]\$hdc, 2\)/)
})

test('v0.4.4 抓屏脚本：回退前必须检测遮挡，被遮挡时不许走屏幕像素', () => {
  const script = captureScript(scriptOptions())
  const occludeAt = script.indexOf('$occluded = Get-OccludedCount')
  const screenAt = script.indexOf('$graphics.CopyFromScreen($rect')
  assert.ok(occludeAt > 0, '脚本里必须有遮挡检测')
  assert.ok(occludeAt < screenAt, '遮挡检测必须在回退到屏幕像素之前')
  // 被遮挡 → 直接报 occluded 退出，而不是继续 CopyFromScreen
  assert.match(script, /error = 'occluded'/)
  const occludedBlock = script.slice(script.indexOf('if ($occluded -gt 0)'), screenAt)
  assert.match(occludedBlock, /error = 'occluded'/, 'occluded 分支里必须先报失败')
  assert.doesNotMatch(occludedBlock, /CopyFromScreen/, 'occluded 分支里不能出现 CopyFromScreen')
})

test('v0.4.4 抓屏脚本：窗口尺寸用 DWM 扩展边框，去掉不可见阴影边距', () => {
  const script = captureScript(scriptOptions())
  assert.match(script, /DwmGetWindowAttribute/)
  assert.match(script, /TryGetFrame/)
  // 9 = DWMWA_EXTENDED_FRAME_BOUNDS
  assert.match(script, /DwmGetWindowAttribute\(hWnd, 9, out rect/)
  // 矩形获取只能走 TryGetFrame（内部回落 GetWindowRect），不能再直接 GetWindowRect 取尺寸
  assert.doesNotMatch(script, /if \(-not \[CoachShot\]::GetWindowRect\(\$pick\.hwnd/)
})

test('v0.4.4 抓屏脚本：成功结果带 method，失败结果也带 method', () => {
  const script = captureScript(scriptOptions())
  assert.match(script, /\$method = 'printwindow'/)
  assert.match(script, /\$method = 'screen'/)
  assert.match(script, /method = \$method/)
  // blank_image 失败也要说明是用哪种方式抓出来的纯色
  const blankBlock = script.slice(script.indexOf("error = 'blank_image'"))
  assert.match(blankBlock.slice(0, 200), /method = \$method/)
})

test('v0.4.4 抓屏脚本：仍是纯 ASCII，且单引号正确转义', () => {
  const script = captureScript(scriptOptions({ target: "O'Brien" }))
  assert.match(script, /^[\x00-\x7F]*$/, '脚本必须保持 ASCII（-EncodedCommand 与 PS5.1 编码约束）')
  assert.ok(script.includes("'O''Brien'"), '单引号必须转义成两个单引号')
})

test('v0.4.5 抓屏脚本：PNG 用 base64 回传，不写盘', () => {
  const script = captureScript(scriptOptions())
  assert.match(script, /data = \[Convert\]::ToBase64String\(\$bytes\)/)
  assert.match(script, /bytes = \$bytes\.Length/)
  assert.doesNotMatch(script, /\$final\.Save\(\$outPath/)
  assert.doesNotMatch(script, /CreateDirectory/)
  assert.doesNotMatch(script, /\.coach/)
  // 编码后的字节数也由脚本自己卡上限，避免把超大画面塞进 stdout
  assert.match(script, /error = 'too_large'/)
})

test('v0.4.5 抓屏调用：去掉 ExecutionPolicy Bypass，也不再保留截图文件', () => {
  const source = readFileSync(new URL('../tools/coach-check.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /'-ExecutionPolicy'/)
  assert.doesNotMatch(source, /screenshotKeepFiles/)
  assert.doesNotMatch(source, /readBytes\(fileTarget/)
})

test('v0.4.4 parseCaptureOutput：能从噪声里取到 occluded 结果', () => {
  const parsed = parseCaptureOutput('warning: something\n{"ok":false,"error":"occluded","covered":9}\n')
  assert.equal(parsed.error, 'occluded')
  assert.equal(parsed.covered, 9)
  // v0.4.5：成功结果带 base64 画面
  const shot = parseCaptureOutput('{"ok":true,"data":"AAAA","width":10,"height":20}\n')
  assert.equal(shot.data, 'AAAA')
  assert.equal(shot.width, 10)
})

test('v0.4.4 normalizeShot：保留 method，未知值归空，旧记录不受影响', () => {
  assert.equal(normalizeShot({ id: 'a', method: 'printwindow' }).method, 'printwindow')
  assert.equal(normalizeShot({ id: 'a', method: 'screen' }).method, 'screen')
  assert.equal(normalizeShot({ id: 'a', method: 'magic' }).method, '')
  // v0.4.3 写下的记录没有 method 字段，仍能正常归一化
  assert.equal(normalizeShot({ id: 'a', path: 'p.png' }).method, '')
})

test('v0.4.4 渲染：状态块标出截图是自渲染还是屏幕像素', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  const shot = (method) => ({
    kind: 'screenshot',
    target: 'blender',
    ok: true,
    detail: '已截图',
    shot: { id: 'att-1', path: 'x.png', width: 800, height: 600, window: 'Blender', process: 'blender', pid: 1, method },
  })

  const printed = renderStateBlock(applyCheck(state, shot('printwindow'), 21), { screenshotEnabled: true, platform: 'win32' })
  assert.match(printed, /［自渲染］/)

  const screen = renderStateBlock(applyCheck(state, shot('screen'), 21), { screenshotEnabled: true, platform: 'win32' })
  assert.match(screen, /［屏幕像素］/)
})

test('v0.4.4 折叠：method 会随 presentationMeta 进状态，重启后能重算', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyToolCall(state, {
    id: 'c1',
    name: 'coach_check',
    args: { kind: 'screenshot', target: 'blender' },
    meta: {
      coachTool: 'coach_check',
      stepKey: '0:0',
      kind: 'screenshot',
      target: 'blender',
      ok: true,
      detail: '已截图',
      shot: { id: 'att-9', path: 'p.png', width: 800, height: 600, window: 'B', process: 'blender', pid: 7, method: 'printwindow' },
    },
    at: 21,
  })
  assert.equal(state.checks.at(-1).shot.method, 'printwindow')
})

// ── v0.4.5：副作用必须晚于相位校验 ──────────────────────────────────────────

test('v0.4.5 coach_check：PAUSED 阶段先拒绝，绝不先截屏 / 读文件', async () => {
  const paused = applyPause(screenPlan(), { action: 'pause', note: '先停一下' }, 30)
  let sideEffects = 0
  const subprocess = { spawn() { sideEffects += 1; throw new Error('must not spawn') } }
  const fs = {
    resolve() { sideEffects += 1; throw new Error('must not resolve') },
    stat() { sideEffects += 1; throw new Error('must not stat') },
    readText() { sideEffects += 1; throw new Error('must not read') },
  }
  const check = createCheckTool({
    config: resolveCoachConfig({ screenshotEnabled: true }),
    projection: { stateForExec: () => paused },
    ctx: {
      get: (name) => (name === 'subprocess' ? subprocess : name === 'fs' ? fs : undefined),
    },
  })

  await assert.rejects(
    check.execute({ kind: 'screenshot', target: 'blender' }, { signal: undefined }),
    (error) => error.code === 'COACH_PHASE',
  )
  assert.equal(sideEffects, 0, '阶段不允许时不能先截屏')

  await assert.rejects(
    check.execute({ kind: 'read_file', target: 'C:/work/x.txt' }, { signal: undefined }),
    (error) => error.code === 'COACH_PHASE',
  )
  assert.equal(sideEffects, 0, '阶段不允许时不能先读文件')
})

// ── v0.4.5：截图能力按平台收口 ──────────────────────────────────────────────

test('v0.4.5 渲染：Linux/macOS 上不显示【可截图】，也不让模型去撞截图', () => {
  const setup = renderStateBlock(initialState(), {
    screenshotEnabled: true,
    screenshotMaxPerStep: 2,
    platform: 'linux',
  })
  assert.doesNotMatch(setup, /【可截图】/)

  // 旧会话里已经存在 screen 步骤：不再给 coach_check 指令，改成让用户发截图
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  const block = renderStateBlock(state, {
    screenshotEnabled: true,
    screenshotMaxPerStep: 2,
    platform: 'darwin',
  })
  assert.match(block, /截图不可用/)
  assert.match(block, /user_artifact/)
  assert.doesNotMatch(block, /coach_check\(kind="screenshot"/)
})

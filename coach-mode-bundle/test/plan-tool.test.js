/**
 * `coach_plan` 的平台前置校验（v0.4.5）。
 *
 * 计划一旦受理就不能改；如果计划里写了 `evidence: "screen"`，而非 Windows 或没开截图，
 * 这一步就永远过不了核查，用户只能 skip。所以在受理之前就拒绝，让模型改用 user_artifact。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { resolveCoachConfig } from '../config.js'
import { createPlanTool } from '../tools/coach-plan.js'

function screenArgs() {
  return {
    toolName: 'Blender',
    toolAvailable: 'yes',
    userLevel: '会基础',
    originalGoal: '打开材质面板',
    currentGoal: '打开材质面板',
    goalMode: 'learn',
    difficulty: '低',
    sections: [{
      section: '基础',
      steps: [{
        goal: '打开面板',
        action: '点右侧材质标签',
        expected: '出现面板',
        standard: '右侧有材质属性面板',
        evidence: 'screen',
        check: { kind: 'screenshot', target: 'blender' },
      }],
    }],
  }
}

function userArtifactArgs() {
  const args = screenArgs()
  const step = args.sections[0].steps[0]
  step.evidence = 'user_artifact'
  delete step.check
  return args
}

function makeTool({ platform = 'linux', screenshotEnabled = false } = {}) {
  return createPlanTool({
    config: resolveCoachConfig({ screenshotEnabled }),
    projection: { stateForExec: () => initialState() },
    facts: { platform },
  })
}

const EXEC = { signal: undefined }

test('v0.4.5 计划：Linux 上 screen 步骤在受理前被拒', async () => {
  await assert.rejects(
    makeTool({ platform: 'linux', screenshotEnabled: true }).execute(screenArgs(), EXEC),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_PLATFORM_UNSUPPORTED')
      assert.match(error.message, /user_artifact/)
      return true
    },
  )
})

test('v0.4.5 计划：macOS 上同样拒绝 screen', async () => {
  await assert.rejects(
    makeTool({ platform: 'darwin', screenshotEnabled: true }).execute(screenArgs(), EXEC),
    (error) => error.code === 'COACH_PLAN_PLATFORM_UNSUPPORTED',
  )
})

test('v0.4.5 计划：Windows 但截图开关关闭时拒绝 screen', async () => {
  await assert.rejects(
    makeTool({ platform: 'win32', screenshotEnabled: false }).execute(screenArgs(), EXEC),
    (error) => error.code === 'COACH_PLAN_SCREEN_DISABLED',
  )
})

test('v0.4.5 计划：Windows + 截图打开时 screen 计划正常受理', async () => {
  const value = await makeTool({ platform: 'win32', screenshotEnabled: true }).execute(screenArgs(), EXEC)
  assert.equal(value.accepted, true)
  assert.equal(value.phase, 'WAIT_FEEDBACK')
  assert.equal(value.totalSteps, 1)
})

test('v0.4.5 计划：Linux 上的 user_artifact 计划不受影响', async () => {
  const value = await makeTool({ platform: 'linux' }).execute(userArtifactArgs(), EXEC)
  assert.equal(value.accepted, true)
  assert.equal(value.phase, 'WAIT_FEEDBACK')
})

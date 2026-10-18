#!/usr/bin/env node
/**
 * 回放校验：用**当前代码**重折一条真实会话日志，把每个状态块当时"应该"渲染成什么打出来。
 * 用来在重启前验证修复是否真的生效（不改日志、不改状态）。
 *
 * 用法：node replay-check.cjs <日志> [...]
 */

import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'

const PKG = new URL('../coach-mode-bundle/', import.meta.url).href
const { resolveCoachConfig } = await import(`${PKG}config.js`)
const { foldItems, itemsFromEvents } = await import(`${PKG}core/reduce.js`)
const { initialState } = await import(`${PKG}core/machine.js`)
const { renderStateBlock } = await import(`${PKG}core/render.js`)

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function readText(file) {
  const buffer = readFileSync(file)
  if (!file.endsWith('.zstd')) return buffer.toString('utf8')
  const cuts = []
  let from = 0
  for (;;) {
    const i = buffer.indexOf(ZSTD_MAGIC, from)
    if (i === -1) break
    cuts.push(i)
    from = i + ZSTD_MAGIC.length
  }
  if (cuts[0] !== 0) cuts.unshift(0)
  const parts = []
  for (let k = 0; k < cuts.length; k += 1) {
    const slice = buffer.subarray(cuts[k], k + 1 < cuts.length ? cuts[k + 1] : buffer.length)
    try { parts.push(zlib.zstdDecompressSync(slice).toString('utf8')) } catch { /* skip */ }
  }
  return parts.join('')
}

const config = resolveCoachConfig({})
const facts = { failureThreshold: config.failureThreshold, sameMachine: true, platform: 'win32', cwd: '' }

for (const file of process.argv.slice(2)) {
  const events = []
  for (const line of readText(file).split('\n')) {
    if (line.trim() === '') continue
    try { events.push(JSON.parse(line)) } catch { /* skip */ }
  }
  const title = events.filter((e) => /title/.test(e.type)).pop()?.data?.title ?? '(无标题)'
  console.log(`\n${'='.repeat(74)}\n### ${title}`)
  console.log(`   ${file}`)

  const stateSeqs = events
    .filter((e) => e.type === 'user/message'
      && (e.data?.content ?? []).some((b) => b.type === 'text' && b.text.includes('【当前阶段】')))
    .map((e) => e.seq)

  for (const seq of stateSeqs) {
    const upTo = events.filter((e) => e.seq < seq)
    const state = foldItems(initialState(), itemsFromEvents(upTo), config)
    const current = state.plan[state.sectionIndex]?.steps?.[state.stepIndex]
    const block = renderStateBlock(state, facts)
    const marks = []
    if (block.includes('【强制出口】')) marks.push('强制出口')
    if (block.includes('【跳过提醒】')) marks.push('跳过提醒')
    if (block.includes('【环境核查】')) marks.push('环境核查')
    if (block.includes('【安装分支】')) marks.push('安装分支')
    if (block.includes('【降级提示】')) marks.push('降级提示')
    const support = block.split('\n').find((line) => line.startsWith('【支撑等级】')) ?? ''
    const usage = block.split('\n').find((line) => line.startsWith('【用量】')) ?? ''
    const level = support.match(/【支撑等级】(\d)/)?.[1] ?? '-'
    const budget = usage.match(/本步检索 (\d+\/\d+)/)?.[1] ?? '-'
    console.log(`  seq ${String(seq).padStart(4)}  阶段=${state.phase.padEnd(22)} `
      + `失败=${String(current?.failedAttempts ?? '-').padStart(2)}  `
      + `env核查=${state.checks.filter((c) => c.stepKey === 'env').length}  `
      + `支撑=${level}  检索=${budget}  块=${block.length}字  `
      + `标记=${marks.length === 0 ? '（无）' : marks.join('/')}`)
    if (support !== '') console.log(`           ${support}`)
    if (usage !== '') console.log(`           ${usage}`)
  }
}

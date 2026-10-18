#!/usr/bin/env node
/**
 * 重跑验收的一键复核：把"归档状态 + 实际 preset + 阶段轨迹 + 状态块内标记 + 教练工具调用"
 * 打进一份报告，避免把标准模式的会话误当有效样本。
 *
 * 用法：node coach-recheck.cjs <工作区会话目录>
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
// 归档名单是可选信息：默认取当前用户的 DSH 工作区清单，可用环境变量覆盖。
// 读不到就当作“没有归档”，不影响主报告。
const WORKSPACE_JSON = process.env.DSH_WORKSPACE_JSON
  ?? path.join(os.homedir(), '.dsh', 'storages', 'workspace.json')
const COACH_TOOLS = ['coach_plan', 'coach_check', 'coach_verify', 'coach_advance', 'coach_skip', 'coach_research', 'coach_back', 'coach_pause']

function archivedSet() {
  try {
    const data = JSON.parse(fs.readFileSync(WORKSPACE_JSON, 'utf8'))
    return new Set(data.global?.archivedSessionIds ?? [])
  } catch {
    return new Set()
  }
}

function readEvents(file) {
  const buffer = fs.readFileSync(file)
  let text
  if (file.endsWith('.zstd')) {
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
    text = parts.join('')
  } else {
    text = buffer.toString('utf8')
  }
  return text.split('\n').filter((l) => l.trim() !== '')
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

const dir = process.argv[2]
const archived = archivedSet()
const rows = []

for (const name of fs.readdirSync(dir)) {
  const sessionDir = path.join(dir, name)
  if (!fs.statSync(sessionDir).isDirectory()) continue
  const inner = fs.readdirSync(sessionDir).find((f) => f.startsWith('session.v4.jsonl'))
  if (inner === undefined) continue
  const file = path.join(sessionDir, inner)
  const events = readEvents(file)
  const header = events.find((e) => e.type === 'session') ?? {}
  const title = events.filter((e) => /title/.test(e.type)).pop()?.data?.title ?? '(无标题)'
  const selected = events.filter((e) => e.type === 'agent-preset/selected')
  // 新会话可能只在 session 头里记 agentPreset、不单独发 selected 事件（0.3.4 实测）。
  const preset = selected.length === 0
    ? (header.agentPreset ?? '(无 selected 事件)')
    : selected[selected.length - 1].data?.agentPreset

  const blocks = events.filter((e) => e.type === 'user/message'
    && (e.data?.content ?? []).some((b) => b.type === 'text' && b.text.includes('【当前阶段】')))
  const phases = blocks.map((e) => {
    const text = e.data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    return {
      seq: e.seq,
      phase: /【当前阶段】([^\n]+)/.exec(text)?.[1] ?? '?',
      text,
    }
  })

  const calls = new Map()
  const tools = []
  for (const event of events) {
    const data = event.data ?? {}
    if (event.type === 'tool/call') {
      calls.set(data.callId, { seq: event.seq, name: data.name, args: parseJson(data.arguments) })
      continue
    }
    if (event.type === 'tool/result') {
      const callId = data.message?.toolCallId ?? data.message?.source?.callId
      const call = calls.get(callId)
      if (call === undefined) continue
      calls.delete(callId)
      tools.push({
        ...call,
        resultSeq: event.seq,
        isError: data.message?.isError === true || data.error !== undefined,
        error: data.error,
        meta: data.meta,
      })
    }
  }

  rows.push({
    id: header.id ?? name,
    title,
    file,
    archived: archived.has(header.id),
    preset,
    userLines: events.filter((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')
      .map((e) => (e.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text.replace(/\s+/g, ' ').slice(0, 44)).join(' ')),
    phases,
    forcedExit: phases.filter((p) => p.text.includes('【强制出口】')).map((p) => p.seq),
    skipReminder: phases.filter((p) => p.text.includes('【跳过提醒】')).map((p) => p.seq),
    envChecks: phases.filter((p) => p.text.includes('【环境核查】')).map((p) => p.seq),
    installBranch: phases.filter((p) => p.text.includes('【安装分支】')).map((p) => p.seq),
    degraded: phases.filter((p) => p.text.includes('【降级提示】')).map((p) => p.seq),
    coach: tools.filter((t) => COACH_TOOLS.includes(t.name)),
    writeEdits: tools.filter((t) => t.name === 'write' || t.name === 'edit'),
    otherTools: tools.filter((t) => !COACH_TOOLS.includes(t.name) && t.name !== 'write' && t.name !== 'edit'),
  })
}

rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'))

console.log(`目录：${dir}`)
console.log(`会话 ${rows.length} 个，其中归档 ${rows.filter((r) => r.archived).length} 个\n`)

for (const r of rows) {
  const valid = r.preset === 'coach' && !r.archived
  console.log(`${'='.repeat(76)}`)
  console.log(`### ${r.title}   ${valid ? '【有效】' : '【无效：' + (r.archived ? '已归档' : '') + (r.preset !== 'coach' ? ' preset=' + r.preset : '') + '】'}`)
  console.log(`  会话 ${r.id}`)
  console.log(`  文件 ${r.file}`)
  console.log(`  阶段轨迹：${r.phases.map((p) => `${p.phase}@${p.seq}`).join(' → ') || '(无状态块)'}`)
  console.log(`  状态块内标记：强制出口=${r.forcedExit.join(',') || '无'} 跳过提醒=${r.skipReminder.join(',') || '无'} `
    + `环境核查=${r.envChecks.join(',') || '无'} 安装分支=${r.installBranch.join(',') || '无'} 降级=${r.degraded.join(',') || '无'}`)
  console.log(`  教练工具 ${r.coach.length} 次，write/edit ${r.writeEdits.length} 次，其它工具 ${r.otherTools.length} 次`)
  for (const t of r.coach) {
    const status = t.isError ? `失败 ${t.error?.code ?? ''}` : '成功'
    console.log(`   [${t.name}] ${t.seq}→${t.resultSeq} ${status}`)
    console.log(`      args ${JSON.stringify(t.args).slice(0, 200)}`)
    if (t.meta !== undefined) console.log(`      meta ${JSON.stringify(t.meta).slice(0, 300)}`)
    if (t.isError) console.log(`      err  ${String(t.error?.reason ?? '').slice(0, 160)}`)
  }
  for (const t of r.writeEdits) {
    console.log(`   [${t.name}] ${t.seq}→${t.resultSeq} ${t.isError ? '被拒绝' : '成功（不该发生）'}`)
    console.log(`      args ${JSON.stringify(t.args).slice(0, 200)}`)
    if (t.isError) console.log(`      err  ${String(t.error?.reason ?? '').slice(0, 200)}`)
  }
  console.log('  用户台词：')
  r.userLines.forEach((line, i) => console.log(`    ${i + 1}. ${line}`))
}
console.log(`\n${'='.repeat(76)}`)

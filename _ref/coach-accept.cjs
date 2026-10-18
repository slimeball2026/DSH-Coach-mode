#!/usr/bin/env node
/**
 * 档 1 验收分析器：批量读会话日志，抽出每条验收要的证据。
 *
 * 用法：
 *   node coach-accept.cjs <目录 或 单个日志文件> [...]
 *
 * 支持 `.jsonl`（/export 明文）与 `.jsonl.zstd`（多帧 zstd 拼接，按帧魔数切分）。
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const COACH_TOOLS = ['coach_plan', 'coach_check', 'coach_verify', 'coach_advance', 'coach_skip', 'coach_research', 'coach_back', 'coach_pause']

function decodeZstd(buffer) {
  const cuts = []
  let from = 0
  for (;;) {
    const index = buffer.indexOf(ZSTD_MAGIC, from)
    if (index === -1) break
    cuts.push(index)
    from = index + ZSTD_MAGIC.length
  }
  if (cuts.length === 0) throw new Error('没有找到 zstd 帧魔数')
  if (cuts[0] !== 0) cuts.unshift(0)
  const parts = []
  for (let i = 0; i < cuts.length; i += 1) {
    const slice = buffer.subarray(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : buffer.length)
    try { parts.push(zlib.zstdDecompressSync(slice).toString('utf8')) } catch { /* 切错的帧丢掉 */ }
  }
  return parts.join('')
}

function readEvents(file) {
  const buffer = fs.readFileSync(file)
  const text = file.endsWith('.zstd') ? decodeZstd(buffer) : buffer.toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try { events.push(JSON.parse(line)) } catch { /* 半行 */ }
  }
  return events
}

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function textOf(message) {
  const blocks = message?.content ?? []
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}

/** 收集单个日志的一切。 */
function analyze(file) {
  const events = readEvents(file)
  const header = events.find((e) => e.type === 'session') ?? {}

  const titleEvent = events.filter((e) => /title/.test(e.type)).pop()
  const title = titleEvent?.data?.title ?? titleEvent?.title ?? '(无标题)'

  const selected = events.filter((e) => e.type === 'agent-preset/selected')

  const calls = new Map()
  const tools = []
  for (const event of events) {
    if (event.type === 'tool/call') {
      calls.set(event.data.callId, {
        callSeq: event.seq,
        name: event.data.name,
        args: parseJson(event.data.arguments),
      })
      continue
    }
    if (event.type === 'tool/result') {
      const callId = event.data.message?.toolCallId ?? event.data.message?.source?.callId
      const call = calls.get(callId)
      if (call === undefined) continue
      calls.delete(callId)
      tools.push({
        ...call,
        resultSeq: event.seq,
        isError: event.data.message?.isError === true || event.data.error !== undefined,
        error: event.data.error,
        meta: event.data.meta,
        text: textOf(event.data.message),
      })
    }
  }

  const userTurns = events.filter((e) => e.type === 'user/message'
    && (e.data?.source?.kind === 'user'))
  const assistantTurns = events.filter((e) => e.type === 'assistant/message')

  const raw = events.map((e) => JSON.stringify(e.data ?? {}))
  const hasStateBlock = raw.filter((text) => text.includes('【当前阶段】')).length
  const hasForcedExit = raw.filter((text) => text.includes('【强制出口】')).length
  const hasSkipReminder = raw.filter((text) => text.includes('【跳过提醒】')).length
  const hasInstallBranch = raw.filter((text) => text.includes('【安装分支】')).length

  return {
    file,
    id: header.id ?? path.basename(path.dirname(file)),
    cwd: header.cwd ?? '',
    headerPreset: header.agentPreset ?? '(无)',
    selected: selected.map((e) => ({ seq: e.seq, preset: e.data?.agentPreset })),
    title,
    eventCount: events.length,
    userTurns: userTurns.length,
    assistantTurns: assistantTurns.length,
    tools,
    coach: tools.filter((t) => COACH_TOOLS.includes(t.name)),
    guardDenials: tools.filter((t) => (t.name === 'write' || t.name === 'edit') && t.isError),
    markers: { stateBlock: hasStateBlock, forcedExit: hasForcedExit, skipReminder: hasSkipReminder, installBranch: hasInstallBranch },
    events,
  }
}

/** 一条调用的一行摘要。 */
function summarize(entry) {
  const status = entry.isError ? `失败 ${entry.error?.code ?? ''}` : '成功'
  const argKeys = entry.args === null || typeof entry.args !== 'object'
    ? String(entry.args).slice(0, 60)
    : JSON.stringify(entry.args).slice(0, 220)
  const meta = entry.meta === undefined ? '' : `\n          meta: ${JSON.stringify(entry.meta).slice(0, 380)}`
  const err = entry.isError ? `\n          err : ${String(entry.text).split('\n')[0].slice(0, 220)}` : ''
  return `  [${entry.name}] seq ${entry.callSeq}→${entry.resultSeq} ${status}\n          args: ${argKeys}${meta}${err}`
}

function main() {
  const targets = process.argv.slice(2)
  if (targets.length === 0) {
    console.error('用法：node coach-accept.cjs <目录|文件> ...')
    process.exit(2)
  }
  const files = []
  for (const target of targets) {
    const info = fs.statSync(target)
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(target)) {
        const dir = path.join(target, name)
        if (!fs.statSync(dir).isDirectory()) continue
        for (const inner of fs.readdirSync(dir)) {
          if (inner.endsWith('.jsonl') || inner.endsWith('.jsonl.zstd')) files.push(path.join(dir, inner))
        }
      }
    } else {
      files.push(target)
    }
  }

  const results = files.map((file) => {
    try { return analyze(file) } catch (error) { return { file, error: error.message } }
  })
  results.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'))

  console.log(`共 ${results.length} 个会话\n${'='.repeat(78)}`)
  for (const r of results) {
    if (r.error) { console.log(`\n${r.file}\n  解析失败：${r.error}`); continue }
    console.log(`\n### ${r.title}`)
    console.log(`  文件：${r.file}`)
    console.log(`  会话：${r.id}`)
    console.log(`  preset（以 agent-preset/selected 为准）：${r.selected.length === 0 ? '（无 selected 事件）' : r.selected.map((s) => `${s.preset}@seq${s.seq}`).join(', ')}`)
    console.log(`  事件 ${r.eventCount} / 用户轮 ${r.userTurns} / 助手轮 ${r.assistantTurns}`)
    console.log(`  标记：状态块出现 ${r.markers.stateBlock} 次；强制出口 ${r.markers.forcedExit}；跳过提醒 ${r.markers.skipReminder}；安装分支 ${r.markers.installBranch}`)
    console.log(`  教练工具调用 ${r.coach.length} 次：`)
    for (const entry of r.coach) console.log(summarize(entry))
    if (r.guardDenials.length > 0) {
      console.log(`  被拒绝的 write/edit ${r.guardDenials.length} 次：`)
      for (const entry of r.guardDenials) console.log(summarize(entry))
    }
    const others = r.tools.filter((t) => !COACH_TOOLS.includes(t.name))
    if (others.length > 0) {
      console.log(`  其它工具 ${others.length} 次：${others.map((t) => `${t.name}@${t.callSeq}${t.isError ? '(失败)' : ''}`).join(', ')}`)
    }
  }
  console.log(`\n${'='.repeat(78)}`)
}

main()

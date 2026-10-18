#!/usr/bin/env node
/**
 * 会话转写：把一条日志渲染成"人话"的对话，便于人工核对验收。
 *
 * 用法：node coach-transcript.cjs <日志> [每段截断字符数]
 */

const fs = require('node:fs')
const zlib = require('node:zlib')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

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
    try { parts.push(zlib.zstdDecompressSync(slice).toString('utf8')) } catch { /* skip */ }
  }
  return parts.join('')
}

function readEvents(file) {
  const buffer = fs.readFileSync(file)
  const text = file.endsWith('.zstd') ? decodeZstd(buffer) : buffer.toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try { events.push(JSON.parse(line)) } catch { /* skip */ }
  }
  return events
}

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

const clip = (text, size) => {
  const value = String(text ?? '').replace(/\r/g, '')
  return value.length <= size ? value : `${value.slice(0, size)} …[+${value.length - size}]`
}

const file = process.argv[2]
const BUDGET = Number(process.argv[3] ?? 700)
const events = readEvents(file)

let calls = new Map()
for (const event of events) {
  const data = event.data ?? {}

  if (event.type === 'session') {
    console.log(`# 会话 ${data.id}  cwd=${data.cwd}  headerPreset=${data.agentPreset}`)
    continue
  }
  if (event.type === 'agent-preset/selected') {
    console.log(`\n[seq ${event.seq}] **preset → ${data.agentPreset}**`)
    continue
  }
  if (event.type === 'user/message') {
    const source = data.source?.kind ?? '?'
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    if (text.includes('【当前阶段】')) {
      // 运行时上下文（每轮状态块）——整段打印，这是验收重点
      console.log(`\n[seq ${event.seq}] ── 状态块（运行时上下文）──\n${text}`)
    } else if (source === 'user') {
      console.log(`\n[seq ${event.seq}] 👤 用户：${clip(text, BUDGET)}`)
    } else {
      console.log(`\n[seq ${event.seq}] （${source} 注入）${clip(text, 260)}`)
    }
    continue
  }
  if (event.type === 'assistant/message') {
    const text = (data.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    if (text.trim() !== '') console.log(`\n[seq ${event.seq}] 🤖 教练：${clip(text, BUDGET)}`)
    continue
  }
  if (event.type === 'tool/call') {
    calls.set(data.callId, { seq: event.seq, name: data.name, args: parseJson(data.arguments) })
    console.log(`\n[seq ${event.seq}] 🔧 调用 ${data.name}  ${clip(JSON.stringify(parseJson(data.arguments)), 420)}`)
    continue
  }
  if (event.type === 'tool/result') {
    const callId = data.message?.toolCallId ?? data.message?.source?.callId
    const call = calls.get(callId)
    calls.delete(callId)
    const text = (data.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    const failed = data.message?.isError === true || data.error !== undefined
    console.log(`[seq ${event.seq}] ${failed ? '❌ 失败' : '✅ 结果'} ${call?.name ?? ''}${failed ? ` (${data.error?.code ?? ''})` : ''}`)
    console.log(`${clip(text, failed ? 420 : 900).split('\n').map((line) => `      ${line}`).join('\n')}`)
    if (data.meta !== undefined) console.log(`      meta: ${clip(JSON.stringify(data.meta), 500)}`)
  }
}

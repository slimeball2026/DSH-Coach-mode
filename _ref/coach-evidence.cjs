#!/usr/bin/env node
/**
 * 教练模式档 1 · 验收取证脚本（零依赖）。
 *
 * 用法：
 *   node coach-evidence.cjs <会话日志路径>
 *
 * 支持的输入：
 *   - `/export` 导出的 `session.v4.jsonl`（明文 JSONL）
 *   - `$DSH_HOME/sessions/<工作区>/<会话id>/session.v4.jsonl.zstd`
 *     （该文件是**多帧 zstd 拼接**：每行一个独立帧。本脚本按帧魔数切分后逐帧解压）
 *
 * 输出：
 *   - 会话头与**实际生效**的 preset（以 `agent-preset/selected` 为准，不看头里的 agentPreset）
 *   - 五个教练工具的每次调用：`tool/call` 的 seq + 参数 + 成败
 *   - `coach_check` / `coach_verify` / `coach_skip` 的结构化结果（`tool/result.data.meta`）
 *   - 被 guard 拒绝的 `write` / `edit`
 *   - 日志里出现【当前阶段】状态块的位置（如果有）
 */

const fs = require('node:fs')
const zlib = require('node:zlib')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const COACH_TOOLS = ['coach_plan', 'coach_check', 'coach_verify', 'coach_advance', 'coach_skip', 'coach_research', 'coach_back', 'coach_pause']

/** 多帧 zstd → 明文 JSONL。 */
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
    try {
      parts.push(zlib.zstdDecompressSync(slice).toString('utf8'))
    } catch {
      // 魔数出现在压缩流内部时会切错；丢掉这一段不影响其他行。
    }
  }
  return parts.join('')
}

/** 读成事件数组。 */
function readEvents(file) {
  const buffer = fs.readFileSync(file)
  let text
  if (file.endsWith('.zstd')) text = decodeZstd(buffer)
  else text = buffer.toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // 忽略半行（日志写入中）
    }
  }
  return events
}

/** 安全 JSON.parse。 */
function parseJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** 从工具结果里取可读文本。 */
function resultText(result) {
  const blocks = result?.content ?? result?.message?.content ?? []
  return blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

function main() {
  const file = process.argv[2]
  if (file === undefined) {
    console.error('用法：node coach-evidence.cjs <session.v4.jsonl | session.v4.jsonl.zstd>')
    process.exit(2)
  }
  const events = readEvents(file)
  if (events.length === 0) {
    console.error('没有解析到任何事件')
    process.exit(2)
  }

  const header = events.find((event) => event.type === 'session')
  const selected = events.filter((event) => event.type === 'agent-preset/selected')

  console.log(`日志文件：${file}`)
  console.log(`事件数：${events.length}`)
  if (header !== undefined) {
    console.log(`会话 id：${header.id ?? ''}`)
    console.log(`cwd：${header.cwd ?? ''}`)
    console.log(`会话头 agentPreset（**不可信**，仅供参考）：${header.agentPreset ?? '(无)'}`)
  }
  if (selected.length === 0) {
    console.log('agent-preset/selected：**没有这个事件** → 该会话没有切换过 preset，通常是默认 preset')
  } else {
    for (const event of selected) console.log(`agent-preset/selected @seq ${event.seq} → ${event.data?.agentPreset ?? event.agentPreset}`)
  }

  // tool/call 与 tool/result 配对
  const calls = new Map()
  const rows = []
  for (const event of events) {
    if (event.type === 'tool/call') {
      calls.set(event.data.callId, { seq: event.seq, name: event.data.name, args: parseJson(event.data.arguments) })
      continue
    }
    if (event.type === 'tool/result') {
      const callId = event.data.message?.toolCallId ?? event.data.message?.source?.callId
      const call = calls.get(callId)
      if (call === undefined) continue
      calls.delete(callId)
      rows.push({
        ...call,
        resultSeq: event.seq,
        isError: event.data.message?.isError === true || event.data.error !== undefined,
        error: event.data.error,
        meta: event.data.meta,
        text: resultText(event.data.message),
      })
    }
  }

  const coach = rows.filter((row) => COACH_TOOLS.includes(row.name))
  console.log(`\n=== 教练工具调用（共 ${coach.length} 次）===`)
  if (coach.length === 0) {
    console.log('（没有）——如果该会话是教练模式，这本身就是一个发现。')
  }
  for (const row of coach) {
    const verdict = row.isError ? `失败 ${row.error?.code ?? ''} ${row.error?.reason ?? ''}` : '成功'
    console.log(`\n[${row.name}] call@seq ${row.seq} → result@seq ${row.resultSeq}  ${verdict}`)
    console.log(`  参数：${JSON.stringify(row.args)}`)
    if (row.meta !== undefined) console.log(`  meta：${JSON.stringify(row.meta)}`)
    if (row.isError) console.log(`  错误文本：${String(row.text).split('\n')[0].slice(0, 200)}`)
  }

  const guarded = rows.filter((row) => (row.name === 'write' || row.name === 'edit') && row.isError
    && /教练模式/.test(String(row.error?.reason ?? '') + String(row.text)))
  console.log(`\n=== 被守卫拒绝的 write / edit（共 ${guarded.length} 次）===`)
  for (const row of guarded) {
    console.log(`[${row.name}] call@seq ${row.seq} → result@seq ${row.resultSeq}`)
    console.log(`  拒绝理由：${String(row.text).split('\n')[0].slice(0, 200)}`)
  }

  const stateBlocks = []
  for (const event of events) {
    const raw = JSON.stringify(event.data ?? {})
    if (raw.includes('【当前阶段】')) stateBlocks.push(event.seq)
  }
  console.log(`\n=== 日志中带【当前阶段】状态块的事件（共 ${stateBlocks.length} 个）===`)
  if (stateBlocks.length === 0) {
    console.log('（没有）运行时上下文按请求装配，可能尚未落盘；以教练工具调用为间接证据。')
  } else {
    console.log(`seq：${stateBlocks.slice(0, 30).join(', ')}${stateBlocks.length > 30 ? ' …' : ''}`)
  }

  console.log(`\n=== 全部工具调用（共 ${rows.length} 次，按时间）===`)
  for (const row of rows) {
    console.log(`seq ${row.seq}→${row.resultSeq}  ${row.name}  ${row.isError ? '（失败）' : ''}`)
  }
}

main()

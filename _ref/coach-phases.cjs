#!/usr/bin/env node
/** 只看"状态块"里的标记（排除人设文本污染），并列出每轮用户台词。 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

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
  return text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
}

const targets = process.argv.slice(2)
const files = []
for (const target of targets) {
  if (fs.statSync(target).isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      const dir = path.join(target, name)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const inner of fs.readdirSync(dir)) {
        if (inner.includes('session.v4.jsonl')) files.push(path.join(dir, inner))
      }
    }
  } else files.push(target)
}

const rows = []
for (const file of files) {
  const events = readEvents(file)
  const header = events.find((e) => e.type === 'session') ?? {}
  const titleEvent = events.filter((e) => /title/.test(e.type)).pop()
  const title = titleEvent?.data?.title ?? titleEvent?.title ?? '(无标题)'

  const blocks = events.filter((e) => e.type === 'user/message'
    && (e.data?.content ?? []).some((b) => b.type === 'text' && b.text.includes('【当前阶段】')))
  const phases = blocks.map((e) => {
    const text = e.data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    const phase = /【当前阶段】([^\n]+)/.exec(text)?.[1] ?? '?'
    return { seq: e.seq, phase, text }
  })
  const last = phases[phases.length - 1]

  rows.push({
    title,
    id: header.id,
    file,
    userLines: events.filter((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')
      .map((e) => (e.data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text.replace(/\s+/g, ' ').slice(0, 46)).join(' ')),
    phases: phases.map((p) => `${p.phase}@${p.seq}`),
    forcedExit: phases.filter((p) => p.text.includes('【强制出口】')).map((p) => p.seq),
    skipReminder: phases.filter((p) => p.text.includes('【跳过提醒】')).map((p) => p.seq),
    installBranch: phases.filter((p) => p.text.includes('【安装分支】')).map((p) => p.seq),
    degraded: phases.filter((p) => p.text.includes('【降级提示】')).map((p) => p.seq),
    lastPhase: last?.phase ?? '(无状态块)',
    lastSeq: last?.seq ?? null,
  })
}

rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'))
for (const row of rows) {
  console.log(`\n### ${row.title}  (${row.id})`)
  console.log(`  文件：${row.file}`)
  console.log(`  阶段轨迹：${row.phases.join(' → ') || '(无)'}`)
  console.log(`  末态：${row.lastPhase} @seq${row.lastSeq}`)
  console.log(`  状态块内【强制出口】@seq：${row.forcedExit.join(',') || '无'}`)
  console.log(`  状态块内【跳过提醒】@seq：${row.skipReminder.join(',') || '无'}`)
  console.log(`  状态块内【安装分支】@seq：${row.installBranch.join(',') || '无'}`)
  console.log(`  状态块内【降级提示】@seq：${row.degraded.join(',') || '无'}`)
  console.log('  用户台词：')
  row.userLines.forEach((line, i) => console.log(`    ${i + 1}. ${line}`))
}

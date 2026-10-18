#!/usr/bin/env node
/**
 * 定位「多个条目不换行」：
 *   A. 模型实际收到的系统提示词里，教练人设的换行还在不在（system/message）
 *   B. 教练自己输出的正文里，条目是否真的没有换行（assistant/message）
 *   C. 插件返回的工具结果文本是否挤成一行（tool/result 的 render 输出）
 *
 * 用法：node diagnose-newline.cjs <会话目录> [...]
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function readEvents(file) {
  const buf = fs.readFileSync(file)
  let text
  if (file.endsWith('.zstd')) {
    const cuts = []
    let from = 0
    for (;;) {
      const i = buf.indexOf(MAGIC, from)
      if (i === -1) break
      cuts.push(i)
      from = i + MAGIC.length
    }
    if (cuts[0] !== 0) cuts.unshift(0)
    const parts = []
    for (let k = 0; k < cuts.length; k += 1) {
      const s = buf.subarray(cuts[k], k + 1 < cuts.length ? cuts[k + 1] : buf.length)
      try { parts.push(zlib.zstdDecompressSync(s).toString('utf8')) } catch { /* skip */ }
    }
    text = parts.join('')
  } else {
    text = buf.toString('utf8')
  }
  return text.split('\n').filter((l) => l.trim() !== '')
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

/** 收集日志文件。 */
function collect(target) {
  const info = fs.statSync(target)
  if (!info.isDirectory()) return [target]
  const out = []
  for (const name of fs.readdirSync(target)) {
    const dir = path.join(target, name)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const inner of fs.readdirSync(dir)) {
      if (inner.startsWith('session.v4.jsonl')) out.push(path.join(dir, inner))
    }
  }
  return out
}

/** 「条目」标记：编号、项目符号、方括号标签。 */
const ITEM = /(?:^|[\s，。；])(?:\d+[.、）)]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨]|[-•·]\s|【[^】]{2,8}】)/g

function countItems(text) {
  return (text.match(ITEM) ?? []).length
}

const report = []

for (const file of process.argv.slice(2).flatMap(collect)) {
  const events = readEvents(file)
  const header = events.find((e) => e.type === 'session')
  const selected = events.filter((e) => e.type === 'agent-preset/selected')
  const preset = selected.length === 0 ? '(默认)' : selected[selected.length - 1].data?.agentPreset
  if (preset !== 'coach') continue
  const title = events.filter((e) => /title/.test(e.type)).pop()?.data?.title ?? '(无标题)'

  // A. 系统提示词里的教练人设换行
  const systems = events.filter((e) => e.type === 'system/message')
  let personaNote = '（本会话没有 system/message 事件）'
  if (systems.length > 0) {
    const last = systems[systems.length - 1]
    const text = (last.data?.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    const lines = text.split('\n')
    const marker = lines.find((l) => l.includes('【最高优先级的四条铁律】'))
    const oneLine = lines.some((l) => l.includes('一次只给一步') && l.includes('绝不代做') && l.includes('不臆造'))
    personaNote = `系统提示词 ${text.length} 字符 / ${lines.length} 行；`
      + `铁律小节${marker === undefined ? '找不到' : '独占一行'}；`
      + `「一次只给一步…绝不代做」${oneLine ? '被挤在同一行 ⚠️' : '分行正常 ✅'}`
  }

  // B. 助手正文里的密度
  const dense = []
  for (const e of events) {
    if (e.type !== 'assistant/message') continue
    const text = (e.data?.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    if (text.trim() === '') continue
    const newlines = (text.match(/\n/g) ?? []).length
    const items = countItems(text)
    const longestLine = Math.max(...text.split('\n').map((l) => l.length))
    if (items >= 3 && newlines < items) {
      dense.push({ seq: e.seq, chars: text.length, newlines, items, longestLine, text })
    }
  }

  // C. 工具结果文本密度
  const toolDense = []
  for (const e of events) {
    if (e.type !== 'tool/result') continue
    const text = (e.data?.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    if (text.trim() === '') continue
    const newlines = (text.match(/\n/g) ?? []).length
    const items = countItems(text)
    if (items >= 3 && newlines < items) toolDense.push({ seq: e.seq, chars: text.length, newlines, items, text })
  }

  report.push({ title, file, personaNote, dense, toolDense })
}

console.log(`教练模式会话 ${report.length} 个\n`)
for (const r of report) {
  console.log(`${'='.repeat(74)}\n### ${r.title}`)
  console.log(`  A. ${r.personaNote}`)
  console.log(`  B. 正文「条目多、换行少」的助手消息：${r.dense.length} 条`)
  for (const d of r.dense.slice(0, 3)) {
    console.log(`     [seq ${d.seq}] ${d.chars} 字符 / ${d.newlines} 个换行 / ${d.items} 个条目标记 / 最长行 ${d.longestLine}`)
    console.log(`     ${JSON.stringify(d.text.slice(0, 260))}`)
  }
  console.log(`  C. 工具结果「条目多、换行少」：${r.toolDense.length} 条`)
  for (const d of r.toolDense.slice(0, 2)) {
    console.log(`     [seq ${d.seq}] ${d.chars} 字符 / ${d.newlines} 换行 / ${d.items} 条目`)
    console.log(`     ${JSON.stringify(d.text.slice(0, 200))}`)
  }
}

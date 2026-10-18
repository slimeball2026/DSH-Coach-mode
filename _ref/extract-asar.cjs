// 一次性工具：从 app.asar 中按前缀提取文件（只读，不修改安装副本）。
// asar 布局（Chromium Pickle）：
//   [0..3]   = 4
//   [4..7]   = headerPickle 载荷长度 H
//   [8..11]  = headerPickle 载荷长度 H
//   [12..15] = JSON 字符串长度 J
//   [16..16+J) = header JSON
//   数据区起点 = 8 + H
const fs = require('node:fs')
const path = require('node:path')

const archive = process.argv[2]
const outDir = process.argv[3]
const prefixes = process.argv.slice(4)

const fd = fs.openSync(archive, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, null)
const headerSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const headerBuf = Buffer.alloc(jsonLen)
fs.readSync(fd, headerBuf, 0, jsonLen, 16)
const header = JSON.parse(headerBuf.toString('utf8'))
const dataOffset = 8 + headerSize

const results = []
function walk(node, trail) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = trail ? `${trail}/${name}` : name
    if (entry.files) walk(entry, p)
    else results.push({ path: p, entry })
  }
}
walk(header, '')

const wanted = results.filter((r) => prefixes.length === 0 || prefixes.some((p) => r.path.startsWith(p)))
console.log(`archive files: ${results.length}, matched: ${wanted.length}`)

for (const { path: p, entry } of wanted) {
  if (entry.unpacked) { console.log(`SKIP unpacked ${p}`); continue }
  const target = path.join(outDir, p.replace(/[:*?"<>|]/g, '_'))
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const size = Number(entry.size || 0)
    const buf = Buffer.alloc(size)
    if (size > 0) fs.readSync(fd, buf, 0, size, dataOffset + Number(entry.offset))
    fs.writeFileSync(target, buf)
  } catch (error) {
    console.log(`FAIL ${p}: ${error.message}`)
  }
}
fs.closeSync(fd)
console.log(`extracted ${wanted.length} files to ${outDir}`)

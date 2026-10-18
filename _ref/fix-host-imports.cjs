// 一次性修复：把工具文件里对宿主导入 helper 的依赖换成本地 define-tool.js，
// 并扫描整包确认没有残留的宿主包 bare import。
const fs = require('node:fs')
const path = require('node:path')

const root = process.argv[2]
const from = "import { defineTool } from '@deepseek-ai/dsh-tools'"
const to = "import { defineTool } from './define-tool.js'"

for (const name of fs.readdirSync(path.join(root, 'tools'))) {
  if (!name.startsWith('coach-') || !name.endsWith('.js')) continue
  const file = path.join(root, 'tools', name)
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes(from)) {
    console.log('NO CHANGE', name)
    continue
  }
  fs.writeFileSync(file, text.split(from).join(to), 'utf8')
  console.log('patched', name)
}

const hits = []
const bareImport = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](@deepseek-ai\/[^'"]+)['"]/
const dynamicImport = /import\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full)
      continue
    }
    if (!full.endsWith('.js') && !full.endsWith('.cjs') && !full.endsWith('.mjs')) continue
    const text = fs.readFileSync(full, 'utf8')
    const found = bareImport.exec(text) ?? dynamicImport.exec(text)
    if (found !== null) hits.push(`${path.relative(root, full)} → ${found[1]}`)
  }
})(root)

console.log(hits.length === 0 ? '\n宿主包 bare import：0 处 ✅' : `\n宿主包 bare import 残留 ${hits.length} 处：\n${hits.join('\n')}`)

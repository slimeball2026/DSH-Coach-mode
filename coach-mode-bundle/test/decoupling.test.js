/**
 * 解耦断言：`core/` 下不得出现任何 `@deepseek-ai/*` import。
 *
 * 这是 SPEC 第 11 节硬约束的强制执行点，也是"纯核心可单测、可移植"的保险丝。
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE_DIR = join(HERE, '..', 'core')

/** 递归列出 core/ 下的 .js 文件。 */
function coreFiles() {
  const found = []
  for (const name of readdirSync(CORE_DIR)) {
    const full = join(CORE_DIR, name)
    if (statSync(full).isDirectory()) continue
    if (name.endsWith('.js')) found.push(full)
  }
  return found
}

test('core/ 至少有一个模块（防止断言空跑）', () => {
  assert.ok(coreFiles().length >= 5, `core/ 文件数异常：${coreFiles().length}`)
})

test('core/ 下不 import 任何 @deepseek-ai/ 包', () => {
  for (const file of coreFiles()) {
    const text = readFileSync(file, 'utf8')
    const offenders = [
      ...text.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+)['"]/g),
      ...text.matchAll(/require\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/g),
      ...text.matchAll(/import\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/g),
    ].map((match) => match[1])
    assert.deepEqual(
      offenders,
      [],
      `${relative(process.cwd(), file)} 依赖了宿主包：${offenders.join(', ')}`,
    )
  }
})

test('core/ 不 import 任何 Node 内置模块', () => {
  for (const file of coreFiles()) {
    const text = readFileSync(file, 'utf8')
    const offenders = [...text.matchAll(/(?:from|require\()\s*['"](node:[^'"]+)['"]/g)]
      .map((match) => match[1])
    assert.deepEqual(
      offenders,
      [],
      `${relative(process.cwd(), file)} 依赖了 Node 内置模块：${offenders.join(', ')}`,
    )
  }
})

test('core/ 的 import 只指向同目录相对路径', () => {
  for (const file of coreFiles()) {
    const text = readFileSync(file, 'utf8')
    const specifiers = [...text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)]
      .map((match) => match[1])
    for (const specifier of specifiers) {
      assert.match(
        specifier,
        /^\.\/[A-Za-z0-9_-]+\.js$/,
        `${relative(process.cwd(), file)} 的 import "${specifier}" 不是同目录相对路径`,
      )
    }
  }
})

test('core/ 不出现时间、随机与 IO 入口', () => {
  const forbidden = [
    'Date.now',
    'new Date',
    'Math.random',
    "from 'node:fs'",
    'from "node:fs"',
    "from 'node:path'",
    "require('node:fs')",
  ]
  for (const file of coreFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const needle of forbidden) {
      assert.ok(
        !text.includes(needle),
        `${relative(process.cwd(), file)} 出现了「${needle}」，纯核心必须是纯函数`,
      )
    }
  }
})

/**
 * 回归测试：**整包**都不许出现宿主包的 bare import。
 *
 * 事故记录：`defineTool`（来自 `@deepseek-ai/dsh-tools`）与 `Config`
 * （来自 `@deepseek-ai/schemastery`）让插件行在 profile 里
 * `ERR_MODULE_NOT_FOUND`，preset 直接显示「加载失败」。
 * 原因：dsh 自己的包在 `app.asar` 内，不在 profile 的任何祖先 node_modules 里，
 * 所以 profile 装的 bundle 解析不到它们。
 *
 * `cordis.patch.yml` 里出现的 `@deepseek-ai/*` 是**行名**，由 Loader 解析，不受影响；
 * 本测试只扫 `.js`。
 */
test('整包不 import 任何宿主包（除了 test/ 里的文档性引用）', () => {
  const root = join(HERE, '..')
  const offenders = []

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'test') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!full.endsWith('.js')) continue
      const text = readFileSync(full, 'utf8')
      const hit = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](@deepseek-ai\/[^'"]+)['"]/.exec(text)
        ?? /import\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/.exec(text)
      if (hit !== null) offenders.push(`${relative(root, full)} → ${hit[1]}`)
    }
  }
  walk(root)

  assert.deepEqual(
    offenders,
    [],
    '这些文件 import 了宿主包，装到 profile 里会 ERR_MODULE_NOT_FOUND：\n'
      + offenders.join('\n'),
  )
})

test('package.json 声明 "type": "module"（Load 器按 ESM 加载）', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
})

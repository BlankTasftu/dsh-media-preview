// Dead-code + unused-import audit for the plugin (regex-based, no parser needed).
// usage: node audit-deadcode.mjs <pluginDir>
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node audit-deadcode.mjs <pluginDir>'); process.exit(2) }

/** Collect every .mjs/.js source file that belongs to the plugin. */
function sources(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.tmp-real-fs' || entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = sources(dir)
const text = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]))
const rel = (file) => path.relative(dir, file).replace(/\\/g, '/')

const declarations = []
const DECL = [
  [/(?:^|\n)\s*export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g, 'export fn'],
  [/(?:^|\n)\s*export\s+function\s+([A-Za-z_$][\w$]*)/g, 'export fn'],
  [/(?:^|\n)\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, 'export const'],
  [/(?:^|\n)\s*export\s+class\s+([A-Za-z_$][\w$]*)/g, 'export class'],
  [/(?:^|\n)\s*function\s+([A-Za-z_$][\w$]*)/g, 'fn'],
  [/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=/g, 'const'],
  [/(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g, 'class'],
]

for (const [file, source] of text) {
  for (const [pattern, kind] of DECL) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) {
      declarations.push({ name: match[1], kind, file, index: match.index })
    }
  }
}

/** Count references to a name across every plugin source, split lib vs tests. */
function references(name, skipFile, skipIndex) {
  const word = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`, 'g')
  let inLib = 0
  let inTests = 0
  for (const [file, source] of text) {
    word.lastIndex = 0
    let count = 0
    let match
    while ((match = word.exec(source)) !== null) count += 1
    if (file === skipFile && skipIndex !== undefined && count > 0) count -= 1 // the declaration itself
    if (count <= 0) continue
    if (rel(file).startsWith('tests/')) inTests += count
    else inLib += count
  }
  return { inLib, inTests }
}

console.log('=== 声明但从未被引用（死代码）===')
let dead = 0
const seen = new Set()
for (const decl of declarations) {
  const key = `${decl.file}:${decl.name}`
  if (seen.has(key)) continue
  seen.add(key)
  const { inLib, inTests } = references(decl.name, decl.file, decl.index)
  if (inLib === 0 && inTests === 0) {
    console.log(`  [${decl.kind}] ${decl.name}  (${rel(decl.file)}:${decl.index})`)
    dead += 1
  }
}
console.log(dead === 0 ? '  （无）' : `  共 ${dead} 个`)

console.log('\n=== 只被测试引用（生产代码里没有使用）===')
for (const decl of declarations) {
  const { inLib, inTests } = references(decl.name, decl.file, decl.index)
  if (inLib === 0 && inTests > 0) {
    console.log(`  [${decl.kind}] ${decl.name}  (${rel(decl.file)})  ← 仅测试使用 ×${inTests}`)
  }
}

console.log('\n=== 未使用的 import ===')
let unusedImports = 0
for (const [file, source] of text) {
  const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let match
  while ((match = importRe.exec(source)) !== null) {
    const names = match[2]
      .split(',')
      .map((piece) => piece.trim().split(/\s+as\s+/).pop().trim())
      .filter((name) => name !== '')
    for (const name of names) {
      const rest = source.slice(0, match.index) + source.slice(match.index + match[0].length)
      const word = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g')
      if (!word.test(rest)) {
        console.log(`  ${rel(file)}: ${name} (from ${match[3]})`)
        unusedImports += 1
      }
    }
  }
}
console.log(unusedImports === 0 ? '  （无）' : `  共 ${unusedImports} 个`)

console.log('\n=== 可能未被使用的本地函数参数/变量（粗筛，需人工确认）===')
for (const [file, source] of text) {
  if (rel(file).startsWith('tests/')) continue
  const fnRe = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g
  let match
  while ((match = fnRe.exec(source)) !== null) {
    const params = match[2]
      .split(',')
      .map((piece) => piece.trim().replace(/^\.\.\./, '').split(/[\s=]/)[0])
      .filter((name) => name !== '' && name !== '{' && name !== '}')
    if (params.length === 0) continue
    const bodyStart = source.indexOf('{', match.index + match[0].length - 1)
    const body = source.slice(bodyStart, bodyStart + 4000)
    for (const param of params) {
      const word = new RegExp(`(?<![\\w$])${param}(?![\\w$])`, 'g')
      const hits = (body.match(word) || []).length
      if (hits <= 1) console.log(`  ${rel(file)}: ${match[1]}() 的参数 \`${param}\` 在函数体内只出现一次`)
    }
  }
}
console.log('\n完成。')

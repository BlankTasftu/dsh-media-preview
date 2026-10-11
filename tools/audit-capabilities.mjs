// Security / blast-radius audit for the media plugin: scans source for dangerous
// capabilities and print a PASS/FAIL table. Read-only.
// usage: node audit-plugin-safety.mjs <pluginDir>
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node audit-plugin-safety.mjs <pluginDir>'); process.exit(2) }

function sources(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.(mjs|js|json|yml|md)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = sources(dir)
const rel = (file) => path.relative(dir, file).replace(/\\/g, '/')
/**
 * 生产运行时 = `lib/` 下的源码。
 *
 * `tests/` 与 `tools/` 都是工具链：测试会写临时文件、审计脚本本身就**含有**
 * 这些危险 API 的正则字面量（它靠它们工作）。把它们算进能力面必然误报 ——
 * 这一条是踩过坑之后收紧的。
 */
const runtime = files.filter((file) => rel(file).startsWith('lib/') && /\.(mjs|js)$/.test(file))
if (runtime.length === 0) {
  console.error('未找到 lib/ 下的源码，目录参数是否正确？')
  process.exit(2)
}

const rules = [
  { id: 'host-no-writes', files: runtime, pattern: /writeFile|appendFile|createWriteStream|fsp?\.unlink|\brm\(|rmdir|mkdir|\bmv\(|rename\(/, expect: false, why: '宿主半侧不应有任何写盘能力' },
  { id: 'no-child-process', files: runtime, pattern: /child_process|execSync|spawnSync|\bspawn\(/, expect: false, why: '不应启动任何进程' },
  { id: 'no-eval', files: runtime, pattern: /\beval\s*\(|new Function\s*\(/, expect: false, why: '不应动态求值' },
  { id: 'no-html-injection', files: runtime, pattern: /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/, expect: false, why: '不应注入 HTML' },
  { id: 'no-absolute-paths', files: runtime, pattern: /['"][A-Za-z]:[\\/]|['"]\/(Users|home|root)\//, expect: false, why: '不应硬编码本机路径' },
  { id: 'no-outbound-urls', files: runtime, pattern: /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+/i, expect: false, why: '不应有任何外部网络请求' },
  { id: 'no-unauthenticated-route', files: runtime, pattern: /webServer\.register|registerFallback/, expect: false, why: '不应注册绕过鉴权的 webServer 路由' },
  { id: 'no-global-patching', files: runtime, pattern: /globalThis\.[A-Za-z_$]+\s*=|window\.[A-Za-z_$]+\s*=(?!\s*$)|\.prototype\.[A-Za-z_$]+\s*=/, expect: false, why: '不应篡改全局或原型' },
  { id: 'no-env-reads', files: runtime, pattern: /process\.env/, expect: false, why: '不应读取环境变量' },
  { id: 'no-direct-node-fs', files: [path.join(dir, 'lib', 'index.js')], pattern: /from 'node:fs'|require\('node:fs'\)/, expect: false, why: '宿主读取必须经 ctx.fs，不能直读本机磁盘' },
  { id: 'client-requires-react-only', files: runtime, pattern: /require\('(?!react')[^')]+'\)/, expect: 'custom', why: '客户端 bundle 只能 require 基座模块' },
  { id: 'routes-are-api-scoped', files: runtime, pattern: /path:\s*'(?!\/api\/)[^']+'/, expect: 'custom', why: '路由必须挂在鉴权 /api 通道下' },
  { id: 'has-nosniff', files: [path.join(dir, 'lib', 'index.js')], pattern: /X-Content-Type-Options/, expect: true, why: '响应必须带 nosniff' },
  { id: 'has-no-store', files: [path.join(dir, 'lib', 'index.js')], pattern: /Cache-Control/, expect: true, why: '响应必须显式声明缓存策略' },
  { id: 'has-extension-allowlist', files: [path.join(dir, 'lib', 'index.js')], pattern: /isMediaPath/, expect: true, why: '必须按后缀白名单拒绝非媒体文件' },
  { id: 'has-nul-check', files: [path.join(dir, 'lib', 'index.js')], pattern: /\\0|\\u0000/, expect: true, why: '必须拒绝含 NUL 的路径' },
  { id: 'has-absolute-check', files: [path.join(dir, 'lib', 'index.js')], pattern: /isAbsoluteAnywhere/, expect: true, why: '必须拒绝相对路径' },
]

let failures = 0
console.log('=== 能力面审计（生产代码）===\n')
for (const rule of rules) {
  const hits = []
  for (const file of rule.files) {
    if (!fs.existsSync(file)) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) hits.push(`${rel(file)}:${index + 1}  ${line.trim().slice(0, 110)}`)
    })
  }
  let verdict
  if (rule.expect === 'custom') {
    // 客户端 require：只允许 react / react/jsx-runtime。
    const bad = hits.filter((hit) => !/require\('react(\/jsx-runtime)?'\)/.test(hit))
    const badRoutes = hits.filter((hit) => !/path:\s*'\/api\//.test(hit))
    const offenders = rule.id === 'client-requires-react-only' ? bad : badRoutes
    verdict = offenders.length === 0 ? 'PASS' : 'FAIL'
    if (offenders.length > 0) { failures += 1; console.log(`${verdict}  ${rule.id} — ${rule.why}`); offenders.forEach((hit) => console.log(`        ${hit}`)) ; continue }
    console.log(`${verdict}  ${rule.id} — ${rule.why}（命中 ${hits.length} 处，全部合规）`)
    continue
  }
  const ok = rule.expect ? hits.length > 0 : hits.length === 0
  verdict = ok ? 'PASS' : 'FAIL'
  if (!ok) failures += 1
  console.log(`${verdict}  ${rule.id} — ${rule.why}`)
  if (!ok) hits.slice(0, 12).forEach((hit) => console.log(`        ${hit}`))
}

console.log('\n=== 只读事实 ===')
console.log(`生产源文件: ${runtime.map(rel).join(', ')}`)
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
console.log(`声明的扩展点: dsh.bundle.patch=${pkg.dsh?.bundle?.patch}  dsh.client.platform=${pkg.dsh?.client?.platform}  inject=${JSON.stringify(pkg.dsh?.client?.inject)}`)
console.log(`运行时依赖: ${JSON.stringify(pkg.dependencies ?? {})}  peerDependencies: ${JSON.stringify(pkg.peerDependencies ?? {})}`)
console.log(`install 脚本: ${JSON.stringify(pkg.scripts ?? {})}`)

console.log(`\n${failures === 0 ? '全部通过。' : `有 ${failures} 项需要处理。`}`)
process.exitCode = failures === 0 ? 0 : 1

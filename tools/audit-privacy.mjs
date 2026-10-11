#!/usr/bin/env node
/**
 * 隐私审计：确认仓库里没有任何**本机专属信息**。
 *
 * 为什么需要它：0.3.0 发布时，我把本地文档整份复制到发布目录，覆盖了已经脱敏的版本 ——
 * 于是 `E:\...` / `D:\...` 这类本机绝对路径被推到公开仓库。写文档时很难靠眼睛发现，
 * 所以把它变成一条会失败的检查。
 *
 * 判定规则（不依赖任何"用户是谁"的预设，否则脚本自己就成了泄露源）：
 *   1. Windows 绝对路径（`X:\...`）—— 除白名单里的合成夹具外一律报错；
 *   2. POSIX 家目录（`/home/<name>`、`/Users/<name>`）—— 除 `u` / `someone` 外报错；
 *   3. 邮箱地址（`someone@example.com` 之类占位域名放行）；
 *   4. 常见密钥形状（`sk-...`、`AKIA...`、40 位十六进制串）。
 *
 * 用法: node tools/audit-privacy.mjs [目录，默认当前目录]
 * 退出码: 0 = 干净；1 = 有需要处理的命中。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? '.')
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.cache'])
const TEXT_EXTENSIONS = new Set([
  '.md', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml', '.txt', '.ts', '.tsx', '.html', '.css',
])

/** 合成夹具：测试里刻意使用的假路径，允许出现。 */
const PATH_ALLOWLIST = [
  /^C:\\ws(\\|$)/i,
  /^C:\\Users\\someone(\\|$)/i,
  /^C:\\a(\\|$)/i,
  /^C:\\dir(\\|$)/i,
  /^C:\\nonexistent(\\|$)/i,
]
const POINTER_ALLOWLIST = ['<仓库目录>', '<DSH 安装目录>', '<DSH 运行时>', '<你>', '<profile>']

const CHECKS = [
  {
    name: 'Windows 绝对路径',
    // 匹配前会把源码里的 `\\` 还原成 `\`（JS/JSON 字面量需要转义，Markdown 不需要）。
    // 反斜杠后必须紧跟路径字符，否则 `n:\s*` 这种正则片段会被误报。
    pattern: /[A-Za-z]:\\[A-Za-z0-9_.$-][^\s`'"()|,;]*/g,
    allow: (hit) => PATH_ALLOWLIST.some((re) => re.test(hit)) || POINTER_ALLOWLIST.some((p) => hit.includes(p)),
  },
  {
    name: 'POSIX 家目录',
    pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g,
    allow: (hit) => /^\/(?:home\/u|Users\/someone)$/.test(hit),
  },
  {
    name: '邮箱地址',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: (hit) => /@(example\.(com|org|net)|users\.noreply\.github\.com|localhost)$/.test(hit),
  },
  {
    name: '疑似密钥',
    pattern: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|[0-9a-f]{40})\b/g,
    allow: () => false,
  },
]

/** 审计脚本自己必须写下这些模式，跳过它。 */
const SELF = path.join('tools', 'audit-privacy.mjs')

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files)
      continue
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(path.join(dir, entry.name))
  }
  return files
}

const files = walk(ROOT)
const findings = []

for (const file of files) {
  const relative = path.relative(ROOT, file)
  if (relative === SELF) continue
  const text = readFileSync(file, 'utf8')
  // 源码里 `C:\\ws` 表示路径 `C:\ws`；还原后再匹配，否则白名单永远对不上。
  const lines = text.split('\n').map((line) => line.replace(/\\\\/g, '\\'))
  for (const check of CHECKS) {
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(check.pattern)) {
        const hit = match[0]
        // 源码里的正则片段（例如 `"version":\s*` 里的 `n:\s*`）会被路径模式误匹配：
        // `n:` 后面跟 `\s`，而 `s` 恰好落在"路径字符"里。真实路径不含正则元字符，
        // 所以含元字符的命中一律不当路径看。
        if (/[*?[\]()+^$]/.test(hit)) continue
        if (check.allow(hit)) continue
        findings.push({ file: relative, line: index + 1, kind: check.name, hit })
      }
    }
  }
}

console.log(`目录: ${ROOT}`)
console.log(`文本文件: ${files.length} 个，检查项: ${CHECKS.map((c) => c.name).join(' / ')}\n`)

if (findings.length === 0) {
  console.log('✓ 没有发现本机专属信息。')
  process.exit(0)
}

console.log('✗ 发现需要处理的命中：')
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  [${f.kind}]  ${f.hit}`)
}
console.log(`\n共 ${findings.length} 处。若确认是合成夹具，请加进本脚本的白名单并说明理由。`)
process.exit(1)

/**
 * 版本规则的自检。
 *
 * 为什么值得单独写一个测试：这个仓库真的犯过一次 —— 4 个提交（1 个功能 + 3 个文档）
 * 全写着 `0.1.0`，而 `main` 已经比 `v0.1.0` tag 多出 2 个提交。结果是"从 main 装到的
 * 0.1.0"与"tag v0.1.0"内容不同却同名同版本，用户无法从版本号判断自己装的是哪一份，
 * 也没法据此判断"要不要更新"。
 *
 * 版本号这种事靠自觉一定会再犯，所以把它变成会失败的检查：
 *   · `package.json` 的 version 必须是合法 semver；
 *   · `CHANGELOG.md` 必须有对应的 `## [x.y.z]` 小节；
 *   · 该小节必须是 CHANGELOG 里最新的一个（防止"补了旧版本号却忘了写新的"）。
 *
 * 有意**不**检查"是否存在对应的 git tag"：打 tag 属于发布动作，本地开发时提前写号
 * 是正常的；把 tag 检查塞进单测会让提交顺序变得僵硬。发布清单里另行确认。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

/** CHANGELOG 里出现的所有版本号，按出现顺序。 */
function changelogVersions() {
  const versions = []
  const pattern = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/gm
  let match
  while ((match = pattern.exec(changelog)) !== null) versions.push(match[1])
  return versions
}

test('package.json 的 version 是合法 semver', () => {
  assert.equal(
    typeof pkg.version,
    'string',
    `package.json 缺少 version（${ROOT}）`,
  )
  assert.match(
    pkg.version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    `version "${pkg.version}" 不是合法 semver`,
  )
})

test('CHANGELOG.md 必须有与 package.json 版本一致的小节', () => {
  const versions = changelogVersions()
  assert.ok(versions.length > 0, 'CHANGELOG.md 里一个小节都没有')
  assert.ok(
    versions.includes(pkg.version),
    `CHANGELOG.md 缺少 ## [${pkg.version}] 小节（现有：${versions.join(', ')}）。` +
      '改动了用户装到的东西就必须写一条更新记录，并同步 package.json 的 version。',
  )
})

test('CHANGELOG 最新的一节就是当前版本（不许只补旧版本号）', () => {
  const versions = changelogVersions()
  assert.equal(
    versions[0],
    pkg.version,
    `CHANGELOG 最新小节是 ${versions[0]}，而 package.json 是 ${pkg.version}：` +
      '要么补写新版本的记录，要么把版本号改回去。',
  )
})

test('版本号只出现在 package.json 一处（文档里的历史版本号是叙述，不是配置）', () => {
  // 防止有人另建一份"版本常量"忘记同步：运行时不应再有第二个版本来源。
  const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const hostSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  for (const [name, source] of [['lib/client.js', clientSource], ['lib/index.js', hostSource]]) {
    assert.doesNotMatch(
      source,
      /version:\s*['"]\d+\.\d+\.\d+/,
      `${name} 里出现了硬编码的版本号：版本只能来自 package.json`,
    )
  }
})

/**
 * 目录扫描的单元测试（用假 fs，不碰真实磁盘）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinChild, pathFlavorOf, scanMediaRoot, scanMediaRoots } from '../lib/media-scan.mjs'
import { createFakeFs } from './support/fake-fs.mjs'

/**
 * 造一棵显式目录树。
 *
 * @param spec - `{ [absolutePath]: string[] | { bytes?: number, type?: string } }`；
 *   数组表示目录（子项名），对象表示文件/链接。
 * @returns 假 fs。
 */
function tree(spec) {
  const entries = {}
  for (const [path, value] of Object.entries(spec)) {
    if (Array.isArray(value)) {
      entries[path] = {
        type: 'directory',
        children: value.map((name) => {
          const childPath = `${path}/${name}`
          const child = spec[childPath]
          if (Array.isArray(child)) return { name, type: 'directory' }
          if (child && child.type !== undefined && child.type !== 'file') {
            return { name, type: child.type }
          }
          return { name, type: 'file', size: (child && child.bytes) || 10 }
        }),
      }
    } else {
      entries[path] = { bytes: new Uint8Array(value.bytes || 10) }
    }
  }
  // 文件条目需要真实字节，供 stat 报大小。
  for (const [path, value] of Object.entries(spec)) {
    if (!Array.isArray(value)) entries[path] = { bytes: new Uint8Array(value.bytes || 10) }
  }
  return createFakeFs(entries)
}

const LIMITS = { maxFiles: 100, maxDepth: 4, maxVisited: 1000, maxEntriesPerDir: 100, skipDirectories: [] }

test('路径风味与拼接', () => {
  assert.equal(pathFlavorOf('C:\\work\\ws'), 'win32')
  assert.equal(pathFlavorOf('\\\\server\\share'), 'win32')
  assert.equal(pathFlavorOf('/home/u/ws'), 'posix')
  assert.equal(joinChild('C:\\work\\ws', 'a.mp4', 'win32'), 'C:\\work\\ws\\a.mp4')
  assert.equal(joinChild('/home/u/ws/', 'a.mp4', 'posix'), '/home/u/ws/a.mp4')
})

test('只收媒体文件，跳过非媒体、符号链接与忽略目录', async () => {
  const fs = tree({
    '/ws': ['a.mp4', 'notes.txt', 'sub', 'node_modules', 'link.mp4'],
    '/ws/a.mp4': { bytes: 11 },
    '/ws/notes.txt': { bytes: 3 },
    '/ws/link.mp4': { type: 'symlink' },
    '/ws/sub': ['b.mp3', 'deep'],
    '/ws/sub/b.mp3': { bytes: 22 },
    '/ws/sub/deep': ['c.wav'],
    '/ws/sub/deep/c.wav': { bytes: 33 },
    '/ws/node_modules': ['junk'],
    '/ws/node_modules/junk': ['x.mp4'],
    '/ws/node_modules/junk/x.mp4': { bytes: 44 },
  })

  const result = await scanMediaRoot({
    fs,
    root: '/ws',
    limits: { ...LIMITS, skipDirectories: ['node_modules'] },
  })

  assert.deepEqual(
    result.files.map((file) => file.name),
    ['a.mp4', 'b.mp3', 'c.wav'],
  )
  assert.deepEqual(
    result.files.map((file) => file.kind),
    ['video', 'audio', 'audio'],
  )
  assert.equal(result.files[0].bytes, 11)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.errors, [])
})

test('maxDepth 生效：更深一层不再进入', async () => {
  const fs = tree({
    '/ws': ['l1'],
    '/ws/l1': ['l2'],
    '/ws/l1/l2': ['deep.mp4'],
    '/ws/l1/l2/deep.mp4': { bytes: 5 },
  })
  const shallow = await scanMediaRoot({ fs, root: '/ws', limits: { ...LIMITS, maxDepth: 1 } })
  assert.deepEqual(shallow.files, [])
  const deep = await scanMediaRoot({ fs, root: '/ws', limits: { ...LIMITS, maxDepth: 2 } })
  assert.deepEqual(
    deep.files.map((file) => file.name),
    ['deep.mp4'],
  )
})

test('maxFiles 生效并置 truncated', async () => {
  const names = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3']
  const spec = { '/ws': names }
  for (const name of names) spec[`/ws/${name}`] = { bytes: 1 }
  const fs = tree(spec)
  const result = await scanMediaRoot({ fs, root: '/ws', limits: { ...LIMITS, maxFiles: 2 } })
  assert.equal(result.files.length, 2)
  assert.equal(result.truncated, true)
})

test('读不动的目录只记录错误，不中断整次扫描', async () => {
  // 显式声明目录项：`locked` 是一个目录，但它的条目拿不到（模拟权限/竞态），
  // listDir 会抛 FS_NOT_FOUND —— 扫描必须跳过它并继续。
  const fs = createFakeFs({
    '/ws': {
      type: 'directory',
      children: [
        { name: 'ok.mp3', type: 'file', size: 1 },
        { name: 'locked', type: 'directory' },
      ],
    },
    '/ws/ok.mp3': { bytes: new Uint8Array(1) },
  })
  const result = await scanMediaRoot({ fs, root: '/ws', limits: LIMITS })
  assert.deepEqual(
    result.files.map((file) => file.name),
    ['ok.mp3'],
  )
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /locked/)
})

test('多根合并：按绝对路径去重，并带上来源标签', async () => {
  const fs = tree({
    '/a': ['x.mp4'],
    '/a/x.mp4': { bytes: 1 },
    '/b': ['x.mp4', 'y.mp4'],
    '/b/x.mp4': { bytes: 1 },
    '/b/y.mp4': { bytes: 1 },
  })
  const result = await scanMediaRoots({
    fs,
    roots: [
      { path: '/a', label: '甲乙' },
      { path: '/b', label: 'B' },
      { path: '/missing', label: 'gone' },
    ],
    limits: LIMITS,
  })
  // 不同根下的同名文件是不同文件，都保留；读不到的根只贡献一条错误。
  assert.deepEqual(
    result.files.map((file) => `${file.rootLabel}:${file.absolutePath}`),
    ['甲乙:/a/x.mp4', 'B:/b/x.mp4', 'B:/b/y.mp4'],
  )
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /missing/)
  // 读不到的根也会出现在清单里（文件数 0），这样面板能如实说明"哪个根没扫到"。
  assert.equal(result.roots.length, 3)
  assert.equal(result.roots[2].files, 0)
})

test('多根合并：同一路径被两个根覆盖时只出现一次', async () => {
  const fs = tree({
    '/outer': ['inner'],
    '/outer/inner': ['a.mp4'],
    '/outer/inner/a.mp4': { bytes: 1 },
  })
  const result = await scanMediaRoots({
    fs,
    roots: [
      { path: '/outer', label: '外' },
      { path: '/outer/inner', label: '内' },
    ],
    limits: LIMITS,
  })
  assert.deepEqual(
    result.files.map((file) => file.absolutePath),
    ['/outer/inner/a.mp4'],
  )
})

/**
 * 格式表与配置钳制的单元测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_MIME,
  MEDIA_MIME,
  VIDEO_MIME,
  extensionOf,
  isMediaPath,
  mediaKindOf,
  mediaMimeOf,
} from '../lib/media-formats.mjs'

/** 后缀顺序由 MIME 表的键序决定（客户端副本必须一致，见 parity 测试）。 */
const VIDEO_EXTENSIONS = Object.keys(VIDEO_MIME)
const AUDIO_EXTENSIONS = Object.keys(AUDIO_MIME)
import { DEFAULT_CONFIG, resolveConfig, shouldSkipDirectory } from '../lib/config.mjs'

test('扩展名提取：只看最后一段、大小写归一、无扩展名返回空串', () => {
  assert.equal(extensionOf('C:\\a\\b\\Song.MP3'), 'mp3')
  assert.equal(extensionOf('/home/u/movie.MP4'), 'mp4')
  assert.equal(extensionOf('my.folder/README'), '')
  assert.equal(extensionOf('archive.tar.gz'), 'gz')
  assert.equal(extensionOf('.hidden'), '')
  assert.equal(extensionOf('trailing.'), '')
  assert.equal(extensionOf(''), '')
  assert.equal(extensionOf(null), '')
})

test('本次要求的三种格式必须在内', () => {
  for (const extension of ['mp4', 'm4a', 'mp3']) {
    assert.ok(isMediaPath(`x.${extension}`), `${extension} 应当被支持`)
  }
  assert.equal(mediaKindOf('a.mp4'), 'video')
  assert.equal(mediaKindOf('a.m4a'), 'audio')
  assert.equal(mediaKindOf('a.mp3'), 'audio')
})

test('常用容器覆盖面', () => {
  for (const extension of ['webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'm4v', 'ogv', '3gp']) {
    assert.equal(mediaKindOf(`x.${extension}`), 'video', extension)
  }
  for (const extension of ['wav', 'flac', 'ogg', 'opus', 'aac', 'wma', 'aiff', 'amr', 'mid']) {
    assert.equal(mediaKindOf(`x.${extension}`), 'audio', extension)
  }
  assert.equal(mediaKindOf('x.txt'), null)
  assert.equal(isMediaPath('x.credentials'), false)
})

test('每个后缀都有精确的 Content-Type，且类别与 MIME 前缀一致', () => {
  const all = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]
  for (const extension of all) {
    const mime = mediaMimeOf(`x.${extension}`)
    assert.notEqual(mime, 'application/octet-stream', extension)
    if (VIDEO_EXTENSIONS.includes(extension)) {
      assert.ok(
        mime.startsWith('video/') || mime.startsWith('application/'),
        `${extension} → ${mime}`,
      )
    } else {
      assert.ok(mime.startsWith('audio/'), `${extension} → ${mime}`)
    }
  }
  // 未知后缀不猜。
  assert.equal(mediaMimeOf('x.zzz'), 'application/octet-stream')
})

test('格式表没有重复键（音频/视频后缀不允许交叉）', () => {
  const overlap = VIDEO_EXTENSIONS.filter((extension) => AUDIO_EXTENSIONS.includes(extension))
  assert.deepEqual(overlap, [])
  assert.equal(VIDEO_EXTENSIONS.length + AUDIO_EXTENSIONS.length, Object.keys(MEDIA_MIME).length)
})

test('配置：非法值回落到默认值，合法值被采纳', () => {
  const defaults = resolveConfig(undefined)
  assert.deepEqual(defaults, DEFAULT_CONFIG)

  const custom = resolveConfig({
    stream: { maxChunkBytes: 1024 * 1024, streamChunkBytes: 128 * 1024 },
    library: { maxFiles: 12, maxDepth: 2, skipDirectories: ['Node_Modules', '.git'] },
  })
  assert.equal(custom.stream.maxChunkBytes, 1024 * 1024)
  assert.equal(custom.library.maxFiles, 12)
  assert.equal(custom.library.maxDepth, 2)
  assert.deepEqual(custom.library.skipDirectories, ['node_modules', '.git'])
})

test('配置：越界与错误类型都不会把插件变成内存炸弹', () => {
  const insane = resolveConfig({
    stream: { maxChunkBytes: 1e12, streamChunkBytes: -5 },
    library: { maxFiles: 0, maxDepth: 999, maxVisited: 'abc', maxEntriesPerDir: null },
  })
  assert.equal(insane.stream.maxChunkBytes, DEFAULT_CONFIG.stream.maxChunkBytes)
  assert.equal(insane.stream.streamChunkBytes, DEFAULT_CONFIG.stream.streamChunkBytes)
  assert.equal(insane.library.maxFiles, DEFAULT_CONFIG.library.maxFiles)
  assert.equal(insane.library.maxDepth, DEFAULT_CONFIG.library.maxDepth)
  assert.equal(insane.library.maxVisited, DEFAULT_CONFIG.library.maxVisited)
  assert.equal(insane.library.maxEntriesPerDir, DEFAULT_CONFIG.library.maxEntriesPerDir)

  // 空数组同样视为"没配"，回落到默认跳过表（否则会退化成扫描 node_modules）。
  assert.deepEqual(
    resolveConfig({ library: { skipDirectories: [] } }).library.skipDirectories,
    DEFAULT_CONFIG.library.skipDirectories,
  )
})

test('跳过目录判定不区分大小写', () => {
  const list = DEFAULT_CONFIG.library.skipDirectories
  assert.equal(shouldSkipDirectory('NODE_MODULES', list), true)
  assert.equal(shouldSkipDirectory('.git', list), true)
  assert.equal(shouldSkipDirectory('src', list), false)
})

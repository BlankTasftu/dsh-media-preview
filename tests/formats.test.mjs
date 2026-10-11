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
import { DEFAULT_CONFIG, resolveConfig } from '../lib/config.mjs'

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

test('绝不认领代码/文档后缀（`.ts` 曾经把 TypeScript 当成视频）', () => {
  // 真实事故：`ts`（MPEG 传输流）被放进媒体表之后，
  //   · 媒体库把 20+ 个 `.d.ts` 列成了"视频"；
  //   · 更糟的是预览 —— 本插件的注册优先级高于内建渲染器与纯文本兜底，
  //     于是点开 `.ts` 源码会进"媒体播放器"，而不再按代码显示。
  // 这里把"不能认领的后缀"钉死，避免以后再撞上同类歧义。
  const FORBIDDEN = [
    'ts', 'mts', 'tsx', 'cts', 'js', 'mjs', 'cjs', 'jsx',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'php', 'lua', 'sh', 'ps1',
    'json', 'yml', 'yaml', 'toml', 'ini', 'md', 'txt', 'log', 'html', 'htm', 'css', 'scss',
  ]
  for (const extension of FORBIDDEN) {
    assert.equal(isMediaPath(`x.${extension}`), false, `${extension} 不该被当媒体`)
    assert.equal(mediaKindOf(`x.${extension}`), null, `${extension} 不该有媒体类别`)
    assert.equal(mediaMimeOf(`x.${extension}`), 'application/octet-stream', `${extension} 不该有媒体 MIME`)
  }
  // 报障时的具体形态
  for (const path of ['index.d.ts', 'mod.mts', 'a.ts', 'src/types/config.d.ts']) {
    assert.equal(isMediaPath(path), false, path)
  }
  // 无歧义的那个要保留
  assert.equal(mediaKindOf('movie.m2ts'), 'video')
})

test('格式表没有重复键（音频/视频后缀不允许交叉）', () => {
  const overlap = VIDEO_EXTENSIONS.filter((extension) => AUDIO_EXTENSIONS.includes(extension))
  assert.deepEqual(overlap, [])
  assert.equal(VIDEO_EXTENSIONS.length + AUDIO_EXTENSIONS.length, Object.keys(MEDIA_MIME).length)
})

test('配置：非法值回落到默认值，合法值被采纳', () => {
  const defaults = resolveConfig(undefined)
  assert.deepEqual(defaults, DEFAULT_CONFIG)

  const custom = resolveConfig({ stream: { streamChunkBytes: 128 * 1024 } })
  assert.equal(custom.stream.streamChunkBytes, 128 * 1024)
})

test('配置：越界与错误类型都不会把插件变成内存炸弹', () => {
  const insane = resolveConfig({ stream: { streamChunkBytes: -5 } })
  assert.equal(insane.stream.streamChunkBytes, DEFAULT_CONFIG.stream.streamChunkBytes)

  // 整个 config 缺失、或塞进完全不认识的字段，都要能正常工作（0.3.0 删掉了 library 一组）。
  assert.deepEqual(resolveConfig(undefined), DEFAULT_CONFIG)
  assert.deepEqual(
    resolveConfig({ library: { maxFiles: 10 }, 未知: true }).stream,
    DEFAULT_CONFIG.stream,
  )
})

/**
 * 真文件系统集成测试。
 *
 * 上面那些用例用的是假 fs，能钉住 HTTP 语义，但钉不住"真实后端的 offset/短读语义
 * 是不是我们以为的那样"。这里用一个直接架在 `node:fs` 上的最小 fs 适配器，
 * 对**真实的媒体文件**跑一遍完整链路：
 *
 *   Range 请求 → 路由 → readByteRange → 响应字节
 *
 * 并逐字节比对（SHA-256）——这正是播放器拖进度条时发生的事：把各段拼起来应当
 * 与文件本身完全一致。素材用工作区里已有的真实 mp3；缺失时自动跳过，不假装通过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fsp, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveMedia } from '../lib/index.js'
import { resolveConfig } from '../lib/config.mjs'
import { scanMediaRoot } from '../lib/media-scan.mjs'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 真实素材目录：默认取仓库旁的 `media-samples/`，也可用环境变量指定。
 *
 * 为什么做成可配置：这一层测的是"真实字节经真实文件系统往返"，没有素材就
 * **跳过**而不是假装通过。任何人把自己的 mp3 丢进 `media-samples/` 就能跑起来。
 */
const SAMPLE_DIR = process.env.DSH_MEDIA_SAMPLE_DIR
  ? path.resolve(process.env.DSH_MEDIA_SAMPLE_DIR)
  : path.resolve(REPO_ROOT, '..', 'media-samples')
const TMP_DIR = path.join(REPO_ROOT, 'tests', '.tmp-real-fs')

/** 直连 `node:fs` 的最小适配器，语义按 `ctx.fs` 的契约实现。 */
function createRealFs() {
  return {
    async resolve(target) {
      return { path: path.resolve(String(target)) }
    },
    processPath(target) {
      return target.path
    },
    async stat(target) {
      const info = await fsp.stat(target.path).catch(() => undefined)
      if (info === undefined) return undefined
      const type = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
      return { type, version: String(info.mtimeMs), ...(type === 'file' ? { size: info.size } : {}) }
    },
    async listDir(target) {
      const items = await fsp.readdir(target.path, { withFileTypes: true })
      return items.map((item) => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'other',
        ...(item.isFile() ? { size: undefined } : {}),
      }))
    },
    async readByteRange(target, range) {
      const handle = await fsp.open(target.path, 'r')
      try {
        const info = await handle.stat()
        const length = Math.max(0, Math.min(range.length, info.size - range.offset))
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, range.offset)
        return new Uint8Array(buffer.subarray(0, bytesRead))
      } finally {
        await handle.close()
      }
    },
  }
}

const ctx = { fs: createRealFs(), get: () => undefined }
const cfg = resolveConfig(undefined)

/** 取一个真实 mp3；没有素材时返回 undefined。 */
function sampleFile() {
  if (!existsSync(SAMPLE_DIR)) return undefined
  const entries = readdirSync(SAMPLE_DIR)
  const mp3 = entries.filter((entry) => entry.toLowerCase().endsWith('.mp3')).sort()
  if (mp3.length === 0) return undefined
  return path.join(SAMPLE_DIR, mp3[0])
}

/**
 * 发一个 /api/media 请求。
 *
 * @param file - 绝对路径。
 * @param range - Range 头。
 * @param method - HTTP 方法。
 * @returns Response。
 */
function request(file, range, method = 'GET') {
  const url = `http://127.0.0.1:19387/api/media?path=${encodeURIComponent(file)}`
  const headers = range === undefined ? {} : { range }
  return serveMedia(new Request(url, { method, headers }), ctx, cfg)
}

/** 文件内容的 SHA-256。 */
function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

test('真实 mp3：一段 Range 的字节与文件切片逐字节一致', async (t) => {
  const file = sampleFile()
  if (file === undefined) {
    t.skip('没有可用的真实 mp3 素材')
    return
  }
  const whole = readFileSync(file)
  const response = await request(file, 'bytes=0-1023')
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-range'), `bytes 0-1023/${whole.length}`)
  const body = Buffer.from(await response.arrayBuffer())
  assert.equal(body.length, 1024)
  assert.equal(hashOf(body), hashOf(whole.subarray(0, 1024)))
})

test('真实 mp3：按分块边界逐段取回并拼接，等于整文件哈希', async (t) => {
  const file = sampleFile()
  if (file === undefined) {
    t.skip('没有可用的真实 mp3 素材')
    return
  }
  const whole = readFileSync(file)
  const parts = []
  let offset = 0
  let requests = 0
  while (offset < whole.length) {
    // 与播放器一致：每次都是"从当前偏移到末尾"，由服务端裁到单次上限。
    const response = await request(file, `bytes=${offset}-`)
    assert.equal(response.status, 206)
    const range = response.headers.get('content-range')
    assert.match(range, new RegExp(`^bytes ${offset}-(\\d+)/${whole.length}$`))
    const body = Buffer.from(await response.arrayBuffer())
    assert.ok(body.length > 0, '中间某一段返回了空 body，会导致播放器卡住')
    parts.push(body)
    offset += body.length
    requests += 1
    assert.ok(requests < 10000, '分块循环没有前进')
  }
  const assembled = Buffer.concat(parts)
  assert.equal(assembled.length, whole.length)
  assert.equal(hashOf(assembled), hashOf(whole))
})

test('真实 mp3：无 Range 的整文件响应与文件完全一致（下载路径）', async (t) => {
  const file = sampleFile()
  if (file === undefined) {
    t.skip('没有可用的真实 mp3 素材')
    return
  }
  const whole = readFileSync(file)
  const response = await request(file)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(whole.length))
  assert.equal(hashOf(Buffer.from(await response.arrayBuffer())), hashOf(whole))
})

test('真实文件：后缀区间取到文件最后 N 字节；越界回 416', async (t) => {
  const file = sampleFile()
  if (file === undefined) {
    t.skip('没有可用的真实 mp3 素材')
    return
  }
  const whole = readFileSync(file)
  const tail = await request(file, 'bytes=-100')
  assert.equal(tail.status, 206)
  assert.equal(
    hashOf(Buffer.from(await tail.arrayBuffer())),
    hashOf(whole.subarray(whole.length - 100)),
  )

  const beyond = await request(file, `bytes=${whole.length + 10}-`)
  assert.equal(beyond.status, 416)
  assert.equal(beyond.headers.get('content-range'), `bytes */${whole.length}`)
})

test('真实大文件：跨多个 206 分块与整文件流式读取都字节精确', async (t) => {
  await fsp.mkdir(TMP_DIR, { recursive: true })
  const big = path.join(TMP_DIR, 'synthetic.mp4')
  const payload = Buffer.alloc(3 * 1024 * 1024 + 7)
  for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251
  await fsp.writeFile(big, payload)
  t.after(async () => {
    await fsp.rm(TMP_DIR, { recursive: true, force: true })
  })

  const window = 1024 * 1024
  const localCfg = resolveConfig({ stream: { maxChunkBytes: window, streamChunkBytes: 256 * 1024 } })

  // ① 播放器式的连续分块。
  const parts = []
  let offset = 0
  while (offset < payload.length) {
    const url = `http://127.0.0.1:19387/api/media?path=${encodeURIComponent(big)}`
    const response = await serveMedia(new Request(url, { headers: { range: `bytes=${offset}-` } }), ctx, localCfg)
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-type'), 'video/mp4')
    const body = Buffer.from(await response.arrayBuffer())
    assert.ok(body.length <= window, '单次响应不得超过配置上限')
    parts.push(body)
    offset += body.length
  }
  assert.equal(hashOf(Buffer.concat(parts)), hashOf(payload))

  // ② 无 Range 的整文件：内部多窗口流式，结果仍须一致。
  const full = await serveMedia(
    new Request(`http://127.0.0.1:19387/api/media?path=${encodeURIComponent(big)}`),
    ctx,
    localCfg,
  )
  assert.equal(full.status, 200)
  assert.equal(hashOf(Buffer.from(await full.arrayBuffer())), hashOf(payload))
})

test('真实目录：扫描到素材目录里的 mp3，大小与文件系统一致', async (t) => {
  if (!existsSync(SAMPLE_DIR)) {
    t.skip('没有素材目录')
    return
  }
  const result = await scanMediaRoot({
    fs: ctx.fs,
    root: SAMPLE_DIR,
    limits: { ...resolveConfig(undefined).library },
  })
  const mp3 = result.files.filter((file) => file.extension === 'mp3')
  assert.ok(mp3.length > 0, '应当扫到 mp3')
  for (const file of mp3) {
    assert.equal(file.kind, 'audio')
    assert.equal(file.bytes, readFileSync(file.absolutePath).length)
    assert.equal(file.name.includes('\\'), false)
  }
  assert.deepEqual(result.errors, [])
})

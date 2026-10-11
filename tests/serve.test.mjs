/**
 * 宿主路由的行为测试。
 *
 * 直接驱动真实的 `Request` / `Response` 对象（Node 内建），所以断言的是**真正的
 * HTTP 语义**：状态码、`Content-Range`、`Accept-Ranges`、实际发出的字节数。
 * 这一层是本插件最该被测死的地方 —— 视频能不能拖进度条，全在这里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INDEX_ROUTE, STREAM_ROUTE, serveIndex, serveMedia } from '../lib/index.js'
import { resolveConfig } from '../lib/config.mjs'
import { createFakeCtx, createFakeFs, rangeRequest } from './support/fake-fs.mjs'

/** 12 字节的"文件"：字节值等于下标，便于逐字节核对。 */
const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
const VIDEO = 'C:\\ws\\clip.mp4'

/**
 * 造一个只有 clip.mp4 的 ctx。
 *
 * @param options - `{ type, maxChunkBytes, withWorkspaces }`。
 * @returns `{ ctx, cfg }`。
 */
function harness(options = {}) {
  const fs = createFakeFs({
    [VIDEO]: { bytes: BYTES, type: options.type },
    'C:\\ws\\song.mp3': { bytes: new Uint8Array([9, 9, 9]) },
  })
  const workspaces = options.withWorkspaces === false ? undefined : [{ path: 'C:\\ws', title: '工作区' }]
  const ctx = createFakeCtx(fs, workspaces)
  const cfg = resolveConfig(
    options.maxChunkBytes === undefined ? undefined : { stream: { maxChunkBytes: options.maxChunkBytes } },
  )
  return { ctx, cfg, fs }
}

/**
 * 拼一个 /api/media 请求。
 *
 * @param path - path 查询参数。
 * @param range - Range 头。
 * @param method - 方法。
 * @returns Request。
 */
function mediaRequest(path, range, method = 'GET') {
  const url = `http://127.0.0.1:19387${STREAM_ROUTE}?path=${encodeURIComponent(path)}`
  return rangeRequest(url, range, method)
}

test('缺少 path → 400', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(new Request(`http://x${STREAM_ROUTE}`), ctx, cfg)
  assert.equal(response.status, 400)
  assert.equal(await response.text(), 'missing path')
})

test('相对路径 → 400（这条路由不接受可被 cwd 解释的路径）', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest('clip.mp4'), ctx, cfg)
  assert.equal(response.status, 400)
  assert.equal(await response.text(), 'absolute path required')
})

test('含 NUL → 400', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest('C:\\ws\\clip.mp4\0.txt'), ctx, cfg)
  assert.equal(response.status, 400)
})

test('非媒体后缀 → 415，绝不变成任意文件读取器', async () => {
  const { ctx, cfg } = harness()
  for (const path of ['C:\\ws\\.credentials.yaml', 'C:\\ws\\id_rsa', 'C:\\ws\\a.txt']) {
    const response = await serveMedia(mediaRequest(path), ctx, cfg)
    assert.equal(response.status, 415, path)
    assert.equal(await response.text(), 'unsupported media extension')
  }
})

test('文件不存在 → 404；目录 → 403', async () => {
  const { ctx, cfg } = harness()
  const missing = await serveMedia(mediaRequest('C:\\ws\\nope.mp4'), ctx, cfg)
  assert.equal(missing.status, 404)

  const directory = harness({ type: 'directory' })
  const response = await serveMedia(mediaRequest(VIDEO), directory.ctx, directory.cfg)
  assert.equal(response.status, 403)
  assert.equal(await response.text(), 'not a regular file')
})

test('HEAD → 200、Content-Length 为整体大小、无 body', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, undefined, 'HEAD'), ctx, cfg)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(BYTES.length))
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(await response.text(), '')
})

test('无 Range → 200 完整实体，body 逐字节正确', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO), ctx, cfg)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(BYTES.length))
  assert.equal(response.headers.get('content-range'), null)
  const body = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...body], [...BYTES])
})

test('单区间 → 206 + Content-Range，字节切片精确', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=2-5'), ctx, cfg)
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 2-5/${BYTES.length}`)
  assert.equal(response.headers.get('content-length'), '4')
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  const body = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...body], [2, 3, 4, 5])
})

test('`bytes=0-`（播放器的第一次请求）被裁到 maxChunkBytes，且 Content-Range 如实反映', async () => {
  // 配置层对 maxChunkBytes 有 64 KiB 的下界（一个 5 字节的窗口是病态配置），
  // 所以这里用一个大于该下界的文件来观察真实的裁剪行为。
  const chunk = 64 * 1024
  const big = new Uint8Array(chunk + 100).map((_value, index) => index % 251)
  const fs = createFakeFs({ [VIDEO]: { bytes: big } })
  const ctx = createFakeCtx(fs, [{ path: 'C:\\ws' }])
  const cfg = resolveConfig({ stream: { maxChunkBytes: chunk } })

  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=0-'), ctx, cfg)
  assert.equal(response.status, 206)
  // 请求的是"到末尾"，实际只给第一个窗口 —— HTTP 允许少给，播放器据此继续要下一段。
  assert.equal(response.headers.get('content-range'), `bytes 0-${chunk - 1}/${big.length}`)
  assert.equal(response.headers.get('content-length'), String(chunk))
  const body = new Uint8Array(await response.arrayBuffer())
  assert.equal(body.length, chunk)
  assert.deepEqual([...body.slice(0, 8)], [...big.slice(0, 8)])

  // 第二段接着要：偏移 chunk 起，只剩 100 字节。
  const next = await serveMedia(mediaRequest(VIDEO, `bytes=${chunk}-`), ctx, cfg)
  assert.equal(next.headers.get('content-range'), `bytes ${chunk}-${big.length - 1}/${big.length}`)
  assert.equal((await next.arrayBuffer()).byteLength, 100)
})

test('末尾附近：结束位置超出实体时按实际读到的字节写 Content-Range', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=10-'), ctx, cfg)
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 10-11/${BYTES.length}`)
  assert.deepEqual([...(new Uint8Array(await response.arrayBuffer()))], [10, 11])
})

test('后缀区间 → 206，取的是文件尾部', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=-3'), ctx, cfg)
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 9-11/${BYTES.length}`)
  assert.deepEqual([...(new Uint8Array(await response.arrayBuffer()))], [9, 10, 11])
})

test('起点越界 → 416 + `bytes */size`', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=999-'), ctx, cfg)
  assert.equal(response.status, 416)
  assert.equal(response.headers.get('content-range'), `bytes */${BYTES.length}`)
})

test('语法错误的 Range 被忽略 → 200 完整实体（不是 416）', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=nonsense'), ctx, cfg)
  assert.equal(response.status, 200)
  assert.equal((await response.arrayBuffer()).byteLength, BYTES.length)
})

test('多区间只服务第一个', async () => {
  const { ctx, cfg } = harness()
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=1-2, 5-6'), ctx, cfg)
  assert.equal(response.headers.get('content-range'), `bytes 1-2/${BYTES.length}`)
  assert.deepEqual([...(new Uint8Array(await response.arrayBuffer()))], [1, 2])
})

test('底层权限错误被映射成 403，而不是 500', async () => {
  const { ctx, cfg } = harness()
  const original = ctx.fs.readByteRange
  ctx.fs.readByteRange = async () => {
    const error = new Error('denied')
    error.code = 'FS_PERMISSION_DENIED'
    throw error
  }
  const response = await serveMedia(mediaRequest(VIDEO, 'bytes=0-1'), ctx, cfg)
  assert.equal(response.status, 403)
  assert.equal(await response.text(), 'FS_PERMISSION_DENIED')
  ctx.fs.readByteRange = original
})

test('整文件流式读取：分多次窗口读完，内存不随文件大小增长', async () => {
  const window = 64 * 1024
  const big = new Uint8Array(window * 2 + 10).map((_value, index) => index % 7)
  const fs = createFakeFs({ [VIDEO]: { bytes: big } })
  const ctx = createFakeCtx(fs, [{ path: 'C:\\ws' }])
  const cfg = resolveConfig({ stream: { streamChunkBytes: window } })

  const response = await serveMedia(mediaRequest(VIDEO), ctx, cfg)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), String(big.length))
  const body = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...body], [...big])
  // 3 个窗口（64K + 64K + 10 字节），而不是一次 readBytes 把整个文件搬进内存。
  assert.equal(fs.calls.readByteRange, 3)
})

test('媒体清单：返回工作区里的音视频并标注类别与大小', async () => {
  const { ctx, cfg } = harness()
  const url = `http://127.0.0.1:19387${INDEX_ROUTE}`
  const response = await serveIndex(new Request(url), ctx, cfg, { key: '', at: 0, value: undefined })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  const payload = await response.json()
  assert.equal(payload.streamRoute, STREAM_ROUTE)
  assert.deepEqual(
    payload.files.map((file) => `${file.name}:${file.kind}:${file.bytes}`),
    ['clip.mp4:video:12', 'song.mp3:audio:3'],
  )
  assert.equal(payload.roots[0].label, '工作区')
})

test('媒体清单：不接受 ?root 参数（能力面刻意收敛到"只看工作区"）', async () => {
  const { ctx, cfg } = harness()
  const base = `http://127.0.0.1:19387${INDEX_ROUTE}`
  const cache = { key: '', at: 0, value: undefined }
  const response = await serveIndex(
    new Request(`${base}?root=${encodeURIComponent('C:\\Windows')}`),
    ctx,
    cfg,
    cache,
  )
  assert.equal(response.status, 400)
  assert.equal(await response.text(), 'root parameter is not supported')
})

test('媒体清单：第二次相同请求命中短时缓存，不再扫盘', async () => {
  const { ctx, cfg, fs } = harness()
  const base = `http://127.0.0.1:19387${INDEX_ROUTE}`
  const cache = { key: '', at: 0, value: undefined }
  await serveIndex(new Request(base), ctx, cfg, cache)
  const afterFirst = fs.calls.listDir
  await serveIndex(new Request(base), ctx, cfg, cache)
  assert.equal(fs.calls.listDir, afterFirst)
  // refresh=1 强制重扫。
  await serveIndex(new Request(`${base}?refresh=1`), ctx, cfg, cache)
  assert.ok(fs.calls.listDir > afterFirst)
})

test('媒体清单：没有注册工作区时回落到 cwd，而不是 500', async () => {
  const { ctx, cfg } = harness({ withWorkspaces: false })
  const response = await serveIndex(
    new Request(`http://127.0.0.1:19387${INDEX_ROUTE}`),
    ctx,
    cfg,
    { key: '', at: 0, value: undefined },
  )
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.roots.length, 1)
  assert.equal(payload.roots[0].label, 'cwd')
})

test('后端报不出文件大小时：未知长度流式送出，而不是假装文件是空的', async () => {
  // 这是曾经的静默错误：把"没有 size"当成 0，就会回一个 Content-Length: 0 的
  // 空响应 —— 看起来像"文件是空的"。契约里 size 是可选的，必须处理。
  const { cfg } = harness()
  const fs = createFakeFs({ [VIDEO]: { bytes: BYTES, noSize: true } })
  const ctx = createFakeCtx(fs, [{ path: 'C:\\ws' }])

  const response = await serveMedia(mediaRequest(VIDEO), ctx, cfg)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), null)
  assert.equal(response.headers.get('accept-ranges'), null, '不知道总长就不该宣告分段能力')
  assert.deepEqual([...(new Uint8Array(await response.arrayBuffer()))], [...BYTES])

  const head = await serveMedia(mediaRequest(VIDEO, undefined, 'HEAD'), ctx, cfg)
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), null)
})

test('未分类异常：500 只回固定文案，不把内部消息或路径泄漏给浏览器', async () => {
  const { cfg } = harness()
  const fs = createFakeFs({ [VIDEO]: { bytes: BYTES } })
  fs.resolve = async () => {
    throw new Error('backend exploded at C:\\Users\\someone\\.dsh\\.credentials.yaml')
  }
  const ctx = createFakeCtx(fs, [{ path: 'C:\\ws' }])
  const response = await serveMedia(mediaRequest(VIDEO), ctx, cfg)
  assert.equal(response.status, 500)
  assert.equal(await response.text(), 'internal error')
})

test('所有响应都带加固头（nosniff / 私有缓存 / CSP sandbox）', async () => {
  const { ctx, cfg } = harness()
  for (const response of [
    await serveMedia(mediaRequest(VIDEO), ctx, cfg),
    await serveMedia(mediaRequest(VIDEO, 'bytes=0-1'), ctx, cfg),
    await serveMedia(mediaRequest('C:\\ws\\nope.mp4'), ctx, cfg),
    await serveMedia(mediaRequest('C:\\ws\\a.txt'), ctx, cfg),
    await serveIndex(
      new Request(`http://127.0.0.1:19387${INDEX_ROUTE}`),
      ctx,
      cfg,
      { key: '', at: 0, value: undefined },
    ),
  ]) {
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `status ${response.status}`)
    assert.equal(response.headers.get('cache-control'), 'private, no-store', `status ${response.status}`)
    assert.equal(
      response.headers.get('content-security-policy'),
      "sandbox; default-src 'none'",
      `status ${response.status}`,
    )
  }
})

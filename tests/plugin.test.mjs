/**
 * 宿主插件装配测试。
 *
 * 前面的用例直接调 `serveMedia` / `serveIndex`，绕过了"插件到底往宿主注册了什么"。
 * 这一段补上：`apply()` 是不是在 `connection.fetch` 上按正确的形状注册了两条路由、
 * 配置是不是从 profile 补丁里读到并生效。装配错了的症状是"文件认领了但 404"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../lib/index.js'
import { createFakeFs } from './support/fake-fs.mjs'

/**
 * 造一个够用的宿主 root ctx。
 *
 * @param options - `{ fs }`。
 * @returns `{ root, routes, effects }`。
 */
function createHostRoot(options = {}) {
  const routes = []
  const effects = []
  const fs = options.fs ?? createFakeFs({ 'C:\\ws\\a.mp4': { bytes: new Uint8Array(8) } })

  const ctx = {
    fs,
    get(name) {
      if (name === 'workspaceRegistry') return { list: () => [{ path: 'C:\\ws' }] }
      return undefined
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    },
    effect(callback, label) {
      effects.push(label)
      return callback()
    },
  }

  const root = {
    inject(services, callback) {
      for (const name of services) {
        assert.ok(name === 'connection' || name === 'fs', `未预期的依赖: ${name}`)
      }
      callback(ctx)
    },
  }

  return { root, routes, effects, ctx }
}

test('插件导出形状：name + apply', () => {
  assert.equal(plugin.name, 'dsh-media-preview')
  assert.equal(typeof plugin.apply, 'function')
})

test('apply() 在鉴权 fetch 通道上注册两条路由，方法与路径正确', () => {
  const { root, routes, effects } = createHostRoot()
  plugin.apply(root, undefined)

  assert.equal(routes.length, 2)
  const stream = routes.find((route) => route.path === '/api/media')
  const index = routes.find((route) => route.path === '/api/media-index')
  assert.ok(stream, '缺少 /api/media')
  assert.ok(index, '缺少 /api/media-index')

  // GET 与 HEAD 都必须放行：播放器取数据前会先探一次元数据。
  assert.deepEqual(stream.methods, ['GET', 'HEAD'])
  assert.deepEqual(index.methods, ['GET'])
  assert.equal(stream.requestBody, 'buffered')
  assert.equal(index.requestBody, 'buffered')
  assert.equal(typeof stream.fetch, 'function')
  assert.equal(typeof index.fetch, 'function')
  // 两个 effect 都带标签，热重载时能对上账。
  assert.equal(effects.length, 2)
  assert.ok(effects.every((label) => typeof label === 'string' && label.startsWith('dsh-media-preview:')))
})

test('注册出去的 handler 真的能服务：Range 请求拿到 206', async () => {
  const { root, routes } = createHostRoot()
  plugin.apply(root, undefined)
  const stream = routes.find((route) => route.path === '/api/media')

  const url = `http://127.0.0.1:19387/api/media?path=${encodeURIComponent('C:\\ws\\a.mp4')}`
  const response = await stream.fetch(new Request(url, { headers: { range: 'bytes=0-3' } }))
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/8')
  assert.equal((await response.arrayBuffer()).byteLength, 4)

  const head = await stream.fetch(new Request(url, { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), '8')
})

test('profile 补丁里的配置生效（streamChunkBytes 只影响读取窗口，不裁响应）', async () => {
  // 窗口取配置下界 64 KiB，文件 100 KiB：响应必须是**整个请求区间**（100 KiB），
  // 但内部按 64 KiB 窗口分两次读 —— 内存有界，而响应完整。
  const size = 100 * 1024
  const bytes = new Uint8Array(size).map((_value, index) => index % 253)
  const { root, routes } = createHostRoot({ fs: createFakeFs({ 'C:\\ws\\big.mp4': { bytes } }) })
  plugin.apply(root, { stream: { streamChunkBytes: 65536 } })

  const stream = routes.find((route) => route.path === '/api/media')
  const url = `http://127.0.0.1:19387/api/media?path=${encodeURIComponent('C:\\ws\\big.mp4')}`
  const response = await stream.fetch(new Request(url, { headers: { range: 'bytes=0-' } }))
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), `bytes 0-${size - 1}/${size}`)
  assert.equal(response.headers.get('content-length'), String(size))
  assert.equal((await response.arrayBuffer()).byteLength, size)
})

test('非法配置只回落默认值，不让路由注册失败', () => {
  const { root, routes } = createHostRoot()
  plugin.apply(root, { stream: { streamChunkBytes: 'x', 未知字段: 1 }, library: { maxFiles: -3 } })
  assert.equal(routes.length, 2)
})

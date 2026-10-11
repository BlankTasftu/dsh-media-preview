/**
 * dsh-media-preview —— 宿主半侧。
 *
 * ─── 这一半只做一件事：把"工作区里的媒体文件"变成一个浏览器能播的 URL ──────
 * 浏览器侧的 `<video>` / `<audio>` 想要的是**支持 Range 的 HTTP 资源**：能 206、
 * 能拖进度条、能边下边播。DSH 内建的 `/api/file` 做不到 —— 它 `readBytes` 整个
 * 文件后 200 返回，并且在 `maxImageBytes`（默认 20 MiB）处直接 413，所以
 * 一个 30 MB 的 mp4 既播不了也拖不动。
 *
 * 于是本插件在**同一条鉴权通道**上挂两个新路由：
 *
 *   GET|HEAD /api/media?path=<绝对路径>      带 Range / 206 / 416 的单文件流
 *   GET      /api/media-index[?root=<目录>]  工作区媒体清单（JSON）
 *
 * ─── 为什么挂在 `ctx.connection.fetch` 而不是 `ctx.webServer` ─────────────
 * `connection.fetch` 是 DSH 的**鉴权 fetch 通道**：它已经替我们做了
 * ① 回环 / `trustedHosts` 的主机栅栏，② `Origin` 与 `sec-fetch-site` 校验，
 * ③ 签名 cookie 的验证（未带 cookie 直接 401）。自己用 `webServer` 重写这三条
 * 既有写错的风险，也会和宿主的安全模型分叉。内建 `/api/file` 走的就是这条路。
 *
 * ─── 安全边界（重要，别只看"有鉴权"）────────────────────────────────────
 * 1. **后缀白名单**：只服务 `media-formats.mjs` 列出的媒体后缀，其余一律 415。
 *    内建 `/api/file` 明确写着"目录包含关系与 MIME 类别均不限制访问"，也就是
 *    带上 cookie 就能读任意绝对路径 —— 本插件不继承这个性质。
 * 2. **只读、只 GET/HEAD**：没有写路径。
 * 3. **读经 `ctx.fs`**：路径解析、访问策略与沙箱判定仍由组合文件系统执行，
 *    与本机磁盘直读相比不越过它自己的规则。
 * 4. 响应带 `X-Content-Type-Options: nosniff` 与 `Cache-Control: private, no-store`。
 */
import { win32, posix } from 'node:path'
import { isMediaPath, mediaMimeOf } from './media-formats.mjs'
import {
  RANGE_OK,
  RANGE_UNSATISFIABLE,
  clampWindow,
  formatContentRange,
  formatUnsatisfiedRange,
  parseByteRange,
  windowLength,
} from './range.mjs'
import { scanMediaRoots } from './media-scan.mjs'
import { resolveConfig } from './config.mjs'

/** 两个路由的固定路径；客户端 bundle 里有一份必须一致的副本（有测试守着）。 */
export const STREAM_ROUTE = '/api/media'
export const INDEX_ROUTE = '/api/media-index'

/**
 * 所有响应都带的加固头。
 *
 * `Content-Security-Policy: sandbox; default-src 'none'` 与内建 `/api/file` 一致：
 * 本插件只可能返回白名单内的媒体 MIME，正常路径下这条头不会生效；它的作用是
 * 万一将来有人把非媒体内容塞进这条路（或浏览器对某个 MIME 做了意外解释），
 * 响应也绝不能被当作可执行文档打开。
 */
const HARDENING_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
}

/** `ctx.fs` 的错误码 → HTTP 状态（与内建 `/api/file` 的映射保持一致）。 */
const FS_STATUS = {
  FS_NOT_FOUND: 404,
  FS_NOT_REGULAR_FILE: 403,
  FS_PERMISSION_DENIED: 403,
  FS_SANDBOX_DENIED: 403,
  FS_TOO_LARGE: 413,
  FS_ABORTED: 499,
}

/**
 * 纯文本失败响应。HEAD 不带 body（与内建路由同样的处理）。
 *
 * @param request - 原始 Request。
 * @param status - HTTP 状态码。
 * @param text - 诊断文本。
 * @returns Response。
 */
function fail(request, status, text) {
  const headers = { ...HARDENING_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
  return new Response(request.method === 'HEAD' ? null : text, { status, headers })
}

/**
 * 是不是一个绝对路径。
 *
 * 用 `node:path` 的两种风味分别判定，而不是只看当前平台：组合文件系统可能是
 * 远程执行世界，路径风味未必等于本机。
 *
 * @param value - 待判定的路径。
 * @returns 绝对则 true。
 */
function isAbsoluteAnywhere(value) {
  return win32.isAbsolute(value) || posix.isAbsolute(value)
}

/**
 * 把未知异常归一化成 HTTP 响应。
 *
 * 500 只回一句固定文案：异常消息里可能带本机路径或后端细节，而这条响应会
 * 走进浏览器。已经分类过的文件系统错误仍然回稳定的错误码（与内建 `/api/file`
 * 同一口径），那些码本身不含路径。
 *
 * @param request - 原始 Request。
 * @param error - 抛出的异常。
 * @returns Response。
 */
function failFromError(request, error) {
  const code = typeof error === 'object' && error !== null ? error?.code : undefined
  if (typeof code === 'string' && Object.hasOwn(FS_STATUS, code)) {
    return fail(request, FS_STATUS[code], code)
  }
  return fail(request, 500, 'internal error')
}

/**
 * 无 Range 的整文件请求：按固定窗口流式读出，内存不随文件大小增长。
 *
 * 之所以要流式而不是一次 `readBytes`：整文件请求常见于"下载"按钮，几百 MB 的
 * 片子不该整个进内存。宿主侧确认是 `for await (const chunk of response.body)`
 * 逐块写出的，所以 `ReadableStream` 身体会被如实流下去。
 *
 * @param fs - 组合文件系统。
 * @param target - 已解析的目标。
 * @param size - 文件总字节数。
 * @param chunkBytes - 每次读取的窗口大小。
 * @param signal - 请求取消信号。
 * @returns 响应体流。
 */
function streamWholeFile(fs, target, size, chunkBytes, signal) {
  let offset = 0
  return new ReadableStream({
    async pull(controller) {
      try {
        if (offset >= size) {
          controller.close()
          return
        }
        const length = Math.min(chunkBytes, size - offset)
        const data = await fs.readByteRange(target, { offset, length }, signal)
        if (!data || data.length === 0) {
          controller.close()
          return
        }
        offset += data.length
        controller.enqueue(data)
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * 未知长度实体的流式读取：一直读到后端给出空窗口为止。
 *
 * 为什么需要它：`ctx.fs` 的 `stat` 允许报不出 `size`（远程提供方就可能这样）。
 * 若把"没有 size"当成 0，路由会回一个 `Content-Length: 0` 的空响应 —— 一个
 * 静默的、看起来"文件是空的"的错误。这里改成未知长度的分块响应：Range 无法
 * 计算（没有总长就没有 `Content-Range`），所以这条路径不支持分段，但能播。
 *
 * @param fs - 组合文件系统。
 * @param target - 已解析的目标。
 * @param chunkBytes - 每次读取的窗口大小。
 * @param signal - 请求取消信号。
 * @returns 响应体流。
 */
function streamUnknownSize(fs, target, chunkBytes, signal) {
  let offset = 0
  return new ReadableStream({
    async pull(controller) {
      try {
        const data = await fs.readByteRange(target, { offset, length: chunkBytes }, signal)
        if (!data || data.length === 0) {
          controller.close()
          return
        }
        offset += data.length
        controller.enqueue(data)
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * `/api/media` 的实现。
 *
 * @param request - 鉴权通道交给我们的 Request。
 * @param ctx - 已注入 `fs` 的上下文。
 * @param cfg - 解析后的配置。
 * @returns Response。
 */
export async function serveMedia(request, ctx, cfg) {
  const fs = ctx.fs
  let url
  try {
    url = new URL(request.url)
  } catch {
    return fail(request, 400, 'bad request url')
  }

  const path = url.searchParams.get('path')
  if (path === null || path.length === 0) return fail(request, 400, 'missing path')
  // NUL 会截断下游的文件系统调用；相对路径没有可用的基准目录。
  if (path.includes('\0')) return fail(request, 400, 'invalid path')
  if (!isAbsoluteAnywhere(path)) return fail(request, 400, 'absolute path required')
  // 白名单在鉴权之后仍然生效：这条路由不是"任意文件读取器"。
  if (!isMediaPath(path)) return fail(request, 415, 'unsupported media extension')

  try {
    const target = await fs.resolve(path, { signal: request.signal })
    const info = await fs.stat(target, request.signal)
    if (info === undefined) return fail(request, 404, 'not found')
    if (info.type !== 'file') return fail(request, 403, 'not a regular file')

    // `ctx.fs` 的契约里 size 是可选的：报不出大小时不能当成 0（那会回一个
    // 空的 200，看起来像"文件是空的"），必须走未知长度流式路径。
    const size =
      typeof info.size === 'number' && Number.isFinite(info.size) && info.size >= 0
        ? info.size
        : undefined
    const headers = {
      ...HARDENING_HEADERS,
      'Content-Type': mediaMimeOf(path),
    }
    // 只有知道总长才敢宣告分段能力：`Content-Range` 的分母就是它。
    if (size !== undefined) headers['Accept-Ranges'] = 'bytes'

    // 播放器与下载器都会先探一次 HEAD。
    if (request.method === 'HEAD') {
      if (size !== undefined) headers['Content-Length'] = String(size)
      return new Response(null, { status: 200, headers })
    }

    if (size === undefined) {
      return new Response(streamUnknownSize(fs, target, cfg.stream.streamChunkBytes, request.signal), {
        status: 200,
        headers,
      })
    }

    const parsed = parseByteRange(request.headers.get('range'), size)
    if (parsed.kind === RANGE_UNSATISFIABLE) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': formatUnsatisfiedRange(size) },
      })
    }

    if (parsed.kind !== RANGE_OK) {
      // 没有 Range（或 Range 语法错误、按 RFC 应被忽略）→ 200 完整实体。
      headers['Content-Length'] = String(size)
      return new Response(streamWholeFile(fs, target, size, cfg.stream.streamChunkBytes, request.signal), {
        status: 200,
        headers,
      })
    }

    // 合法区间：按单次响应上限"少给"，Content-Range 如实反映实际发出的范围。
    const window = clampWindow(parsed.start, parsed.end, cfg.stream.maxChunkBytes)
    const length = windowLength(window.start, window.end)
    const data = await fs.readByteRange(target, { offset: window.start, length }, request.signal)
    if (!data || data.length === 0) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': formatUnsatisfiedRange(size) },
      })
    }
    const end = window.start + data.length - 1
    headers['Content-Range'] = formatContentRange(window.start, end, size)
    headers['Content-Length'] = String(data.length)
    // `slice()` 复制一份，避免把后端可能复用的缓冲区直接交出去。
    return new Response(data.slice(), { status: 206, headers })
  } catch (error) {
    return failFromError(request, error)
  }
}

/** 清单结果的短时缓存：面板一次挂载可能问好几遍，重复全盘扫描没有意义。 */
const INDEX_CACHE_TTL_MS = 5000

/**
 * 从工作区注册表取出可扫描的根。
 *
 * @param ctx - 上下文。
 * @returns `{ path, label }[]`。
 */
function workspaceRoots(ctx) {
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
  const roots = []
  if (registry && typeof registry.list === 'function') {
    for (const workspace of registry.list() ?? []) {
      // `Workspace` 暴露 path / title 两个 getter；拿不到路径的条目跳过。
      const path = workspace?.path
      if (typeof path !== 'string' || path === '') continue
      const title = workspace?.title
      const label = typeof title === 'string' && title !== '' ? title : path
      roots.push({ path, label })
    }
  }
  return roots
}

/**
 * `/api/media-index` 的实现。
 *
 * @param request - 鉴权通道交给我们的 Request。
 * @param ctx - 已注入 `fs` 的上下文。
 * @param cfg - 解析后的配置。
 * @param cache - 上一次结果的缓存对象（由插件持有，跨请求复用）。
 * @returns Response（JSON）。
 */
export async function serveIndex(request, ctx, cfg, cache) {
  let url
  try {
    url = new URL(request.url)
  } catch {
    return fail(request, 400, 'bad request url')
  }

  const requestedRoot = url.searchParams.get('root')
  if (requestedRoot !== null) {
    // 曾经支持 `?root=<绝对路径>`，已刻意移除：客户端从不需要它，而它等于
    // "枚举本机任意目录下的媒体文件名"。能力面不该大于功能面。
    return fail(request, 400, 'root parameter is not supported')
  }

  const roots = workspaceRoots(ctx)
  if (roots.length === 0) roots.push({ path: process.cwd(), label: 'cwd' })

  const cacheKey = `${roots.map((entry) => entry.path).join('|')}#${cfg.library.maxFiles}`
  const force = url.searchParams.get('refresh') === '1'
  const now = Date.now()
  if (!force && cache.key === cacheKey && now - cache.at < INDEX_CACHE_TTL_MS && cache.value !== undefined) {
    return jsonResponse(cache.value)
  }

  try {
    const result = await scanMediaRoots({
      fs: ctx.fs,
      roots,
      limits: cfg.library,
      signal: request.signal,
    })
    const payload = {
      roots: result.roots,
      files: result.files,
      truncated: result.truncated,
      errors: result.errors.slice(0, 20),
      streamRoute: STREAM_ROUTE,
      generatedAt: new Date(now).toISOString(),
    }
    cache.key = cacheKey
    cache.at = now
    cache.value = payload
    return jsonResponse(payload)
  } catch (error) {
    return failFromError(request, error)
  }
}

/**
 * JSON 响应。
 *
 * @param payload - 可序列化对象。
 * @returns Response。
 */
function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...HARDENING_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export default {
  name: 'dsh-media-preview',

  /**
   * 不声明硬依赖：缺少 `connection` / `fs` 时插件应当**静默不注册**，
   * 而不是让整个 profile 起不来。所以两个服务都用 `root.inject` 分开等。
   *
   * @param root - 插件根上下文。
   * @param config - profile 补丁那一行的 `config`。
   */
  apply(root, config) {
    const cfg = resolveConfig(config)

    root.inject(['connection', 'fs'], (ctx) => {
      const cache = { key: '', at: 0, value: undefined }

      // 单文件流：Range / 206 / 416 / HEAD。GET 与 HEAD 都必须放行，
      // 播放器在真正取数据前会先探一次元数据。
      ctx.effect(
        () =>
          ctx.connection.fetch.register({
            path: STREAM_ROUTE,
            methods: ['GET', 'HEAD'],
            requestBody: 'buffered',
            fetch: (request) => serveMedia(request, ctx, cfg),
          }),
        'dsh-media-preview: /api/media',
      )

      // 媒体清单：媒体库面板用它列出工作区里所有可播的文件。
      ctx.effect(
        () =>
          ctx.connection.fetch.register({
            path: INDEX_ROUTE,
            methods: ['GET'],
            requestBody: 'buffered',
            fetch: (request) => serveIndex(request, ctx, cfg, cache),
          }),
        'dsh-media-preview: /api/media-index',
      )
    })
  },
}

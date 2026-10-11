/**
 * dsh-media-preview —— 浏览器半侧。
 *
 * ─── 这个文件为什么是"手写产物"而不是打包结果 ──────────────────────────────
 * DSH 的客户端模块系统只认一种形态：`window.__ModuleLoader__.load({ id, factory })`。
 * 执行它只**注册** factory，模块副作用留到真正被 import 时。`dsh.client.platform
 * = 'web'` 指向本文件，宿主在 `/plugins` 下按包名提供它。因此这里没有 `import`，
 * 只有 `require`（而且只能 require 基座里有的东西：本插件只 require `react`）。
 *
 * ─── 它往一个座位上放东西 ──────────────────────────────────────────────────
 * **右侧 Sidebar 的文档预览**（也是唯一的功能面）。DSH 内建的
 *    `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 已经认领了
 *    `dsh-resource://file/**` 这个 tab 类型 —— 也就是说"点文件 → 右侧预览"这条路
 *    本来就是通的，它只是**没有能播音视频的渲染器**：mp4/mp3/wav/flac… 全在它的
 *    `UNVIEWABLE_BINARY_EXTENSIONS` 里，于是显示"暂不支持预览此文件类型"并且
 *    一个字节都不读。我们要做的只有一件事：用 `ctx.documentPreviews.register`
 *    把这些后缀认领下来，再把正文注册进 keyed slot `sidebar.right.tab.document`
 *    （key 必须等于同一个 id）。**不要**再注册新的 tab 类型：那是另一条路，
 *    而且会让同一个文件在两个 tab 里各开一份。
 *
 *    加载模式选 `loading: 'renderer'` —— 这是唯一"owner 不替你读字节"的模式，
 *    正好适合媒体：把 `<video src>` 直接指向支持 Range 的 HTTP 路由，
 *    浏览器自己去流式取、自己拖进度条，字节永远不经过 JS。
 *
 *    0.3.0 起**不再有左侧"媒体库"面板**：那是我额外加的便利面，而右侧 Files 树
 *    本来就能浏览工作区；为它多维护一条扫描路由与一整块 UI 不划算。
 *
 * ─── 宿主依赖 ──────────────────────────────────────────────────────────────
 * 取字节指向宿主半侧注册的鉴权路由：
 *   GET /api/media?path=<绝对路径>   带 Range/206，供 <video>/<audio> 直接当 src
 * 路径来自 `useResource(address).value.absolutePath`（DSH 的 file 资源协议），
 * 不自己拼 `dsh-resource://` 地址 —— 那套编码是 `dsh-util-workspace-path` 的私事。
 */

window.__ModuleLoader__.load({
  id: 'dsh-media-preview',

  factory: (require) => {
    var __modules = Object.create(null)
    var __cache = Object.create(null)

    __modules['./index.js'] = function (module, exports, require, __load_) {
      'use strict'
      Object.defineProperty(exports, '__esModule', { value: true })

      const React = require('react')

      // ─────────────────────────────────────────────────────────── 常量

      /** i18n 命名空间。 */
      const NS = 'dshMediaPreview'
      /** 本 bundle 的包名（客户端模块身份）。 */
      const PACKAGE_NAME = 'dsh-media-preview'
      /** documentPreviews 实现 id，同时是正文 slot 的 key。 */
      const MEDIA_ID = 'dsh-media-preview/media'
      /** 宿主流路由（与 lib/index.js 的 STREAM_ROUTE 一致）。 */
      const STREAM_ROUTE = 'api/media'

      /**
       * 格式表 —— **必须与宿主 `lib/media-formats.mjs` 完全一致**。
       * client bundle 不能 import 宿主模块，只能抄一份；`tests/format-parity.test.mjs`
       * 会把两份解析出来逐项比对，改漏一边会当场失败。
       */
      const VIDEO_MIME = {
        mp4: 'video/mp4',
        m4v: 'video/x-m4v',
        mov: 'video/quicktime',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        avi: 'video/x-msvideo',
        wmv: 'video/x-ms-wmv',
        flv: 'video/x-flv',
        f4v: 'video/x-f4v',
        mpg: 'video/mpeg',
        mpeg: 'video/mpeg',
        m2v: 'video/mpeg',
        // 与宿主保持一致：**故意不认领 `ts` 与 `mts`**。
        // 它们是 TypeScript（`.d.ts` / `.mts` 模块），而本注册的优先级高于内建
        // 渲染器与纯文本兜底 —— 认领它们会让 `.ts` 源码被当成视频打开。
        m2ts: 'video/mp2t',
        '3gp': 'video/3gpp',
        '3g2': 'video/3gpp2',
        ogv: 'video/ogg',
        rm: 'application/vnd.rn-realmedia',
        rmvb: 'application/vnd.rn-realmedia-vbr',
        asf: 'video/x-ms-asf',
        vob: 'video/dvd',
        divx: 'video/divx',
        mxf: 'application/mxf',
        dv: 'video/dv',
        wtv: 'video/wtv',
      }
      const AUDIO_MIME = {
        mp3: 'audio/mpeg',
        mp2: 'audio/mpeg',
        mpga: 'audio/mpeg',
        m4a: 'audio/mp4',
        m4b: 'audio/mp4',
        m4r: 'audio/mp4',
        m4p: 'audio/mp4',
        aac: 'audio/aac',
        wav: 'audio/wav',
        wave: 'audio/wav',
        flac: 'audio/flac',
        ogg: 'audio/ogg',
        oga: 'audio/ogg',
        opus: 'audio/ogg',
        spx: 'audio/ogg',
        weba: 'audio/webm',
        wma: 'audio/x-ms-wma',
        aif: 'audio/aiff',
        aiff: 'audio/aiff',
        aifc: 'audio/aiff',
        amr: 'audio/amr',
        awb: 'audio/amr-wb',
        ac3: 'audio/ac3',
        eac3: 'audio/eac3',
        dts: 'audio/vnd.dts',
        mka: 'audio/x-matroska',
        mid: 'audio/midi',
        midi: 'audio/midi',
        ape: 'audio/x-ape',
        wv: 'audio/x-wavpack',
        tta: 'audio/x-tta',
        caf: 'audio/x-caf',
        au: 'audio/basic',
        snd: 'audio/basic',
        ra: 'audio/vnd.rn-realaudio',
        ram: 'audio/vnd.rn-realaudio',
        '3ga': 'audio/3gpp',
      }
      const MEDIA_MIME = Object.assign({}, VIDEO_MIME, AUDIO_MIME)
      /** 注册给 documentPreviews 的后缀全集。 */
      const MEDIA_EXTENSIONS = Object.keys(VIDEO_MIME).concat(Object.keys(AUDIO_MIME))

      /** 已知 Chromium 内核**结构上**就不支持的容器：报错时先给出这条更准确的解释。 */
      const LIKELY_UNSUPPORTED = {
        mkv: true,
        avi: true,
        wmv: true,
        flv: true,
        rm: true,
        rmvb: true,
        asf: true,
        vob: true,
        divx: true,
        mxf: true,
        dv: true,
        wtv: true,
        wma: true,
        ape: true,
        wv: true,
        tta: true,
        ra: true,
        ram: true,
        '3ga': true,
      }

      // ───────────────────────────────────────────────────── 纯工具函数

      /**
       * 取小写扩展名。
       * @param path - 原生路径。
       * @returns 扩展名或空串。
       */
      function extensionOf(path) {
        const normalized = String(path == null ? '' : path).replace(/\\/g, '/')
        const name = normalized.slice(normalized.lastIndexOf('/') + 1)
        const dot = name.lastIndexOf('.')
        if (dot <= 0 || dot === name.length - 1) return ''
        return name.slice(dot + 1).toLowerCase()
      }

      /**
       * 媒体类别。
       * @param path - 原生路径。
       * @returns `'video'` / `'audio'` / `null`。
       */
      function mediaKindOf(path) {
        const extension = extensionOf(path)
        if (Object.prototype.hasOwnProperty.call(VIDEO_MIME, extension)) return 'video'
        if (Object.prototype.hasOwnProperty.call(AUDIO_MIME, extension)) return 'audio'
        return null
      }

      /**
       * 路径的文件名。
       * @param path - 原生路径。
       * @returns 文件名。
       */
      function baseNameOf(path) {
        const normalized = String(path == null ? '' : path).replace(/\\/g, '/')
        return normalized.slice(normalized.lastIndexOf('/') + 1)
      }

      /**
       * 人读的字节数。
       * @param bytes - 字节数。
       * @returns 例如 `12.4 MB`。
       */
      function humanBytes(bytes) {
        if (typeof bytes !== 'number' || !isFinite(bytes)) return '—'
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
      }

      /**
       * 时长。
       * @param seconds - 秒；NaN/Infinity 返回 `—`。
       * @returns `m:ss` 或 `h:mm:ss`。
       */
      function humanDuration(seconds) {
        if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '—'
        const total = Math.floor(seconds)
        const s = total % 60
        const m = Math.floor(total / 60) % 60
        const h = Math.floor(total / 3600)
        const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
        return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0')
      }

      /**
       * 用同一个基准解析应用内 URL。
       *
       * 必须用 `document.baseURI` 的相对解析：桌面端的页面基准是
       * `dsh-app://app/`，Web 端是 `http(s)://host[:port]/`，写成绝对路径
       * `/api/media` 会在带部署前缀时指错地方。内建图片渲染器同样是这么做的。
       *
       * @param route - 相对路由，例如 `api/media`。
       * @param query - 查询参数对象。
       * @returns 绝对 URL 字符串。
       */
      function appUrl(route, query) {
        const params = new URLSearchParams()
        Object.keys(query || {}).forEach((key) => {
          const value = query[key]
          if (value === undefined || value === null || value === '') return
          params.set(key, String(value))
        })
        const suffix = params.toString()
        const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
        return new URL(route + (suffix === '' ? '' : '?' + suffix), base).href
      }

      /** 记忆化的偏好读写：任何异常都不能让播放器崩掉。 */
      const STORE_PREFIX = 'dsh-media-preview:'
      function readPreference(key, fallback) {
        try {
          const raw = window.localStorage.getItem(STORE_PREFIX + key)
          if (raw === null) return fallback
          return JSON.parse(raw)
        } catch (_error) {
          return fallback
        }
      }
      function writePreference(key, value) {
        try {
          window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value))
        } catch (_error) {
          /* 隐私模式/配额满：偏好不持久化而已，不影响播放 */
        }
      }

      // ─────────────────────────────────────────────────────────── 样式

      const CSS = [
        '.dshmp-frame{display:flex;flex-direction:column;flex:1;min-height:0;height:100%}',
        '.dshmp-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit)}',
        '.dshmp-scroll{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}',
        '.dshmp-center{align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:12px;padding:24px;text-align:center}',
        '.dshmp-spinner{width:18px;height:18px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:dshmp-spin .9s linear infinite}',
        '@keyframes dshmp-spin{to{transform:rotate(360deg)}}',
        '.dshmp-stage{background:#000;display:flex;align-items:center;justify-content:center;min-height:0}',
        '.dshmp-stage video{display:block;width:100%;max-height:100%;background:#000}',
        '.dshmp-audio{padding:26px 18px 10px;display:flex;flex-direction:column;align-items:center;gap:14px}',
        '.dshmp-art{width:96px;height:96px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-brand-primary)}',
        '.dshmp-title{font-size:13px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}',
        '.dshmp-sub{font-size:11px;color:var(--dsw-alias-label-secondary)}',
        '.dshmp-audio audio{width:100%;max-width:460px}',
        '.dshmp-bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
        '.dshmp-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;font-family:inherit}',
        '.dshmp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
        '.dshmp-btn:disabled{opacity:.5;cursor:default}',
        '.dshmp-btn[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
        '.dshmp-select{height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-family:inherit;padding:0 4px}',
        '.dshmp-spacer{flex:1}',
        '.dshmp-meta{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;padding:10px 12px;font-size:11px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1)}',
        '.dshmp-meta b{color:var(--dsw-alias-label-primary);font-weight:600}',
        '.dshmp-card{margin:14px;padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.7}',
        '.dshmp-card h4{margin:0 0 6px;font-size:13px}',
        '.dshmp-card ul{margin:6px 0 0;padding-left:18px}',
        '.dshmp-code{font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;word-break:break-all;color:var(--dsw-alias-label-secondary)}',
        '.dshmp-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
        '.dshmp-warn{color:var(--dsw-alias-state-warn-primary)}',
        '.dshmp-progress{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin:8px 0 2px}',
        '.dshmp-progress-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .25s ease}',
        '.dshmp-err{color:var(--dsw-alias-state-error-primary)}',
        '.dshmp-ok{color:var(--dsw-alias-state-success-primary)}',
      ].join('')

      const CSS_TAG_ID = 'dsh-media-preview/styles'

      /** 注入一次样式（与内建渲染器同款做法：带 data-plugin-css 幂等标记）。 */
      function ensureStyles() {
        if (typeof document === 'undefined') return
        if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return
        const style = document.createElement('style')
        style.dataset.plugin = PACKAGE_NAME
        style.dataset.pluginCss = CSS_TAG_ID
        style.textContent = CSS
        document.head.appendChild(style)
      }

      // ───────────────────────────────────────────────────────────── 图标

      /**
       * 线性图标（16 基准）。只画几笔，避免引入图标库依赖。
       * @param props - `{ size, children, viewBox }`。
       * @returns svg 元素。
       */
      function Icon(props) {
        return React.createElement(
          'svg',
          {
            width: props.size || 16,
            height: props.size || 16,
            viewBox: props.viewBox || '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            focusable: 'false',
          },
          props.children,
        )
      }

      /** 音符图标：纯音频用。 */
      function NoteIcon(props) {
        return React.createElement(
          Icon,
          { size: props.size },
          React.createElement('path', { d: 'M6 12.5V4l7-1.5v8' }),
          React.createElement('circle', { cx: 4.2, cy: 12.4, r: 1.8 }),
          React.createElement('circle', { cx: 11.2, cy: 10.9, r: 1.8 }),
        )
      }

      /** 播放图标。 */
      function PlayIcon(props) {
        return React.createElement(
          Icon,
          { size: props.size },
          React.createElement('path', { d: 'M4.5 3.2l8 4.8-8 4.8z', fill: 'currentColor', stroke: 'none' }),
        )
      }

      // ─────────────────────────────────────────────────── 播放器（共用）

      /**
       * 取当前媒体元素的"浏览器自评"。
       *
       * `canPlayType` 返回 `''` / `'maybe'` / `'probably'`，是浏览器自己给的答案 ——
       * 比任何静态表都准，所以诊断里展示它，而不是猜。
       *
       * @param path - 原生路径。
       * @returns `{ mime, verdict, supported }`。
       */
      function probeSupport(path) {
        const extension = extensionOf(path)
        const mime = MEDIA_MIME[extension]
        if (mime === undefined) return { mime: '', verdict: 'unknown', supported: false }
        try {
          const probe = document.createElement(mime.indexOf('video/') === 0 ? 'video' : 'audio')
          const verdict = probe.canPlayType(mime)
          return { mime: mime, verdict: verdict, supported: verdict !== '' }
        } catch (_error) {
          return { mime: mime, verdict: 'unknown', supported: false }
        }
      }

      /**
       * 媒体元素的错误码 → 人话。
       * @param code - `MediaError.code`。
       * @returns 说明 key。
       */
      function mediaErrorKey(code) {
        if (code === 1) return 'errorAborted'
        if (code === 2) return 'errorNetwork'
        if (code === 3) return 'errorDecode'
        if (code === 4) return 'errorUnsupported'
        return 'errorUnknown'
      }

      // ─────────────────────────────────────────── 完整缓冲（流式播放的退路）

      /**
       * 哪些容器值得在"直接流式播放失败"时自动改用完整缓冲。
       *
       * 判据不是"能不能解码"，而是**"失败大概率来自取字节而不是编码"**：
       * mp4/mov/m4a 这类容器常见"索引（moov）在文件末尾"，播放器必须先 seek 到
       * 尾部；如果传输层没有把分段读取送到（例如自定义协议下的媒体请求），
       * Chromium 会直接报 `DEMUXER_ERROR_COULD_NOT_OPEN` —— 明明编码完全可播。
       * 这类文件先取完整字节做成 Blob 就能正常播、也能拖。
       *
       * 反过来，mkv/avi/wmv 这些是**编码层面**就不被 Chromium 支持，取完整文件
       * 也只是白下载几百 MB，所以不自动缓冲，只在诊断卡里给一个手动按钮。
       */
      const BUFFERABLE = {
        mp4: 1, m4v: 1, mov: 1, m4a: 1, m4b: 1, m4r: 1, m4p: 1,
        mp3: 1, mp2: 1, mpga: 1, wav: 1, wave: 1, flac: 1, ogg: 1, oga: 1,
        opus: 1, spx: 1, aac: 1, webm: 1, weba: 1, '3gp': 1, '3g2': 1, ogv: 1,
      }

      /**
       * 自动缓冲的体积上限。超过就不自动做 —— 让用户点按钮，避免为一个几百 MB
       * 的文件静默吃掉同等内存。
       */
      const MAX_AUTO_BUFFER_BYTES = 256 * 1024 * 1024

      /**
       * 后台准备"可拖动版本"的体积上限（1 GiB）。
       *
       * 比上面的自动缓冲上限大得多，因为这条路的取舍不同：它是**边播边取**、
       * 不阻塞观看，取完就换成完全可 seek 的内存 Blob。实测在这个传输层上，
       * 直连流会被浏览器拒绝 seek（"能拖动但位置不变、滑块弹回"），所以对
       * 一个 "想拖进度" 的用户来说，花掉与文件等量的内存是值得的；超过 1 GiB
       * 才退回"流式 + 手动按钮"。
       */
      const WARMUP_MAX_BYTES = 1024 * 1024 * 1024

      /**
       * 从 `Content-Range: bytes a-b/total` 里取出实体总长。
       * @param value - 响应头值。
       * @returns 总字节数，解析不出返回 null。
       */
      function totalFromContentRange(value) {
        if (typeof value !== 'string') return null
        const match = /\/(\d+)\s*$/.exec(value)
        if (match === null) return null
        const total = Number(match[1])
        return Number.isSafeInteger(total) ? total : null
      }

      /**
       * 用带 `Range` 的 fetch 逐段取完整文件，拼成一个可自由 seek 的 Blob。
       *
       * 为什么这条路有效：`Range` 由 JS 显式带上，不依赖浏览器媒体栈是否愿意发
       * 分段请求；服务端本来就会 206。而且它对"服务器忽略 Range 直接回 200 完整
       * 实体"也成立 —— 那时第一段就是全部，循环随即结束。
       *
       * @param url - 流地址。
       * @param options - `{ onProgress, signal }`。
       * @returns `{ parts, transport }`。
       */
      async function bufferWholeFile(url, options) {
        const parts = []
        let offset = 0
        let total = null
        let segments = 0
        let status = 0
        let contentRange = ''
        let acceptRanges = ''

        // 保险丝：正常最多十几次请求；真出问题也不能变成死循环。
        for (let guard = 0; guard < 10000; guard += 1) {
          const response = await fetch(url, {
            headers: { Range: 'bytes=' + String(offset) + '-' },
            credentials: 'same-origin',
            signal: options.signal,
          })
          if (segments === 0) {
            status = response.status
            contentRange = response.headers.get('content-range') || ''
            acceptRanges = response.headers.get('accept-ranges') || ''
            total = totalFromContentRange(contentRange)
          }
          if (response.status !== 200 && response.status !== 206) {
            throw new Error('HTTP ' + String(response.status))
          }
          const chunk = new Uint8Array(await response.arrayBuffer())
          if (chunk.length === 0) break
          parts.push(chunk)
          offset += chunk.length
          segments += 1
          if (options.onProgress) options.onProgress(offset, total, segments)
          if (total !== null && offset >= total) break
          // 服务器忽略了 Range（回 200 且给了整个实体）：一次就够了。
          if (status === 200 && segments === 1) break
        }

        return {
          parts: parts,
          transport: {
            status: status,
            contentRange: contentRange,
            acceptRanges: acceptRanges,
            segments: segments,
            mode: status === 206 ? 'ranged' : 'full',
          },
        }
      }

      /**
       * 这个容器能不能"取完整文件再播"。
       *
       * 与"要不要自动做"分开：大文件不该被静默下载，但用户明确点按钮时应当允许
       * —— 一个 300 MB 的 mp4 若只是索引在末尾，缓冲是唯一能播的路。
       *
       * @param path - 原生路径。
       * @returns 容器适合缓冲时为 true。
       */
      function isBufferable(path) {
        return BUFFERABLE[extensionOf(path)] === 1
      }

      /**
       * 这个文件要不要在直接播放失败后**自动**改用完整缓冲（额外带体积上限）。
       *
       * @param path - 原生路径。
       * @param bytes - 文件大小（未知传 undefined）。
       * @returns 该自动缓冲时为 true。
       */
      function shouldAutoBuffer(path, bytes) {
        if (!isBufferable(path)) return false
        if (typeof bytes === 'number' && bytes > MAX_AUTO_BUFFER_BYTES) return false
        return true
      }

      /**
       * 播放器：视频用 `<video controls>`，音频用 `<audio controls>` + 封面卡。
       *
       * 为什么把原生控件作为主控件：它自带全屏、画中画、字幕、键盘、无障碍与
       * 硬件解码路径，是浏览器里最可靠的播放 UI。额外能力（倍速/循环/截图/
       * 复制路径/下载）放在下面那条工具条里，不替换原生控件。
       *
       * @param props - 见下方解构。
       * @returns 播放器元素。
       */
      function MediaPlayer(props) {
        const t = props.t
        const path = props.path
        const src = props.src
        const kind = mediaKindOf(path) || 'audio'
        const probe = React.useMemo(() => probeSupport(path), [path])

        const [error, setError] = React.useState(null)
        const [state, setState] = React.useState({ duration: NaN, width: 0, height: 0, seekableEnd: 0 })
        /** 用户的拖动没有生效过 —— 用来提示并给出出路。 */
        const [seekFailed, setSeekFailed] = React.useState(false)
        const [rate, setRate] = React.useState(() => {
          const stored = readPreference('rate', 1)
          return typeof stored === 'number' && stored > 0 ? stored : 1
        })
        const [loop, setLoop] = React.useState(() => readPreference('loop', false) === true)
        const [volume, setVolume] = React.useState(() => {
          const stored = readPreference('volume', 1)
          return typeof stored === 'number' && stored >= 0 && stored <= 1 ? stored : 1
        })
        const [muted, setMuted] = React.useState(() => readPreference('muted', false) === true)
        const [notice, setNotice] = React.useState('')
        const [audioOnly, setAudioOnly] = React.useState(kind === 'audio')
        /** 完整缓冲得到的 Blob URL；有它时优先于直连流地址。 */
        const [buffered, setBuffered] = React.useState(null)
        /** 缓冲进度：`{ loaded, total, segments }`；不在缓冲时为 null。 */
        const [buffer, setBuffer] = React.useState(null)
        /** 后台"可拖动版本"的准备进度：`{ loaded, total }`。它不阻塞播放。 */
        const [warmup, setWarmup] = React.useState(null)
        /** 最近一次已知的传输事实（分段 206 还是一次 200），用于诊断与展示。 */
        const [transport, setTransport] = React.useState(null)
        const mediaRef = React.useRef(null)
        const objectUrlRef = React.useRef(null)
        const bufferAbortRef = React.useRef(null)
        /**
         * 本次 src 是否已经自动缓冲过一次。
         *
         * 必须有这道闸：`<video>` 在 `preload="metadata"` 下会**自己**去取元数据，
         * 失败即触发 onError。若用户取消缓冲后元素再次报错又自动缓冲，就会变成
         * "取消 → 重新开始 → 再取消"的死循环。所以自动只做一次，之后一律交给
         * 用户点按钮。
         */
        const autoBufferTriedRef = React.useRef(false)
        /** 拖动探测：记录目标位置，超时未生效即判定"拖不动"。 */
        const seekTimerRef = React.useRef(null)
        const seekTargetRef = React.useRef(null)
        /** 主动探测 `seekable` 的复查定时器（400ms / 1500ms）。 */
        const seekCheckTimersRef = React.useRef([])
        /** 后台准备"可拖动版本"的取消句柄与"本 src 是否已试过"。 */
        const warmupAbortRef = React.useRef(null)
        const warmupTriedRef = React.useRef(false)
        /** 换成 Blob 之后要恢复的播放位置与播放状态。 */
        const resumeRef = React.useRef(null)

        // 路径或流地址一变，旧的错误、旧的缓冲与旧结论全部作废。
        // 这里必须撤销 Blob URL：否则每换一次文件就泄漏一份完整字节。
        React.useEffect(() => {
          setError(null)
          setState({ duration: NaN, width: 0, height: 0, seekableEnd: 0 })
          setAudioOnly(kind === 'audio')
          setBuffered(null)
          setBuffer(null)
          setWarmup(null)
          setTransport(null)
          setSeekFailed(false)
          autoBufferTriedRef.current = false
          warmupTriedRef.current = false
          resumeRef.current = null
          if (warmupAbortRef.current !== null) {
            warmupAbortRef.current.abort()
            warmupAbortRef.current = null
          }
          seekTargetRef.current = null
          clearSeekChecks()
          if (seekTimerRef.current !== null) {
            clearTimeout(seekTimerRef.current)
            seekTimerRef.current = null
          }
          if (bufferAbortRef.current !== null) {
            bufferAbortRef.current.abort()
            bufferAbortRef.current = null
          }
          if (objectUrlRef.current !== null) {
            URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = null
          }
        }, [src, path, kind])

        // 卸载时同样撤销，避免离开预览后 Blob 一直占着内存。
        React.useEffect(
          () => () => {
            if (bufferAbortRef.current !== null) bufferAbortRef.current.abort()
            if (warmupAbortRef.current !== null) warmupAbortRef.current.abort()
            if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current)
            if (seekTimerRef.current !== null) clearTimeout(seekTimerRef.current)
            for (const timer of seekCheckTimersRef.current) clearTimeout(timer)
            seekCheckTimersRef.current = []
          },
          [],
        )

        /**
         * 后台准备"可拖动版本"：**边播边取**，取完换成内存 Blob。
         *
         * ─── 为什么必须有这条路 ────────────────────────────────────────────────
         * 报障是"能拖动，但进度不会变，滑块弹回去" —— 浏览器接受了拖动手势、
         * 却拒绝了这次 seek（`currentTime` 不生效，控件于是回到播放头位置）。
         * 也就是说：**在这个传输层上，"让媒体元素自己去 seek"这条路走不通**，
         * 再把 HTTP 侧修得更对也没用。
         *
         * 而内存里的 Blob URL 是完全可 seek 的资源：时长由容器给出、读取不经过
         * 自定义协议、不存在"数据源拒绝 seek"。所以这里不再等用户失败，也不等
         * 浏览器承认，直接**主动**准备：立刻用流地址起播（不牺牲秒开），同时在
         * 后台把整份取回来，就绪后换成 Blob 并保留播放位置与播放状态。
         *
         * 只对"整份能放进内存"的文件做（上限见 WARMUP_MAX_BYTES）；更大的文件
         * 保持流式播放，并给出手动按钮 —— 那时由用户决定是否为它付出内存。
         */
        React.useEffect(() => {
          if (warmupTriedRef.current) return
          if (typeof props.bytes !== 'number' || props.bytes <= 0) return
          if (props.bytes > WARMUP_MAX_BYTES) return
          // 只为"值得缓冲"的容器准备：mkv/avi/rmvb 这类是编码层面就不被支持，
          // 取完整份也播不出来，白白花掉等量内存（与 isBufferable 同一张表）。
          if (!isBufferable(path)) return
          warmupTriedRef.current = true
          const controller = new AbortController()
          warmupAbortRef.current = controller
          setWarmup({ loaded: 0, total: props.bytes })
          bufferWholeFile(src, {
            signal: controller.signal,
            onProgress: (loaded, total) => setWarmup({ loaded, total }),
          }).then(
            (result) => {
              if (controller.signal.aborted) return
              warmupAbortRef.current = null
              setWarmup(null)
              const element = mediaRef.current
              // 记下当前位置与是否在播，换 src 之后原样恢复 —— 换源不能让用户回到 0 秒。
              resumeRef.current =
                element === null
                  ? null
                  : { time: element.currentTime, playing: element.paused === false }
              const blob = new Blob(result.parts, { type: probe.mime || 'application/octet-stream' })
              const url = URL.createObjectURL(blob)
              if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current)
              objectUrlRef.current = url
              setTransport(result.transport)
              setBuffered({ url: url, bytes: blob.size })
              setSeekFailed(false)
              setNotice(t('warmupReady'))
            },
            (failure) => {
              // 后台准备失败不该影响正常播放：把原因留在控制台，界面保持流式。
              warmupAbortRef.current = null
              setWarmup(null)
              if (typeof console !== 'undefined' && console.warn) {
                console.warn('[dsh-media-preview] 后台准备可拖动版本失败：', failure)
              }
            },
          )
          return () => {
            controller.abort()
          }
        }, [src, path])

        // 偏好落盘。
        React.useEffect(() => {
          writePreference('rate', rate)
        }, [rate])
        React.useEffect(() => {
          writePreference('loop', loop)
        }, [loop])
        React.useEffect(() => {
          writePreference('volume', volume)
        }, [volume])
        React.useEffect(() => {
          writePreference('muted', muted)
        }, [muted])

        // 命令式属性：这些不是 React 受控属性，必须直接写元素。
        React.useEffect(() => {
          const element = mediaRef.current
          if (element === null) return
          element.playbackRate = rate
          element.loop = loop
          element.volume = volume
          element.muted = muted
        }, [rate, loop, volume, muted, audioOnly, src])

        /** 浏览器认为"可以拖到"的最远位置（秒）；0 表示它把该资源当成不可拖动。 */
        const seekableEndOf = (element) => {
          const ranges = element.seekable
          if (!ranges || ranges.length === 0) return 0
          const end = ranges.end(ranges.length - 1)
          return Number.isFinite(end) ? end : 0
        }

        const onLoadedMetadata = (event) => {
          const element = event.currentTarget
          setState({
            duration: element.duration,
            width: element.videoWidth || 0,
            height: element.videoHeight || 0,
            seekableEnd: seekableEndOf(element),
          })
          // 后缀说是视频、实际只有音轨（mp4/webm 里塞纯音频很常见）→ 收成音频版式，
          // 否则会留一个纯黑的视频框。
          if (kind === 'video' && (!element.videoWidth || !element.videoHeight)) setAudioOnly(true)
          setError(null)
          // 刚换成 Blob：把播放位置与播放状态原样接上，别让用户回到 0 秒。
          const resume = resumeRef.current
          if (resume !== null) {
            resumeRef.current = null
            if (Number.isFinite(resume.time) && resume.time > 0) {
              try {
                element.currentTime = resume.time
              } catch (_error) {
                // 不支持设置就保持原样，不影响播放。
              }
            }
            if (resume.playing) {
              const played = element.play()
              if (played && typeof played.catch === 'function') played.catch(() => {})
            }
          }
          // 元数据一到就先看一眼 seekable，并在稍后复查两次（此刻它常常还是空的）。
          scheduleSeekChecks()
          if (props.onReady) props.onReady(event)
        }

        /**
         * 逐段取回完整文件，成功后用 Blob URL 播放。
         *
         * 这条路不依赖"浏览器媒体栈愿意发分段请求"：`Range` 由 JS 显式带上，
         * 服务端本来就会 206。索引在文件末尾的 mp4 靠它才能起播与拖动。
         *
         * @param reason - 触发原因，只用于日志/展示语义。
         */
        const startBuffering = async () => {
          // 两道闸：state 更新是异步的，连点按钮或元素重复报错都可能同时进来
          // 两个调用 —— 那会取两遍整个文件并留下一个泄漏的 Blob URL。
          if (buffer !== null || bufferAbortRef.current !== null) return
          const controller = new AbortController()
          bufferAbortRef.current = controller
          setError(null)
          setBuffer({ loaded: 0, total: typeof props.bytes === 'number' ? props.bytes : null, segments: 0 })
          try {
            const result = await bufferWholeFile(src, {
              signal: controller.signal,
              onProgress: (loaded, total, segments) =>
                setBuffer({ loaded: loaded, total: total, segments: segments }),
            })
            const blob = new Blob(result.parts, { type: probe.mime || 'application/octet-stream' })
            const url = URL.createObjectURL(blob)
            if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = url
            bufferAbortRef.current = null
            setBuffer(null)
            setTransport(result.transport)
            setBuffered({ url: url, bytes: blob.size })
            setNotice(
              result.transport.mode === 'ranged'
                ? t('bufferedNoticeRanged', { n: result.transport.segments })
                : t('bufferedNoticeFull'),
            )
            if (props.onSettled) props.onSettled()
          } catch (failure) {
            bufferAbortRef.current = null
            setBuffer(null)
            // 缓冲也失败 → 这时才认为这个文件真的播不了，并把传输事实摊开给用户。
            setError({
              code: 2,
              message: failure && failure.message ? failure.message : String(failure),
              stage: 'buffer',
            })
            if (props.onSettled) props.onSettled()
          }
        }

        const cancelBuffering = () => {
          if (bufferAbortRef.current !== null) {
            bufferAbortRef.current.abort()
            bufferAbortRef.current = null
          }
          setBuffer(null)
        }

        /**
         * 用户的拖动没生效时的出路。
         *
         * 为什么会失败：光把 HTTP 侧做对（206 + `Content-Range` + 如实服务整个区间）
         * 还不够 —— 浏览器可能仍然不把这个资源当成"可拖动"，此时拖进度条不会有任何
         * 反应（`video.seekable` 为空或范围极窄）。Blob URL 在内存里天然完全可 seek，
         * 所以这里有确定的出路：改成完整缓冲播放。
         *
         * 小于自动阈值就直接做（用户只想拖一下，不该还要点一次按钮）；超过阈值只提示，
         * 由用户决定是否为它付出等量内存。
         */
        const handleSeekFailure = () => {
          if (buffered !== null || buffer !== null) return
          const seekableEnd = mediaRef.current === null ? 0 : seekableEndOf(mediaRef.current)
          setState((previous) => ({ ...previous, seekableEnd }))
          setSeekFailed(true)
          // 后台正在准备可拖动版本：告诉用户"马上就好"，不要再叠一层整份缓冲。
          if (warmup !== null) {
            setNotice(t('warmupPending'))
            return
          }
          if (!autoBufferTriedRef.current && shouldAutoBuffer(path, props.bytes)) {
            autoBufferTriedRef.current = true
            setNotice(t('seekFixing'))
            void startBuffering()
          } else {
            setNotice(t('seekUnsupportedLarge'))
          }
        }

        /**
         * **主动**判断浏览器认不认这个资源可拖动 —— 不等用户去拖。
         *
         * 为什么必须主动：0.3.0 只挂了 `seeking` 事件，但浏览器若根本不接受这次拖动，
         * 连 `seeking` 都不会触发 —— 于是"拖了没反应"时插件什么都不做。
         * 唯一可靠的信号是 `video.seekable`：它为空、或覆盖不到整个时长，就意味着
         * 拖动这条路的收益是零，必须换成完整缓冲（Blob 天然可自由 seek）。
         *
         * 时机很关键：`loadedmetadata` 那一刻 `seekable` 常常还是空的，所以除了立刻看
         * 一次，还在 400ms / 1500ms 各复查一次，并在 `canplay` / `progress` / 重新载入
         * 后复查 —— 一旦浏览器把范围填好，就判为"可拖"，不再打扰用户。
         */
        const evaluateSeekability = () => {
          const element = mediaRef.current
          if (element === null) return
          const end = seekableEndOf(element)
          const duration = element.duration
          setState((previous) =>
            previous.seekableEnd === end ? previous : { ...previous, seekableEnd: end },
          )
          if (buffered !== null || buffer !== null || seekFailed) return
          const coversWhole = end > 0 && Number.isFinite(duration) && end >= duration - 1
          // 还没拿到时长（元数据未就绪）时不下结论，等下一次复查。
          if (!Number.isFinite(duration) || duration <= 0) return
          if (coversWhole) return
          handleSeekFailure()
        }

        /**
         * 复查时机：`loadedmetadata` 时 `seekable` 往往还没填好。
         *
         * 两道复查（400ms / 1500ms）之后仍判为不可拖，才会去缓冲整个文件 —— 这个决定
         * 会花掉与文件等量的内存，值得多等一秒确认。
         */
        const scheduleSeekChecks = () => {
          for (const timer of seekCheckTimersRef.current) clearTimeout(timer)
          seekCheckTimersRef.current = [400, 1500].map((delay) =>
            setTimeout(() => {
              evaluateSeekability()
            }, delay),
          )
        }

        const clearSeekChecks = () => {
          for (const timer of seekCheckTimersRef.current) clearTimeout(timer)
          seekCheckTimersRef.current = []
        }

        const onSeeking = (event) => {
          const element = event.currentTarget
          seekTargetRef.current = element.currentTime
          if (seekTimerRef.current !== null) clearTimeout(seekTimerRef.current)
          seekTimerRef.current = setTimeout(() => {
            seekTimerRef.current = null
            const el = mediaRef.current
            const target = seekTargetRef.current
            if (el === null || target === null) return
            // 位置确实到了目标附近 → 拖动有效，什么也不做。
            if (Math.abs(el.currentTime - target) < 0.75) return
            handleSeekFailure()
          }, 1500)
        }

        const onSeeked = (event) => {
          if (seekTimerRef.current !== null) {
            clearTimeout(seekTimerRef.current)
            seekTimerRef.current = null
          }
          const element = event.currentTarget
          setState((previous) => ({ ...previous, seekableEnd: seekableEndOf(element) }))
        }

        const onError = (event) => {
          const element = event.currentTarget
          const mediaError = element.error || null
          const info = {
            code: mediaError ? mediaError.code : 0,
            message: mediaError && mediaError.message ? mediaError.message : '',
          }
          // 交给 owner 一个"已落定"的信号：不能让 owner 一直停在"渲染中"。
          if (props.onSettled) props.onSettled()

          // 后台"可拖动版本"正在取同一份字节：等它，不要再起第二遍整份下载。
          if (warmupAbortRef.current !== null) {
            setNotice(t('warmupPending'))
            return
          }

          // 直连流播不动时，先试完整缓冲再谈失败。这是 mp4"索引在文件末尾"的
          // 常规出路：编码完全可播，只是取不到尾部索引。每个 src 只自动试一次。
          if (
            buffered === null &&
            buffer === null &&
            !autoBufferTriedRef.current &&
            shouldAutoBuffer(path, props.bytes)
          ) {
            autoBufferTriedRef.current = true
            void startBuffering()
            return
          }
          setError(info)
        }

        const copyPath = () => {
          const clipboard = navigator.clipboard
          if (!clipboard || typeof clipboard.writeText !== 'function') {
            setNotice(t('copyFailed'))
            return
          }
          clipboard.writeText(path).then(
            () => setNotice(t('copied')),
            () => setNotice(t('copyFailed')),
          )
        }

        const snapshot = () => {
          const element = mediaRef.current
          if (element === null || !element.videoWidth) return
          try {
            const canvas = document.createElement('canvas')
            canvas.width = element.videoWidth
            canvas.height = element.videoHeight
            canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height)
            const link = document.createElement('a')
            link.href = canvas.toDataURL('image/png')
            link.download = baseNameOf(path).replace(/\.[^.]+$/, '') + '.png'
            link.click()
            setNotice(t('snapshotSaved'))
          } catch (_error) {
            setNotice(t('snapshotFailed'))
          }
        }

        const pictureInPicture = () => {
          const element = mediaRef.current
          if (element === null || typeof element.requestPictureInPicture !== 'function') return
          element.requestPictureInPicture().catch(() => setNotice(t('pipFailed')))
        }

        const onKeyDown = (event) => {
          const element = mediaRef.current
          if (element === null) return
          const key = event.key
          if (key === ' ' || key === 'k') {
            event.preventDefault()
            if (element.paused) element.play().catch(() => {})
            else element.pause()
          } else if (key === 'ArrowRight') {
            event.preventDefault()
            element.currentTime = Math.min(element.duration || 0, element.currentTime + 5)
          } else if (key === 'ArrowLeft') {
            event.preventDefault()
            element.currentTime = Math.max(0, element.currentTime - 5)
          } else if (key === 'ArrowUp') {
            event.preventDefault()
            setVolume((value) => Math.min(1, Math.round((value + 0.05) * 100) / 100))
          } else if (key === 'ArrowDown') {
            event.preventDefault()
            setVolume((value) => Math.max(0, Math.round((value - 0.05) * 100) / 100))
          } else if (key === 'm') {
            setMuted((value) => !value)
          } else if (key === 'l') {
            setLoop((value) => !value)
          } else if (key === 'f' && kind === 'video') {
            const container = element.parentElement
            if (container && container.requestFullscreen) container.requestFullscreen().catch(() => {})
          }
        }

        // 有 Blob 就用 Blob（可自由 seek），否则直连流地址（零内存、原生流式）。
        const effectiveSrc = buffered === null ? src : buffered.url

        const elementProps = {
          ref: mediaRef,
          src: effectiveSrc,
          controls: true,
          preload: 'metadata',
          playsInline: true,
          onLoadedMetadata: onLoadedMetadata,
          onError: onError,
          onSeeking: onSeeking,
          onSeeked: onSeeked,
          // 这三个都是"seekable 可能刚刚填好"的时刻，顺手复查一次。
          onCanPlay: evaluateSeekability,
          onLoadedData: evaluateSeekability,
          onProgress: evaluateSeekability,
          tabIndex: 0,
        }

        const player =
          kind === 'video' && !audioOnly
            ? React.createElement('div', { className: 'dshmp-stage' }, React.createElement('video', elementProps))
            : React.createElement(
                'div',
                { className: 'dshmp-audio' },
                React.createElement(
                  'div',
                  { className: 'dshmp-art' },
                  React.createElement(NoteIcon, { size: 40 }),
                ),
                React.createElement('div', { className: 'dshmp-title', title: path }, baseNameOf(path)),
                React.createElement(
                  'div',
                  { className: 'dshmp-sub' },
                  humanBytes(props.bytes) +
                    (isFinite(state.duration) ? ' · ' + humanDuration(state.duration) : '') +
                    (audioOnly && kind === 'video' ? ' · ' + t('audioOnlyHint') : ''),
                ),
                React.createElement('audio', elementProps),
              )

        const videoElement = mediaRef.current
        const canPictureInPicture =
          kind === 'video' &&
          !audioOnly &&
          typeof document !== 'undefined' &&
          document.pictureInPictureEnabled === true

        return React.createElement(
          'div',
          { className: 'dshmp-root', onKeyDown: onKeyDown },
          React.createElement(
            'div',
            // 这个元素就是真正的滚动容器，因此把它交给 owner 当 scrollport
            // （slot 契约：上报 null 会把滚动职责还给共享正文）。
            { className: 'dshmp-scroll', ref: props.scrollportRef },
            error === null
              ? buffer === null
                ? player
                : React.createElement(BufferingPanel, {
                    t: t,
                    path: path,
                    streamUrl: src,
                    loaded: buffer.loaded,
                    total: buffer.total,
                    segments: buffer.segments,
                    onCancel: cancelBuffering,
                  })
              : React.createElement(ErrorCard, {
                  t: t,
                  path: path,
                  probe: probe,
                  error: error,
                  transport: transport,
                  canBuffer: buffered === null && buffer === null && isBufferable(path),
                  onBuffer: () => {
                    void startBuffering()
                  },
                  onRetry: () => {
                    setError(null)
                    if (props.onReload) props.onReload()
                  },
                  onCopyPath: copyPath,
                  streamUrl: src,
                }),
            error === null
              ? React.createElement(
                  'div',
                  { className: 'dshmp-meta' },
                  React.createElement('span', null, t('metaContainer')),
                  React.createElement('b', null, extensionOf(path).toUpperCase() || '—'),
                  React.createElement('span', null, t('metaType')),
                  React.createElement('b', null, probe.mime || '—'),
                  React.createElement('span', null, t('metaSize')),
                  React.createElement('b', null, humanBytes(props.bytes)),
                  React.createElement('span', null, t('metaDuration')),
                  React.createElement('b', null, humanDuration(state.duration)),
                  kind === 'video' && !audioOnly
                    ? React.createElement('span', null, t('metaResolution'))
                    : null,
                  kind === 'video' && !audioOnly
                    ? React.createElement(
                        'b',
                        null,
                        state.width > 0 ? state.width + ' × ' + state.height : '—',
                      )
                    : null,
                  // 传输事实只在真的观察到之后才显示 —— 比"支持/不支持"这种预判更有用：
                  // 分段 206 说明能在没下完时起播，一次 200 说明这一份是完整缓冲来的。
                  transport === null ? null : React.createElement('span', null, t('metaTransport')),
                  transport === null
                    ? null
                    : React.createElement(
                        'b',
                        { className: 'dshmp-ok' },
                        transport.mode === 'ranged'
                          ? t('transportRanged', { n: transport.segments })
                          : t('transportFull'),
                      ),
                  React.createElement('span', null, t('metaBrowser')),
                  React.createElement(
                    'b',
                    { className: probe.supported ? 'dshmp-ok' : 'dshmp-warn' },
                    probe.verdict === 'probably'
                      ? t('supportProbably')
                      : probe.verdict === 'maybe'
                        ? t('supportMaybe')
                        : t('supportNo'),
                  ),
                  // 浏览器自己说的"能拖到哪"。进度条拖不动时，这一行就是答案：
                  // 不是文件的问题，而是浏览器没把这个资源当成可拖动。
                  React.createElement('span', null, t('metaSeekable')),
                  React.createElement(
                    'b',
                    { className: state.seekableEnd > 0 ? 'dshmp-ok' : 'dshmp-warn' },
                    state.seekableEnd > 0
                      ? t('seekableRange', { end: humanDuration(state.seekableEnd) })
                      : t('seekableNone'),
                  ),
                )
              : null,
          ),
          // 缓冲期间不渲染控制条：此刻还没有可播的媒体，按钮只会误导。
          buffer !== null
            ? null
            : React.createElement(
            'div',
            { className: 'dshmp-bar' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshmp-btn',
                onClick: () => {
                  const element = mediaRef.current
                  if (element === null) return
                  if (element.paused) element.play().catch(() => {})
                  else element.pause()
                },
              },
              React.createElement(PlayIcon, { size: 12 }),
              t('playPause'),
            ),
            React.createElement(
              'select',
              {
                className: 'dshmp-select',
                value: String(rate),
                title: t('rate'),
                onChange: (event) => setRate(Number(event.target.value)),
              },
              [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) =>
                React.createElement('option', { key: value, value: String(value) }, value + '×'),
              ),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshmp-btn',
                'data-active': loop ? 'true' : 'false',
                onClick: () => setLoop((value) => !value),
                title: t('loop'),
              },
              t('loop'),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dshmp-btn',
                'data-active': muted ? 'true' : 'false',
                onClick: () => setMuted((value) => !value),
                title: t('mute'),
              },
              muted ? t('unmute') : t('mute'),
            ),
            // 拖动失败且文件超出自动缓冲阈值时，把出路摆在最显眼的位置。
            seekFailed && buffered === null && buffer === null
              ? React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-btn',
                    'data-active': 'true',
                    title: t('bufferForSeekHint'),
                    onClick: () => {
                      autoBufferTriedRef.current = true
                      void startBuffering()
                    },
                  },
                  t('bufferForSeek'),
                )
              : null,
            React.createElement('span', { className: 'dshmp-spacer' }),
            kind === 'video' && !audioOnly
              ? React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshmp-btn',
                    onClick: snapshot,
                    disabled: videoElement === null,
                    title: t('snapshot'),
                  },
                  t('snapshot'),
                )
              : null,
            canPictureInPicture
              ? React.createElement(
                  'button',
                  { type: 'button', className: 'dshmp-btn', onClick: pictureInPicture },
                  t('pip'),
                )
              : null,
            React.createElement(
              'button',
              { type: 'button', className: 'dshmp-btn', onClick: copyPath, title: path },
              t('copyPath'),
            ),
            React.createElement(
              'a',
              {
                className: 'dshmp-btn',
                href: src,
                download: baseNameOf(path),
                title: t('download'),
                style: { textDecoration: 'none' },
              },
              t('download'),
            ),
            props.onReload
              ? React.createElement(
                  'button',
                  { type: 'button', className: 'dshmp-btn', onClick: props.onReload },
                  t('reload'),
                )
              : null,
          ),
          notice === ''
            ? null
            : React.createElement(
                'div',
                { className: 'dshmp-sub', style: { padding: '0 10px 8px' } },
                notice,
              ),
          // 后台准备"可拖动版本"的进度。它不阻塞播放，所以只在下面占一行，
          // 让用户知道"再等一会就能自由拖了"。
          warmup === null
            ? null
            : React.createElement(
                'div',
                { className: 'dshmp-sub', style: { padding: '0 10px 8px' } },
                t('warmupProgress', {
                  percent: warmup.total ? Math.min(100, Math.round((warmup.loaded / warmup.total) * 100)) : 0,
                }),
              ),
        )
      }

      /**
       * 完整缓冲进行中的面板。
       *
       * 必须让人看见"正在为什么等"：这不是普通加载，而是被迫把整个文件取下来 ——
       * 索引在文件末尾的 mp4 就是这种情况。所以给出百分比、已取字节、段数与取消。
       *
       * @param props - `{ t, path, loaded, total, segments, onCancel }`。
       * @returns 缓冲面板。
       */
      function BufferingPanel(props) {
        const t = props.t
        const percent =
          typeof props.total === 'number' && props.total > 0
            ? Math.min(100, Math.round((props.loaded / props.total) * 100))
            : null
        return React.createElement(
          'div',
          { className: 'dshmp-card' },
          React.createElement(
            'div',
            { className: 'dshmp-row', style: { marginTop: 0, alignItems: 'center' } },
            React.createElement('div', { className: 'dshmp-spinner' }),
            React.createElement('h4', { style: { margin: 0 } }, t('bufferingTitle')),
          ),
          React.createElement(
            'div',
            null,
            t('bufferingProgress', {
              loaded: humanBytes(props.loaded),
              total: typeof props.total === 'number' ? humanBytes(props.total) : '?',
              n: props.segments,
            }) + (percent === null ? '' : '（' + String(percent) + '%）'),
          ),
          React.createElement(
            'div',
            { className: 'dshmp-progress' },
            React.createElement('div', {
              className: 'dshmp-progress-fill',
              style: { width: (percent === null ? 8 : Math.max(3, percent)) + '%' },
            }),
          ),
          React.createElement('ul', null, React.createElement('li', null, t('bufferingHint'))),
          React.createElement(
            'div',
            { className: 'dshmp-code' },
            props.path,
          ),
          React.createElement(
            'div',
            { className: 'dshmp-row' },
            React.createElement(
              'button',
              { type: 'button', className: 'dshmp-btn', onClick: props.onCancel },
              t('cancel'),
            ),
            React.createElement(
              'a',
              {
                className: 'dshmp-btn',
                href: props.streamUrl,
                download: baseNameOf(props.path),
                style: { textDecoration: 'none' },
              },
              t('download'),
            ),
          ),
        )
      }

      /**
       * 播不了时的诊断卡。
       *
       * 这里的取舍：**不把"播不了"变成一句"加载失败"**。用户手上往往是一个真的
       * 能播的文件，所以他需要知道三件事：① 失败发生在哪一层（解码 / 网络 / 来源）；
       * ② 传输层实际发生了什么（分段 206 还是一次 200、HTTP 状态、Content-Range）；
       * ③ 现在还能做什么（完整缓冲、复制路径、下载、换系统播放器）。
       *
       * 提示语必须**按容器分岔**：给一个 mp4 讲"MKV/AVI 这类容器浏览器不支持"
       * 是错的，而且会把用户引向错误的结论（去转码一个本来就能播的文件）。
       *
       * @param props - `{ t, path, probe, error, transport, canBuffer, onBuffer, onRetry, onCopyPath, streamUrl }`。
       * @returns 诊断卡。
       */
      function ErrorCard(props) {
        const t = props.t
        const extension = extensionOf(props.path)
        const likelyUnsupported = LIKELY_UNSUPPORTED[extension] === true
        const code = props.error.code
        const lines = []
        if (code === 2) lines.push(t('hintNetwork'))
        if (code === 3) lines.push(t('hintDecode'))
        if (likelyUnsupported) {
          lines.push(t('hintContainer'))
          lines.push(t('hintConvert'))
        } else if (code === 4) {
          // 不在"结构性不支持"名单里的容器（mp4/mov/webm…）却打不开容器，
          // 最常见的原因是**索引在文件末尾且播放器读不到尾部**，不是编码问题。
          lines.push(t('hintIndex'))
          if (props.canBuffer) lines.push(t('hintTryBuffer'))
          else lines.push(t('hintConvert'))
        }
        if (props.error.stage === 'buffer') lines.push(t('hintBufferFailed'))
        return React.createElement(
          'div',
          { className: 'dshmp-card' },
          React.createElement('h4', { className: 'dshmp-err' }, t('errorTitle')),
          React.createElement(
            'div',
            null,
            t('errorReason') +
              '：' +
              t(mediaErrorKey(code)) +
              (props.error.message ? '（' + props.error.message + '）' : ''),
          ),
          React.createElement(
            'div',
            null,
            t('metaContainer') +
              '：' +
              (extension.toUpperCase() || '—') +
              ' · ' +
              (props.probe.mime || '—') +
              ' · ' +
              t('metaBrowser') +
              '：' +
              (props.probe.verdict === 'probably'
                ? t('supportProbably')
                : props.probe.verdict === 'maybe'
                  ? t('supportMaybe')
                  : t('supportNo')),
          ),
          // 传输层事实：这一行是"到底是文件的问题还是取字节的问题"的分水岭。
          props.transport === null
            ? null
            : React.createElement(
                'div',
                null,
                t('diagnostics') +
                  '：HTTP ' +
                  String(props.transport.status) +
                  (props.transport.contentRange ? ' · Content-Range: ' + props.transport.contentRange : '') +
                  (props.transport.acceptRanges ? ' · Accept-Ranges: ' + props.transport.acceptRanges : '') +
                  ' · ' +
                  t('transportSegments', { n: props.transport.segments }),
              ),
          React.createElement(
            'div',
            { className: 'dshmp-code', style: { marginTop: '6px' } },
            props.path,
          ),
          lines.length > 0
            ? React.createElement(
                'ul',
                null,
                lines.map((line, index) => React.createElement('li', { key: index }, line)),
              )
            : null,
          React.createElement(
            'div',
            { className: 'dshmp-row' },
            props.canBuffer
              ? React.createElement(
                  'button',
                  { type: 'button', className: 'dshmp-btn', onClick: props.onBuffer },
                  t('bufferRetry'),
                )
              : null,
            React.createElement(
              'button',
              { type: 'button', className: 'dshmp-btn', onClick: props.onRetry },
              t('retry'),
            ),
            React.createElement(
              'button',
              { type: 'button', className: 'dshmp-btn', onClick: props.onCopyPath },
              t('copyPath'),
            ),
            React.createElement(
              'a',
              {
                className: 'dshmp-btn',
                href: props.streamUrl,
                download: baseNameOf(props.path),
                style: { textDecoration: 'none' },
              },
              t('download'),
            ),
          ),
        )
      }

      // ─────────────────────────────────── 正文：右侧 Sidebar 文档预览

      /**
       * `sidebar.right.tab.document` 的正文（key = MEDIA_ID）。
       *
       * 加载模式是 `renderer`，所以 owner **不会**替我们读字节，`content` 是
       * `{ kind:'renderer', revision, loaded(version), failed(), reload() }`。
       * 我们要做四件事：
       * 1. 从 `useResource(resourceAddress)` 拿到 Host 的绝对路径（file 协议资源）；
       * 2. 拼出带 Range 的流地址交给 `<video>`/`<audio>`；
       * 3. 元数据就绪或出错时调一次 `loaded(version)`，把"正在渲染"落定；
       * 4. 把 `content.revision` 编进 URL，这样 owner 的刷新按钮会真的重新取流。
       *
       * @param props - owner 交给正文的 slot props。
       * @returns 正文元素。
       */
      function MediaBody(props) {
        const t = props.t
        const content = props.content
        const useResource = props.useResource

        const meta = typeof useResource === 'function' ? useResource(props.resourceAddress) : undefined
        const stat = meta && meta.value ? meta.value : undefined
        const absolutePath = stat && typeof stat.absolutePath === 'string' ? stat.absolutePath : undefined
        const version = stat ? stat.version : undefined
        const bytes = stat && typeof stat.bytes === 'number' ? stat.bytes : undefined

        const request = content && content.kind === 'renderer' ? content : undefined
        const revision = request ? request.revision : 0

        const src = React.useMemo(() => {
          if (absolutePath === undefined) return undefined
          // revision 参与 URL：owner 的重新载入会换一个 URL，元素才会真的重取。
          return appUrl(STREAM_ROUTE, { path: absolutePath, r: revision })
        }, [absolutePath, revision])

        // 元数据到位 / 出错都要让 owner 落定，否则它会一直显示"文档渲染中"。
        const settledRef = React.useRef(false)
        React.useEffect(() => {
          settledRef.current = false
        }, [revision, absolutePath])
        const settle = React.useCallback(() => {
          if (request === undefined || settledRef.current) return
          settledRef.current = true
          request.loaded(version)
        }, [request, version])

        const scrollportRef = props.scrollportRef
        const bindScrollport = React.useCallback(
          (node) => {
            if (typeof scrollportRef === 'function') scrollportRef(node)
          },
          [scrollportRef],
        )

        // 元数据一直不来（资源提供方缺失/失败）时给出可读的失败面，而不是空转。
        if (absolutePath === undefined) {
          const failed = meta !== undefined && meta.status === 'failed'
          return React.createElement(
            'div',
            { className: 'dshmp-root' },
            React.createElement(
              'div',
              { className: 'dshmp-scroll dshmp-center', ref: bindScrollport },
              React.createElement('div', { className: failed ? 'dshmp-spinner' : 'dshmp-spinner' }),
              React.createElement(
                'div',
                null,
                failed ? t('metaFailed') : t('readingFile'),
              ),
              React.createElement('div', { className: 'dshmp-code' }, String(props.resourceAddress || '')),
            ),
          )
        }

        return React.createElement(
          'div',
          { className: 'dshmp-frame' },
          React.createElement(MediaPlayer, {
            t: t,
            path: absolutePath,
            src: src,
            bytes: bytes,
            scrollportRef: bindScrollport,
            onReady: settle,
            onSettled: settle,
            onReload: request === undefined ? undefined : () => request.reload(),
          }),
        )
      }

      // ─────────────────────────────────────────── 媒体库面板（main slot）

      // ─────────────────────────────────────────────────────────── 文案

      const zh = {
        title: '媒体播放器',
        readingFile: '正在读取文件信息…',
        metaFailed: '拿不到这个文件的信息（资源提供方未就绪或文件不可读）。',
        playPause: '播放/暂停',
        rate: '播放速度',
        loop: '循环',
        mute: '静音',
        unmute: '取消静音',
        snapshot: '截图',
        snapshotSaved: '已保存当前画面（PNG）。',
        snapshotFailed: '截图失败：浏览器拒绝了画面导出。',
        pip: '画中画',
        pipFailed: '画中画启动失败。',
        copyPath: '复制路径',
        copied: '文件路径已复制到剪贴板。',
        copyFailed: '复制失败：剪贴板不可用。',
        download: '下载',
        reload: '重新载入',
        audioOnlyHint: '（此文件只有音轨）',
        metaContainer: '容器',
        metaType: '类型',
        metaSize: '大小',
        metaDuration: '时长',
        metaResolution: '分辨率',
        metaBrowser: '浏览器',
        metaSeekable: '可拖范围',
        seekableRange: '0 ~ {end}',
        seekableNone: '不可拖动',
        seekFixing: '浏览器没把这个资源当成可拖动，已自动改为完整缓冲播放 —— 稍后即可随意拖动。',
        seekUnsupportedLarge: '浏览器没把这个资源当成可拖动。点「完整缓冲后播放」即可随意拖动（这个文件较大，会占用等量内存）。',
        warmupProgress: '正在后台准备可拖动版本… {percent}%（不影响播放，就绪后可随意拖进度）',
        warmupReady: '已可自由拖动（整份已缓存在内存里）。',
        warmupPending: '正在准备可拖动版本，就绪后即可随意拖动 —— 稍等一下再拖。',
        bufferForSeek: '完整缓冲后播放',
        bufferForSeekHint: '先把整个文件取到内存（Blob 天然可自由 seek），然后就能拖进度条了。',
        supportProbably: '支持',
        supportMaybe: '可能支持',
        supportNo: '不支持或未知',
        errorTitle: '浏览器无法播放这个文件',
        errorReason: '失败原因',
        errorAborted: '读取被中止',
        errorNetwork: '网络或读取错误',
        errorDecode: '解码失败（文件可能损坏，或编码不被支持）',
        errorUnsupported: '来源不受支持（容器或编码不被浏览器接受）',
        errorUnknown: '未知错误',
        hintNetwork: '这不是格式问题：请确认文件仍然存在、且没有被别的程序独占。',
        hintDecode: '编码（如 H.265/HEVC、ProRes、AC-3）可能不被浏览器内置解码器支持。',
        hintContainer: 'MKV、AVI、WMV、FLV、RMVB 这类容器通常无法被 Chromium 内核直接解码——这是浏览器的限制，不是文件坏了。',
        hintConvert: '把文件转成 MP4（H.264 + AAC）即可在浏览器里直接播放；或先下载，再用系统播放器打开。',
        hintIndex: '这个容器的编码通常是浏览器支持的，打不开多半是因为**索引（moov）在文件末尾**，而浏览器没能分段读到它——不是文件损坏。',
        hintTryBuffer: '点"完整缓冲后重试"：先把整个文件取下来再播，索引在末尾也能正常起播与拖动。',
        hintBufferFailed: '完整缓冲也失败了：说明问题可能真的在文件本身（截断、损坏），而不是取字节的方式。',
        bufferRetry: '完整缓冲后重试',
        bufferingTitle: '正在完整缓冲…',
        bufferingProgress: '已取 {loaded} / {total}（{n} 段）',
        bufferingHint: '这个文件无法边下边播：它的索引在文件末尾，播放器必须先读到索引才能起播。稍等片刻，取完即可播放并自由拖动。',
        cancel: '取消',
        bufferedNoticeRanged: '已改为完整缓冲播放（分 {n} 段取回）——此文件无法流式起播。',
        bufferedNoticeFull: '已改为完整缓冲播放——服务器未分段，一次取回整个文件。',
        diagnostics: '传输诊断',
        transportSegments: '分 {n} 段取回',
        metaTransport: '读取方式',
        transportRanged: '分段读取（206，共 {n} 段）',
        transportFull: '一次完整响应（200）',
        retry: '重试',
      }

      const en = {
        title: 'Media player',
        readingFile: 'Reading file information…',
        metaFailed: 'File information is unavailable (resource provider not ready or file unreadable).',
        playPause: 'Play/Pause',
        rate: 'Playback speed',
        loop: 'Loop',
        mute: 'Mute',
        unmute: 'Unmute',
        snapshot: 'Snapshot',
        snapshotSaved: 'Saved the current frame as PNG.',
        snapshotFailed: 'Snapshot failed: the browser refused to export the frame.',
        pip: 'Picture in picture',
        pipFailed: 'Picture-in-picture failed to start.',
        copyPath: 'Copy path',
        copied: 'File path copied to the clipboard.',
        copyFailed: 'Copy failed: clipboard unavailable.',
        download: 'Download',
        reload: 'Reload',
        audioOnlyHint: '(audio-only file)',
        metaContainer: 'Container',
        metaType: 'Type',
        metaSize: 'Size',
        metaDuration: 'Duration',
        metaResolution: 'Resolution',
        metaBrowser: 'Browser',
        metaSeekable: 'Seekable',
        seekableRange: '0 – {end}',
        seekableNone: 'not seekable',
        seekFixing: 'The browser does not treat this resource as seekable; switched to full buffering automatically — seeking will work shortly.',
        seekUnsupportedLarge: 'The browser does not treat this resource as seekable. Use "Buffer fully and play" to seek freely (large file: it costs that much memory).',
        warmupProgress: 'Preparing a seekable copy in the background… {percent}% (playback continues; dragging works once ready)',
        warmupReady: 'Seeking now works freely (the whole file is cached in memory).',
        warmupPending: 'Still preparing the seekable copy — try dragging again in a moment.',
        bufferForSeek: 'Buffer fully and play',
        bufferForSeekHint: 'Fetch the whole file into memory (a Blob is freely seekable) so the progress bar works.',
        supportProbably: 'supported',
        supportMaybe: 'maybe supported',
        supportNo: 'unsupported or unknown',
        errorTitle: 'The browser cannot play this file',
        errorReason: 'Reason',
        errorAborted: 'the read was aborted',
        errorNetwork: 'network or read error',
        errorDecode: 'decode failure (corrupt file or unsupported encoding)',
        errorUnsupported: 'unsupported source (container or codec refused by the browser)',
        errorUnknown: 'unknown error',
        hintNetwork: 'This is not a format problem: check that the file still exists and is not locked by another program.',
        hintDecode: 'The codec (e.g. H.265/HEVC, ProRes, AC-3) may not be supported by the browser decoder.',
        hintContainer: 'Containers like MKV, AVI, WMV, FLV and RMVB generally cannot be decoded by the Chromium engine — a browser limitation, not a broken file.',
        hintConvert: 'Convert to MP4 (H.264 + AAC) to play it in the browser, or download it and open it in your system player.',
        hintIndex: 'This container is usually playable in a browser; the failure is most likely that its index (moov) sits at the end of the file and the browser could not read it in ranges — the file is not corrupt.',
        hintTryBuffer: 'Use "Retry with full buffering": fetch the whole file first, then play it. Works even when the index is at the end.',
        hintBufferFailed: 'Full buffering failed too: the problem is probably the file itself (truncated or corrupt), not how the bytes were fetched.',
        bufferRetry: 'Retry with full buffering',
        bufferingTitle: 'Buffering the whole file…',
        bufferingProgress: '{loaded} / {total} fetched ({n} segments)',
        bufferingHint: 'This file cannot be played progressively: its index lives at the end, so the player must read it before starting. It will play and seek freely once fetched.',
        cancel: 'Cancel',
        bufferedNoticeRanged: 'Switched to full buffering ({n} ranged reads) — this file cannot start progressively.',
        bufferedNoticeFull: 'Switched to full buffering — the server did not split the response, so the whole file came in one read.',
        diagnostics: 'Transport',
        transportSegments: '{n} ranged reads',
        metaTransport: 'Delivery',
        transportRanged: 'ranged reads (206, {n} segments)',
        transportFull: 'one full response (200)',
        retry: 'Retry',
      }

      // ───────────────────────────────────────────────────── 插件入口

      /**
       * 需要的客户端服务（**Cordis 服务名**，不是包名）。
       *
       * `documentPreviews` 由 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`
       * 提供 —— 那个包必须在 `dsh.client.inject` 里点名，它才会先于本插件物化。
       */
      const inject = ['slots', 'locale', 'documentPreviews']

      /**
       * 挂载媒体预览。
       *
       * @param ctx - 浏览器半侧的 Cordis 上下文。
       */
      function apply(ctx) {
        ensureStyles()

        ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'dsh-media-preview: 字典')
        const t = ctx.locale.bind(NS)

        // ① 认领后缀：这一步让 mp4/mp3/… 不再落进内建预览的
        //    UNVIEWABLE_BINARY_EXTENSIONS 空态，而是被派发给本实现。
        //    `priority: 'extension'` —— 预览注册表里"非 builtin 档"排在前面，
        //    于是同一个后缀我们优先（目前这些后缀没有别的实现）。
        //    `binaryExtensions` 与 extensions 相同：明确告诉 owner"这些不是文本"，
        //    别在查看器下拉里给纯文本选项。
        ctx.effect(
          () =>
            ctx.documentPreviews.register({
              id: MEDIA_ID,
              extensions: MEDIA_EXTENSIONS,
              binaryExtensions: MEDIA_EXTENSIONS,
              priority: 'extension',
              title: () => t('title'),
              loading: 'renderer',
              wrap: false,
            }),
          'dsh-media-preview: 预览实现',
        )

        // ② 正文：keyed、session 作用域的 `sidebar.right.tab.document`，key 必须等于 id。
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.tab.document', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.tab.document',
                  key: MEDIA_ID,
                  locale: NS,
                },
                MediaBody,
              ),
            ),
          'dsh-media-preview: 预览正文',
        )

      }

      exports.apply = apply
      exports.inject = inject
      exports.NS = NS
      return module.exports
    }

    /** 相对请求解析（本 bundle 目前只有一个模块，保留与 dsh-ark 相同的骨架）。 */
    function __resolve(from, request) {
      if (!request.startsWith('.')) return request
      var parts = from.slice(2).split('/')
      parts.pop()
      for (var part of request.split('/')) {
        if (part === '.' || part === '') continue
        if (part === '..') parts.pop()
        else parts.push(part)
      }
      return './' + parts.join('/')
    }
    function __load(id) {
      if (__modules[id] === undefined) return require(id)
      if (__cache[id] !== undefined) return __cache[id].exports
      var module = (__cache[id] = { exports: {} })
      __modules[id](module, module.exports, require, function (request) {
        var resolved = __resolve(id, request)
        return __modules[resolved] === undefined ? require(request) : __load(resolved)
      })
      return module.exports
    }
    return __load('./index.js')
  },
})

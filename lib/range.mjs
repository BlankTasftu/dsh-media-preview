/**
 * HTTP `Range` 的解析与生成 —— 纯函数，无 IO，可被 `node --test` 直接覆盖。
 *
 * ─── 为什么这一段必须自己写 ────────────────────────────────────────────────
 * DSH 内建的 `/api/file` 路由**不支持 Range**（`fs.readBytes` → 整个文件 → 200）。
 * 图片无所谓，视频不行：`<video>` 靠 206 + `Content-Range` 才能拖动进度条、
 * 才能在没下完的时候开始播。所以本插件的 `/api/media` 自己实现这一段。
 *
 * ─── 只做"单区间"，不做 multipart/byteranges ──────────────────────────────
 * 一个请求里带多个区间时只看第一个。浏览器与 ffmpeg 都只用单区间；返回
 * `multipart/byteranges` 需要另一套 Content-Type 与边界拼装，收益为零。
 *
 * ─── 单次响应的字节上限是"合法地少给" ──────────────────────────────────────
 * `<video>` 的第一次请求通常是 `Range: bytes=0-`（到文件末尾）。真按字面读，
 * 一个 2 GB 的片子就会一次性进内存。HTTP 允许服务器只返回请求区间的一部分
 * ——只要 `Content-Range` 如实写出实际发的范围。播放器会接着再要下一段，
 * 这也正是所有分块媒体服务器的做法。`clampWindow()` 就是这件事。
 */

/** 单区间解析结果的判别式。 */
export const RANGE_NONE = 'none'
export const RANGE_OK = 'range'
export const RANGE_UNSATISFIABLE = 'unsatisfiable'
export const RANGE_MALFORMED = 'malformed'

/**
 * 解析 `Range` 请求头。
 *
 * 语义取舍（与 RFC 9110 及主流服务器一致）：
 * - **没有头** → `none`，调用方按 200 返回完整实体。
 * - **语法错误**（单位不对、不是数字、`a-b` 里 a>b）→ `malformed`。按 RFC，
 *   语法错误的 Range 必须被**忽略**，所以调用方按 200 处理，而不是报错。
 * - **区间落在实体之外** → `unsatisfiable`，调用方回 416 + `Content-Range: bytes *​/size`。
 *   这一条不能忽略：它正是播放器判断"我要的位置不存在"的依据。
 *
 * @param header - 原始 `Range` 头，可能为 null。
 * @param size - 实体总字节数（必须是非负整数）。
 * @returns `{kind:'none'}` | `{kind:'range',start,end}`（闭区间，0 起算、已按 size 裁剪）
 *          | `{kind:'unsatisfiable'}` | `{kind:'malformed'}`
 */
export function parseByteRange(header, size) {
  if (header === null || header === undefined) return { kind: RANGE_NONE }
  const raw = String(header).trim()
  if (raw === '') return { kind: RANGE_NONE }
  if (!Number.isSafeInteger(size) || size < 0) return { kind: RANGE_MALFORMED }

  const match = /^bytes\s*=\s*(.+)$/i.exec(raw)
  if (match === null) return { kind: RANGE_MALFORMED }

  // 多区间只取第一个；但空元素（`bytes=1-2,`、`bytes=,1-2`）让整个头语法错误，
  // 按 RFC 必须忽略 —— 忽略等于回 200 完整实体，而不是回一个被误解的区间。
  const parts = match[1].split(',').map((part) => part.trim())
  if (parts.some((part) => part === '')) return { kind: RANGE_MALFORMED }
  const first = parts[0]
  if (first === '') return { kind: RANGE_MALFORMED }

  const suffix = /^-(\d+)$/.exec(first)
  if (suffix !== null) {
    const length = Number(suffix[1])
    // `bytes=-0` 不是"最后 0 字节"，而是无意义 → 不可满足。
    if (length === 0 || size === 0) return { kind: RANGE_UNSATISFIABLE }
    const start = Math.max(0, size - length)
    return { kind: RANGE_OK, start, end: size - 1 }
  }

  const span = /^(\d+)-(\d*)$/.exec(first)
  if (span === null) return { kind: RANGE_MALFORMED }
  const start = Number(span[1])
  if (!Number.isSafeInteger(start)) return { kind: RANGE_MALFORMED }
  // `bytes=N-` 是"从 N 到文件末尾"：末尾要等越界检查之后才推导出来。
  // 顺序反了就会出现 `bytes=100-` 在 100 字节文件上被判成语法错误（而不是 416）——
  // 而这恰好是播放器拖到文件末之后最常见的一个请求。
  const open = span[2] === ''
  const end = open ? size - 1 : Number(span[2])
  if (!Number.isSafeInteger(end)) return { kind: RANGE_MALFORMED }
  if (!open && end < start) return { kind: RANGE_MALFORMED }
  if (start >= size) return { kind: RANGE_UNSATISFIABLE }
  return { kind: RANGE_OK, start, end: Math.min(end, size - 1) }
}

/**
 * 生成 `Content-Range`。
 *
 * @param start - 起始字节。
 * @param end - 结束字节（含）。
 * @param size - 实体总字节数。
 * @returns 例如 `bytes 0-1048575/1073741824`。
 */
export function formatContentRange(start, end, size) {
  return `bytes ${start}-${end}/${size}`
}

/**
 * 生成 416 用的 `Content-Range`（RFC 9110 要求写成 `bytes *​/size`）。
 *
 * @param size - 实体总字节数；未知时用 `*`。
 * @returns 例如 `bytes *​/0`。
 */
export function formatUnsatisfiedRange(size) {
  return `bytes */${Number.isSafeInteger(size) && size >= 0 ? size : '*'}`
}

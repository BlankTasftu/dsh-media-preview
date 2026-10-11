/**
 * 媒体扩展名 → MIME / 类别 的单一事实来源（宿主半侧）。
 *
 * ─── 为什么自己写一张表，而不是用 `mime-types` ─────────────────────────────
 * `mime-types` 确实是 DSH 依赖（`dsh-api-session-controller` 用它给 `/api/file`
 * 定 Content-Type）。但本插件以 `link:` 方式装进 profile，模块解析路径从
 * `E:\...\dsh-media-preview\lib\` 往上走，**够不到 profile 的 node_modules**，
 * 除非把 `mime-types` 声明成本插件的依赖进而污染用户的 profile。为一张表不值得，
 * 而且浏览器能不能播，取决于响应上的 Content-Type 是否精确 —— 由自己掌握更好。
 *
 * ─── 两条纪律 ──────────────────────────────────────────────────────────────
 * 1. **只认白名单**。`/api/media` 只服务本文件列出的后缀，别的一律 415。
 *    这条比鉴权更靠内：即使请求已经通过鉴权，也读不到 `.credentials.yaml`
 *    这类非媒体文件（把文件改名成 `.mp3` 是唯一绕过方式，代价可见）。
 * 2. **`lib/client.js` 里有一张必须与这里保持一致的副本**。客户端 bundle 是
 *    手写的自包含 factory，不能 import 宿主模块。`tests/format-parity.test.mjs`
 *    会把两边解析出来逐项对比，谁改漏了都会当场失败。
 */

/** 视频容器：后缀 → MIME。键一律小写、不带点。 */
export const VIDEO_MIME = {
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
  // 注意：**故意没有 `ts` 与 `mts`**。
  // MPEG 传输流的规范后缀确实是 `.ts`，但 `.ts` / `.mts` 在开发工作区里是
  // TypeScript（`.d.ts` 遍地都是）。把它们当媒体会造成两个真实后果：
  //   ① 媒体库把成百上千个 `.d.ts` 列成"视频"（实测：本机 4 个工作区列出的 39 个
  //      "媒体文件"里，20 多个是 TypeScript 声明文件）；
  //   ② 更严重的是预览：本插件的注册优先级高于内建渲染器与纯文本兜底，
  //      于是点开一个 `.ts` 会进"媒体播放器"，而不再按代码/文本显示。
  // 代价只是失去 `.ts` 视频，而 Chromium 对 `video/mp2t` 的支持本就很差。
  // `m2ts` 无歧义，保留。
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

/** 音频容器：后缀 → MIME。 */
export const AUDIO_MIME = {
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

/** 全部支持的后缀 → MIME。 */
export const MEDIA_MIME = { ...VIDEO_MIME, ...AUDIO_MIME }

/**
 * 取路径最后一段的扩展名（小写、不带点）。
 *
 * 只按最后一段算：目录名里有点不该影响判定（`my.folder/song` 没有扩展名）。
 *
 * @param path - 原生路径或 `dsh-resource://` 地址的路径部分。
 * @returns 小写扩展名；没有扩展名时返回空串。
 */
export function extensionOf(path) {
  const normalized = String(path ?? '').replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 这个路径是不是本插件支持的媒体文件。
 *
 * @param path - 原生路径或地址。
 * @returns 支持时为 true。
 */
export function isMediaPath(path) {
  return Object.hasOwn(MEDIA_MIME, extensionOf(path))
}

/**
 * 媒体类别。
 *
 * @param path - 原生路径或地址。
 * @returns `'video'`、`'audio'`，不支持时为 `null`。
 */
export function mediaKindOf(path) {
  const extension = extensionOf(path)
  if (Object.hasOwn(VIDEO_MIME, extension)) return 'video'
  if (Object.hasOwn(AUDIO_MIME, extension)) return 'audio'
  return null
}

/**
 * 响应用的 Content-Type。
 *
 * @param path - 原生路径或地址。
 * @returns 已知后缀返回精确 MIME，否则 `application/octet-stream`。
 */
export function mediaMimeOf(path) {
  return MEDIA_MIME[extensionOf(path)] ?? 'application/octet-stream'
}

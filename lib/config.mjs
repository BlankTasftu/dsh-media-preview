/**
 * 插件配置的解析与钳制。
 *
 * 配置来自 profile 补丁里本插件那一行的 `config:` 块（`cordis.patch.yml`）。
 * 原则：**任何用户输入都不能把插件变成内存炸弹**，所以每个数值字段都过一遍
 * 上下界，非法值回落到默认值而不是抛错 —— 一个写错的数字不该让整个插件的
 * 路由注册不上。
 */

/** 默认跳过扫描的目录：媒体不会藏在里面，但可能是几万个文件。 */
const DEFAULT_SKIP_DIRECTORIES = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.cache',
  '.idea',
  '.vscode',
  '$RECYCLE.BIN',
  'System Volume Information',
]

/** 默认配置。字段注释即语义。 */
export const DEFAULT_CONFIG = {
  stream: {
    /** 流式路由路径（挂在鉴权的 connection.fetch 通道上，位于 `/api` 前缀下）。 */
    route: '/api/media',
    /**
     * 单次 206 响应最多发多少字节。`Range: bytes=0-` 会被裁到这个上限，
     * `Content-Range` 如实写出实际范围，播放器接着要下一段。
     */
    maxChunkBytes: 8 * 1024 * 1024,
    /** 无 Range 的整文件请求，内部按这个窗口流式读取（内存上限，不是响应上限）。 */
    streamChunkBytes: 1024 * 1024,
  },
  library: {
    /** 媒体清单路由路径。 */
    route: '/api/media-index',
    /** 清单最多返回多少个文件。 */
    maxFiles: 400,
    /** 目录递归深度上限。 */
    maxDepth: 6,
    /** 最多访问多少条目录项后停止（防止在巨型目录里跑飞）。 */
    maxVisited: 20000,
    /** 单个目录最多看多少项。 */
    maxEntriesPerDir: 500,
    /** 跳过的目录名（小写比较）。 */
    skipDirectories: DEFAULT_SKIP_DIRECTORIES,
  },
}

/**
 * 取一个整数，越界或非法时回落到默认值。
 *
 * @param value - 配置里的原始值。
 * @param fallback - 默认值。
 * @param min - 允许的最小值（含）。
 * @param max - 允许的最大值（含）。
 * @returns 合法整数。
 */
function integerOr(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

/**
 * 取一个以 `/` 开头的路由路径，非法时回落到默认值。
 *
 * @param value - 配置里的原始值。
 * @param fallback - 默认路由。
 * @returns 规范化后的绝对路径（无尾斜杠）。
 */
function routeOr(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.length < 2) return fallback
  if (/[\s?#]/.test(trimmed)) return fallback
  return trimmed.replace(/\/+$/, '')
}

/**
 * 取一个字符串数组（目录名），非法时回落到默认值。
 *
 * @param value - 配置里的原始值。
 * @param fallback - 默认数组。
 * @returns 小写化后的目录名数组。
 */
function directoryListOr(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const names = value
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim().toLowerCase())
  return names.length > 0 ? [...new Set(names)] : fallback
}

/**
 * 解析插件配置。
 *
 * @param config - profile 补丁那一行的 `config` 对象；可能为 undefined。
 * @returns 完整的、已钳制的配置。
 */
export function resolveConfig(config) {
  const stream = config?.stream ?? {}
  const library = config?.library ?? {}
  return {
    stream: {
      route: routeOr(stream.route, DEFAULT_CONFIG.stream.route),
      maxChunkBytes: integerOr(
        stream.maxChunkBytes,
        DEFAULT_CONFIG.stream.maxChunkBytes,
        64 * 1024,
        64 * 1024 * 1024,
      ),
      streamChunkBytes: integerOr(
        stream.streamChunkBytes,
        DEFAULT_CONFIG.stream.streamChunkBytes,
        64 * 1024,
        16 * 1024 * 1024,
      ),
    },
    library: {
      route: routeOr(library.route, DEFAULT_CONFIG.library.route),
      maxFiles: integerOr(library.maxFiles, DEFAULT_CONFIG.library.maxFiles, 1, 5000),
      maxDepth: integerOr(library.maxDepth, DEFAULT_CONFIG.library.maxDepth, 0, 32),
      maxVisited: integerOr(library.maxVisited, DEFAULT_CONFIG.library.maxVisited, 1, 500000),
      maxEntriesPerDir: integerOr(
        library.maxEntriesPerDir,
        DEFAULT_CONFIG.library.maxEntriesPerDir,
        1,
        10000,
      ),
      skipDirectories: directoryListOr(library.skipDirectories, DEFAULT_CONFIG.library.skipDirectories),
    },
  }
}

/**
 * 这个目录名要不要跳过。
 *
 * @param name - 目录项名字。
 * @param skipDirectories - 小写目录名集合。
 * @returns 命中则 true。
 */
export function shouldSkipDirectory(name, skipDirectories) {
  return skipDirectories.includes(String(name).toLowerCase())
}

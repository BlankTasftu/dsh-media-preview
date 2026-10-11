/**
 * 插件配置的解析与钳制。
 *
 * 配置来自 profile 补丁里本插件那一行的 `config:` 块（`cordis.patch.yml`）。
 * 原则与 dsh-ark 一致：**任何用户输入都不能把插件变成内存炸弹**，所以每个
 * 数值字段都过一遍上下界，非法值回落到默认值而不是抛错 —— 一个写错的数字
 * 不该让整个插件的路由注册不上。
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
    /**
     * 流式发送时的读取窗口（内存上限）。
     *
     * **这里没有"单次响应上限"这种配置，是刻意的**：曾经有过一个 `maxChunkBytes`，
     * 用来把客户端要的区间裁短以防一次性读进内存。那是错的 —— 播放器发
     * `Range: bytes=0-`（到文件末尾）时，"短 206"会被媒体栈当成流结束。
     * 正确做法是如实服务整个区间、用流式发送；内存由这个窗口约束。
     */
    streamChunkBytes: 1024 * 1024,
  },
  library: {
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
      streamChunkBytes: integerOr(
        stream.streamChunkBytes,
        DEFAULT_CONFIG.stream.streamChunkBytes,
        64 * 1024,
        16 * 1024 * 1024,
      ),
    },
    library: {
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

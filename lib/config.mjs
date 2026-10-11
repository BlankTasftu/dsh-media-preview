/**
 * 插件配置的解析与钳制。
 *
 * 配置来自 profile 补丁里本插件那一行的 `config:` 块（`cordis.patch.yml`）。
 * 原则：**任何用户输入都不能把插件变成内存炸弹**，所以数值字段都过一遍上下界，
 * 非法值回落到默认值而不是抛错 —— 一个写错的数字不该让整个插件的路由注册不上。
 *
 * 0.3.0 起只剩一个字段：媒体库（含扫描上限那一组配置）已随面板一并删除。
 */

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
 * 解析插件配置。
 *
 * @param config - profile 补丁那一行的 `config` 对象；可能为 undefined。
 * @returns 完整的、已钳制的配置。
 */
export function resolveConfig(config) {
  const stream = config?.stream ?? {}
  return {
    stream: {
      streamChunkBytes: integerOr(
        stream.streamChunkBytes,
        DEFAULT_CONFIG.stream.streamChunkBytes,
        64 * 1024,
        16 * 1024 * 1024,
      ),
    },
  }
}

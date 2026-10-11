/**
 * 工作区媒体文件扫描 —— 遍历逻辑本身与 `ctx.fs` 解耦（只依赖一个很小的接口），
 * 因此可以用假 fs 在 `node --test` 里覆盖，而不必真的造一棵目录树。
 *
 * ─── 三条纪律 ──────────────────────────────────────────────────────────────
 * 1. **只用 `ctx.fs`**。不直接 `node:fs`：组合出来的文件系统可能是远程执行世界，
 *    直接读本机磁盘既会读错地方，也绕过了它的访问策略。
 * 2. **不跟随符号链接**。只认 `type === 'file'` 的目录项。跟链会引入环，
 *    也会让"工作区里"这个前提失效。
 * 3. **有界**。深度、访问条目数、返回文件数都有上限；单个目录读不动就跳过，
 *    不让一次权限错误毁掉整份清单。
 */
import { extensionOf, isMediaPath, mediaKindOf } from './media-formats.mjs'
import { shouldSkipDirectory } from './config.mjs'

/** 上限默认值；调用方传 limits 时按字段覆盖。 */
const DEFAULT_SCAN_LIMITS = {
  maxFiles: 400,
  maxDepth: 6,
  maxVisited: 20000,
  maxEntriesPerDir: 500,
  skipDirectories: [],
}

/**
 * 判断路径属于哪个路径风味。
 *
 * `ctx.fs.processPath()` 返回的是**执行世界**里的路径：本机后端是 Windows 或
 * POSIX 原生路径，远程后端则可能是任意风味。按第一个绝对路径的样子选定
 * 分隔符，比硬编码 `node:path` 的当前平台更可靠。
 *
 * @param sample - 一个绝对路径样本。
 * @returns `win32` 或 `posix`。
 */
export function pathFlavorOf(sample) {
  const value = String(sample ?? '')
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) return 'win32'
  return 'posix'
}

/**
 * 拼接一个子项路径。
 *
 * @param directory - 父目录的原生路径。
 * @param name - 子项名字。
 * @param flavor - `pathFlavorOf()` 的结果。
 * @returns 拼接后的路径。
 */
export function joinChild(directory, name, flavor) {
  const separator = flavor === 'win32' ? '\\' : '/'
  const base = String(directory).replace(/[\\/]+$/, '')
  return base === '' ? `${separator}${name}` : `${base}${separator}${name}`
}

/**
 * 扫描一个根目录下的媒体文件。
 *
 * @param options - 扫描参数。
 * @param options.fs - 组合文件系统（`ctx.fs`）：需要 `resolve`/`listDir`/`stat`/`processPath`。
 * @param options.root - 根目录：可以是工作区根、会话 cwd 或任意绝对路径。
 * @param options.label - 结果里带的来源标签（例如工作区标题）。
 * @param options.limits - 上限，缺省用 {@link DEFAULT_SCAN_LIMITS}。
 * @param options.signal - 取消信号；中止时抛出，由调用方归一化。
 * @returns `{ root, label, files, truncated, visited, errors }`；`files` 按路径排序。
 */
export async function scanMediaRoot({ fs, root, label, limits, signal }) {
  const bounds = { ...DEFAULT_SCAN_LIMITS, ...(limits ?? {}) }
  const resolvedRoot = await fs.resolve(root, { signal })
  const rootPath = fs.processPath(resolvedRoot)
  const flavor = pathFlavorOf(rootPath)

  const files = []
  const errors = []
  let visited = 0
  let truncated = false

  /** 广度优先：先近后远，命中上限时留下的是"更浅"的文件，通常也更有用。 */
  const queue = [{ path: rootPath, depth: 0 }]

  while (queue.length > 0) {
    if (files.length >= bounds.maxFiles || visited >= bounds.maxVisited) {
      truncated = true
      break
    }
    const directory = queue.shift()

    let entries
    try {
      const target = await fs.resolve(directory.path, { signal })
      entries = await fs.listDir(target, signal)
    } catch (error) {
      // 一个读不动的目录不该毁掉整份清单；把原因带回给调用方。
      errors.push(`${directory.path}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!Array.isArray(entries)) continue

    for (const entry of entries.slice(0, bounds.maxEntriesPerDir)) {
      if (visited >= bounds.maxVisited || files.length >= bounds.maxFiles) {
        truncated = true
        break
      }
      visited += 1

      const name = typeof entry?.name === 'string' ? entry.name : ''
      if (name === '' || name === '.' || name === '..') continue
      const childPath = joinChild(directory.path, name, flavor)

      if (entry.type === 'directory') {
        if (directory.depth < bounds.maxDepth && !shouldSkipDirectory(name, bounds.skipDirectories)) {
          queue.push({ path: childPath, depth: directory.depth + 1 })
        }
        continue
      }
      // 符号链接、设备、套接字一律不碰。
      if (entry.type !== 'file') continue
      if (!isMediaPath(childPath)) continue

      let bytes = typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : undefined
      if (bytes === undefined) {
        try {
          const info = await fs.stat(await fs.resolve(childPath, { signal }), signal)
          if (typeof info?.size === 'number' && Number.isFinite(info.size)) bytes = info.size
        } catch {
          // 拿不到大小不影响"能播"，只是清单里少一个数字。
        }
      }

      files.push({
        absolutePath: childPath,
        name,
        extension: extensionOf(childPath),
        kind: mediaKindOf(childPath),
        ...(bytes === undefined ? {} : { bytes }),
      })
    }
  }

  files.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath))
  return { root: rootPath, label: label ?? '', files, truncated, visited, errors }
}

/**
 * 扫描多个根，合并去重。
 *
 * @param options - 与 {@link scanMediaRoot} 相同，另加 `roots`（`{path,label}[]`）。
 * @returns `{ files, roots, truncated, errors }`；`files` 里每个元素带 `rootLabel`。
 */
export async function scanMediaRoots({ fs, roots, limits, signal }) {
  const files = []
  const seen = new Set()
  const errors = []
  const scannedRoots = []
  let truncated = false

  for (const entry of roots) {
    try {
      const result = await scanMediaRoot({
        fs,
        root: entry.path,
        label: entry.label,
        limits,
        signal,
      })
      scannedRoots.push({ label: result.label, root: result.root, files: result.files.length })
      truncated = truncated || result.truncated
      errors.push(...result.errors)
      for (const file of result.files) {
        if (seen.has(file.absolutePath)) continue
        seen.add(file.absolutePath)
        files.push({ ...file, rootLabel: result.label })
      }
    } catch (error) {
      errors.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  files.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath))
  return { files, roots: scannedRoots, truncated, errors }
}

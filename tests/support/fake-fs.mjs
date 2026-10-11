/**
 * 测试用的假 `ctx.fs`。
 *
 * 只实现本插件真正用到的那几个方法，语义按 `@deepseek-ai/dsh-fs` 的契约来：
 * `resolve` 返回不透明 target、`processPath` 给出原生路径、`stat` 找不到时返回
 * `undefined`（而不是抛错）、`readByteRange` 允许**短读**（越过文件末尾时短于
 * 请求长度）—— 最后这条正是宿主路由必须按"实际拿到的字节数"写 Content-Range
 * 的原因，所以假实现必须保真。
 */

/**
 * 造一个假文件系统。
 *
 * @param entries - `{ [absolutePath]: { bytes: Uint8Array, type?: string, children?: object[] } }`。
 *   `byDir` 未给出时，`listDir` 依据路径前缀推导直接子项。
 * @returns 假 fs 对象。
 */
export function createFakeFs(entries) {
  /** 归一化：比较时统一用正斜杠、去掉尾部分隔符。 */
  const normalize = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '')

  // 键也要归一化：真实后端的 `processPath()` 给的是原生路径，`resolve()` 之后
  // 的目标标识不随分隔符变化，所以表必须按归一化键查。
  const files = new Map(Object.entries(entries).map(([key, value]) => [normalize(key), value]))

  return {
    calls: { readByteRange: 0, listDir: 0 },

    async resolve(path) {
      return { path: normalize(path) }
    },

    processPath(target) {
      return target.path
    },

    async stat(target) {
      const entry = files.get(target.path)
      if (entry === undefined) return undefined
      if (entry.type !== undefined && entry.type !== 'file') {
        return { type: entry.type, version: 'v1' }
      }
      // `noSize` 模拟"后端报不出大小"的提供方（契约里 size 是可选的）。
      if (entry.noSize === true) return { type: 'file', version: 'v1' }
      return { type: 'file', size: entry.bytes.length, version: 'v1' }
    },

    async readByteRange(target, range) {
      this.calls.readByteRange += 1
      const entry = files.get(target.path)
      if (entry === undefined) {
        const error = new Error('FS_NOT_FOUND')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      // 短读：slice 天然在末尾截断，与真实后端一致。
      return entry.bytes.slice(range.offset, range.offset + range.length)
    },

    async listDir(target, _signal) {
      this.calls.listDir += 1
      const entry = files.get(target.path)
      if (entry !== undefined && entry.children !== undefined) return entry.children
      // 目录本身可以不在扁平表里（只声明了它的子文件）——那就是一个隐式目录。
      // 但既没有条目、又推导不出任何子项时按真实语义抛 FS_NOT_FOUND：这保证了
      // "读不动的目录"这类错误路径仍然可测。
      if (entry === undefined && ![...files.keys()].some((key) => key.startsWith(target.path + '/'))) {
        const error = new Error('FS_NOT_FOUND')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      // 由扁平表推导直接子项：`<dir>/<name>` 且 name 里没有分隔符。
      const prefix = target.path === '' ? '' : target.path + '/'
      const seen = new Map()
      for (const key of files.keys()) {
        if (!key.startsWith(prefix) || key === target.path) continue
        const rest = key.slice(prefix.length)
        const slash = rest.indexOf('/')
        const name = slash === -1 ? rest : rest.slice(0, slash)
        if (name === '' || seen.has(name)) continue
        const isDirectory = slash !== -1
        seen.set(name, {
          name,
          type: isDirectory ? 'directory' : 'file',
          ...(isDirectory ? {} : { size: files.get(prefix + name).bytes.length }),
        })
      }
      return [...seen.values()]
    },
  }
}

/**
 * 造一个假 ctx。
 *
 * 只有一个 `fs`：0.3.0 删掉媒体库后，插件不再读 `workspaceRegistry`。
 *
 * @param fs - 假文件系统。
 * @returns 假 ctx。
 */
export function createFakeCtx(fs) {
  return {
    fs,
    get() {
      return undefined
    },
  }
}

/**
 * 造一个 `Range` 请求。
 *
 * @param url - 完整 URL。
 * @param range - `Range` 头；不传则不带头。
 * @param method - HTTP 方法。
 * @returns Request。
 */
export function rangeRequest(url, range, method = 'GET') {
  const headers = {}
  if (range !== undefined) headers.range = range
  return new Request(url, { method, headers })
}

/**
 * 浏览器半侧的冒烟测试。
 *
 * `lib/client.js` 是一个**手写的 bundle**（`window.__ModuleLoader__.load({...})`），
 * 正常情况下只有浏览器会执行它 —— 也就是说，写错了要到用户点开文件时才发现。
 * 这里给它一个最小的宿主替身：假的 `window`/`document`/`navigator`、一个够用的
 * React 桩、以及一个记录调用参数的假 ctx。于是"注册了什么""渲染出什么元素"
 * "回调有没有被调用"都能在 Node 里钉死。
 *
 * 覆盖的正是最贵的几个失误：
 *   · 扩展名列表没带上 mp4/m4a/mp3（用户的核心诉求）
 *   · `loading` 忘了写 `renderer`（会退化成 owner 先读完整文件）
 *   · slot key 与实现 id 不一致（正文永远不渲染）
 *   · 面板 id 与 `main` key 不一致（点图标会抛错）
 *   · 视频/音频选错标签、流地址没带 path
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

// ────────────────────────────────────────────────────────── React 桩

/** 极简 React 桩：够组件跑一遍首次渲染，并能把元素树序列化出来检查。 */
function createReactStub() {
  /**
   * 每个"组件实例"一份 hook 槽位，按元素在树里的**位置路径**记住 —— 这与 React 的
   * 位置身份一致，足以让"渲染 → 改 state → 再渲染"这条链在 Node 里跑通。
   */
  const instances = new Map()
  const effects = []
  let active = null
  let cursor = 0

  /** 取（或建）当前位置的实例槽位。 */
  function slot() {
    const index = cursor++
    if (active.hooks[index] === undefined) active.hooks[index] = { value: undefined, ref: null }
    return active.hooks[index]
  }

  const React = {
    createElement(type, props, ...children) {
      const flat = []
      for (const child of children) {
        if (Array.isArray(child)) flat.push(...child.flat(Infinity).filter((item) => item != null && item !== false))
        else if (child != null && child !== false && child !== true) flat.push(child)
      }
      return { type, props: props || {}, children: flat }
    },
    Fragment: 'Fragment',
    useState(initial) {
      const cell = slot()
      if (cell.value === undefined) cell.value = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next
      }
      return [cell.value, set]
    },
    useMemo(factory) {
      cursor += 1
      return factory()
    },
    useCallback(fn) {
      cursor += 1
      return fn
    },
    useRef(initial) {
      const cell = slot()
      if (cell.ref === null) cell.ref = { current: initial }
      return cell.ref
    },
    useEffect(fn, deps) {
      const cell = slot()
      const changed =
        deps === undefined ||
        cell.deps === undefined ||
        deps.length !== cell.deps.length ||
        deps.some((value, index) => !Object.is(value, cell.deps[index]))
      cell.deps = deps === undefined ? undefined : deps.slice()
      if (changed) effects.push(fn)
    },
  }

  /**
   * 递归渲染：函数组件会被真的调用（hooks 生效），宿主元素原样保留供断言检查。
   *
   * @param node - createElement 的结果。
   * @param key - 位置路径（稳定的实例身份）。
   * @returns 渲染后的树。
   */
  function render(node, key) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((child, index) => render(child, `${key}.${index}`))
    const { type, props, children } = node
    if (typeof type === 'function') {
      let instance = instances.get(key)
      if (instance === undefined) {
        instance = { hooks: [] }
        instances.set(key, instance)
      }
      const previous = active
      active = instance
      cursor = 0
      const fullProps = { ...props }
      if (children.length === 1) fullProps.children = children[0]
      else if (children.length > 1) fullProps.children = children
      let rendered
      try {
        rendered = type(fullProps)
      } finally {
        active = previous
      }
      return render(rendered, `${key}/r`)
    }
    return { type, props, children: children.map((child, index) => render(child, `${key}.${index}`)) }
  }

  return {
    React,
    /** 从根元素开始渲染整棵树（含嵌套函数组件）。 */
    renderRoot(element) {
      effects.length = 0
      return render(element, 'root')
    },
    /** 执行本轮收集到的 effect；返回 cleanup 列表。 */
    runEffects() {
      const collected = effects.slice()
      effects.length = 0
      return collected.map((fn) => fn())
    },
  }
}

// ─────────────────────────────────────────── 宿主替身（window/document）

/**
 * 装好浏览器宿主替身并加载 bundle。
 *
 * @returns `{ exports, react, restore, registrations, ctxEnv }`。
 */
function loadBundle() {
  const react = createReactStub()
  const createdElements = []
  const appendedStyles = []
  const warnings = []

  const documentStub = {
    baseURI: 'dsh-app://app/',
    head: {
      appendChild(node) {
        appendedStyles.push(node)
      },
    },
    querySelector() {
      return null
    },
    createElement(tag) {
      createdElements.push(tag)
      if (tag === 'video' || tag === 'audio') {
        return { canPlayType: () => 'probably', tagName: tag.toUpperCase() }
      }
      return {
        tagName: String(tag).toUpperCase(),
        style: {},
        dataset: {},
        appendChild() {},
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/png;base64,',
        click() {},
      }
    },
    pictureInPictureEnabled: true,
  }

  const windowStub = {
    __ModuleLoader__: {
      load(registration) {
        windowStub.__registration = registration
      },
    },
    localStorage: {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null
      },
      setItem(key, value) {
        this.store.set(key, value)
      },
    },
  }

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  }
  // `navigator` 在 Node 里是只读的 getter，不能挂到 globalThis 上；好在 bundle 是
  // 以 `new Function(..., 'navigator', ...)` 求值的，参数会遮蔽全局，组件里看到的
  // 就是这个替身。
  const navigatorStub = { clipboard: { writeText: async () => {} } }
  globalThis.window = windowStub
  globalThis.document = documentStub

  const source = readFileSync(CLIENT_PATH, 'utf8')
  // 用 Function 求值：bundle 是副作用脚本（调用 window.__ModuleLoader__.load），
  // 不是模块，不能用 import。参数名对齐宿主模块系统的 factory 契约。
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', 'console', source)(
    windowStub,
    documentStub,
    navigatorStub,
    { warn: (...args) => warnings.push(args.join(' ')), error: (...args) => warnings.push(args.join(' ')) },
  )

  const registration = windowStub.__registration
  assert.ok(registration, 'bundle 必须调用 window.__ModuleLoader__.load')
  const exports = registration.factory((name) => {
    if (name === 'react') return react.React
    throw new Error('未声明的外部依赖: ' + name)
  })

  return {
    registration,
    exports,
    react,
    documentStub,
    appendedStyles,
    warnings,
    createdElements,
    restore() {
      globalThis.window = previous.window
      globalThis.document = previous.document
      globalThis.fetch = previous.fetch
    },
  }
}

/**
 * 假的客户端 ctx：记录每次注册调用。
 *
 * @returns `{ ctx, log }`。
 */
function createClientCtx() {
  const log = { documentPreviews: [], slots: [], locales: [], effects: 0 }
  const ctx = {
    effect(fn) {
      log.effects += 1
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      register(namespace, dicts) {
        log.locales.push({ namespace, dicts })
      },
      bind() {
        return (key) => key
      },
    },
    documentPreviews: {
      register(definition) {
        log.documentPreviews.push(definition)
        return () => {}
      },
    },
    slots: {
      inject(name, callback) {
        return callback()
      },
      register(options, component) {
        log.slots.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, log }
}

/**
 * 渲染一个组件（含嵌套组件）+ 执行 effect。
 *
 * @param component - 组件函数。
 * @param props - 传给组件的 props。
 * @param react - 渲染器（`createReactStub()` 的返回值）。
 * @returns `{ tree, cleanups }`。
 */
function renderComponent(component, props, react) {
  const tree = react.renderRoot(react.React.createElement(component, props))
  const cleanups = react.runEffects()
  return { tree, cleanups }
}

/**
 * 深度遍历序列化后的元素树，找出满足条件的节点。
 *
 * @param node - 树节点。
 * @param predicate - 判定函数。
 * @returns 命中节点数组。
 */
function findAll(node, predicate) {
  const found = []
  const visit = (current) => {
    if (current === null || current === undefined || typeof current !== 'object') return
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (current.type !== undefined && predicate(current)) found.push(current)
    ;(current.children || []).forEach(visit)
  }
  visit(node)
  return found
}

// ───────────────────────────────────────────────────────────── 测试

test('bundle 注册 id / 导出 apply+inject，且只 require 基座里的 react', () => {
  const bundle = loadBundle()
  try {
    assert.equal(bundle.registration.id, 'dsh-media-preview')
    assert.equal(typeof bundle.exports.apply, 'function')
    assert.deepEqual(bundle.exports.inject, ['slots', 'locale', 'documentPreviews'])
    assert.equal(bundle.warnings.length, 0)
  } finally {
    bundle.restore()
  }
})

test('apply() 注册：预览实现 / 预览正文 / 媒体库面板 / 面板图标', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)

    // ① 预览实现：核心诉求的三个格式必须在，且是 renderer 模式。
    assert.equal(log.documentPreviews.length, 1)
    const definition = log.documentPreviews[0]
    assert.equal(definition.loading, 'renderer', 'renderer 模式才不会让 owner 先读完整文件')
    assert.equal(definition.wrap, false)
    assert.notEqual(definition.priority, 'builtin', '非 builtin 档才会盖过内建实现')
    for (const extension of ['mp4', 'm4a', 'mp3']) {
      assert.ok(definition.extensions.includes(extension), `缺少 ${extension}`)
    }
    // binaryExtensions 必须是 extensions 的子集（注册表会对超集抛错）。
    const declared = new Set(definition.extensions)
    for (const extension of definition.binaryExtensions) {
      assert.ok(declared.has(extension), `binaryExtensions 里的 ${extension} 不在 extensions 中`)
    }
    assert.equal(typeof definition.title, 'function')

    // ② 三个 slot：正文 key 必须等于实现 id；面板 id 必须同时是 main 的 key 与 icon 的 id。
    const byName = new Map(log.slots.map((entry) => [entry.options.name, entry.options]))
    assert.deepEqual([...byName.keys()].sort(), [
      'main',
      'sidebar.panellist',
      'sidebar.right.tab.document',
    ])
    assert.equal(byName.get('sidebar.right.tab.document').key, definition.id)
    const panelId = byName.get('main').key
    assert.equal(byName.get('sidebar.panellist').id, panelId)
    assert.equal(panelId, 'dsh-media-preview')
    for (const entry of log.slots) {
      assert.equal(entry.options.locale, 'dshMediaPreview')
      assert.equal(typeof entry.component, 'function')
    }
    assert.ok(log.locales.length >= 1)
    assert.equal(log.locales[0].namespace, 'dshMediaPreview')
  } finally {
    bundle.restore()
  }
})

test('正文：视频路径渲染 <video>，流地址带 Range 路由与绝对路径', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const loaded = []
    const { tree } = renderComponent(
      MediaBody,
      {
        t: (key) => key,
        resourceAddress: 'dsh-resource://file/session/s1/C%3A%5Cws%5Cclip.mp4',
        content: { kind: 'renderer', revision: 7, loaded: (version) => loaded.push(version), failed: () => {}, reload: () => {} },
        useTabInfo: () => ({ tab: { id: 'tab1', contentId: 'c1' } }),
        useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\clip.mp4', version: 'v9', bytes: 2048 } }),
        scrollportRef: () => {},
      },
      bundle.react,
    )

    const videos = findAll(tree, (node) => node.type === 'video')
    assert.equal(videos.length, 1)
    const src = videos[0].props.src
    assert.match(src, /^dsh-app:\/\/app\/api\/media\?/)
    assert.match(src, /path=C%3A%5Cws%5Cclip\.mp4/)
    // revision 参与 URL：owner 的"重新载入"必须真的换地址。
    assert.match(src, /r=7/)
    assert.equal(videos[0].props.controls, true)
    assert.equal(videos[0].props.preload, 'metadata')

    // 元数据就绪 → 通知 owner（把"正在渲染"落定，并记录展示版本）。
    videos[0].props.onLoadedMetadata({
      currentTarget: { duration: 12.5, videoWidth: 1920, videoHeight: 1080 },
    })
    assert.deepEqual(loaded, ['v9'])
  } finally {
    bundle.restore()
  }
})

test('正文：纯音频后缀渲染 <audio>，且不出现 <video>', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const { tree } = renderComponent(
      MediaBody,
      {
        t: (key) => key,
        resourceAddress: 'dsh-resource://file/session/s1/song.m4a',
        content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
        useTabInfo: () => ({ tab: { id: 'tab1', contentId: 'c1' } }),
        useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\song.m4a', version: 'v1', bytes: 99 } }),
        scrollportRef: () => {},
      },
      bundle.react,
    )
    assert.equal(findAll(tree, (node) => node.type === 'video').length, 0)
    assert.equal(findAll(tree, (node) => node.type === 'audio').length, 1)
  } finally {
    bundle.restore()
  }
})

test('正文：资源元数据还没到时显示读取中，而不是崩掉', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const { tree } = renderComponent(
      MediaBody,
      {
        t: (key) => key,
        resourceAddress: 'dsh-resource://file/session/s1/x.mp4',
        content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
        useTabInfo: () => ({ tab: { id: 'tab1', contentId: 'c1' } }),
        useResource: () => ({ status: 'loading', value: undefined }),
        scrollportRef: () => {},
      },
      bundle.react,
    )
    assert.equal(findAll(tree, (node) => node.type === 'video').length, 0)
    assert.equal(findAll(tree, (node) => node.type === 'audio').length, 0)
    // 文案键必须真的存在于字典里（否则用户看到的是 key）。
    assert.ok(findAll(tree, (node) => node.children.includes('readingFile')).length > 0)
  } finally {
    bundle.restore()
  }
})

test('正文：元素报错时给出诊断卡，并且不把失败甩给 owner', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const failed = []
    const loaded = []
    let tree
    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/movie.mkv',
      content: { kind: 'renderer', revision: 1, loaded: (v) => loaded.push(v), failed: () => failed.push(1), reload: () => {} },
      useTabInfo: () => ({ tab: { id: 'tab1', contentId: 'c1' } }),
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\movie.mkv', version: 'v1', bytes: 1024 } }),
      scrollportRef: () => {},
    }
    const first = renderComponent(MediaBody, props, bundle.react)
    const video = findAll(first.tree, (node) => node.type === 'video')[0]
    video.props.onError({ currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR' } } })
    // 再渲染一次：错误态应当换成诊断卡，并且 owner 收到的是 loaded（我们自己的卡接管了正文，
    // 不能让 owner 弹它自己的失败空态把诊断信息盖掉）。
    const second = renderComponent(MediaBody, props, bundle.react)
    tree = second.tree
    assert.equal(findAll(tree, (node) => node.type === 'video').length, 0)
    // 诊断卡里有 mkv 的容器提示与"下载/复制路径/重试"出路。
    assert.ok(findAll(tree, (node) => node.type === 'button').length >= 2)
    assert.deepEqual(failed, [])
  } finally {
    bundle.restore()
  }
})

test('媒体库面板：拉到清单后列出文件并可选中播放', async () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const Panel = log.slots.find((entry) => entry.options.name === 'main').component

    const payload = {
      roots: [{ label: 'ws', root: 'C:\\ws', files: 2 }],
      files: [
        { absolutePath: 'C:\\ws\\clip.mp4', name: 'clip.mp4', extension: 'mp4', kind: 'video', bytes: 2048 },
        { absolutePath: 'C:\\ws\\song.mp3', name: 'song.mp3', extension: 'mp3', kind: 'audio', bytes: 900 },
      ],
      truncated: false,
      errors: [],
      streamRoute: '/api/media',
    }
    const requested = []
    globalThis.fetch = async (url) => {
      requested.push(url)
      return { ok: true, status: 200, json: async () => payload }
    }

    const props = { t: (key) => key }
    renderComponent(Panel, props, bundle.react)
    // 等 fetch 的 promise 链落地。
    await new Promise((resolve) => setTimeout(resolve, 0))
    const { tree } = renderComponent(Panel, props, bundle.react)

    assert.equal(requested.length, 1)
    assert.match(requested[0], /^dsh-app:\/\/app\/api\/media-index/)
    const items = findAll(tree, (node) => node.props && node.props.className === 'dshmp-item')
    assert.equal(items.length, 2)

    // 点第一条 → 同一个元素树重渲染后应当出现 video 播放器。
    items[0].props.onClick()
    const afterSelect = renderComponent(Panel, props, bundle.react)
    const videos = findAll(afterSelect.tree, (node) => node.type === 'video')
    assert.equal(videos.length, 1)
    assert.match(videos[0].props.src, /clip\.mp4/)
  } finally {
    bundle.restore()
  }
})

test('正文：把真正的滚动容器上报为 scrollport（owner 契约：null 归还滚动职责）', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const reported = []
    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/clip.mp4',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\clip.mp4', version: 'v1', bytes: 10 } }),
      scrollportRef: (node) => reported.push(node),
    }
    const { tree } = renderComponent(MediaBody, props, bundle.react)

    const scroller = findAll(
      tree,
      (node) => node.props && node.props.className === 'dshmp-scroll' && typeof node.props.ref === 'function',
    )[0]
    assert.ok(scroller, '正文必须把滚动容器交给 owner')
    const node = { id: 'scrollport' }
    scroller.props.ref(node)
    assert.deepEqual(reported, [node])
    // 卸载时上报 null：owner 会把滚动职责还给共享正文。
    scroller.props.ref(null)
    assert.deepEqual(reported, [node, null])
  } finally {
    bundle.restore()
  }
})

test('正文：后缀是视频但实际只有音轨 → 收成音频版式', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/audio-only.mp4',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\audio-only.mp4', version: 'v1', bytes: 10 } }),
      scrollportRef: () => {},
    }
    const first = renderComponent(MediaBody, props, bundle.react)
    const video = findAll(first.tree, (node) => node.type === 'video')[0]
    assert.ok(video, 'mp4 默认按视频渲染')
    // 元数据说没有视频轨（videoWidth/videoHeight 都是 0）→ 不该继续留一个纯黑框。
    video.props.onLoadedMetadata({ currentTarget: { duration: 30, videoWidth: 0, videoHeight: 0 } })
    const second = renderComponent(MediaBody, props, bundle.react)
    assert.equal(findAll(second.tree, (node) => node.type === 'video').length, 0)
    assert.equal(findAll(second.tree, (node) => node.type === 'audio').length, 1)
  } finally {
    bundle.restore()
  }
})

/**
 * 造一个"支持 206 分段"的 fetch 替身。
 *
 * @param total - 实体总字节数。
 * @param chunkSize - 每次响应的最大字节数（模拟服务端裁剪）。
 * @returns `{ calls, fetch }`。
 */
function createRangedFetch(total, chunkSize) {
  const payload = new Uint8Array(total).map((_value, index) => index % 251)
  const calls = []
  return {
    calls,
    fetch: async (url, init) => {
      const range = init && init.headers ? init.headers.Range : undefined
      calls.push({ url, range })
      const match = /^bytes=(\d+)-$/.exec(String(range === undefined ? 'bytes=0-' : range))
      const start = match === null ? 0 : Number(match[1])
      const end = Math.min(total - 1, start + chunkSize - 1)
      const body = payload.slice(start, end + 1)
      return {
        status: 206,
        ok: true,
        headers: {
          get(name) {
            const key = String(name).toLowerCase()
            if (key === 'content-range') return `bytes ${start}-${end}/${total}`
            if (key === 'accept-ranges') return 'bytes'
            return null
          },
        },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      }
    },
  }
}

/** 让挂起的 promise 链跑完。 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('视频直连播放失败 → 自动完整缓冲，改用可自由 seek 的 Blob URL', async () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const mock = createRangedFetch(300 * 1024, 64 * 1024)
    globalThis.fetch = mock.fetch

    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/clip.mp4',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\clip.mp4', version: 'v1', bytes: 300 * 1024 } }),
      scrollportRef: () => {},
    }

    const first = renderComponent(MediaBody, props, bundle.react)
    const video = findAll(first.tree, (node) => node.type === 'video')[0]
    assert.ok(video)
    assert.match(video.props.src, /^dsh-app:\/\/app\/api\/media\?/)

    // Chromium 打不开容器（索引在末尾、取不到尾部）时就是这个错。
    video.props.onError({ currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } } })

    // 关键行为：不该直接甩错误卡，而应当进入完整缓冲。
    const during = renderComponent(MediaBody, props, bundle.react)
    assert.equal(findAll(during.tree, (node) => node.type === 'video').length, 0)
    assert.ok(
      findAll(during.tree, (node) => node.children.includes('bufferingTitle')).length > 0,
      '应当显示缓冲面板',
    )

    await settle()
    const after = renderComponent(MediaBody, props, bundle.react)
    const videos = findAll(after.tree, (node) => node.type === 'video')
    assert.equal(videos.length, 1)
    assert.match(videos[0].props.src, /^blob:/, '缓冲完成后应当改用 Blob URL')
    // 分段请求：第一段是 bytes=0-，后续接着上一段的末尾。
    assert.ok(mock.calls.length >= 2, '应当分多段取回')
    assert.equal(mock.calls[0].range, 'bytes=0-')
    assert.equal(mock.calls[1].range, 'bytes=65536-')
    // 传输事实要写进元数据，别让"到底发生了什么"变成谜。
    assert.ok(findAll(after.tree, (node) => node.children.includes('transportRanged')).length > 0)
    assert.ok(findAll(after.tree, (node) => node.children.includes('bufferedNoticeRanged')).length > 0)
  } finally {
    bundle.restore()
  }
})

test('结构性不支持的容器（mkv）不自动缓冲：直接给诊断卡，且不谎报容器问题', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    let fetches = 0
    globalThis.fetch = async () => {
      fetches += 1
      throw new Error('不该发生：mkv 不该触发完整缓冲')
    }

    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/movie.mkv',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\movie.mkv', version: 'v1', bytes: 1024 } }),
      scrollportRef: () => {},
    }
    const first = renderComponent(MediaBody, props, bundle.react)
    // mkv 按视频渲染，但 Chromium 结构上不支持 → 报 code 4。
    const video = findAll(first.tree, (node) => node.type === 'video')[0]
    video.props.onError({ currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } } })

    const after = renderComponent(MediaBody, props, bundle.react)
    assert.equal(fetches, 0, '不该为结构性不支持的容器下载整个文件')
    assert.equal(findAll(after.tree, (node) => node.type === 'video').length, 0)
    // 提示语必须按容器分岔：mkv 说容器不支持，而不是说"索引在末尾"。
    const text = JSON.stringify(after.tree)
    assert.ok(text.includes('hintContainer'), 'mkv 应当给出容器不支持的提示')
    assert.ok(!text.includes('hintIndex'), 'mkv 不该被解释成"索引在末尾"')
    assert.ok(!text.includes('bufferRetry'), 'mkv 不该出现完整缓冲按钮')
  } finally {
    bundle.restore()
  }
})

test('mp4 打不开时解释为"索引在末尾"，且超大文件只给手动按钮不自动下载', () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const huge = 300 * 1024 * 1024
    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/big.mp4',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\big.mp4', version: 'v1', bytes: huge } }),
      scrollportRef: () => {},
    }
    globalThis.fetch = async () => {
      throw new Error('超大文件不该被自动下载')
    }

    const first = renderComponent(MediaBody, props, bundle.react)
    const video = findAll(first.tree, (node) => node.type === 'video')[0]
    video.props.onError({ currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } } })

    const after = renderComponent(MediaBody, props, bundle.react)
    const text = JSON.stringify(after.tree)
    assert.ok(text.includes('hintIndex'), 'mp4 应当解释为索引在末尾')
    // 不自动下载，但用户明确点按钮时仍可缓冲。
    assert.ok(text.includes('bufferRetry'), '应当保留手动缓冲按钮')
  } finally {
    bundle.restore()
  }
})

test('取消缓冲后不会再自动开始（否则会变成取消/重启的死循环）', async () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const mock = createRangedFetch(300 * 1024, 64 * 1024)
    globalThis.fetch = mock.fetch

    const props = {
      t: (key) => key,
      resourceAddress: 'dsh-resource://file/session/s1/clip.mp4',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\clip.mp4', version: 'v1', bytes: 300 * 1024 } }),
      scrollportRef: () => {},
    }

    const first = renderComponent(MediaBody, props, bundle.react)
    findAll(first.tree, (node) => node.type === 'video')[0].props.onError({
      currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } },
    })
    const during = renderComponent(MediaBody, props, bundle.react)
    const cancel = findAll(during.tree, (node) => node.type === 'button' && node.children.includes('cancel'))[0]
    assert.ok(cancel, '缓冲面板必须有取消按钮')
    cancel.props.onClick()
    const cancelled = renderComponent(MediaBody, props, bundle.react)
    // 取消后回到播放器（流地址），元素会再次报错 —— 但这一次必须只给诊断卡。
    const video = findAll(cancelled.tree, (node) => node.type === 'video')[0]
    assert.ok(video)
    video.props.onError({ currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } } })
    const after = renderComponent(MediaBody, props, bundle.react)
    assert.equal(findAll(after.tree, (node) => node.type === 'video').length, 0)
    assert.ok(JSON.stringify(after.tree).includes('bufferRetry'), '应当给出手动缓冲按钮而不是再次自动缓冲')
  } finally {
    bundle.restore()
  }
})

/**
 * 从客户端源码里取出 zh / en 两个字典字面量并求值（它们是纯数据）。
 *
 * @returns `{ zh, en }`。
 */
function extractDictionaries() {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  const block = source.slice(
    source.indexOf('const zh = {'),
    source.indexOf('// ───────────────────────────────────────────────────── 插件入口'),
  )
  const zhLiteral = block.slice(block.indexOf('{'), block.indexOf('\n      }\n') + 8)
  const enBlock = block.slice(block.indexOf('const en = {'))
  const enLiteral = enBlock.slice(enBlock.indexOf('{'), enBlock.indexOf('\n      }\n') + 8)
  // eslint-disable-next-line no-new-func
  return { zh: new Function('return ' + zhLiteral)(), en: new Function('return ' + enLiteral)() }
}

/**
 * 复刻 `@deepseek-ai/dsh-client-locale` 的 translate()：
 * `template.replace(/\{(\w+)\}/g, …)`，参数缺失时**原样留下 `{name}`**。
 *
 * 这正是重点：漏传参数不会抛错，只会把 `{n}` 直接显示给用户。用真语义的 t
 * 渲染一遍，就能让这种缺陷在测试里现形。
 *
 * @param dict - 字典。
 * @returns `(key, params) => string`。
 */
function makeTranslator(dict) {
  return (key, params) => {
    const template = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    )
  }
}

test('所有渲染路径都不留下未填充的翻译占位符（{n} 之类）', async () => {
  const bundle = loadBundle()
  try {
    const { ctx, log } = createClientCtx()
    bundle.exports.apply(ctx)
    const t = makeTranslator(extractDictionaries().zh)
    const MediaBody = log.slots.find((entry) => entry.options.name === 'sidebar.right.tab.document').component

    const mock = createRangedFetch(300 * 1024, 64 * 1024)
    globalThis.fetch = mock.fetch

    const props = {
      t: t,
      resourceAddress: 'dsh-resource://file/session/s1/clip.mp4',
      content: { kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} },
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\clip.mp4', version: 'v1', bytes: 300 * 1024 } }),
      scrollportRef: () => {},
    }
    const assertNoPlaceholder = (tree, label) => {
      const leftovers = JSON.stringify(tree).match(/\{\w+\}/g)
      assert.equal(leftovers, null, `${label} 里有未填充的占位符: ${String(leftovers)}`)
    }

    // ① 直接播放态（进度/时长/分辨率/浏览器自评）
    const playing = renderComponent(MediaBody, props, bundle.react)
    assertNoPlaceholder(playing.tree, '播放态')

    // ② 缓冲进行中（bufferingProgress 的 {loaded}/{total}/{n}）
    findAll(playing.tree, (node) => node.type === 'video')[0].props.onError({
      currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } },
    })
    const buffering = renderComponent(MediaBody, props, bundle.react)
    assertNoPlaceholder(buffering.tree, '缓冲面板')

    // ③ 缓冲完成（bufferedNoticeRanged 的 {n}、transportRanged 的 {n}）
    await settle()
    const done = renderComponent(MediaBody, props, bundle.react)
    assertNoPlaceholder(done.tree, '缓冲完成态')

    // ④ 诊断卡（transportSegments 的 {n}）
    const failedProps = {
      ...props,
      resourceAddress: 'dsh-resource://file/session/s1/other.mp4',
      useResource: () => ({ status: 'live', value: { absolutePath: 'C:\\ws\\other.mp4', version: 'v1', bytes: 4096 } }),
    }
    const beforeFail = renderComponent(MediaBody, failedProps, bundle.react)
    const el = findAll(beforeFail.tree, (node) => node.type === 'video')[0]
    el.props.onError({ currentTarget: { error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' } } })
    await settle()
    const afterFail = renderComponent(MediaBody, failedProps, bundle.react)
    assertNoPlaceholder(afterFail.tree, '缓冲失败后的诊断卡')

    // ⑤ 媒体库面板
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [], roots: [], truncated: false, errors: [] }),
    })
    const Panel = log.slots.find((entry) => entry.options.name === 'main').component
    const panel = renderComponent(Panel, { t: t }, bundle.react)
    assertNoPlaceholder(panel.tree, '媒体库面板')
  } finally {
    bundle.restore()
  }
})

test('字典：中英文键集合一致，且被引用到的键都存在', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  const { zh, en } = extractDictionaries()
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    assert.equal(typeof zh[key], 'string', key)
    assert.equal(typeof en[key], 'string', key)
  }
  // 组件里用到的 t('...') 键必须都在字典里。
  // 前面那个 `(?<![\w$.])` 很关键：没有它，`document.createElement('style')`
  // 也会被当成一次 `t('style')` 调用而误报缺键。
  const used = new Set()
  const pattern = /(?<![\w$.])t\('([A-Za-z][A-Za-z0-9]*)'\)/g
  let match
  while ((match = pattern.exec(source)) !== null) used.add(match[1])
  for (const key of used) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `字典缺少被引用的键: ${key}`)
  }
})

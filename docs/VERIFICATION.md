# 验收报告 · dsh-media-preview 0.1.0

日期：2026-10-11 · 目标 DSH 版本：`0.2.0-rc.2`（profile `desktop`）

本文件区分三件事：**已经用证据钉住的**、**只从源码读出来、尚未在运行时观察到的**、以及**还没做的**。
最后一项请当成待办清单读，不要当成"应该没问题"。

---

## 一、自动化测试（81/81 通过）

```powershell
cd <仓库目录>
node --test "tests/*.test.mjs"
# ℹ tests 81  ℹ pass 81  ℹ fail 0
```

| 文件 | 覆盖 | 用例 |
|---|---|---|
| `tests/range.test.mjs` | `Range` 解析与生成 | 12 |
| `tests/formats.test.mjs` | 格式表 / 配置钳制 / 跳过目录 | 8 |
| `tests/scan.test.mjs` | 目录扫描（假 fs）：深度、上限、错误容忍、多根去重 | 7 |
| `tests/serve.test.mjs` | 托管路由的真实 `Request`/`Response` 语义、未知大小、加固头 | 23 |
| `tests/plugin.test.mjs` | 插件装配：注册了什么路由、配置是否生效 | 5 |
| `tests/client.test.mjs` | 客户端 bundle：加载、注册、渲染、报错、缓冲退路、翻译占位符、scrollport 契约 | 15 |
| `tests/parity.test.mjs` | 宿主 ↔ 客户端格式表/路由常量一致性 | 5 |
| `tests/integration-real-fs.test.mjs` | **真实文件**逐字节校验 | 6 |

### 被钉死的关键行为

- **`bytes=0-` 被裁到 `maxChunkBytes`**，`Content-Range` 如实写出实际范围（`bytes 0-65535/102400`），而不是回 200 或一次性读整个文件。这条是"大文件能边下边播"的全部依据。
- **`bytes=N-` 在 N 越界时回 416**（不是被误判成语法错误）。顺序写反会让播放器拖到文件末后拿到一个莫名其妙的 200 完整实体。
- **语法错误的 `Range` 被忽略**（按 RFC 回 200），不回 416、不回 500。
- **非媒体后缀一律 415**：`.credentials.yaml` / `id_rsa` / `.txt` 逐个断言。
- **真实 mp3**：`bytes=0-1023` 的字节与文件切片 SHA-256 相同；按"每次要剩余全部"的循环把各段拼回来，哈希等于整文件哈希（这正是播放器拖进度条时发生的事）。
- **3 MiB 真实文件**：跨 3 个 206 分块拼回文件哈希一致；无 Range 的整文件响应（内部多窗口流式）同样一致。
- **客户端**：`loading: 'renderer'`、`extensions` 含 mp4/m4a/mp3、`binaryExtensions ⊆ extensions`、正文 slot 的 `key` 等于实现 `id`、媒体库面板 `id` 等于 `main` 的 `key`、视频路径渲染 `<video>` 且 src 为 `dsh-app://app/api/media?path=…&r=7`、纯音频渲染 `<audio>`、元素报错时给诊断卡而不是把失败甩给 owner。

### 补丁文件本身也验过

用 DSH 自己 bundle 的 `yaml@2.9.1` 解析 `cordis.patch.yml`（从 `app.asar` 内提取），确认结构被解析为 `[{ insert: [{ id: 'dsh-media-preview', name: 'dsh-media-preview', config: {…} }] }]`——与已知可用的 `dsh-ark/cordis.patch.yml` 同构。YAML 写错会让整个 profile 起不来，所以这一步不能省。

---

## 二、从真实源码核实过的宿主契约

以下每一条都来自 `<DSH 安装目录>\resources\app.asar` 里的实际实现，不是文档推测。它们决定了本插件为什么这样写。

| 事实 | 来源 |
|---|---|
| `/api/*` 是**鉴权 fetch 通道**：主机必须回环或命中 `trustedHosts`，`Origin` 必须等于 `Host`，`sec-fetch-site: cross-site` 拒绝，且需要签名 cookie（否则 401）。 | `dsh-client-connection/lib/index.js` |
| 在它上面注册路由的写法是 `ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch: request => Response })`。 | `dsh-api-session-controller/lib/types/media-references.js` |
| 内建 `/api/file` **不支持 Range**：`fs.readBytes` → `new Response(bytes)` → 永远 200；上限是 `maxImageBytes`（默认 20 MiB），超出 413 且不截断。 | 同上 |
| 内建 `/api/file` **不做目录包含限制**（文档原文："目录包含关系与 MIME 类别均不限制访问"）—— 本插件因此加了后缀白名单。 | `dsh-api-session-controller/README.zh.md` |
| 文档预览的扩展点：`ctx.documentPreviews.register({ id, extensions, binaryExtensions, priority, title, loading, wrap })`，`loading` ∈ `text-pages`/`bytes-complete`/`renderer`，重复 `id` 抛错、`binaryExtensions` 不属于 `extensions` 抛错，优先级排序里**非 `builtin` 档一律排在前面**。 | `dsh-client-ui-sidebar-documentpreview/lib/client.js`（未压缩，带完整 JSDoc） |
| 音视频后缀今天被 `UNVIEWABLE_BINARY_EXTENSIONS` 拦下，该名单**只在没有任何实现匹配时才生效** —— 所以注册这些后缀就能接走它们。 | 同上 |
| 正文注册进 keyed、session 作用域的 `sidebar.right.tab.document`，`key` 必须等于实现 `id`；props 里带 `resourceAddress`/`content`/`wrap`/`scrollportRef`/`addResource`/`setResources` 与 `useTabInfo`/`useResource`（**都是 props，不是 import**）。 | 同上 |
| `loading: 'renderer'` 时 `content = { kind:'renderer', revision, loaded(version), failed(), reload() }`，owner **不读任何字节**。 | 同上 |
| `documentPreviews` 是经 `ctx.reflect.provide('documentPreviews', …)` 提供的 —— 那是 Cordis 注册服务的正规入口（Loader 自己就这么注册），因此**兄弟插件**可以用 `inject: ['documentPreviews']` 拿到它。 | `dsh-client-ui-sidebar-documentpreview/lib/client.js` + `cordis.js` |
| Files 树对文件行**不做扩展名/MIME/大小过滤**，点任意文件都会 `openResource(fileAddressFor(...))`；媒体地址今天落到文档预览标签，显示"暂不支持"。 | `dsh-client-ui-sidebar-files/lib/client.js` |
| `sidebar.panellist` 的图标组件**只收到 `{ size, active }`**，点击由外壳负责（它调 `ctx.layout.selectPanel(id)`）；`main` 面板按 `activePanelId` 派发，**若没有同名的 `main` key，点击会抛错** —— 所以两个座位必须一起注册。 | `dsh-client-ui-sidebar/lib/client.js`、`dsh-client-ui-layout/lib/client.js` |
| 桌面端 `protocol.handle('dsh-app', …)`：只本地服务 `/`、`/index.html`、`/assets/*`、`/favicon.svg`、`/manifest.webmanifest`，**其余 `dsh-app://app/**` 通配转发**到本机 HTTP 服务并注入 Host cookie。 | `app.asar` → `/lib/main.js` |
| 转发的请求头只删 `host`/`origin`/`cookie`/`sec-fetch-site`（**`range` 原样通过**），状态码原样复制（**206 存活**），`content-range`/`accept-ranges` 存活；body 是流式透传不是缓冲。 | 同上 |
| 宿主桥接把响应的 status 与 headers 原样 `writeHead`，再 `for await (const chunk of response.body) res.write(chunk)` —— 所以 `ReadableStream` 响应体会被如实流下去（整文件下载路径依赖这点）。 | `dsh-client-connection/lib/index.js` |
| `readBytes` 的字节窗口走 `range: { offset, length }`（0 起算），窗口**不受 32 MiB 整文件上限约束**；`listDir` 的条目形如 `{ name, type, size? }`，`stat` 形如 `{ type, size?, version }`。 | `dsh-api-workspace-files/lib/index.js`、`README.zh.md` |

### 一个已落地的设计取舍

桌面端转发时会**剥掉 `Content-Length`**（对所有转发响应都这样）。也就是说桌面里的 206 是"没有长度、只有 `Content-Range`"的响应。`Content-Range` 本身就是媒体栈判断总长与偏移的依据，浏览器会继续用新的 Range 请求取下一段；但**本报告未在运行时观察到这一点**，见下一节。

---

## 三、安装与实机装配（已验证）

2026-10-11 用 DSH 自己的插件管理装进 `desktop` profile（上游开发机上的 `link:` 安装）：

```
install_bundle  link:<仓库目录>
→ stage: enable · changed: true · application: applied
→ pnpm: + dsh-media-preview link:<仓库目录>   (exit 0)
```

**不需要重启**，宿主与浏览器两侧当场生效。以下都是从安装后的**实时 slot 树 / 插件清单**读到的，不是推断：

| 证据 | 读到的值 |
|---|---|
| 宿主插件行 | `include:dsh-media-preview` → `enabled: true`、`fiberPhase: "active"` —— `apply` 跑完了，说明两条 `connection.fetch.register` 调用没有抛错 |
| 预览正文 | `sidebar.right.tab.document` 的 occupant 多了 `dsh-media-preview/media`（与 8 个内建实现并列） |
| 媒体库面板 | `main` 的 occupant 多了 `key: "dsh-media-preview"`（与 `plugins`/`conversation`/`schedules` 并列） |
| 面板图标 | `sidebar.panellist` 的 occupant 多了 `id: "dsh-media-preview", order: 20` |

即：**bundle 被宿主提供 → 被浏览器执行 → 四个注册全部成功**，这条最容易出错的链路已经用运行时证据钉住了。

### 还没观察到的

1. **媒体库面板的观感**：图标是否出现、`main` 面板切换是否正常、返回对话是否需要点会话。
2. **完整缓冲在真机上的成功率**：它在单测里跑通（mock 206 分段 → Blob → `<video src="blob:…">`），但还没在真实 Electron 渲染进程里走过一遍。

---

## 三之二、首次实机运行的问题与修复（重要）

安装后第一次真机验证得到两组结果：

- **mp3 音频：正常**（说明鉴权路由、播放器、音频版式这条链是通的）。
- **mp4 视频：失败**，诊断卡报
  `来源不受支持（PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed）`。

### 定位

用 `tools/mp4-probe.mjs` 解剖那个文件，结论很明确：

```
ftyp offset=0        size=32    major=isom  compatible=isom iso2 avc1 mp41
mdat offset=40       size=15254481
moov offset=15254521 size=18600          ← 索引在文件**末尾**
trak#0: handler=vide codec=avc1  avcC[profile=77 level=31]   ← H.264 Main@3.1，可播
trak#1: handler=soun codec=mp4a  esds                        ← AAC，可播
```

**编码完全没问题，问题在布局**：`moov`（索引）在 15 MB `mdat` 之后，播放器必须先
seek 到文件尾部读出索引才能起播。而 mp3 是流式格式、不需要任何 seek ——
**所以"音频正常"根本不能证明分段读取在工作**，这个反例恰好把它暴露了出来。

`DEMUXER_ERROR_COULD_NOT_OPEN` 是 FFmpeg 打开容器失败的报错，不是"编码不支持"
（那会是 `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`）。也就是说：Chromium 没能拿到它
需要的字节，于是连容器都没打开。

### 修复

给播放器加一条**不依赖浏览器媒体栈是否发 Range** 的退路：

1. `<video>` 报错且容器属于"可播但可能索引在末尾"的一类（mp4/mov/m4a/mp3/webm…）时，
   **自动**改为用带 `Range` 的 `fetch` 逐段取完整文件 —— `Range` 由 JS 显式带上，
   服务端本来就回 206 —— 拼成 Blob 后播 `blob:` URL。内存里的 Blob 是完全可 seek 的，
   索引在末尾也能正常起播与拖动。
2. 过程中显示进度面板（已取字节 / 总量 / 段数 / 百分比）与取消按钮。
3. **每个 src 只自动试一次**：否则"取消 → 元素再次报错 → 又自动开始"会变成死循环。
4. 体积上限 256 MiB 内才自动做；更大的文件只给手动按钮，避免静默吃掉等量内存。
5. 结构性不支持的容器（mkv/avi/wmv…）**不**自动下载：那类是编码层面打不开，
   取完整文件只是白下几百 MB，因此直接给诊断卡。
6. **修正了误导性文案**：原来对任何 code 4 都说"MKV/AVI 这类容器浏览器不支持"，
   套在一个 H.264 mp4 上是错的、还会把人引去转码一个本来就能播的文件。
   现在按容器分岔：名单内的说容器不支持；名单外的说"索引在末尾，点完整缓冲"。
7. 诊断卡与元数据里新增**传输事实**：HTTP 状态、`Content-Range`、`Accept-Ranges`、
   分了几段 —— 让"是文件的问题还是取字节的问题"当场可辨，不用再猜。

这条修复同时覆盖了另一种情形：**服务器/传输层忽略 `Range` 直接回 200 完整实体**
（那时第一段就是全部，循环随即结束，元数据会显示"一次完整响应（200）"）。

### 实机验证清单（现在就能做，约 30 秒）

插件已装好并生效，右侧边栏与左侧图标栏都应已就位。工作区里也放好了现成素材：

| 素材 | 大小 | 用途 |
|---|---|---|
| `_media-samples/sample-15s.mp4` | 14.6 MB | 视频 + **跨段 Range**：超过默认 8 MiB 单次上限，拖动进度条即验证多段 206 |
| `ark-output/*.mp3` | 12 个，共 319 KB | 音频（真实语音），秒开 |

1. 右侧边栏 → **Files** → 进 `_media-samples` → 点 `sample-15s.mp4`。
   **期望**：出现播放器（不是"暂不支持预览此文件类型"）→ 播放出画面 → **把进度条直接拖到 60%**，几秒内从该处继续播。
2. 点 `ark-output` 里任意 `.mp3`。
   **期望**：音频版式（音符卡片 + 原生控件），能出声。
3. 左侧图标栏点**胶片图标**。
   **期望**：列出工作区里的媒体（至少包含上面这些），点一条就地播放。

任一步失败时，请带上 DevTools 里 `/api/media` 请求的状态码与 `Content-Range`、以及 Console 报错。

---

## 五、代码与安全审计（2026-10-11 自查）

两个审计脚本（只读）随仓库发布在 `tools/` 下，可复跑：

```powershell
node tools/audit-deadcode.mjs "<仓库目录>"
node tools/audit-capabilities.mjs "<仓库目录>"
```

### 5.1 死代码

| 检查 | 结果 |
|---|---|
| 声明后从未被引用 | **0** |
| 生产模块里"只被测试引用"的声明 | **0** |
| 未使用的 import | **0** |

审计查出并已删除的四类：

1. `lib/media-formats.mjs` 的 `MEDIA_EXTENSIONS` / `VIDEO_EXTENSIONS` / `AUDIO_EXTENSIONS` —— 删掉 `MEDIA_EXTENSIONS` 之后，另两个也失去生产消费者，只剩测试在用。测试改为 `Object.keys(VIDEO_MIME)`，顺序断言（客户端副本必须一致）由 parity 测试继续守着。
2. `lib/media-scan.mjs` 的 `DEFAULT_SCAN_LIMITS` —— 只在模块内部用，多余的 export 降级为模块私有常量。
3. **`/api/media-index?root=<绝对路径>` 整条能力** —— 客户端从来不传 `root`（面板只列工作区）。留着它等于多一个"枚举本机任意目录下媒体文件名"的入口：**能力面大于功能面就是漏洞**。现在显式 400 拒绝。
4. `workspaceRoots()` 里对 `root`/`directory`/`folder` 的猜测式回退 —— 已核对 `@deepseek-ai/dsh-workspace` 的 `Workspace` 类确实暴露 `get path()` / `get title()`，猜测字段不存在，删。

### 5.2 能力面（17 项全 PASS）

| 检查 | 结论 |
|---|---|
| 宿主半侧无任何写盘调用 | PASS |
| 不启动进程、不做动态求值（`eval` / `new Function`） | PASS |
| 不注入 HTML（无 `innerHTML` / `dangerouslySetInnerHTML`） | PASS |
| 无硬编码本机路径、无外部网络请求、不读环境变量 | PASS |
| 不注册绕过鉴权的 `webServer` 路由（只在 `connection.fetch` 上） | PASS |
| 不篡改全局对象或原型 | PASS |
| 宿主读取只经 `ctx.fs`，不 `import node:fs` | PASS |
| 客户端 bundle 只 `require('react')`（基座模块） | PASS |
| 路由全部挂在鉴权 `/api` 前缀下 | PASS |
| 响应带 `nosniff` / `private, no-store` / CSP `sandbox` | PASS |
| 后缀白名单、NUL 拒绝、绝对路径校验都在 | PASS |
| 运行时依赖 `{}`、install 脚本只有 `test` | PASS |

### 5.3 安全边界（相对内建 `/api/file` 的取舍）

| 维度 | 内建 `/api/file` | 本插件 `/api/media` |
|---|---|---|
| 鉴权 | `connection.fetch` 签名 cookie + 回环/Origin 栅栏 | **同一条通道，同一套栅栏** |
| 目录包含限制 | 文档明确"不限制访问" | 不做包含限制（同口径），但见下一条 |
| MIME / 后缀 | 不限制，任意绝对路径都可读 | **只服务白名单媒体后缀，其余 415** |
| 方法 | GET / HEAD | GET / HEAD |
| 大小 | 整个文件，`maxImageBytes`（20 MiB）封顶 | 分段 206，按 `maxChunkBytes` 裁剪 |
| 500 响应体 | 固定文案 | 固定文案（不回内部消息/路径） |
| 路径枚举能力 | — | 清单只覆盖**已注册工作区**，不接受任意目录 |

### 5.4 审计中发现并修掉的真实缺陷

1. **静默错误**：`ctx.fs` 的 `stat` 允许报不出 `size`（远程提供方就可能如此）。原实现把"没有 size"当成 0，会回一个 `Content-Length: 0` 的空响应 —— 看起来像"文件是空的"。现在改为**未知长度分块流式**送出（不宣告 `Accept-Ranges`），并有单测。
2. **能力面过大**：`?root=` 已移除（见 5.1）。
3. **信息泄漏**：未分类异常的 500 曾回显原始 message（可能含本机路径），改为固定文案。
4. **加固头不齐**：补上 `Content-Security-Policy: sandbox; default-src 'none'`（与内建一致）。
5. **客户端并发缺陷**：缓冲没有硬闸，连点按钮或元素重复报错可能同时起两次取数并泄漏一个 Blob URL。已加 `bufferAbortRef` 闸。
6. **翻译占位符**：`t(key, params)` 漏传参数不会报错，只会把 `{n}` 原样显示给用户。新增一个用**真语义翻译函数**（复刻 `dsh-client-locale` 的 `replace(/\{(\w+)\}/g, …)`）渲染全部界面状态的测试，任何未填充占位符都会当场失败。

### 5.5 "只以插件形式运行，不改 DSH 本身"的证据

| 断言 | 证据 |
|---|---|
| DSH 程序与资源未被修改 | `app.asar`、`app-update.yml` 的 mtime 仍是 **2026/9/29 18:34:26**（安装日期，今天没有变动） |
| 没有 DSH 应用文件被写过 | 逐文件遍历 DSH 安装目录：安装插件当天唯一出现的新文件是 `resources\runtime\...\python\Lib\**\__pycache__\*.pyc` —— 那是**捆绑 Python 解释器自己写的字节码缓存**（校验 YAML 时被导入的模块），与插件无关；插件的宿主半侧连写盘调用都没有（能力审计 PASS） |
| 补丁只新增、不覆盖 | 解析 `cordis.patch.yml`：顶层 1 个条目、键只有 `insert`、1 行 `{id: dsh-media-preview, name: dsh-media-preview}` —— **没有任何 id-targeted 覆盖或 disable** |
| 装的落点只有 profile | 唯一外部改动是 profile 的 `package.json` / `pnpm-lock.yaml` / `.modules.yaml` / `.pnpm-workspace-state-v1.json`（13:45:50，插件管理器所为）与 `node_modules\dsh-media-preview` 这个 junction —— 这是 DSH 自己的插件安装机制 |
| 只用公开扩展点 | 宿主：`ctx.connection.fetch.register` / `ctx.fs` / `ctx.get('workspaceRegistry')`；客户端：`ctx.documentPreviews.register` / `ctx.slots.register` / `ctx.locale.register` / `ctx.effect`。不 patch 任何宿主对象，不改任何内置 ID |
| 卸载即还原 | 全部注册都在 `ctx.effect(...)` 里（宿主 2 个、客户端 4 个），Cordis 卸载时自动释放；样式标签带 `data-plugin` / `data-plugin-css`，与内建渲染器同款约定，由模块系统回收 |
| 不碰用户数据 | 宿主半侧无写盘能力（审计 PASS）；客户端只在 `localStorage` 写 `dsh-media-preview:*` 四个偏好键，不读写 DSH 自己的键 |

---

## 六、已知限制

- **不支持画中画/截图的浏览器**：按 `document.pictureInPictureEnabled` 与 video 尺寸动态隐藏按钮，不是 bug。
- **`<video>` 与 `<audio>` 使用原生控件**：这是刻意选择（全屏、字幕、硬件解码、无障碍都靠它），代价是样式跟随系统而非主题。
- **媒体库面板会替换中央对话视图**：DSH 面板的通用行为（`selectPanel(id)` 语义如此），插件未做特殊处理。
- **扫描只覆盖已注册工作区**：没有注册工作区时回落到进程 cwd。工作区外的文件请从 Files 树点开。
- **不做转码**：浏览器解不出的容器（mkv/avi/wmv/flv/rmvb…）只给诊断与出路，不在插件里内置 ffmpeg。
- **`maxChunkBytes` 上限 64 MiB、下界 64 KiB**：更极端的值会被钳制，这是防止配置变成内存炸弹的护栏。

# dsh-media-preview

在 DSH 侧边栏里**直接播放**视频和音频：mp4、m4a、mp3 开箱可用，另外覆盖 60 多种常见音视频容器。

- **右侧文档预览**（主功能）：在 Files 树里点一个 `.mp4` / `.mp3`，右侧预览标签就会显示播放器 —— 进度条可以拖，大文件边下边播，不整块进内存。
- **左侧媒体库面板**（附带）：侧边栏图标栏多一个图标，点开列出工作区里所有能播的媒体，就地播放。

**版本与改动**：[发行版说明（Releases）](https://github.com/BlankTasftu/dsh-media-preview/releases) · [更新日志（CHANGELOG）](CHANGELOG.md) · [验收与审计记录](docs/VERIFICATION.md)

---

## 为什么需要这个插件

DSH 内建的文档预览（`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`）覆盖了 Office / 表格 / Markdown / 代码 / 图片 / PDF / HTML，但**音视频是被显式排除的**：`mp4`、`mov`、`avi`、`mkv`、`webm`、`mp3`、`wav`、`flac`、`ogg`、`m4a`、`aac`、`wma`、`opus` 全在它的 `UNVIEWABLE_BINARY_EXTENSIONS` 名单里。于是今天点开一个 mp4，看到的是「暂不支持预览此文件类型」，而且**一个字节都不会读**。

导航那一段本来是通的（Files 树对文件不做任何过滤，"点文件 → 右侧预览"是既有链路），缺的只是渲染器。所以本插件做的事很窄：把这些后缀认领下来，并把正文换成真正会播的播放器。

## 支持的格式

**本次要求的三项**：`mp4`、`m4a`、`mp3` ✅

| 类别 | 后缀 |
|---|---|
| 视频 | `mp4` `m4v` `mov` `webm` `mkv` `avi` `wmv` `flv` `f4v` `mpg` `mpeg` `m2v` `ts` `m2ts` `mts` `3gp` `3g2` `ogv` `rm` `rmvb` `asf` `vob` `divx` `mxf` `dv` `wtv` |
| 音频 | `mp3` `mp2` `mpga` `m4a` `m4b` `m4r` `m4p` `aac` `wav` `wave` `flac` `ogg` `oga` `opus` `spx` `weba` `wma` `aif` `aiff` `aifc` `amr` `awb` `ac3` `eac3` `dts` `mka` `mid` `midi` `ape` `wv` `tta` `caf` `au` `snd` `ra` `ram` `3ga` |

### 但"容器能打开"不等于"这个容器里的编码浏览器一定解得出"

播放靠浏览器内置解码器，所以最终能不能出声/出画，取决于**容器 + 编码**：

- **几乎总是能播**：`mp4`（H.264/H.265/AV1 + AAC/MP3）、`m4a`、`mp3`、`wav`、`flac`、`ogg`/`opus`、`webm`、`mov`（H.264）。
- **通常不行**：`mkv`、`avi`、`wmv`、`flv`、`rmvb`、`vob` 这些容器 Chromium 内核结构性不支持；即使里面的编码是 H.264 也一样。
- **能认、但要看编码**：`ts`/`m2ts`、`3gp`、`ogv`、`mxf`。

本插件不假装这些都能播，而是**把判断权交给浏览器并且如实告诉你**：

1. 播放前用 `canPlayType(mime)` 问一次浏览器，元数据里显示"支持 / 可能支持 / 不支持或未知"。
2. 真播不了时给一张诊断卡，写清楚失败在哪一层（网络 / 解码 / 来源不受支持）、容器与 MIME、浏览器自评，以及出路：**复制文件路径**、**下载**、**重试**，并解释"这类容器浏览器就是不支持，不是文件坏了"。
3. 想在这里播，转成 MP4（H.264 + AAC）即可。

> 后缀说是视频、实际只有音轨的文件（mp4/webm 里塞纯音频很常见）会在元数据到达后自动收成音频版式 —— 否则会留一个纯黑框。

### 索引在文件末尾的 mp4（最常见的"打不开"）

不少 mp4 的索引（`moov`）写在文件**末尾**（不是 faststart）。播放器必须先 seek 到尾部读出索引才能起播；如果浏览器媒体栈没能分段读到它，就会报 `DEMUXER_ERROR_COULD_NOT_OPEN` —— 这时**编码完全可播，问题只在取字节的方式**。

本插件对此有自动退路：一旦直接播放失败且容器属于可播类型，就改用带 `Range` 的 `fetch` 逐段取完整文件，拼成 Blob 后播放（Blob 在内存里可自由 seek）。过程中显示进度与取消；每个文件只自动试一次；超过 256 MiB 只给手动按钮，避免静默吃掉等量内存。诊断卡与元数据会写出传输事实（HTTP 状态、`Content-Range`、段数），一眼能分出"文件的问题"还是"取字节的问题"。

## 安装

插件是标准的 DSH bundle：`dsh.bundle.patch` 指向自己的 `cordis.patch.yml`，补丁里只有一行 `insert`（不覆盖、不禁用任何既有条目），客户端半侧由 `dsh.client.platform = "web"` 声明。零运行时依赖。

**方式 A：从 GitHub 安装（推荐）**

在 DSH 里打开 **设置 → 插件 → 安装**，填：

```
github:BlankTasftu/dsh-media-preview
```

**方式 B：手工等价操作**（与 GUI 所做的是同一件事）

```powershell
# 1) profile 的 package.json（$DSH_HOME\profiles\<profile>\package.json）
#    dependencies:        "dsh-media-preview": "github:BlankTasftu/dsh-media-preview"
#    dsh.profile.bundles: 追加 "dsh-media-preview"

# 2) 在该 profile 目录下装依赖（用 DSH 自带的 node + pnpm）
cd $DSH_HOME\profiles\<profile>
node <DSH 运行时>\node\bin\node.exe <DSH 运行时>\pnpm\bin\pnpm.mjs install

# 3) 重启 DSH（宿主半侧的路由在启动时装配；客户端 bundle 由宿主在 /plugins 下提供）
```

**方式 C：本地开发**——把仓库克隆到任意目录，用 `link:<仓库目录>` 代替上面的 git 规格；改代码后重新加载即可生效，不必重新发布。

> 实测记录：`github:` 规格已验证可解析并安装（`pnpm add github:BlankTasftu/dsh-media-preview` → `dsh-media-preview 0.1.0`，约 10 秒）。上游开发机本机是用 `link:`（方式 C）装的，因此**GUI 里点"安装"的完整交互流程**没有在第二台机器上复现过；若那条路遇阻，方式 C 一定可行。
>
> 另外：**从 git 安装只会拿到 `lib/` + `docs/` + `README.md`**（`package.json` 的 `files` 字段如此），`tests/`、`tools/` 只对克隆仓库的人可见（要跑测试请克隆）。

卸载：从 `dsh.profile.bundles` 与 `dependencies` 里删掉 `dsh-media-preview`，`pnpm install`，重启。

### 装好后 30 秒验证

自己在工作区里放两个文件即可（**不需要任何测试素材**）：

| 准备 | 用来验证什么 |
|---|---|
| 一个 **mp4**，最好 > 8 MiB（默认单次响应上限） | 视频 + 分段读取：超过上限就会真的走"多段 206"，拖动进度条能同时验证 Range |
| 一个 **mp3** 或 **m4a** | 音频版式与出声 |

1. 右侧边栏 → **Files** → 点那个 mp4。
2. 期望：出现播放器（不是"暂不支持预览此文件类型"）→ 点播放能出画面 → **把进度条直接拖到 60% 处**，几秒内从该处继续播。
3. 再点那个 mp3：期望出现音频版式（音符卡片 + 原生控件）并能出声。
4. 左侧图标栏点**胶片图标**：期望列出工作区里的媒体文件，点一条就地播放。

遇到问题时的自证途径：诊断卡与元数据里会给出**传输事实**（HTTP 状态、`Content-Range`、`Accept-Ranges`、分了几段），浏览器 DevTools 的 Network 里也能看到 `/api/media` 的 206 响应 —— 两者一对，就知道是"文件的问题"还是"取字节的问题"。提交 issue 时请带上这两样。

## 怎么用

**右侧预览**：打开右侧边栏 → Files 标签 → 点任意音视频文件。或者让模型 `present` 一个媒体文件，从交付卡片点开。

**媒体库**：左侧边栏的图标栏会出现一个胶片图标，点开是工作区里所有媒体文件的列表（可按名字/路径筛选，点一条就地播放）。注意：这个面板占据中央区域，会替换掉对话视图 —— 点任意会话即可回到对话（这是 DSH 面板的通用行为，不是本插件的特殊处理）。

**播放器自带**：原生控件（全屏、画中画、字幕、键盘无障碍）+ 下面一条工具带：

| 控件 | 说明 |
|---|---|
| 播放/暂停 | 等价于空格或 `K`（播放器聚焦时） |
| 速度 | 0.5× ~ 2×，偏好记在 localStorage，跨标签页保留 |
| 循环 | 同上 |
| 静音 | 音量/静音偏好同样持久化 |
| 截图 | 视频当前帧导出 PNG（仅视频） |
| 画中画 | 浏览器支持时出现（仅视频） |
| 复制路径 | 复制 Host 绝对路径，便于丢给系统播放器 |
| 下载 | 走无 Range 的整文件响应（服务端流式读出，不整块进内存） |
| 重新载入 | 让 owner 递增 revision → URL 变化 → 元素真的重取流 |

键盘（焦点在播放器内时）：`空格`/`K` 播放暂停、`←`/`→` ±5 秒、`↑`/`↓` 音量、`M` 静音、`L` 循环、`F` 全屏。

## 它是怎么工作的

```
浏览器（右侧预览正文 / 媒体库面板）
   │  ① useResource(address) → Host 绝对路径
   │  ② <video src="api/media?path=…&r=<revision>">
   ▼
DSH 鉴权 fetch 通道  /api/media      ← 本插件注册，自带回环+Origin+cookie 三道闸
   │  Range → 206 / Content-Range / Accept-Ranges / 416
   ▼
ctx.fs.readByteRange(target, {offset, length})   ← 组合文件系统，访问策略仍然生效
```

三个关键决定：

1. **用鉴权 fetch 通道（`ctx.connection.fetch`），不用裸 `webServer` 路由。**
   这条通道已经替插件做了主机栅栏、`Origin`/`sec-fetch-site` 校验和签名 cookie 验证；自己做等于重写一套安全模型，还会和内建 `/api/file` 分叉。桌面端 `dsh-app://app/**` 是**通配转发**到本机服务的（只白名单了 `/`、`/assets/*` 等少数路径），所以渲染进程里 `new URL('api/media?…', document.baseURI)` 直接可达，shell 会注入 cookie。

2. **自己实现 Range，并且如实服务整个区间。**
   内建 `/api/file` 是 `readBytes` 整个文件后 200 返回，并且在 `maxImageBytes`（默认 20 MiB）处直接 413 —— 既播不了大文件，也没有 `Content-Range`，进度条拖不动。所以本插件自己解析 `Range`、回 206/416。
   其中一条**踩过坑的**：播放器第一次常发 `Range: bytes=0-`（字面意思是"到文件末尾"）。早先的版本为了"防止一次读进内存"，把区间裁到 8 MiB 再发、并在 `Content-Range` 里如实写出实际范围——**这个思路是错的**：播放器会把"短 206"当成**流已结束**。实测在一部 623 MB / 34 Mbps 的片子上表现为"播约 2 秒就跳到结尾"（8 MiB ÷ 34 Mbps ≈ 1.95 秒），在一部 36 MB / 2 Mbps 的压缩版上表现为"能播但进度条拖不动"。正确做法与所有媒体服务器一致：**要多少区间就给多少，但用流式发送**——内存由读取窗口（`streamChunkBytes`）约束，而不是由裁区间约束。

3. **预览用 `loading: 'renderer'` 模式。**
   这是文档预览里唯一"owner 不替你读字节"的模式，正好适合媒体：把流地址交给 `<video>`，字节永远不经过 JS。

## 配置

写在 profile 补丁里本插件那一行的 `config:` 块（`dsh-media-preview/cordis.patch.yml` 是默认值来源）。所有数值都会被钳制到合法区间，**写错了只会回落默认值，不会让路由注册不上**。

| 字段 | 默认 | 含义 |
|---|---|---|
| `stream.streamChunkBytes` | `1048576`（1 MiB） | 流式发送时的读取窗口，即**内存上限**（64 KiB ~ 16 MiB）。它只决定"每次从磁盘读多少"，不决定响应发多少 —— 客户端要多少区间就给多少 |
| `stream.streamChunkBytes` | `1048576`（1 MiB） | 无 Range 的整文件响应的内部读取窗口（内存上限，非响应上限） |
| `library.maxFiles` | `400` | 媒体库一次最多列出多少文件（1 ~ 5000） |
| `library.maxDepth` | `6` | 扫描递归深度（0 ~ 32） |
| `library.maxVisited` | `20000` | 最多访问多少目录项后停下 |
| `library.maxEntriesPerDir` | `500` | 单个目录最多看多少项 |
| `library.skipDirectories` | 内置表（`node_modules`、`.git`、`dist`…） | 跳过的目录名（小写比较）；空数组视为未配置 |

## 安全边界

值得看清楚，因为这条路由能把文件字节交给浏览器：

- **鉴权在通道上**：只有带签名 cookie 的请求能到达 handler；未带 cookie 是 401，跨站来源是 403。桌面端由 Electron 主进程注入 cookie，渲染进程不需要（也拿不到）任何密钥。
- **后缀白名单**：只服务上表列出的媒体后缀，其余一律 **415**。内建 `/api/file` 的文档明确写着"目录包含关系与 MIME 类别均不限制访问"，本插件**不继承**这个性质 —— 即使请求已经通过鉴权，`.credentials.yaml`、`id_rsa`、`.txt` 也读不到。（把文件改名成 `.mp3` 是唯一绕过方式，代价可见。）
- **只读**：只有 `GET` 与 `HEAD`，没有写路径。
- **读经 `ctx.fs`**：路径解析、沙箱与访问策略仍由组合文件系统执行，没有绕过它直接读本机磁盘。
- **响应加固**：`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`。
- **路径必须绝对**：相对路径、含 NUL 的路径直接 400（不接受被 cwd 解释的路径）。

## 排障

| 症状 | 原因与出路 |
|---|---|
| 点开 mp4 仍是「暂不支持预览此文件类型」 | 插件没加载（重启 DSH 后仍如此 → 看设置→插件里 `dsh-media-preview` 是否启用）。 |
| 有播放器但一按播放就报「浏览器无法播放这个文件」 | 诊断卡会说明是哪一层失败。若是 mp4/mov 报 `DEMUXER_ERROR_COULD_NOT_OPEN`，多半是索引在末尾 —— 点「完整缓冲后重试」，或看它是否已自动开始缓冲。 |
| 卡在「正在完整缓冲…」很久 | 这个文件只能整份取下来才能播（索引在末尾）。可以取消，然后下载到本地用系统播放器看。 |
| 进度条拖不动 | 说明响应没有 `Content-Range`。本插件的路由是有 206 的；若你正经过反向代理或自定义 `webServer` 路由访问，代理可能吞掉了 Range 头。完整缓冲模式不受此影响。 |
| 视频播两秒就跳到结尾 / 进度条拖不动 | 0.1.x 的已知缺陷（响应被裁成"短 206"，播放器当成流结束），0.2.0 已修。若仍复现，说明宿主半侧还是旧代码 —— 重启 DSH 让插件重新加载。 |
| 媒体库面板是空的 | 面板列的是**已注册工作区**下的媒体（没有注册工作区时回落到进程 cwd）。文件在别的目录时，用右侧 Files 树直接点开。 |
| 媒体库列表被截断 | 达到 `library.maxFiles` / `maxVisited` / `maxDepth` 上限，面板底部会写明。调大对应配置即可。 |

## 开发

```powershell
node --test "tests/*.test.mjs"     # 81 个用例
```

测试分三层（见 `docs/VERIFICATION.md`）：

- **纯函数层**：Range 解析（含 `bytes=0-`、`bytes=-N`、越界 416、语法错误被忽略）、格式表、配置钳制、目录扫描。
- **HTTP 层**：直接驱动真实 `Request`/`Response` 断言状态码、`Content-Range`、字节切片；其中 `tests/integration-real-fs.test.mjs` 用**真实的 mp3** 与 3 MiB 合成文件做逐段拼接 + SHA-256 比对。
- **客户端层**：`lib/client.js` 是手写 bundle，测试里用最小 React 桩把它真的跑起来，断言注册了什么、渲染出 `<video>` 还是 `<audio>`、流地址是否正确、报错时是否给出诊断卡。

`tests/parity.test.mjs` 会解析客户端源码里的格式表并与宿主模块逐项比对 —— 两边各有一份表（client bundle 不能 import 宿主模块），改漏一边会当场失败。

`tests/version.test.mjs` 把**版本规则**变成会失败的检查：`package.json` 的 `version` 必须是合法 semver，`CHANGELOG.md` 必须有对应小节且是最新的一节。规则本身写在 [`CHANGELOG.md`](CHANGELOG.md) 开头 —— 简言之：改了用户装到的东西就要有新版本号，每个 tag 都建一个发行版，三者（`version` / CHANGELOG 小节 / tag 名）必须一致。

`tests/integration-real-fs.test.mjs` 需要真实素材：把任意 mp3 放进仓库旁的 `media-samples/`，或用 `DSH_MEDIA_SAMPLE_DIR=<目录>` 指定；没有素材时这一层**跳过而不是假装通过**。

代码与安全审计的结果、以及"只以插件形式运行"的证据，见 [`docs/VERIFICATION.md`](docs/VERIFICATION.md) 第五、六节。两个只读审计脚本随仓库发布，可随时复跑：

```powershell
node tools/audit-deadcode.mjs .       # 死代码 / 未使用的 import
node tools/audit-capabilities.mjs .   # 能力面：写盘、进程、动态求值、外部网络、鉴权旁路…
```

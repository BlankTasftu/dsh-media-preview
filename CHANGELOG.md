# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。每个版本在
[GitHub Releases](https://github.com/BlankTasftu/dsh-media-preview/releases) 里
另有一份面向使用者的发行说明；本文件是仓库内的滚动记录。

## 版本规则（重要）

1. **`package.json` 的 `version`、本文件最新的 `## [x.y.z]` 小节、以及 tag 名 `vx.y.z` 三者必须一致。**
2. **任何改动 `main` 上"用户装到的东西"的提交，都要有对应的新版本**：功能新增 → minor，
   修缺陷 / 只改文档 → patch，破坏兼容 → major。
3. **每个 tag 都建一个发行版**，发行说明取本文件对应小节。
4. 这条规则由 `tests/version.test.mjs` 自动检查：版本号不是合法 semver、或本文件缺少
   对应小节，`npm test` 就会失败。

> 这条规则是被一次真实的疏漏逼出来的：曾经有 4 个提交（1 个功能 + 3 个文档）都写着
> `0.1.0`，`main` 已经比 `v0.1.0` 多出 2 个提交却仍是同一个版本号 —— 于是"从 main 装到的
> 0.1.0"和"tag v0.1.0"是两份不同内容却同名同版本，谁也没法从版本号判断自己装的是哪一份。

## [0.1.1] - 2026-10-11

只改文档与工具链，不改运行时行为（`lib/` 与 `tests/` 的既有用例全部保持通过）。

### 新增

- `CHANGELOG.md`：仓库内的滚动更新日志，并写明版本规则。
- `tests/version.test.mjs`：把版本规则变成会自动失败的检查 ——
  `package.json` 的 `version` 必须是合法 semver，且 `CHANGELOG.md` 必须有对应小节。
- README 顶部加"版本与改动"入口（Releases / CHANGELOG / 验收记录）。

### 变更

- README 安装说明补上实测结论：`github:` 规格已验证可解析并安装；
  并说明从 git 安装只包含 `files` 字段里的 `lib/`、`docs/`、`README.md`。

### 修复

- 上一版遗留：`main` 的版本号停在 `0.1.0`，与 tag `v0.1.0` 早已不是同一份内容。本版把它拉回一致。

## [0.1.0] - 2026-10-11

首个发布版。

### 新增

- **右侧边栏文档预览**：认领 60+ 音视频后缀（`mp4` / `m4a` / `mp3` 开箱可用），把预览正文
  换成真正的播放器。此前这些后缀落在内建预览的"不支持预览"名单里，且一个字节都不会读。
- **工作区媒体库面板**（`sidebar.panellist` + `main`）：列出工作区里的媒体，点一条就地播放。
- **播放器工具带**：倍速 / 循环 / 静音 / 截图 / 画中画 / 复制路径 / 下载 / 重新载入；
  偏好写进 `localStorage`，跨标签页保留。
- **诊断卡**：失败时给出容器、MIME、浏览器自评（`canPlayType`）与**传输事实**
  （HTTP 状态、`Content-Range`、`Accept-Ranges`、分了几段），并给出可执行的出路。

### 宿主半侧

- 在鉴权 fetch 通道（`ctx.connection.fetch`）上新增 `GET|HEAD /api/media`：自己解析 `Range`，
  回 `206` / `416` / `Content-Range`，单次响应按 `maxChunkBytes` 裁剪；**后缀白名单**，
  只服务媒体文件（其余 415）。
- 新增 `GET /api/media-index`：按已注册工作区扫描媒体，深度/条目数/文件数三重有界，
  跳过 `node_modules` 等常见大目录，单个目录读不动不影响整份清单。

### 修复（0.1.0 定版前的实机验证中发现）

- **索引在文件末尾的 mp4**（非 faststart）会报 `DEMUXER_ERROR_COULD_NOT_OPEN`：
  改为在浏览器侧用带 `Range` 的 `fetch` 逐段取完整文件、拼成 Blob 播放，可自由 seek。
  每个文件只自动试一次；超过 256 MiB 只给手动按钮。
- **`ctx.fs` 报不出 `size` 时**曾回 `Content-Length: 0` 的空响应（看起来像"文件是空的"）：
  改为未知长度分块流式送出，且不宣告 `Accept-Ranges`。
- **完整缓冲缺少并发闸**：连点按钮或元素重复报错可能取两遍整个文件并泄漏一个 Blob URL。
- **翻译占位符**：`t(key, params)` 漏传参数不会报错，只会把 `{n}` 原样显示给用户。
- **误导性文案**：对任何"来源不受支持"都套用"MKV/AVI 这类容器不支持"，
  会把 H.264 mp4 的用户引向"去转码一个本来就能播的文件"。

### 安全

- 移除 `?root=<绝对路径>` 参数：它等于"枚举本机任意目录下的媒体文件名"，而客户端从不需要它
  —— 能力面大于功能面就是漏洞。
- 未分类异常的 500 不再回显内部消息（可能含本机路径），改回固定文案。
- 响应补齐 `Content-Security-Policy: sandbox; default-src 'none'`，与内建 `/api/file` 一致。

### 验证

- 81 个自动化测试，含**真实文件**逐段拼接 + SHA-256 逐字节比对；
  客户端 bundle 用最小 React 桩真跑，断言注册项、渲染分支与错误路径。
- 能力面审计 17 项全 PASS（无写盘 / 无进程 / 无动态求值 / 无外部网络 / 不篡改全局…）。
- 全部结论与证据见 [`docs/VERIFICATION.md`](docs/VERIFICATION.md)。

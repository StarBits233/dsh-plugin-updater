# @dsh-external/dsh-plugin-updater

DSH 插件更新检查与一键更新插件（含 link 本地插件、GitHub releases 下载、失败回滚、热重启、自动检查与站内通知）。

> 源仓库：`XinXie-WRJ/dsh-plugin-updater`（Private）｜本地：`D:\MyProject\Tools\DSHTools\dsh-plugin-updater`
> 功能规划与演进记录见 `2-AIAgent使用笔记/6-DSH使用笔记/DSH插件开发日志/DSH 插件更新插件（dsh-plugin-updater）/架构与功能优化方案.md`

## 功能总览

| 模块 | 能力 | 版本 |
|---|---|---|
| npm 插件检测 | 读 profile `dependencies` → 并发查 registry `/latest` + 本地 `node_modules` 版本 semver 比对（10 分钟缓存，`?force=1` 强制刷新） | 3.1 |
| 完整 semver | `v` 前缀 / `-beta`/`-rc` 预发布排序 / build metadata / 降级保护（`latest < installed` 不算更新） | 3.1 |
| link 插件检测 | 解析 `link:`/`file:` 目标 → 本地 git 落后检测（`git fetch` + `HEAD..origin/<branch>`）→ 或 GitHub releases | 3.1/3.5 |
| 自动定时检查 | `timer` 服务，默认 6h（可配 1h/6h/12h/24h/7d），发现新版本写持久化通知 | 3.2 |
| 站内通知 | 右上/右下角铃铛徽标（未读数）+ 弹窗列表 + 全部已读 | 3.2 |
| 失败自动回滚 | npm：记录旧版本，`dsh plugin add name@旧版本` 回滚；git：记录 HEAD commit，`git reset --hard` 回滚；GitHub 下载：备份旧目录恢复 | 3.3 |
| 热重启 | 更新成功后重建 Cordis fiber（purge loadCache → 重新 import → registry.plugin 重建），免手动重启 | 3.4 |
| GitHub releases 更新 | 无本地 git 但有 `repository` 字段 → 查 GitHub 最新 releases/tags（API 限流自动降级 `git ls-remote`）→ codeload 下载 tarball → 校验 → 覆盖替换 | 3.5 |
| 主程序更新 | 检测 `@deepseek-ai/dsh` 版本 vs npm latest；一键更新（`allowCoreUpdates` 开关，默认关闭，且不自动重启宿主） | 3.6 |
| git 安全护栏 | `git reset --hard` 前检测 dirty → 自动 stash（可选关闭）；per-package 并发更新锁 | 3.7 |
| UI 卡片网格 | 图标 + 名称 + 状态徽标（黄可更/绿最新/红失败）+ 当前→最新版本行 + 来源标签 + 更新按钮 + 顶部横幅 + toast | 3.8 |
| 忽略/历史 | 标记「忽略更新」（持久化，列表与通知都跳过）+ 更新历史（时间/插件/版本/成败） | 3.9 |
| 单测 | `node --test`（registry / git / store / semver / updater / github，21 断言） | 3.10 |
| 构建可移植 | `build.ps1`（Windows 原生）+ `scripts/build.sh`（bash）；Config 全参数化（间隔/通知/GitHub/超时） | 3.11 |

## 构建 / 测试

```pwsh
# Windows 原生构建（探测本机 DSH runtime，junction 链接编译依赖 → tsc host → tsdown client）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build.ps1
# 或经 npm：npm run build:win / npm run build（bash 需 DSH_CHECKOUT 指向 dsh checkout）

npm test          # 21 项单测
npm run typecheck # host 侧 tsc --noEmit
```

产物：`lib/index.js`（host）+ `lib/*.js`（纯函数模块）+ `lib/client.js`（Web UI bundle）+ `lib/types/*.d.ts`。

## 安装 / 注入

- 方式一（profile 热装配，免重启）：注入器环境内 `dev_install_package <本目录>`（改 profile `package.json` 加 `link:` 依赖 + `dsh.profile.bundles` + 建 junction）。
- 方式二（重启生效）：`dsh plugin --profile web add <本目录>`，重启 dsh web / 桌面版后生效。

本插件同时注册：

- **设置页 section「插件更新」**：进入自动检查、重新检查（强制刷新）、全部/单独更新、link 插件 git 更新、GitHub 更新、忽略按钮、更新历史。
- **右上/右下角铃铛**：未读更新通知徽标 + 弹窗列表 + 全部已读。
- **Agent 工具** `_dsh_external_dsh_plugin_updater`：`action=status` 检查 / `action=update` 更新（`name@latest` 数组）。
- **HTTP API**（前缀 `/@dsh-external/dsh-plugin-updater/api`）：
  - `GET /status[?force=1]` → 检查结果（`npm[]` / `outdated[]` / `linked[]` / `errors[]`，命中缓存附 `cached`）
  - `POST /update` `{ packages: [{name, latest}] }` → 逐包更新（含回滚 + 热重启）
  - `GET /state` → 全量状态（检查结果 + 主程序状态 + 通知 + 忽略列表 + 更新历史 + 当前配置）
  - `POST /check` → 手动检查；`GET /notifications` / `POST /notifications/read`
  - `POST /ignore` / `POST /unignore` `{ name }` → 忽略/取消忽略
  - `POST /update-main` `{ confirm: true }` → 主程序更新（仅 `allowCoreUpdates` 开启）

## 配置（Config schema，可在 DSH 设置页修改）

| 字段 | 默认 | 说明 |
|---|---|---|
| `profile` | `web` | 目标 DSH profile |
| `checkIntervalMs` | 6h | 自动检查间隔（≥60s，≤30 天） |
| `notifyNewUpdates` | `true` | 发现新版本时写站内通知 |
| `allowCoreUpdates` | `false` | 是否允许更新 DSH 主程序（高危，默认关） |
| `fetchTimeoutMs` | 8000 | npm/GitHub 请求超时 |
| `githubToken` | 空 | GitHub API token（限流 60/h 时提升配额；也认 `GITHUB_TOKEN` 环境变量） |

## 数据存储

`<DSH_HOME>/storages/dsh-plugin-updater/store.json`（JSON 原子写）：

- `notifications[]`（最近 100 条，按 `dedupe` 去重）
- `ignored[]`（忽略列表）
- `history[]`（更新历史，最近 200 条）
- `knownLatest{}`（name → 上次已知最新版本，用于判定"新出现更新"）
- `lastCheckAt`

## 风险与安全

- **热重启**：更新成功后才重建 fiber；重载失败不阻塞（返回提示手动重启）。注意勿在更新本插件自身时依赖热重启。
- **主程序更新**：默认关闭；开启后仍需用户手动重启 DSH 生效。
- **git 更新**：默认启存（dirty 时自动 stash，`protectLocal` 可关）；`git reset --hard` 只针对 `origin/<当前分支>`。
- **GitHub 限流**：匿名 60/h，多级降级 API → 缓存 → `git ls-remote`（0 配额）。
- 更新 **npm** 插件会用 `dsh plugin add <pkg>@<latest>` 实际修改 profile 依赖并重新安装，请确认后再点击。

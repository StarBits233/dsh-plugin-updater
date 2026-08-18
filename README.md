# @dsh-external/dsh-plugin-updater (v0.1.0)

DeepSeek Harness (DSH) 插件更新检查与一键更新套件（支持 NPM 插件、本地 Link 插件、GitHub Release 下载、一键版本回滚、热重载、更新日志预览、环境体检自愈与智能站内通知）。

> 仓库：`https://github.com/StarBits233/dsh-plugin-updater`

## ✨ 核心特性

- 🔍 **双轨更新检测**：同时支持 NPM 官方/镜像源与本地 Link 插件（Git 远程对比 + GitHub Release）的双轨并发检测与 SemVer 比对；
- 📝 **更新日志预览**：在卡片中直接预览新版本的 GitHub Release Notes / Changelog，更新前清晰掌握变更内容；
- 🛡️ **一键版本回滚**：更新历史中支持一键版本降级与安全恢复；
- ⚡ **智能热重载**：更新成功后自动重建 Cordis Fiber，支持一键热重载与便捷重启命令复制；
- ⚙️ **可视化配置面板**：无需编辑配置文件，在界面直接调整定时检查周期、通知开关与 GitHub Token；
- 📋 **多选批量更新 & 状态筛选**：支持即时搜索、状态分类标签（全部/可更新/NPM/Link/已忽略）与多选批量更新；
- 🩺 **环境健康体检**：一键检测 Profile 依赖完整性与 Windows Junction 软链异常并自动执行自愈修复；
- 🔔 **零打扰智能通知**：右下角悬浮铃铛在 0 未读时自动完全隐身，仅在发现新版本时智能滑出，并已做底部任务栏位置避让；
- 🎨 **主题无缝自适应**：全面对接 DSH 原生 Design Tokens，完美适配浅色（Light）与深色（Dark）外观。

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

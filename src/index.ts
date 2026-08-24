/**
 * @dsh-external/dsh-plugin-updater — host 侧（入口）
 *
 * 功能：检查 DSH web profile 全部插件的更新（npm 插件 + link 本地包），并在设置页提供「一键更新」。
 *       与桌面版无任何耦合（纯 DSH 插件）。
 *
 * 模块拆分（P0-3.1）：semver.ts / registry.ts / git.ts / types.ts。
 * P0-3.2：自动定时检查（timer 服务）+ 站内通知（store.ts 持久化 + /state /check /notifications API）。
 *
 * 路由：
 *   GET  /@dsh-external/dsh-plugin-updater/api/status            → 检查更新（?force=1 跳过缓存）
 *   POST /@dsh-external/dsh-plugin-updater/api/update            → 执行更新（dsh plugin add pkg@latest / git 同步）
 *   GET  /@dsh-external/dsh-plugin-updater/api/state             → 全量状态（检查结果+通知+配置+历史）
 *   POST /@dsh-external/dsh-plugin-updater/api/check             → 手动触发一次检查
 *   GET  /@dsh-external/dsh-plugin-updater/api/notifications     → 通知列表
 *   POST /@dsh-external/dsh-plugin-updater/api/notifications/read → 全部已读
 */
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import {
  readRegistryUrl, checkNpmUpdates, mapLimit, fetchLatest, fetchDistTags, readTargetDescription, readTargetVersion,
} from './registry.js'
import {
  gitRemoteHomepage, gitBehindStatus, tryGitUpdate, resolveLinkTarget,
} from './git.js'
import {
  backupNpmState, backupGitState, runNpmUpdateWithRollback, runGitUpdateWithRollback, runGithubDownloadUpdate, healLinkJunctions,
} from './updater.js'
import { inspectAndHealHoist } from './hoist.js'
import { checkPresetUpdates, updatePreset } from './preset.js'
import { diagnoseDshProcess, killProcessTree } from './process.js'
import { hotReloadPlugin } from './reload.js'
import { githubLatest, parseGhRepo, fetchChangelog } from './github.js'
import { isNewer } from './semver.js'
import { Config as UpdaterConfigSchema, type Config as UpdaterConfigType } from './config.js'
import { PluginStore } from './store.js'
import type { NpmItem, LinkItem, OutdatedItem, PresetItem, ProcessDiagnostic, DoctorResult, UpdateResult, UpdateResultCached, UpdateResultValue } from './types.js'

export const name = '@dsh-external/dsh-plugin-updater'
export const inject = ['tools', 'webServer', 'timer'] as const

export const Config = UpdaterConfigSchema
export type Config = UpdaterConfigType

/** 解析 DSH home（无外部依赖：~/.dsh 或 $DSH_HOME）。 */
function dshHome(): string {
  const env = process.env.DSH_HOME
  if (env && env.trim().length > 0) return resolve(env.trim())
  return join(homedir(), '.dsh')
}

function profileDir(profile: string): string {
  return join(dshHome(), 'profiles', profile)
}

/** 检查结果进程内缓存。 */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE = new Map<string, { at: number; value: UpdateResult & { notifiedAt?: string } }>()

/** 解析 dsh CLI 的真实 Node 入口。优先当前正在运行的 DSH 宿主（node 同目录 node_modules），
 *  其次 profile / 全局 npm / 插件旁路。 */
let dshBinCache: string | null | undefined
function resolveDshBin(): string | null {
  if (dshBinCache !== undefined) return dshBinCache
  const candidates = [
    // 当前正在运行的 DSH 宿主：node 与 @deepseek-ai/dsh 位于同一 node_modules（准确，避免更新到旁路全局副本）
    join(dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(process.env.LOCALAPPDATA ?? '', 'DeepSeek Harness', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(profileDir('web'), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        dshBinCache = c
        return c
      }
    } catch {
      // ignore
    }
  }
  dshBinCache = null
  return null
}

/** 执行 dsh CLI：`node <dshBin> <args>`（跨平台）。 */
async function runDsh(args: string[], cwd: string, timeoutMs = 300000): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = resolveDshBin()
  if (!bin) {
    const dshCmd = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
    return runCmd(dshCmd, args, cwd, timeoutMs)
  }
  return runCmd(process.execPath, [bin, ...args], cwd, timeoutMs)
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 120000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const isWin = process.platform === 'win32'
    const finalCmd = isWin && !cmd.includes('.') && (cmd === 'npm' || cmd === 'pnpm' || cmd === 'dsh') ? `${cmd}.cmd` : cmd
    // 关键：对 node.exe / git.exe / process.execPath 等二进制可执行文件，绝对不能开 shell: true！
    // 否则 Windows cmd.exe 在路径含空格（如 AppData\Local\DeepSeek Harness）时会截断报错。
    // 只有 .cmd / .bat 文件才需要 shell: true。
    const useShell = isWin && (finalCmd.toLowerCase().endsWith('.cmd') || finalCmd.toLowerCase().endsWith('.bat'))
    execFile(finalCmd, args, { cwd, timeout: timeoutMs, windowsHide: true, shell: useShell, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolvePromise({ code: err ? (err as any).code ?? 1 : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** 读取 profile package.json 的 dependencies。 */
function readDependencies(profile: string): Record<string, string> {
  try {
    const raw = readFileSync(join(profileDir(profile), 'package.json'), 'utf8')
    return (JSON.parse(raw).dependencies ?? {}) as Record<string, string>
  } catch {
    return {}
  }
}

/** 是否为 link:/file: 本地安装。 */
function isLinked(spec: string): boolean {
  return /^(?:link|file):|^\.{1,2}(?:[/\\]|$)/.test(spec)
}

/** 读取 link 目标 package.json 的 repository 字段（推导 GitHub 仓库）。 */
function readGhRepo(target: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as { repository?: unknown }
    const repo = parseGhRepo(pkg.repository)
    return repo ?? undefined
  } catch {
    return undefined
  }
}

/** 检查更新：直接依赖并发查 registry /latest + 本地 node_modules 版本比对。 */
async function computeUpdates(profile: string, isIgnored?: (name: string) => boolean, fetchTimeoutMs = 8000, githubToken = ''): Promise<UpdateResult> {
  const dir = profileDir(profile)
  const deps = readDependencies(profile)
  const linked: LinkItem[] = []
  const npmNames: string[] = []
  for (const [name, spec] of Object.entries(deps)) {
    if (isLinked(spec)) {
      const target = resolveLinkTarget(dir, spec)
      linked.push({
        name,
        spec,
        version: target ? readTargetVersion(target) : undefined,
        description: target ? readTargetDescription(target) : undefined,
        homepage: target ? gitRemoteHomepage(target) : undefined,
        ghRepo: target ? readGhRepo(target) : undefined,
      })
    } else if (!/^(?:git|github|gitlab|bitbucket|hg):/.test(spec)) {
      npmNames.push(name)
    }
  }

  if (linked.length) {
    const statuses = await mapLimit(linked, 4, async (item) => {
      if (isIgnored && isIgnored(item.name)) return { ...item, ignored: true }
      // 本地 git → 检测落后
      if (item.homepage) {
        const target = resolveLinkTarget(dir, item.spec)
        const st = target ? await gitBehindStatus(runCmd, target) : null
        if (st) {
          return { ...item, gitBehind: st.behind, gitBranch: st.branch, ghLatest: null }
        }
      }
      // 无本地 git 但有 GitHub 仓库 → 查 GitHub releases（3.5）
      if (item.ghRepo && !item.homepage) {
        const repo = item.ghRepo
        const gh = await githubLatest(repo, null, fetchTimeoutMs, githubToken)
        if (gh) return { ...item, ghLatest: gh.version, ghTag: gh.tag }
      }
      return item
    })
    linked.splice(0, linked.length, ...statuses)
  }

  const registry = readRegistryUrl(dir, dshHome())
  const { npm, errors } = await checkNpmUpdates(dir, npmNames, registry, { timeoutMs: fetchTimeoutMs })

  if (isIgnored) {
    for (const n of npm) {
      if (isIgnored(n.name)) {
        n.ignored = true
      }
    }
    for (const l of linked) {
      if (isIgnored(l.name)) {
        l.ignored = true
      }
    }
  }

  const outdated: OutdatedItem[] = npm
    .filter((n): n is NpmItem & { current: string; latest: string } => n.outdated && !n.ignored && !!n.current && !!n.latest)
    .map((n) => ({ name: n.name, current: n.current!, latest: n.latest! }))

  // 扫描 Agent Presets
  const presets = await checkPresetUpdates(dshHome(), fetchTimeoutMs, githubToken, isIgnored)

  // 探查进程与端口状态
  const processInfo = await diagnoseDshProcess()

  return { checkedAt: new Date().toISOString(), profile, profileDir: dir, npm, outdated, linked, presets, processInfo, errors }
}

/** 核心检查 + 通知判定（供 API 与定时器共用）。 */
async function checkUpdates(ctx: Context, config: Config, force = false): Promise<UpdateResultCached> {
  const now = Date.now()
  const hit = CACHE.get(config.profile)
  if (!force && hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true }
  }
  const githubToken = config.githubToken || process.env.GITHUB_TOKEN || ''
  const value = await computeUpdates(config.profile, (name) => st(ctx).isIgnored(name), config.fetchTimeoutMs, githubToken)
  CACHE.set(config.profile, { at: now, value })

  // P0-3.2：发现"新更新"→ 站内通知（去重）
  const store = st(ctx)
  if (config.notifyNewUpdates) {
    for (const n of value.npm) {
      if (n.outdated && !n.ignored && n.latest && n.current) {
        if (store.rememberLatest(n.name, n.latest, n.current)) {
          store.pushNotification({
            kind: 'update-available',
            title: `${n.name} 有新版本`,
            body: `${n.current} → ${n.latest}`,
            dedupe: `${n.name}@${n.latest}`,
          })
        }
      }
    }
  }
  return value
}

/** 定时器触发：后台检查（不阻塞、吞异常）。 */
async function scheduledCheck(ctx: Context, config: Config): Promise<void> {
  try {
    await checkUpdates(ctx, config, true)
  } catch {
    // 定时检查失败静默（下次再试）
  }
}

/** 主程序（@deepseek-ai/dsh）状态检测（3.6 + 预发布通道）：读运行实例版本 + npm dist-tags (latest & next)。 */
async function checkMainUpdate(config: Config): Promise<{
  current: string | null
  latest: string | null
  prerelease: string | null
  hasStableUpdate: boolean
  hasPrereleaseUpdate: boolean
  outdated: boolean
  updateable: boolean
}> {
  const mainPkgDir = join(dirname(resolveDshBin() ?? ''), '..', '..')
  let current: string | null = null
  try {
    const pkg = JSON.parse(readFileSync(join(mainPkgDir, 'package.json'), 'utf8')) as { version?: string }
    current = typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    // runtime 可能不在标准位置，从 resolveDshBin 目录找上一级
    try {
      const bin = resolveDshBin()
      if (bin) {
        const p = JSON.parse(readFileSync(join(dirname(bin), '..', 'package.json'), 'utf8')) as { version?: string }
        current = typeof p.version === 'string' ? p.version : null
      }
    } catch { /* ignore */ }
  }
  const registry = readRegistryUrl(profileDir(config.profile), dshHome())
  const distTags = await fetchDistTags(registry, '@deepseek-ai/dsh', config.fetchTimeoutMs)
  const latest = distTags?.latest ?? null
  const next = distTags?.next ?? null

  const hasStableUpdate = !!current && !!latest && isNewer(latest, current)
  // 预发布更新判定：存在 next 标签且 next 比当前已装版本更新，且如果存在 latest，next 也比 latest 更新（或 latest 等于 current）
  const hasPrereleaseUpdate = !!current && !!next && isNewer(next, current) && (!latest || isNewer(next, latest) || !hasStableUpdate)
  const prerelease = hasPrereleaseUpdate ? next : null
  const outdated = hasStableUpdate || hasPrereleaseUpdate

  return {
    current,
    latest,
    prerelease,
    hasStableUpdate,
    hasPrereleaseUpdate,
    outdated,
    updateable: true,
  }
}

/** 主程序后台看门狗全自动升级（3.6 + Watchdog 机制）：生成脱离主进程生命周期的看门狗脚本并启动。 */
async function runMainUpdate(ctx: Context, config: Config, target: string = 'latest'): Promise<{ ok: boolean; output: string; watchdog?: boolean }> {
  const cleanTarget = target.trim() || 'latest'
  const rtDir = join(process.env.LOCALAPPDATA ?? '', 'DeepSeek Harness', 'runtime')
  const scriptPath = join(dshHome(), 'dsh-watchdog-update.ps1')
  const logPath = join(dshHome(), 'dsh-watchdog-update.log')
  const currentPid = process.pid

  const scriptContent = `# DSH Watchdog Updater Script
$ErrorActionPreference = 'Continue'
$target = "${cleanTarget}"
$rtDir = "${rtDir.replace(/\\/g, '\\\\')}"
$currentPid = ${currentPid}
$logFile = "${logPath.replace(/\\/g, '\\\\')}"

function Log($msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Log "=== Watchdog update started for @deepseek-ai/dsh@$target (Parent PID: $currentPid) ==="

# 1. 等待以确保 HTTP 响应完整返回前端
Start-Sleep -Milliseconds 1500

# 2. 终止当前旧 node 进程释放文件占用锁
try {
  $proc = Get-Process -Id $currentPid -ErrorAction SilentlyContinue
  if ($proc) {
    Log "Terminating process $currentPid to release file locks..."
    Stop-Process -Id $currentPid -Force -ErrorAction SilentlyContinue
  }
} catch {
  Log "Process termination notice: $_"
}

# 等待文件系统锁完全释放
Start-Sleep -Seconds 2

# 3. 若存在桌面版独立 Runtime，优先升级 Runtime 目录
if (Test-Path (Join-Path $rtDir "package.json")) {
  Log "Updating Desktop runtime in $rtDir ..."
  Push-Location $rtDir
  & npm install "@deepseek-ai/dsh@$target" --save 2>&1 | Out-File -Append -FilePath $logFile -Encoding UTF8
  Pop-Location
}

# 4. 同步升级全局 npm
Log "Updating global npm ..."
& npm install -g "@deepseek-ai/dsh@$target" 2>&1 | Out-File -Append -FilePath $logFile -Encoding UTF8

# 5. 检查是否需要重新拉起（如果是纯 CLI 环境没有桌面守护进程）
$isDesktop = Get-Process -Name 'dsh-desktop' -ErrorAction SilentlyContinue
if (-not $isDesktop) {
  Log "Standalone CLI mode detected: relaunching dsh web..."
  Start-Process powershell -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',"dsh web --port 3080"
} else {
  Log "Desktop App mode detected: desktop supervisor will auto-restart DSH backend."
}

Log "=== Watchdog update script finished ==="
`

  try {
    writeFileSync(scriptPath, scriptContent, 'utf8')
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', scriptPath,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()

    const msg = `已启动后台看门狗升级程序（目标版本: ${cleanTarget}）。DSH 正在自动完成升级并重启，请稍候约 10-15 秒...`
    st(ctx).addHistory({ name: '@deepseek-ai/dsh', from: null, to: cleanTarget, ok: true, kind: 'main', output: msg })
    return { ok: true, output: msg, watchdog: true }
  } catch (err: any) {
    const errMsg = `看门狗升级程序启动失败: ${String(err?.message ?? err)}`
    st(ctx).addHistory({ name: '@deepseek-ai/dsh', from: null, to: cleanTarget, ok: false, kind: 'main', output: errMsg })
    return { ok: false, output: errMsg }
  }
}

/** 执行更新：npm 走 dsh plugin add（带回滚）；link 走 git（带回滚 + dirty 保护）。带 per-package 并发锁（3.7）。 */
const RUNNING_UPDATES = new Set<string>()

async function runUpdate(ctx: Context, config: Config, packages: { name: string; latest: string }[]): Promise<UpdateResultValue> {
  const dir = profileDir(config.profile)
  const deps = readDependencies(config.profile)
  const results: { name: string; latest: string; ok: boolean; output: string }[] = []
  const store = st(ctx)
  for (const p of packages) {
    // 3.7: 并发锁：同包已在更新中 → 跳过并提示
    if (RUNNING_UPDATES.has(p.name)) {
      results.push({ ...p, ok: false, output: '该插件正在更新中（并发锁），请稍后再试' })
      continue
    }
    RUNNING_UPDATES.add(p.name)
    try {
      const res = await updateOne(ctx, config, dir, deps, store, p)
      results.push({ ...p, ...res })
    } finally {
      RUNNING_UPDATES.delete(p.name)
    }
  }
  // 更新完成后自动自愈检查 link 软链与 Hoist 提升规则
  try {
    healLinkJunctions(dir)
    inspectAndHealHoist(dir, true)
  } catch {
    // best-effort
  }
  return { results }
}

/** 单包更新（含 npm/link/github/preset，带回滚与热重启）。 */
async function updateOne(
  ctx: Context, config: Config, dir: string, deps: Record<string, string>, store: PluginStore,
  p: { name: string; latest: string },
): Promise<{ ok: boolean; output: string }> {
  // Preset 预设更新处理
  if (p.name.startsWith('preset:')) {
    const presetName = p.name.replace(/^preset:/, '')
    const resPreset = await updatePreset(dshHome(), presetName, config.fetchTimeoutMs, config.githubToken || process.env.GITHUB_TOKEN || '')
    store.addHistory({ name: p.name, from: null, to: resPreset.version ?? null, ok: resPreset.ok, kind: 'preset', output: resPreset.output })
    return { ok: resPreset.ok, output: resPreset.output }
  }

  const spec = deps[p.name] ?? ''
  if (isLinked(spec)) {
    const target = resolveLinkTarget(dir, spec)
    if (!target) return { ok: false, output: 'link 目录解析失败，请手动更新' }
    const gitBackup = await backupGitState(runCmd, target, p.name)
    if (gitBackup) {
      const upd = await runGitUpdateWithRollback(runCmd, target, gitBackup)
      store.addHistory({ name: p.name, from: gitBackup.oldCommit.slice(0, 8), to: null, ok: upd.ok, kind: 'git', output: upd.output })
      return { ok: upd.ok, output: upd.output + (upd.rolledBack ? '（已回滚）' : '') }
    }
    const ghRepo = readGhRepo(target)
    if (ghRepo) {
      const gh = await githubLatest(ghRepo, null, config.fetchTimeoutMs, config.githubToken || process.env.GITHUB_TOKEN || '')
      if (gh) {
        const dl = await runGithubDownloadUpdate(runCmd, target, { repo: ghRepo, version: gh.version, tarball: gh.tarball, tag: gh.tag }, p.name)
        store.addHistory({ name: p.name, from: null, to: gh.version, ok: dl.ok, kind: 'git', output: dl.output })
        return { ok: dl.ok, output: dl.output }
      }
    }
    const plain = await tryGitUpdate(runCmd, target, p, { protectLocal: true })
    store.addHistory({ name: p.name, from: null, to: null, ok: plain.ok, kind: 'git', output: plain.output })
    return { ok: plain.ok, output: plain.output }
  }
  // npm 更新（updater.ts 单一路径：执行 → 验证 → 失败回滚）
  const npmBackup = backupNpmState(dir, p.name, p.latest)
  const r = await runNpmUpdateWithRollback(
    (args) => runDsh(args, dir, 300000),
    config.profile,
    dir,
    npmBackup,
  )
  let finalOk = r.ok
  let finalOutput = r.output + (r.rolledBack ? '（已回滚）' : '')
  if (r.ok && !r.rolledBack) {
    // 3.4: 热重启（更新成功后重建 fiber，免手动重启）
    const pkgDir = join(dir, 'node_modules', ...p.name.split('/'))
    const hrel = await hotReloadPlugin(ctx, p.name, pkgDir)
    finalOutput = finalOutput ? `${finalOutput}\n${hrel.output}` : hrel.output
  }
  store.addHistory({ name: p.name, from: npmBackup.oldVersion, to: r.ok ? p.latest : null, ok: finalOk, kind: 'npm', output: finalOutput })
  return { ok: finalOk, output: finalOutput }
}

// 用 WeakMap 存每个 ctx 对应的 store，避免污染模块级单例。
const STORE_MAP = new WeakMap<object, PluginStore>()
function st(ctx: Context): PluginStore {
  let s = STORE_MAP.get(ctx as object)
  if (!s) {
    s = new PluginStore(dshHome())
    STORE_MAP.set(ctx as object, s)
  }
  return s
}

function writeJson(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: Context, config: Config): void {
  const API = '/@dsh-external/dsh-plugin-updater/api'

  const router = async (req: any, res: any) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(API, '') || '/'
    const store = st(ctx)

    try {
      // GET /status
      if (req.method === 'GET' && pathname === '/status') {
        const force = url.searchParams.get('force') === '1'
        writeJson(res, 200, { ok: true, value: await checkUpdates(ctx, config, force) })
        return
      }
      // POST /update
      if (req.method === 'POST' && pathname === '/update') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const packages = Array.isArray(body?.packages) ? body.packages : []
        writeJson(res, 200, { ok: true, value: await runUpdate(ctx, config, packages) })
        return
      }
      // GET /state
      if (req.method === 'GET' && pathname === '/state') {
        const cur = CACHE.get(config.profile)
        const main = await checkMainUpdate(config)
        writeJson(res, 200, {
          ok: true,
          value: {
            checkedAt: cur?.value.checkedAt ?? null,
            unread: store.unreadCount(),
            notifications: store.snapshot().notifications,
            ignored: store.snapshot().ignored,
            history: store.snapshot().history.slice(0, 20),
            lastCheckAt: store.snapshot().lastCheckAt,
            main,
            config: { checkIntervalMs: config.checkIntervalMs, notifyNewUpdates: config.notifyNewUpdates, allowCoreUpdates: config.allowCoreUpdates },
          },
        })
        return
      }
      // POST /update-main（3.6 + 预发布通道，仅 allowCoreUpdates）
      if (req.method === 'POST' && pathname === '/update-main') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        if (body?.confirm !== true) {
          writeJson(res, 400, { ok: false, error: '需要 { confirm: true }' })
          return
        }
        const target = typeof body?.target === 'string' && body.target.trim().length > 0 ? body.target.trim() : 'latest'
        const r = await runMainUpdate(ctx, config, target)
        writeJson(res, 200, { ok: r.ok, value: r })
        return
      }
      // POST /check
      if (req.method === 'POST' && pathname === '/check') {
        const value = await checkUpdates(ctx, config, true)
        value && writeJson(res, 200, { ok: true, value })
        return
      }
      // GET /changelog
      if (req.method === 'GET' && pathname === '/changelog') {
        const name = url.searchParams.get('name') || ''
        const version = url.searchParams.get('version') || ''
        const githubToken = config.githubToken || process.env.GITHUB_TOKEN || ''
        const info = await fetchChangelog(name, version, githubToken, config.fetchTimeoutMs)
        writeJson(res, 200, { ok: true, value: info })
        return
      }
      // POST /rollback
      if (req.method === 'POST' && pathname === '/rollback') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const { name, targetVersion, kind } = body
        if (!name || !targetVersion) {
          writeJson(res, 400, { ok: false, error: '需要 name 和 targetVersion' })
          return
        }
        const dir = profileDir(config.profile)
        if (kind === 'git') {
          const target = resolveLinkTarget(dir, `link:${name}`) || resolveLinkTarget(dir, `file:${name}`)
          if (target) {
            const r = await runCmd('git', ['reset', '--hard', targetVersion], target, 30000)
            store.addHistory({ name, from: 'rollback', to: targetVersion, ok: r.code === 0, kind: 'git', output: r.stdout || r.stderr })
            writeJson(res, 200, { ok: r.code === 0, output: r.stdout || r.stderr })
            return
          }
          writeJson(res, 400, { ok: false, error: '未找到 link 目录' })
          return
        }
        const r = await runDsh(['plugin', '--profile', config.profile, 'add', `${name}@${targetVersion}`], dir, 300000)
        healLinkJunctions(dir)
        const ok = r.code === 0
        const pkgDir = join(dir, 'node_modules', ...name.split('/'))
        if (ok) await hotReloadPlugin(ctx, name, pkgDir)
        store.addHistory({ name, from: 'rollback', to: targetVersion, ok, kind: 'npm', output: r.stdout || r.stderr })
        writeJson(res, 200, { ok, output: r.stdout || r.stderr })
        return
      }
      // POST /hot-reload
      if (req.method === 'POST' && pathname === '/hot-reload') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const name = body?.name
        const dir = profileDir(config.profile)
        if (name) {
          const pkgDir = join(dir, 'node_modules', ...name.split('/'))
          const hrel = await hotReloadPlugin(ctx, name, pkgDir)
          writeJson(res, 200, { ok: hrel.ok, output: hrel.output })
          return
        }
        writeJson(res, 200, { ok: true, output: '已执行插件热重载' })
        return
      }
      // POST /doctor
      if (req.method === 'POST' && pathname === '/doctor') {
        const dir = profileDir(config.profile)
        const healed = healLinkJunctions(dir)
        const hoist = inspectAndHealHoist(dir, true)
        const proc = await diagnoseDshProcess()
        const deps = readDependencies(config.profile)
        const missingDeps: string[] = []
        for (const depName of Object.keys(deps)) {
          const modPath = join(dir, 'node_modules', ...depName.split('/'))
          if (!existsSync(modPath)) missingDeps.push(depName)
        }
        const healthy = healed.length === 0 && missingDeps.length === 0 && hoist.healthy && !proc.isOrphan
        writeJson(res, 200, {
          ok: true,
          value: {
            healthy,
            scanned: Object.keys(deps).length,
            healedJunctions: healed,
            missingDeps,
            hoist,
            process: proc,
          },
        })
        return
      }
      // POST /kill-orphan
      if (req.method === 'POST' && pathname === '/kill-orphan') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const pid = typeof body?.pid === 'number' ? body.pid : 0
        if (!pid) { writeJson(res, 400, { ok: false, error: '需要 pid' }); return }
        const resKill = await killProcessTree(pid)
        writeJson(res, 200, { ok: resKill.ok, output: resKill.output })
        return
      }
      // POST /update-preset
      if (req.method === 'POST' && pathname === '/update-preset') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (!name) { writeJson(res, 400, { ok: false, error: '需要 preset name' }); return }
        const resPreset = await updatePreset(dshHome(), name, config.fetchTimeoutMs, config.githubToken || process.env.GITHUB_TOKEN || '')
        store.addHistory({ name: `preset:${name}`, from: null, to: resPreset.version ?? null, ok: resPreset.ok, kind: 'preset', output: resPreset.output })
        writeJson(res, 200, { ok: resPreset.ok, value: resPreset })
        return
      }
      // POST /config
      if (req.method === 'POST' && pathname === '/config') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        if (typeof body?.checkIntervalMs === 'number') config.checkIntervalMs = body.checkIntervalMs
        if (typeof body?.notifyNewUpdates === 'boolean') config.notifyNewUpdates = body.notifyNewUpdates
        if (typeof body?.githubToken === 'string') config.githubToken = body.githubToken
        writeJson(res, 200, {
          ok: true,
          value: {
            checkIntervalMs: config.checkIntervalMs,
            notifyNewUpdates: config.notifyNewUpdates,
            githubToken: config.githubToken ? '已设置' : '',
          },
        })
        return
      }
      // GET /notifications
      if (req.method === 'GET' && pathname === '/notifications') {
        writeJson(res, 200, { ok: true, value: store.snapshot().notifications })
        return
      }
      // POST /notifications/read
      if (req.method === 'POST' && pathname === '/notifications/read') {
        store.markAllRead()
        writeJson(res, 200, { ok: true })
        return
      }
      // POST /notifications/clear
      if (req.method === 'POST' && pathname === '/notifications/clear') {
        store.clearNotifications()
        writeJson(res, 200, { ok: true })
        return
      }
      // POST /ignore（3.9）
      if (req.method === 'POST' && pathname === '/ignore') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const name = typeof body?.name === 'string' ? body.name : null
        if (!name) { writeJson(res, 400, { ok: false, error: '需要 name' }); return }
        store.addIgnore(name, body?.kind === 'git' ? 'git' : 'npm')
        writeJson(res, 200, { ok: true })
        return
      }
      // POST /unignore（3.9）
      if (req.method === 'POST' && pathname === '/unignore') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        const name = typeof body?.name === 'string' ? body.name : null
        if (!name) { writeJson(res, 400, { ok: false, error: '需要 name' }); return }
        store.removeIgnore(name)
        writeJson(res, 200, { ok: true })
        return
      }
      writeJson(res, 404, { ok: false, error: 'not found' })
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: String(e?.message ?? e) })
    }
  }

  ctx.effect(() => (ctx as any).webServer.register({ kind: 'prefix', path: API, handler: router }), `${name}: api`)

  // P0-3.2：自动定时检查
  if (config.notifyNewUpdates || config.checkIntervalMs > 0) {
    ctx.effect(() => {
      const timer = (ctx as any).setInterval(() => { scheduledCheck(ctx, config) }, config.checkIntervalMs)
      return () => { try { (ctx as any).clearInterval(timer) } catch { /* ignore */ } }
    }, `${name}: schedule`)
  }

  // Agent 工具
  ctx.effect(() => (ctx as any).tools.register(defineTool({
    name: '_dsh_external_dsh_plugin_updater',
    description: '检查 DSH 插件更新并可选执行更新。action=status 只检查；action=update 更新指定包（name@latest 数组）。',
    parameters: {
      action: { type: 'string', enum: ['status', 'update'], description: 'status=检查, update=更新' },
      packages: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, latest: { type: 'string' } } }, description: 'update 时必填' },
    },
    output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }] },
    async execute(args: any) {
      if (args?.action === 'update') {
        const pkgList = Array.isArray(args?.packages) ? args.packages : []
        if (!pkgList.length) return JSON.stringify({ ok: false, error: 'packages 不能为空' })
        return JSON.stringify(await runUpdate(ctx, config, pkgList))
      }
      return JSON.stringify(await checkUpdates(ctx, config))
    },
  })), `${name}: tool`)
}

function readBody(req: any): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString('utf8') })
    req.on('end', () => resolvePromise(data))
    req.on('error', reject)
  })
}

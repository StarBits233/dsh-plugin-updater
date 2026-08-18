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
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import {
  readRegistryUrl, checkNpmUpdates, installedVersion as npmInstalledVersion, mapLimit, fetchLatest,
} from './registry.js'
import {
  gitRemoteHomepage, gitBehindStatus, tryGitUpdate, resolveLinkTarget,
} from './git.js'
import { backupNpmState, backupGitState, runGitUpdateWithRollback, runGithubDownloadUpdate } from './updater.js'
import { hotReloadPlugin } from './reload.js'
import { githubLatest, parseGhRepo } from './github.js'
import { isNewer } from './semver.js'
import { Config as UpdaterConfigSchema, type Config as UpdaterConfigType } from './config.js'
import { PluginStore } from './store.js'
import type { NpmItem, LinkItem, OutdatedItem, UpdateResult, UpdateResultCached, UpdateResultValue } from './types.js'

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

/** 解析 dsh CLI 的真实 Node 入口。 */
let dshBinCache: string | null | undefined
function resolveDshBin(): string | null {
  if (dshBinCache !== undefined) return dshBinCache
  const candidates = [
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
  if (!bin) return runCmd('dsh', args, cwd, timeoutMs)
  return runCmd(process.execPath, [bin, ...args], cwd, timeoutMs)
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 120000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolvePromise({ code: err ? (err as any).code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })
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
async function computeUpdates(profile: string): Promise<UpdateResult> {
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
        homepage: target ? gitRemoteHomepage(target) : undefined,
        ghRepo: target ? readGhRepo(target) : undefined,
      })
    } else if (!/^(?:git|github|gitlab|bitbucket|hg):/.test(spec)) {
      npmNames.push(name)
    }
  }

  if (linked.length) {
    const statuses = await mapLimit(linked, 4, async (item) => {
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
        const gh = await githubLatest(repo, null, 8000, '')
        if (gh) return { ...item, ghLatest: gh.version, ghTag: gh.tag }
      }
      return item
    })
    linked.splice(0, linked.length, ...statuses)
  }

  const registry = readRegistryUrl(dir, dshHome())
  const { npm, errors } = await checkNpmUpdates(dir, npmNames, registry, { timeoutMs: 8000 })

  const outdated: OutdatedItem[] = npm
    .filter((n): n is NpmItem & { current: string; latest: string } => n.outdated && !!n.current && !!n.latest)
    .map((n) => ({ name: n.name, current: n.current!, latest: n.latest! }))

  return { checkedAt: new Date().toISOString(), profile, profileDir: dir, npm, outdated, linked, errors }
}

/** 核心检查 + 通知判定（供 API 与定时器共用）。 */
async function checkUpdates(ctx: Context, config: Config, force = false): Promise<UpdateResultCached> {
  const now = Date.now()
  const hit = CACHE.get(config.profile)
  if (!force && hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true }
  }
  const value = await computeUpdates(config.profile)
  CACHE.set(config.profile, { at: now, value })

  // P0-3.2：发现"新更新"→ 站内通知（去重）
  const store = st(ctx)
  if (config.notifyNewUpdates) {
    for (const n of value.npm) {
      if (n.outdated && n.latest && n.current) {
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

/** 主程序（@deepseek-ai/dsh）状态检测（3.6）：读运行实例版本 + npm latest。 */
async function checkMainUpdate(config: Config): Promise<{ current: string | null; latest: string | null; outdated: boolean; updateable: boolean }> {
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
  const latest = await fetchLatest(registry, '@deepseek-ai/dsh', 8000)
  const outdated = !!current && !!latest && isNewer(latest, current)
  return { current, latest, outdated, updateable: config.allowCoreUpdates }
}

/** 主程序更新（3.6）：npm 全局/运行时更新。仅 allowCoreUpdates=true 时可用。不自动重启宿主。 */
async function runMainUpdate(ctx: Context, config: Config): Promise<{ ok: boolean; output: string }> {
  if (!config.allowCoreUpdates) {
    return { ok: false, output: '已禁 用主程序更新（allowCoreUpdates=false）' }
  }
  // 用 npm 更新 @deepseek-ai/dsh 到 latest（全局）。不自动重启，提示用户重启。
  const r = await runCmd('npm', ['install', '-g', '@deepseek-ai/dsh@latest'], process.cwd(), 300000)
  const output = (r.stdout + r.stderr).trim()
  if (r.code === 0) {
    st(ctx).addHistory({ name: '@deepseek-ai/dsh', from: null, to: 'latest', ok: true, kind: 'main', output: '已更新主程序，请重启 DSH 生效' })
    return { ok: true, output: output.slice(-500) || '主程序已更新，请重启 DSH 生效' }
  }
  st(ctx).addHistory({ name: '@deepseek-ai/dsh', from: null, to: null, ok: false, kind: 'main', output })
  return { ok: false, output: output.slice(-500) || '主程序更新失败' }
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
  return { results }
}

/** 单包更新（含 npm/link/github，带回滚与热重启）。 */
async function updateOne(
  ctx: Context, config: Config, dir: string, deps: Record<string, string>, store: PluginStore,
  p: { name: string; latest: string },
): Promise<{ ok: boolean; output: string }> {
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
      const gh = await githubLatest(ghRepo, null, 8000, config.githubToken || process.env.GITHUB_TOKEN || '')
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
  // npm 更新带备份/回滚
  const npmBackup = backupNpmState(dir, p.name, p.latest)
  const r = await runDsh(['plugin', '--profile', config.profile, 'add', `${p.name}@${p.latest}`], dir, 300000)
  const raw = (r.stdout + r.stderr).trim()
  const summary = raw.split(/\r?\n/).filter((l) => !/^\s*Progress:/i.test(l)).slice(-6).join('\n')
  const output = summary || raw.slice(-800)
  const ok = r.code === 0
  const actual = npmInstalledVersion(dir, p.name)
  let finalOk = ok
  let finalOutput = output

  // 验证 + 失败回滚
  if (ok && actual !== null && isNewer(p.latest, actual)) {
    finalOk = false
    if (npmBackup.oldVersion) {
      await runDsh(['plugin', '--profile', config.profile, 'add', `${p.name}@${npmBackup.oldVersion}`], dir, 300000)
      finalOutput = `更新后版本(${actual})未达目标(${p.latest})，已回滚到 ${npmBackup.oldVersion}`
    } else {
      finalOutput = `更新后版本(${actual})未达目标(${p.latest})且无法回滚`
    }
  } else if (!ok && npmBackup.oldVersion && npmBackup.oldVersion !== p.latest) {
    await runDsh(['plugin', '--profile', config.profile, 'add', `${p.name}@${npmBackup.oldVersion}`], dir, 300000)
    finalOutput = `${output}\n执行失败，已回滚到 ${npmBackup.oldVersion}`
  } else if (ok) {
    // 3.4: 热重启（更新成功后重建 fiber，免手动重启）
    const pkgDir = join(dir, 'node_modules', ...p.name.split('/'))
    const hrel = await hotReloadPlugin(ctx, p.name, pkgDir)
    finalOutput = summary ? `${summary}\n${hrel.output}` : hrel.output
  }
  store.addHistory({ name: p.name, from: npmBackup.oldVersion, to: p.latest, ok: finalOk, kind: 'npm', output: finalOutput })
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
      // POST /update-main（3.6，仅 allowCoreUpdates）
      if (req.method === 'POST' && pathname === '/update-main') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req)) } catch { /* empty */ }
        if (body?.confirm !== true) {
          writeJson(res, 400, { ok: false, error: '需要 { confirm: true }' })
          return
        }
        const r = await runMainUpdate(ctx, config)
        writeJson(res, 200, { ok: r.ok, value: r })
        return
      }
      // POST /check
      if (req.method === 'POST' && pathname === '/check') {
        const value = await checkUpdates(ctx, config, true)
        value && writeJson(res, 200, { ok: true, value })
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

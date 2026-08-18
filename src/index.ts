/**
 * @dsh-external/dsh-plugin-updater — host 侧
 *
 * 功能：检查 DSH web profile 全部插件的更新（npm 插件 + link 本地包），并在设置页提供「一键更新」。
 *       与桌面版无任何耦合（纯 DSH 插件）。
 *
 * 检查实现：直接依赖逐个并发请求 <registry>/<pkg>/latest（响应极小），读 node_modules 实际安装版本
 *           做 semver 比较；不再跑 pnpm outdated（全量 registry 解析，插件多时数十秒）。
 *           结果在进程内缓存 10 分钟，/status?force=1 强制刷新。
 *
 * 路由：
 *   GET  /@dsh-external/dsh-plugin-updater/api/status  → 检查更新（?force=1 跳过缓存）
 *   POST /@dsh-external/dsh-plugin-updater/api/update  → 执行更新（dsh plugin add pkg@latest）
 */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = '@dsh-external/dsh-plugin-updater'
export const inject = ['tools', 'webServer']

export interface Config {
  profile: string
}

export const Config = z.object({
  profile: z.string().default('web'),
})

/** 解析 DSH home（无外部依赖：~/.dsh 或 $DSH_HOME）。 */
function dshHome(): string {
  const env = process.env.DSH_HOME
  if (env && env.trim().length > 0) return resolve(env.trim())
  return join(homedir(), '.dsh')
}

function profileDir(profile: string): string {
  return join(dshHome(), 'profiles', profile)
}

/**
 * 解析 dsh CLI 的真实 Node 入口（@deepseek-ai/dsh/lib/bin.js）。
 *
 * execFile/spawn 无法直接执行 .cmd/.ps1 shim（Windows 下 ENOENT/EINVAL），
 * 所以跨平台统一用 `node <bin.js>` 的方式调用 dsh。
 */
let dshBinCache: string | null | undefined
function resolveDshBin(): string | null {
  if (dshBinCache !== undefined) return dshBinCache
  const candidates = [
    // 1) profile 依赖里装着的 @deepseek-ai/dsh（host 运行时同款）
    join(profileDir('web'), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    // 2) 全局 npm 安装（npm root -g）
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    // 3) 本插件所在 checkout 的 runtime node_modules
    join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        dshBinCache = c
        return c
      }
    } catch {
      // 忽略
    }
  }
  dshBinCache = null
  return null
}

/** 执行 dsh CLI：`node <dshBin> <args>`（跨平台，不依赖 .cmd/.ps1 shim）。 */
async function runDsh(args: string[], cwd: string, timeoutMs = 300000): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = resolveDshBin()
  if (!bin) {
    // 兜底：直接尝试 dsh（POSIX）或 cmd shim
    return runCmd('dsh', args, cwd, timeoutMs)
  }
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

interface OutdatedItem {
  name: string
  current: string
  latest: string
}

interface NpmItem {
  name: string
  current: string | null
  latest: string | null
  outdated: boolean
  error?: string
  homepage?: string
}

interface LinkItem {
  name: string
  spec: string
  homepage?: string
  /** git 是否有远程新提交（落后 origin 时 true） */
  gitBehind?: boolean
  gitBranch?: string
}

interface UpdateResult {
  checkedAt: string
  profile: string
  profileDir: string
  npm: NpmItem[]
  outdated: OutdatedItem[]
  linked: LinkItem[]
  errors: string[]
}

/** 检查结果进程内缓存（10 分钟 TTL，避免反复全量请求）。 */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE = new Map<string, { at: number; value: UpdateResult }>()

/**
 * 并发受限的 map：保持输入顺序，同时最多 limit 个任务在飞。
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** 解析 registry 地址：profile .npmrc → DSH home .npmrc → 用户 .npmrc → 官方源。 */
function readRegistryUrl(profile: string): string {
  const candidates = [join(profileDir(profile), '.npmrc'), join(dshHome(), '.npmrc'), join(homedir(), '.npmrc')]
  for (const p of candidates) {
    try {
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*registry\s*=\s*(\S+)\s*$/.exec(line)
        if (m) return m[1].replace(/\/+$/, '')
      }
    } catch {
      // 文件不存在则跳过
    }
  }
  return 'https://registry.npmjs.org'
}

/** 请求 <registry>/<pkg>/latest（比全量 packument 小几个数量级），单请求超时。 */
async function fetchLatest(registry: string, name: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const pkgPath = name.split('/').map((s) => encodeURIComponent(s).replace(/%40/i, '@')).join('/')
    const res = await fetch(`${registry}/${pkgPath}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return typeof data?.version === 'string' ? data.version : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 读取 node_modules 中实际安装的版本（pnpm 直接依赖在根 node_modules 均有入口）。 */
function installedVersion(dir: string, name: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { version?: string }
    return typeof pkg?.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/** npm 插件主页：npmjs 页面（点击可查 repository）。 */
function npmHomepage(name: string): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(name)}`
}

/** 向上查找最近的 .git 根目录（link 插件目录常是仓库子目录）。 */
function findGitRoot(target: string): string | null {
  let p = resolve(target)
  for (let i = 0; i < 6 && p; i++) {
    try {
      if (existsSync(join(p, '.git'))) return p
    } catch {
      return null
    }
    const parent = dirname(p)
    if (parent === p) return null
    p = parent
  }
  return null
}

/** 读取 git 根目录的 remote origin，转为网页地址（GitHub/GitLab 通用）。 */
function gitRemoteHomepage(target: string): string | undefined {
  const root = findGitRoot(target)
  if (!root) return undefined
  try {
    const cfg = readFileSync(join(root, '.git', 'config'), 'utf8')
    const m = /\[remote "origin"\]\s*url\s*=\s*([^\r\n]+)/.exec(cfg)
    if (!m) return undefined
    const url = m[1].trim()
    if (/^https?:\/\//.test(url)) return url.replace(/\.git$/, '')
    // ssh 形式 git@host:owner/repo.git
    const s = /^[^@]+@([^:]+):(.+?)(?:\.git)?$/.exec(url)
    if (s) return `https://${s[1]}/${s[2]}`
    // /path/to/repo 本地路径
    return undefined
  } catch {
    return undefined
  }
}

/** 简单 semver 数值比较（忽略 prerelease/build 元数据）。 */
function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return latest !== current
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** 检查更新：直接依赖并发查 registry /latest + 本地 node_modules 版本比对（不再跑 pnpm outdated）。 */
async function computeUpdates(profile: string): Promise<UpdateResult> {
  const errors: string[] = []
  const dir = profileDir(profile)
  const deps = readDependencies(profile)
  const linked: LinkItem[] = []
  const npmDeps: { name: string; spec: string }[] = []
  for (const [name, spec] of Object.entries(deps)) {
    if (isLinked(spec)) {
      linked.push({ name, spec, homepage: resolveLinkTarget(dir, spec) ? gitRemoteHomepage(resolveLinkTarget(dir, spec)!) : undefined })
    } else if (!/^(?:git|github|gitlab|bitbucket|hg):/.test(spec)) {
      npmDeps.push({ name, spec })
    }
  }

  // 并行检测每个 git link 是否有落后
  if (linked.length) {
    const statuses = await mapLimit(linked, 4, async (item) => {
      if (!item.homepage) return item // 无 git 的 link 保持原样
      const target = resolveLinkTarget(dir, item.spec)
      const st = target ? await gitBehindStatus(target) : null
      return st ? { ...item, gitBehind: st.behind, gitBranch: st.branch } : item
    })
    linked.splice(0, linked.length, ...statuses)
  }

  const registry = readRegistryUrl(profile)
  const outdated: OutdatedItem[] = []
  const npm: NpmItem[] = []

  if (npmDeps.length) {
    const fetched = await mapLimit(npmDeps, 8, async ({ name }) => {
      const latest = await fetchLatest(registry, name, 8000)
      return { name, latest }
    })
    for (const { name, latest } of fetched) {
      if (!latest) {
        npm.push({ name, current: installedVersion(dir, name), latest: null, outdated: false, error: '获取最新版本失败', homepage: npmHomepage(name) })
        errors.push(`${name}: 获取最新版本失败`)
        continue
      }
      const current = installedVersion(dir, name)
      const isOutdated = !!current && isNewer(latest, current)
      npm.push({ name, current, latest, outdated: isOutdated, homepage: npmHomepage(name) })
      if (isOutdated) outdated.push({ name, current: current!, latest })
    }
  }

  return { checkedAt: new Date().toISOString(), profile, profileDir: dir, npm, outdated, linked, errors }
}

async function checkUpdates(profile: string, force = false): Promise<UpdateResult & { cached?: boolean }> {
  const now = Date.now()
  const hit = CACHE.get(profile)
  if (!force && hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true }
  }
  const value = await computeUpdates(profile)
  CACHE.set(profile, { at: now, value })
  return value
}

/** 执行更新：npm 插件走 dsh plugin add；link 插件若为 git 仓库则 git pull 更新。 */
async function runUpdate(profile: string, packages: { name: string; latest: string }[]): Promise<{
  results: { name: string; latest: string; ok: boolean; output: string }[]
}> {
  const dir = profileDir(profile)
  const deps = readDependencies(profile)
  const results: { name: string; latest: string; ok: boolean; output: string }[] = []
  for (const p of packages) {
    const spec = deps[p.name] ?? ''
    if (isLinked(spec)) {
      // link 本地安装：解析 link 目标，若是 git 仓库则尝试 git 更新
      const target = resolveLinkTarget(dir, spec)
      if (!target) {
        results.push({ ...p, ok: false, output: 'link 目录解析失败，请手动更新' })
        continue
      }
      const git = await tryGitUpdate(target, p)
      results.push({ ...p, ...git })
      continue
    }
    const r = await runDsh(['plugin', '--profile', profile, 'add', `${p.name}@${p.latest}`], dir, 300000)
    // dsh 的 Progress: 行噪音很大，保留最后的变更摘要；失败时保留更多上下文
    const raw = (r.stdout + r.stderr).trim()
    const summary = raw
      .split(/\r?\n/)
      .filter((l) => !/^\s*Progress:/i.test(l))
      .slice(-6)
      .join('\n')
    results.push({ ...p, ok: r.code === 0, output: summary || raw.slice(-800) })
  }
  return { results }
}

/** 解析 link:/file: 指向的本地绝对路径。 */
function resolveLinkTarget(dir: string, spec: string): string | null {
  const raw = spec.replace(/^(?:link|file):/, '').trim()
  if (!raw) return null
  const p = resolve(dir, raw)
  return existsSync(p) ? p : null
}

/** 检测 link 目录（或其父 git 仓库）是否落后于远端：git fetch + 比较 HEAD..origin/<branch>。 */
async function gitBehindStatus(target: string): Promise<{ behind: boolean; branch: string } | null> {
  const root = findGitRoot(target)
  if (!root) return null
  try {
    const branchR = await runCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, 15000)
    const branch = branchR.stdout.trim() || 'main'
    // fetch 一次（本地仓库通常与远端同步，fetch 很快；失败则视为未知）
    await runCmd('git', ['fetch', 'origin', branch], root, 30000)
    // HEAD..origin/<branch> 的提交数 > 0 表示落后需要更新
    const countR = await runCmd('git', ['rev-list', '--count', `HEAD..origin/${branch}`], root, 15000)
    const behind = countR.code === 0 && Number(countR.stdout.trim()) > 0
    return { behind, branch }
  } catch {
    return null
  }
}

/** 对 link 目录（或其父 git 仓库）执行 git 更新：fetch + 快进到当前分支远端。 */
async function tryGitUpdate(target: string, p: { name: string; latest: string }): Promise<{ ok: boolean; output: string }> {
  const root = findGitRoot(target)
  if (!root) {
    return { ok: false, output: 'link 目录（含父级）无 .git，无法自动更新（请手动更新）' }
  }
  const branch = await runCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, 15000)
  const b = branch.stdout.trim() || 'main'
  const fetchR = await runCmd('git', ['fetch', 'origin', b], root, 60000)
  if (fetchR.code !== 0) {
    return { ok: false, output: `git fetch 失败: ${(fetchR.stderr || fetchR.stdout).slice(-300)}` }
  }
  const resetR = await runCmd('git', ['reset', '--hard', `origin/${b}`], root, 60000)
  const logR = await runCmd('git', ['log', '-1', '--oneline'], root, 15000)
  const output = resetR.code === 0
    ? `已同步 ${root} @ ${b} — ${logR.stdout.trim()}（本地 link 已更新，重启 DSH 生效）`
    : `git reset 失败: ${(resetR.stderr || resetR.stdout).slice(-300)}`
  return { ok: resetR.code === 0, output }
}

function writeJson(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: Context, config: Config): void {
  const API = '/@dsh-external/dsh-plugin-updater/api'

  ctx.effect(() => (ctx as any).webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req: any, res: any) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = url.pathname.replace(API, '') || '/'

      try {
        if (req.method === 'GET' && pathname === '/status') {
          const force = url.searchParams.get('force') === '1'
          writeJson(res, 200, { ok: true, value: await checkUpdates(config.profile, force) })
          return
        }
        if (req.method === 'POST' && pathname === '/update') {
          let body: any = {}
          try {
            body = JSON.parse(await readBody(req))
          } catch { /* 空 body */ }
          const packages = Array.isArray(body?.packages) ? body.packages : []
          writeJson(res, 200, { ok: true, value: await runUpdate(config.profile, packages) })
          return
        }
        writeJson(res, 404, { ok: false, error: 'not found' })
      } catch (e: any) {
        writeJson(res, 500, { ok: false, error: String(e?.message ?? e) })
      }
    },
  }), `${name}: api`)

  // Agent 工具：让 AI 也能查询/触发插件更新
  ctx.effect(() => (ctx as any).tools.register(defineTool({
    name: '_dsh_external_dsh_plugin_updater',
    description: '检查 DSH 插件更新并可选执行更新。action=status 只检查；action=update 更新指定包（name@latest 数组）。',
    parameters: {
      action: { type: 'string', enum: ['status', 'update'], description: 'status=检查, update=更新' },
      packages: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, latest: { type: 'string' } } }, description: 'update 时必填' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: any) {
      if (args?.action === 'update') {
        const pkgList = Array.isArray(args?.packages) ? args.packages : []
        if (!pkgList.length) return JSON.stringify({ ok: false, error: 'packages 不能为空' })
        return JSON.stringify(await runUpdate(config.profile, pkgList))
      }
      return JSON.stringify(await checkUpdates(config.profile))
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
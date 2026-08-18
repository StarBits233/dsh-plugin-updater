/**
 * @dsh-external/dsh-plugin-updater — host 侧（入口）
 *
 * 功能：检查 DSH web profile 全部插件的更新（npm 插件 + link 本地包），并在设置页提供「一键更新」。
 *       与桌面版无任何耦合（纯 DSH 插件）。
 *
 * 检查实现：直接依赖逐个并发请求 <registry>/<pkg>/latest（响应极小），读 node_modules 实际安装版本
 *           做 semver 比较；不再跑 pnpm outdated（全量 registry 解析，插件多时数十秒）。
 *           结果在进程内缓存 10 分钟，/status?force=1 强制刷新。
 *
 * 模块拆分（P0-3.1）：语义/比较 → semver.ts；npm 版本解析 → registry.ts；
 *           git 工具 → git.ts；共享契约 → types.ts。本文件仅保留装配与路由。
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

import {
  readRegistryUrl, checkNpmUpdates, mapLimit,
} from './registry.js'
import {
  gitRemoteHomepage, gitBehindStatus, tryGitUpdate, resolveLinkTarget,
} from './git.js'
import type { NpmItem, LinkItem, OutdatedItem, UpdateResult, UpdateResultCached, UpdateResultValue } from './types.js'

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
 * execFile/spawn 无法直接执行 .cmd/.ps1 shim（Windows 下 ENOENT/EINVAL），
 * 所以跨平台统一用 `node <bin.js>` 的方式调用 dsh。
 */
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

/** 检查结果进程内缓存（10 分钟 TTL，避免反复全量请求）。 */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE = new Map<string, { at: number; value: UpdateResult }>()

/** 检查更新：直接依赖并发查 registry /latest + 本地 node_modules 版本比对（不再跑 pnpm outdated）。 */
async function computeUpdates(profile: string): Promise<UpdateResult> {
  const dir = profileDir(profile)
  const deps = readDependencies(profile)
  const linked: LinkItem[] = []
  const npmNames: string[] = []
  for (const [name, spec] of Object.entries(deps)) {
    if (isLinked(spec)) {
      const target = resolveLinkTarget(dir, spec)
      linked.push({ name, spec, homepage: target ? gitRemoteHomepage(target) : undefined })
    } else if (!/^(?:git|github|gitlab|bitbucket|hg):/.test(spec)) {
      npmNames.push(name)
    }
  }

  // 并行检测每个 git link 是否有落后
  if (linked.length) {
    const statuses = await mapLimit(linked, 4, async (item) => {
      if (!item.homepage) return item
      const target = resolveLinkTarget(dir, item.spec)
      const st = target ? await gitBehindStatus(runCmd, target) : null
      return st ? { ...item, gitBehind: st.behind, gitBranch: st.branch } : item
    })
    linked.splice(0, linked.length, ...statuses)
  }

  const registry = readRegistryUrl(dir, dshHome())
  const { npm, errors } = await checkNpmUpdates(dir, npmNames, registry)

  const outdated: OutdatedItem[] = npm
    .filter((n): n is NpmItem & { current: string; latest: string } => n.outdated && !!n.current && !!n.latest)
    .map((n) => ({ name: n.name, current: n.current!, latest: n.latest! }))

  return { checkedAt: new Date().toISOString(), profile, profileDir: dir, npm, outdated, linked, errors }
}

async function checkUpdates(profile: string, force = false): Promise<UpdateResultCached> {
  const now = Date.now()
  const hit = CACHE.get(profile)
  if (!force && hit && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true }
  }
  const value = await computeUpdates(profile)
  CACHE.set(profile, { at: now, value })
  return value
}

/** 执行更新：npm 插件走 dsh plugin add；link 插件若为 git 仓库则 git 更新（含 dirty 保护）。 */
async function runUpdate(profile: string, packages: { name: string; latest: string }[]): Promise<UpdateResultValue> {
  const dir = profileDir(profile)
  const deps = readDependencies(profile)
  const results: { name: string; latest: string; ok: boolean; output: string }[] = []
  for (const p of packages) {
    const spec = deps[p.name] ?? ''
    if (isLinked(spec)) {
      const target = resolveLinkTarget(dir, spec)
      if (!target) {
        results.push({ ...p, ok: false, output: 'link 目录解析失败，请手动更新' })
        continue
      }
      const git = await tryGitUpdate(runCmd, target, p, { protectLocal: true })
      results.push({ ...p, ok: git.ok, output: git.output })
      continue
    }
    const r = await runDsh(['plugin', '--profile', profile, 'add', `${p.name}@${p.latest}`], dir, 300000)
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

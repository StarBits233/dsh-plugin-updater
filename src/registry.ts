/**
 * @dsh-external/dsh-plugin-updater — 版本解析模块。
 *
 * npm registry 地址解析 + `/latest` 并发拉取（3.1 阶段先做 npm 侧；
 * GitHub releases 解析在 3.5 单独扩展）。
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isNewer, compareVersions, isPrerelease } from './semver.js'
import type { NpmItem } from './types.js'

/** 并发受限的 map：保持输入顺序，同时最多 limit 个任务在飞。 */
export async function mapLimit<T, R>(
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
export function readRegistryUrl(profileDirPath: string, dshHomePath: string): string {
  const candidates = [join(profileDirPath, '.npmrc'), join(dshHomePath, '.npmrc'), join(homedir(), '.npmrc')]
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

/** npm registry 路径形式：保留 @ 字面量，编码斜杠。 */
export function registryPath(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2F') : name
}

/** 请求 <registry>/<pkg>/latest（比全量 packument 小几个数量级），单请求超时。 */
export async function fetchLatest(registry: string, name: string, timeoutMs: number): Promise<string | null> {
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
export function installedVersion(dir: string, name: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { version?: string }
    return typeof pkg?.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/** 读取 node_modules 中实际安装的插件描述。 */
export function installedDescription(dir: string, name: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { description?: string }
    return typeof pkg?.description === 'string' && pkg.description.trim().length > 0 ? pkg.description.trim() : undefined
  } catch {
    return undefined
  }
}

/** 读取指定本地目录的 package.json version。 */
export function readTargetVersion(targetPath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(targetPath, 'package.json'), 'utf8')) as { version?: string }
    return typeof pkg?.version === 'string' && pkg.version.trim().length > 0 ? pkg.version.trim() : undefined
  } catch {
    return undefined
  }
}

/** 读取指定本地目录的 package.json description。 */
export function readTargetDescription(targetPath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(targetPath, 'package.json'), 'utf8')) as { description?: string }
    return typeof pkg?.description === 'string' && pkg.description.trim().length > 0 ? pkg.description.trim() : undefined
  } catch {
    return undefined
  }
}

/** npm 插件主页：npmjs 页面（点击可查 repository）。 */
export function npmHomepage(name: string): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(name)}`
}

/** 是否被忽略列表命中（3.9 由调用方注入过滤）。 */
export type IgnoredFn = (name: string) => boolean

export interface NpmCheckResult {
  npm: NpmItem[]
  errors: string[]
}

export interface NpmCheckOptions {
  concurrency?: number
  timeoutMs?: number
  /** 3.9: 忽略过滤器（命中则不列入结果） */
  isIgnored?: IgnoredFn
}

export async function checkNpmUpdates(
  dir: string,
  names: string[],
  registry: string,
  opts: NpmCheckOptions = {},
): Promise<NpmCheckResult> {
  const { concurrency = 8, timeoutMs = 8000, isIgnored } = opts
  const errors: string[] = []
  const npm: NpmItem[] = []
  if (!names.length) return { npm, errors }

  const fetched = await mapLimit(
    names.map((name) => ({ name })),
    concurrency,
    async ({ name }) => ({ name, latest: await fetchLatest(registry, name, timeoutMs) }),
  )
  for (const { name, latest } of fetched) {
    if (isIgnored && isIgnored(name)) continue
    const home = npmHomepage(name)
    const current = installedVersion(dir, name)
    const description = installedDescription(dir, name)
    if (!latest) {
      npm.push({ name, current, latest: null, outdated: false, description, error: '获取最新版本失败', homepage: home })
      errors.push(`${name}: 获取最新版本失败`)
      continue
    }
    const isOutdated = !!current && isNewer(latest, current)
    npm.push({ name, current, latest, outdated: isOutdated, description, homepage: home })
  }
  return { npm, errors }
}

// 供后续模块复用的比较辅助（显式导出便于测试）
export { isNewer, compareVersions, isPrerelease }
export type { NpmItem }

/**
 * @dsh-external/dsh-plugin-updater — GitHub 版本解析（3.5）。
 *
 * - parseGhRepo：从 package.json `repository` 推导 GitHub owner/repo。
 * - githubLatest：查 GitHub releases/tags 的最新版本；API 限流(403/429/test 5xx)或失败时
 *   自动降级 `git ls-remote`（0 API 配额）。
 * - fetchGithubTarball：codeload 下载 tarball URL（供 updater 用）。
 */
import { execFile } from 'node:child_process'

export interface GithubLatest {
  version: string
  repo: string
  tag: string
  /** tarball URL（codeload） */
  tarball: string
  source: 'releases' | 'tags'
}

/** 从 package.json repository 字段推导 GitHub owner/repo，无法推导返回 null。 */
export function parseGhRepo(repository: unknown): string | null {
  let repo = typeof repository === 'string' ? repository : (repository as { url?: unknown } | null)?.url
  if (typeof repo !== 'string' || !repo) return null
  let r = repo.trim()

  // 非 github 形式（link/file/workspace/gitlab/bitbucket/http 非 github）直接排除
  if (/^(?:link|file|workspace):/i.test(r)) return null
  if (/^(?:gitlab|bitbucket):/i.test(r) || /https?:\/\/(?!github\.)/i.test(r) && !/github\.com/i.test(r)) return null

  r = r.replace(/^git\+/, '').replace(/#.*$/, '').replace(/\.git$/, '').replace(/\/$/, '')
  const m = /github\.com[/:]([^/]+\/[^/]+)$/.exec(r)
  if (m) return m[1]
  const m2 = /^github:([^/]+\/[^/]+)$/.exec(r)
  if (m2) return m2[1]
  if (r.includes('/') && !r.includes(':')) {
    // 裸 owner/repo 形式（如 npm 的 "owner/repo"）
    const parts = r.split('/')
    if (parts.length === 2 && parts[0] && parts[1]) return r
  }
  return null
}

async function githubJson(url: string, token: string, timeoutMs: number): Promise<any[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-plugin-updater',
      'x-github-api-version': '2022-11-28',
    }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(url, { signal: controller.signal, headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as any[]
  } finally {
    clearTimeout(timer)
  }
}

function runGit(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile('git', args, { cwd, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolvePromise({ code: err ? (err as any).code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

const SEMVER_ISH = /^\d+\.\d+\.\d+/

/**
 * 计算 GitHub 后台最新版本（> installedVersion 的最高版本）。
 * API 限流/失败自动降级 git ls-remote（0 配额）。
 * 返回 null 表示无更新（或仓库无法访问）。
 */
export async function githubLatest(
  repo: string,
  installedVersion: string | null,
  timeoutMs: number,
  token: string,
): Promise<GithubLatest | null> {
  const { compareVersions, isPrerelease } = await import('./semver.js')
  const wantPrerelease = installedVersion !== null && isPrerelease(installedVersion)
  let best: string | null = null
  let bestTag: string | null = null
  let bestKind: 'releases' | 'tags' = 'releases'
  let tarball: string | null = null

  const consider = (rawTag: string, isPre: boolean): void => {
    const version = rawTag.replace(/^[vV]/, '')
    if (isPre && !wantPrerelease) return
    if (!SEMVER_ISH.test(version)) return
    if (installedVersion && compareVersions(version, installedVersion) <= 0) return
    if (!best || compareVersions(version, best) > 0) {
      best = version
      bestTag = rawTag
    }
  }

  let limited = false
  try {
    const releases = await githubJson(`https://api.github.com/repos/${repo}/releases?per_page=5`, token, timeoutMs)
    for (const rel of releases as any[]) {
      if (typeof rel?.tag_name === 'string') consider(rel.tag_name, rel.prerelease === true || rel.draft === true)
    }
    if (!best) {
      // 无 release → 退回 tags
      bestKind = 'tags'
      const tags = await githubJson(`https://api.github.com/repos/${repo}/tags?per_page=10`, token, timeoutMs)
      for (const tag of tags as any[]) {
        if (typeof tag?.name === 'string') consider(tag.name, false)
      }
    }
  } catch (error: any) {
    const msg = String(error?.message ?? error)
    limited = msg.includes('HTTP 403') || msg.includes('HTTP 429') || msg.includes('HTTP 5') || msg.includes('timed out') || msg.includes('abort')
    if (!limited) return null // 其它错误（仓库不存在等）→ 无更新源
  }

  // 限流时降级 git ls-remote（拉 tags，0 配额）
  if (limited && !best) {
    const ls = await runGit(['ls-remote', '--tags', `https://github.com/${repo}.git`], process.cwd(), timeoutMs)
    if (ls.code === 0) {
      bestKind = 'tags'
      const seen = new Set<string>()
      for (const line of ls.stdout.split(/\r?\n/)) {
        const mm = /refs\/tags\/([^^\s]+)(?:\^\{\})?$/.exec(line.trim())
        if (mm) seen.add(mm[1])
      }
      for (const tag of seen) consider(tag, false)
    }
  }

  if (!best || !bestTag) return null
  tarball = tarball ?? `https://codeload.github.com/${repo}/tar.gz/refs/tags/${encodeURIComponent(bestTag)}`
  return { version: best, repo, tag: bestTag, tarball, source: bestKind }
}

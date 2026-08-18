/**
 * @dsh-external/dsh-plugin-updater — git 工具模块。
 *
 * 处理 link 插件的 git 定位、homepage 推导、落后检测与更新。
 * `run`（执行命令）由调用方注入，保证本模块可独立单测。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type Run = (cmd: string, args: string[], cwd: string, timeoutMs?: number) => Promise<{ code: number; stdout: string; stderr: string }>

/** 向上查找最近的 .git 根目录（link 插件目录常是仓库子目录）。 */
export function findGitRoot(target: string): string | null {
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
export function gitRemoteHomepage(target: string): string | undefined {
  const root = findGitRoot(target)
  if (!root) return undefined
  try {
    const cfg = readFileSync(join(root, '.git', 'config'), 'utf8')
    const m = /\[remote "origin"\]\s*url\s*=\s*([^\r\n]+)/.exec(cfg)
    if (!m) return undefined
    const url = m[1].trim()
    if (/^https?:\/\//.test(url)) return url.replace(/\.git$/, '')
    const s = /^[^@]+@([^:]+):(.+?)(?:\.git)?$/.exec(url)
    if (s) return `https://${s[1]}/${s[2]}`
    return undefined
  } catch {
    return undefined
  }
}

/** 解析 link:/file: 指向的本地绝对路径。 */
export function resolveLinkTarget(dir: string, spec: string): string | null {
  const raw = spec.replace(/^(?:link|file):/, '').trim()
  if (!raw) return null
  const p = resolve(dir, raw)
  return existsSync(p) ? p : null
}

/** 检测 git 工作区是否有未提交改动（3.7）。 */
export async function gitIsDirty(run: Run, root: string): Promise<boolean> {
  const r = await run('git', ['status', '--porcelain'], root, 15000)
  return r.code === 0 && r.stdout.trim().length > 0
}

/** 暂存并恢复本地改动（3.7 的 stash 保护，返回生成的 stash 列表用于恢复）。 */
export async function gitStash(run: Run, root: string): Promise<{ ok: boolean; output: string }> {
  const r = await run('git', ['stash', 'push', '--include-untracked', '-m', 'dsh-plugin-updater pre-update'], root, 30000)
  return { ok: r.code === 0, output: (r.stderr || r.stdout).trim() }
}

/** 检测 link 目录（或其父 git 仓库）是否落后于远端：git fetch + 比较 HEAD..origin/<branch>。 */
export async function gitBehindStatus(run: Run, target: string): Promise<{ behind: boolean; branch: string } | null> {
  const root = findGitRoot(target)
  if (!root) return null
  try {
    const branchR = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, 15000)
    const branch = branchR.stdout.trim() || 'main'
    await run('git', ['fetch', 'origin', branch], root, 30000)
    const countR = await run('git', ['rev-list', '--count', `HEAD..origin/${branch}`], root, 15000)
    const behind = countR.code === 0 && Number(countR.stdout.trim()) > 0
    return { behind, branch }
  } catch {
    return null
  }
}

/**
 * 对 link 目录（或其父 git 仓库）执行 git 更新：可选 stash 保护 → fetch → 快进到当前分支远端。
 * @param protectLocal 为 true 时先检测 dirty，有本地改动则 stash（3.7 默认 true）。
 */
export async function tryGitUpdate(
  run: Run,
  target: string,
  p: { name: string; latest: string },
  opts: { protectLocal?: boolean } = {},
): Promise<{ ok: boolean; output: string; stashed?: boolean }> {
  const root = findGitRoot(target)
  if (!root) {
    return { ok: false, output: 'link 目录（含父级）无 .git，无法自动更新（请手动更新）' }
  }
  const protectLocal = opts.protectLocal ?? true

  // 3.7：dirty 保护
  let stashed = false
  if (protectLocal && (await gitIsDirty(run, root))) {
    const s = await gitStash(run, root)
    if (!s.ok) {
      return { ok: false, output: '检测到本地未提交改动且 stash 失败（请手动处理）：' + s.output }
    }
    stashed = true
  }

  const branchR = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, 15000)
  const b = branchR.stdout.trim() || 'main'
  const fetchR = await run('git', ['fetch', 'origin', b], root, 60000)
  if (fetchR.code !== 0) {
    return { ok: false, output: `git fetch 失败: ${(fetchR.stderr || fetchR.stdout).slice(-300)}`, stashed }
  }
  const resetR = await run('git', ['reset', '--hard', `origin/${b}`], root, 60000)
  const logR = await run('git', ['log', '-1', '--oneline'], root, 15000)
  const output = resetR.code === 0
    ? `已同步 ${root} @ ${b} — ${logR.stdout.trim()}${stashed ? '（本地改动已 stash）' : ''}（本地 link 已更新，重启 DSH 生效）`
    : `git reset 失败: ${(resetR.stderr || resetR.stdout).slice(-300)}`
  return { ok: resetR.code === 0, output, stashed }
}

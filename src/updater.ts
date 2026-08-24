/**
 * @dsh-external/dsh-plugin-updater — 更新与回滚管线（3.3）。
 *
 * 针对 DSH/pnpm 布局设计：不直接备份 node_modules 物理文件（junction/虚拟存储
 * 复杂），而是"记录旧状态 → 更新 → 验证 → 失败恢复到旧状态"。
 *
 * - npm：备份 = 记录当前安装版本；回滚 = `dsh plugin add name@旧版本`。
 * - git：备份 = 记录当前 HEAD commit；回滚 = `git reset --hard 旧commit`。
 */
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, readdirSync, statSync, copyFileSync, rmSync, createWriteStream, renameSync, symlinkSync, lstatSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { installedVersion } from './registry.js'
import { inspectAndHealHoist } from './hoist.js'

/**
 * 修复 profile 中的 link: 插件 Windows Junction 软链（防止 pnpm 升级后覆盖、破坏或生成畸形相对路径）。
 */
export function healLinkJunctions(profileDirPath: string): string[] {
  const healed: string[] = []
  const pkgPath = join(profileDirPath, 'package.json')
  if (!existsSync(pkgPath)) return healed
  let deps: Record<string, string> = {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> }
    deps = pkg.dependencies ?? {}
  } catch {
    return healed
  }

  for (const [name, spec] of Object.entries(deps)) {
    if (!/^(?:link|file):|^\.{1,2}(?:[/\\]|$)/.test(spec)) continue
    const rawTarget = spec.replace(/^(?:link|file):/, '').trim()
    const target = resolve(profileDirPath, rawTarget)
    if (!existsSync(target)) continue

    const dest = join(profileDirPath, 'node_modules', ...name.split('/'))
    let needRecreate = false
    try {
      if (!existsSync(dest)) {
        needRecreate = true
      } else {
        const lst = lstatSync(dest)
        if (!lst.isSymbolicLink() && !lst.isDirectory()) {
          needRecreate = true
        } else {
          // Windows 针对畸形 target 进行真实路径匹配验证
          try {
            const real = realpathSync(dest)
            if (resolve(real) !== resolve(target)) {
              needRecreate = true
            }
          } catch {
            needRecreate = true
          }
        }
      }
    } catch {
      needRecreate = true
    }

    if (needRecreate) {
      try {
        rmSync(dest, { recursive: true, force: true })
        mkdirSync(dirname(dest), { recursive: true })
        if (process.platform === 'win32') {
          symlinkSync(target, dest, 'junction')
        } else {
          symlinkSync(target, dest, 'dir')
        }
        healed.push(name)
      } catch {
        // best-effort
      }
    }
  }
  return healed
}

export interface NpmBackup {
  kind: 'npm'
  name: string
  /** 更新前安装版本 */
  oldVersion: string | null
  /** 目标版本 */
  targetVersion: string
  at: string
}

export interface GitBackup {
  kind: 'git'
  name: string
  root: string
  /** 更新前 HEAD commit */
  oldCommit: string
  /** 更新前分支 */
  branch: string
  at: string
}

export type Backup = NpmBackup | GitBackup

export type Run = (cmd: string, args: string[], cwd: string, timeoutMs?: number) => Promise<{ code: number; stdout: string; stderr: string }>

/** 备份 npm 状态（读当前版本）。 */
export function backupNpmState(dir: string, name: string, targetVersion: string): NpmBackup {
  return {
    kind: 'npm',
    name,
    oldVersion: installedVersion(dir, name),
    targetVersion,
    at: new Date().toISOString(),
  }
}

/** 备份 git 状态（读当前 HEAD）。失败返回 null（无法回滚时调用方直接失败）。 */
export async function backupGitState(run: Run, dir: string, name: string): Promise<GitBackup | null> {
  const { findGitRoot } = await import('./git.js')
  const root = findGitRoot(dir)
  if (!root) return null
  const branchR = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, 15000)
  const headR = await run('git', ['rev-parse', 'HEAD'], root, 15000)
  if (branchR.code !== 0 || headR.code !== 0) return null
  return {
    kind: 'git',
    name,
    root,
    oldCommit: headR.stdout.trim(),
    branch: branchR.stdout.trim() || 'main',
    at: new Date().toISOString(),
  }
}

/**
 * 执行 npm 更新（dsh plugin add）并验证，失败时回滚到旧版本。
 * @param runDsh 已注入 profile 与超时的 dsh 执行函数（args → 子进程结果）。
 * @param profile 目标 DSH profile 名。
 * @returns {ok, output, rolledBack} rolledBack=true 表示已回滚到旧版本。
 */
export async function runNpmUpdateWithRollback(
  runDsh: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  profile: string,
  dir: string,
  backup: NpmBackup,
): Promise<{ ok: boolean; output: string; rolledBack: boolean }> {
  const r = await runDsh(['plugin', '--profile', profile, 'add', `${backup.name}@${backup.targetVersion}`])
  const raw = (r.stdout + r.stderr).trim()
  const summary = raw.split(/\r?\n/).filter((l) => !/^\s*Progress:/i.test(l)).slice(-6).join('\n')
  const ok = r.code === 0

  // 验证实际安装版本是否达到目标
  if (ok) {
    const actual = installedVersion(dir, backup.name)
    const semver = await import('./semver.js')
    if (actual !== null && semver.compareVersions(actual, backup.targetVersion) < 0) {
      // 版本没升上去，视为失败
      return { ok: false, output: `更新后版本(${actual})未达到目标(${backup.targetVersion})，执行回滚`, rolledBack: await rollbackNpm(runDsh, profile, backup) }
    }
  }

  if (!ok && backup.oldVersion && backup.oldVersion !== backup.targetVersion) {
    const rb = await rollbackNpm(runDsh, profile, backup)
    return { ok: false, output: `${summary || r.stderr}\n已回滚到 ${backup.oldVersion}${rb ? '' : '（回滚失败，请手动处理）'}`, rolledBack: rb }
  }
  if (!ok) {
    return { ok: false, output: summary || raw.slice(-800), rolledBack: false }
  }
  return { ok: true, output: summary || raw.slice(-800), rolledBack: false }
}

/** 回滚 npm 到旧版本（仅当记录到旧版本时）。 */
export async function rollbackNpm(
  runDsh: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  profile: string,
  backup: NpmBackup,
): Promise<boolean> {
  if (!backup.oldVersion) return false
  const r = await runDsh(['plugin', '--profile', profile, 'add', `${backup.name}@${backup.oldVersion}`])
  return r.code === 0
}

/**
 * 执行 git 更新（fast-forward）并验证，失败时回滚到旧 commit。
 */
export async function runGitUpdateWithRollback(
  run: Run,
  target: string,
  backup: GitBackup,
): Promise<{ ok: boolean; output: string; rolledBack: boolean }> {
  const { gitRemoteHomepage, tryGitUpdate, findGitRoot } = await import('./git.js')
  const root = findGitRoot(target)
  if (!root) {
    return { ok: false, output: 'link 目录（含父级）无 .git，无法更新', rolledBack: false }
  }
  const before = await run('git', ['rev-parse', 'HEAD'], root, 15000)
  const beforeCommit = before.stdout.trim() || backup.oldCommit

  const update = await tryGitUpdate(run, target, { name: backup.name, latest: '' }, { protectLocal: true })
  if (update.ok) return { ...update, rolledBack: false }

  // 失败：回滚到旧 commit
  const resetR = await run('git', ['reset', '--hard', beforeCommit], root, 60000)
  const logR = await run('git', ['log', '-1', '--oneline'], root, 15000)
  const output = resetR.code === 0
    ? `更新失败：${update.output}\n已回滚到 ${beforeCommit.slice(0, 8)}（${logR.stdout.trim()}）`
    : `更新失败且回滚失败：${update.output}`
  return { ok: false, output, rolledBack: resetR.code === 0 }
}

// ─── 3.5 GitHub 下载更新管线 ───────────────────────────────

function mkdtempSafe(base: string, prefix: string): string {
  return mkdtempSync(join(base, prefix))
}

async function renameDir(from: string, to: string): Promise<void> {
  try {
    mkdirSync(dirname(to), { recursive: true })
    rmSync(to, { recursive: true, force: true })
    // 改父目录正则下人用 renameSync（跨设备回退 copy）
    try {
      renameSync(from, to)
    } catch {
      await copyDirAsync(from, to)
      rmSync(from, { recursive: true, force: true })
    }
  } catch {
    throw new Error('renameDir failed')
  }
  if (!existsSync(to)) throw new Error('renameDir: destination missing')
}

async function copyDirAsync(from: string, to: string): Promise<void> {
  if (!existsSync(from)) return
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const src = join(from, entry)
    const dst = join(to, entry)
    const st = statSync(src)
    if (st.isDirectory()) await copyDirAsync(src, dst)
    else {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
    }
  }
}

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const src = join(from, entry)
    const dst = join(to, entry)
    const st = statSync(src)
    if (st.isDirectory()) copyDir(src, dst)
    else {
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
    }
  }
}

/** 下载文件到磁盘（流式，全阶段超时）。 */
async function downloadFile(url: string, dest: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok || !res.body) return false
    await pipeline(res.body as any, createWriteStream(dest))
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export interface GithubDownloadResult {
  ok: boolean
  output: string
  rolledBack: boolean
}

/**
 * GitHub tarball 下载更新（3.5）：codeload 下载 → 系统 tar 解压 → 校验包名 → 备份 → 覆盖 → 复核。
 * 用于"无本地 git 但有 GitHub repository"的 link 插件。
 * 依赖：系统 tar（Windows 10+ 自带 bsdtar，支持 .tar.gz）。
 */
export async function runGithubDownloadUpdate(
  run: Run,
  target: string,
  gh: { repo: string; version: string; tarball: string; tag?: string },
  name: string,
): Promise<GithubDownloadResult> {
  const stage = mkdtempSafe(tmpdir(), 'dshpu-gh-')
  try {
    // 1) 下载
    const tgz = join(stage, 'pkg.tar.gz')
    const ok = await downloadFile(gh.tarball, tgz, 120000)
    if (!ok) return { ok: false, output: `GitHub 下载失败：${gh.tarball}`, rolledBack: false }

    // 2) 解压（系统 tar）
    const extractDir = join(stage, 'extract')
    mkdirSync(extractDir, { recursive: true })
    const tar = await run('tar', ['-xzf', tgz, '-C', extractDir], process.cwd(), 120000)
    if (tar.code !== 0) return { ok: false, output: `解压失败：${(tar.stderr || tar.stdout).slice(-200)}`, rolledBack: false }

    // 3) 定位包根（通常 <repo>-<tag>/）
    const entries = readdirSync(extractDir)
    const pkgRoot = entries.length === 1 && existsSync(join(extractDir, entries[0])) ? join(extractDir, entries[0]) : extractDir

    // 4) 校验 package.json name
    const pkgJsonPath = join(pkgRoot, 'package.json')
    if (!existsSync(pkgJsonPath)) return { ok: false, output: 'GitHub 包缺少 package.json', rolledBack: false }
    let pkg: { name?: unknown } = {}
    try { pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) } catch { /* 忽略解析失败 */ }
    if (pkg.name && pkg.name !== name) {
      return { ok: false, output: `GitHub 包名不匹配：${pkg.name} ≠ ${name}`, rolledBack: false }
    }

    // 5) 备份旧目录（移动到 stage，非复制）
    const backupDir = join(stage, 'backup')
    if (existsSync(target)) {
      rmSync(backupDir, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      try {
        await renameDir(target, backupDir)
      } catch {
        return { ok: false, output: '旧目录备份失败', rolledBack: false }
      }
    }

    // 6) 覆盖
    try {
      copyDir(pkgRoot, target)
    } catch (error: any) {
      rmSync(target, { recursive: true, force: true })
      try {
        if (existsSync(backupDir)) await renameDir(backupDir, target)
      } catch { /* best-effort */ }
      return { ok: false, output: `覆盖失败：${String(error?.message ?? error)}（已回滚）`, rolledBack: true }
    }

    return { ok: true, output: `已从 GitHub 更新到 ${gh.version}（${gh.repo}${gh.tag ? ' @' + gh.tag : ''}）`, rolledBack: false }
  } catch (error: any) {
    return { ok: false, output: `GitHub 更新异常：${String(error?.message ?? error)}`, rolledBack: false }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

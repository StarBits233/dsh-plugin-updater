/**
 * @dsh-external/dsh-plugin-updater — 更新与回滚管线（3.3）。
 *
 * 针对 DSH/pnpm 布局设计：不直接备份 node_modules 物理文件（junction/虚拟存储
 * 复杂），而是"记录旧状态 → 更新 → 验证 → 失败恢复到旧状态"。
 *
 * - npm：备份 = 记录当前安装版本；回滚 = `dsh plugin add name@旧版本`。
 * - git：备份 = 记录当前 HEAD commit；回滚 = `git reset --hard 旧commit`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installedVersion } from './registry.js'

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
 * @returns {ok, output, rolledBack} rolledBack=true 表示已回滚到旧版本。
 */
export async function runNpmUpdateWithRollback(
  runDsh: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  dir: string,
  backup: NpmBackup,
): Promise<{ ok: boolean; output: string; rolledBack: boolean }> {
  const r = await runDsh(['plugin', '--profile', /* profile 由调用方拼进 args? */ 'web', 'add', `${backup.name}@${backup.targetVersion}`])
  const raw = (r.stdout + r.stderr).trim()
  const summary = raw.split(/\r?\n/).filter((l) => !/^\s*Progress:/i.test(l)).slice(-6).join('\n')
  const ok = r.code === 0

  // 验证实际安装版本是否达到目标
  if (ok) {
    const actual = installedVersion(dir, backup.name)
    const semver = await import('./semver.js')
    if (actual !== null && semver.compareVersions(actual, backup.targetVersion) < 0) {
      // 版本没升上去，视为失败
      return { ok: false, output: `更新后版本(${actual})未达到目标(${backup.targetVersion})，执行回滚`, rolledBack: await rollbackNpm(runDsh, backup) }
    }
  }

  if (!ok && backup.oldVersion) {
    const rb = await rollbackNpm(runDsh, backup)
    return { ok: false, output: `${summary || r.stderr}\n已回滚到 ${backup.oldVersion}${rb ? '' : '（回滚失败，请手动处理）'}`, rolledBack: rb }
  }
  if (!ok) {
    return { ok: false, output: summary || raw.slice(-800), rolledBack: false }
  }
  return { ok: true, output: summary || raw.slice(-800), rolledBack: false }
}

/** 回滚 npm 到旧版本。 */
export async function rollbackNpm(
  runDsh: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
  backup: NpmBackup,
): Promise<boolean> {
  if (!backup.oldVersion) return false
  const r = await runDsh(['plugin', '--profile', 'web', 'add', `${backup.name}@${backup.oldVersion}`])
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

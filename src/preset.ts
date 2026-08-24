/**
 * @dsh-external/dsh-plugin-updater — Agent Presets（思维模式预设）管理与更新模块。
 *
 * 负责：
 * 1. 扫描 ~/.dsh/.agent-presets/ 下的全部预设；
 * 2. 关联本地套件（dsh-routing-suite）及远程 GitHub 仓库；
 * 3. 一键同步更新预设文件（平铺复制 agent.cordis.yml / router-bootstrap.mjs 等）；
 * 4. 配合 super-injector 实现预设热更新。
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PresetItem } from './types.js'
import { githubLatest } from './github.js'
import { isNewer } from './semver.js'

/** 预设到远程 GitHub 仓库的映射表。 */
export const PRESET_REPOS: Record<string, string> = {
  'router-standard': 'yjh051108/dsh-router-standard',
  'router-spec': 'yjh051108/dsh-routing-suite',
  'router-react': 'yjh051108/dsh-routing-suite',
  'router-flash': 'SheberDavid/v4-flash-godmode-opencode-go',
}

/** 本地套件预设源路径候选。 */
export function findLocalSuitePresetDir(presetName: string): string | null {
  const candidates = [
    join('D:', 'MyProject', 'Tools', 'DSHTools', 'dsh-routing-suite', 'preset', 'preset', presetName),
    join('D:', 'MyProject', 'Tools', 'dsh-routing-suite', 'preset', 'preset', presetName),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'agent.cordis.yml'))) {
      return c
    }
  }
  return null
}

/** 从预设目录读取版本与简介。 */
export function readPresetMetadata(dir: string): { version: string | null; description?: string } {
  let version: string | null = null
  let description: string | undefined

  // 1. 尝试从 preset.yml 读取
  const presetYml = join(dir, 'preset.yml')
  if (existsSync(presetYml)) {
    try {
      const content = readFileSync(presetYml, 'utf8')
      const vm = /^version:\s*['"]?([^'"\r\n]+)['"]?/m.exec(content)
      if (vm) version = vm[1].trim()
      const dm = /^description:\s*['"]?([^'"\r\n]+)['"]?/m.exec(content)
      if (dm) description = dm[1].trim()
    } catch { /* ignore */ }
  }

  // 2. 尝试从 router-bootstrap.mjs 注释读取版本
  const bootMjs = join(dir, 'router-bootstrap.mjs')
  if (!version && existsSync(bootMjs)) {
    try {
      const content = readFileSync(bootMjs, 'utf8').slice(0, 1000)
      const vm = /(?:v|version\s*)([0-9]+\.[0-9]+\.[0-9]+)/i.exec(content)
      if (vm) version = vm[1].trim()
    } catch { /* ignore */ }
  }

  return { version, description }
}

/** 扫描所有已安装的 Agent Presets。 */
export async function checkPresetUpdates(
  dshHome: string,
  fetchTimeoutMs = 8000,
  githubToken = '',
  isIgnored?: (name: string) => boolean,
): Promise<PresetItem[]> {
  const presetsDir = join(dshHome, '.agent-presets')
  if (!existsSync(presetsDir)) return []

  const entries = readdirSync(presetsDir, { withFileTypes: true })
  const items: PresetItem[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const dir = join(presetsDir, name)
    const cordisYml = join(dir, 'agent.cordis.yml')
    if (!existsSync(cordisYml)) continue

    const { version, description } = readPresetMetadata(dir)
    const repo = PRESET_REPOS[name] ?? null
    const localSuite = findLocalSuitePresetDir(name)
    const ignored = isIgnored ? isIgnored(`preset:${name}`) : false

    let latestVersion: string | null = null
    let outdated = false

    // 检查本地套件更新
    if (localSuite) {
      const localMeta = readPresetMetadata(localSuite)
      if (localMeta.version && version && isNewer(localMeta.version, version)) {
        latestVersion = localMeta.version
        outdated = true
      }
    }

    // 若本地未发现更新且有远程仓库，则请求 GitHub API
    if (!outdated && repo) {
      try {
        const gh = await githubLatest(repo, null, fetchTimeoutMs, githubToken)
        if (gh?.version) {
          latestVersion = gh.version
          if (version && isNewer(gh.version, version)) {
            outdated = true
          }
        }
      } catch {
        // ignore
      }
    }

    items.push({
      name,
      dir,
      version,
      description,
      repo,
      latestVersion,
      outdated,
      ignored,
      localSuiteAvailable: !!localSuite,
    })
  }

  return items
}

/** 递归同步目录。 */
function copyDirSync(src: string, dst: string) {
  mkdirSync(dst, { recursive: true })
  for (const f of readdirSync(src)) {
    const s = join(src, f)
    const d = join(dst, f)
    copyFileSync(s, d)
  }
}

/**
 * 执行指定预设的更新同步。
 * 优先从本地套件源拷贝，否则从 GitHub 下载。
 */
export async function updatePreset(
  dshHome: string,
  presetName: string,
  fetchTimeoutMs = 15000,
  githubToken = '',
): Promise<{ ok: boolean; output: string; version?: string }> {
  const targetDir = join(dshHome, '.agent-presets', presetName)
  const localSuite = findLocalSuitePresetDir(presetName)

  // 1. 优先本地套件同步
  if (localSuite) {
    try {
      copyDirSync(localSuite, targetDir)
      const meta = readPresetMetadata(targetDir)
      return {
        ok: true,
        output: `已从本地套件库同步最新预设文件${meta.version ? ' (v' + meta.version + ')' : ''}`,
        version: meta.version ?? undefined,
      }
    } catch (e: any) {
      return { ok: false, output: `本地套件同步失败: ${String(e?.message ?? e)}` }
    }
  }

  // 2. 远程 GitHub 更新（如果不是套件中的预设）
  const repo = PRESET_REPOS[presetName]
  if (!repo) {
    return { ok: false, output: `预设 ${presetName} 无已知的更新源` }
  }

  try {
    const gh = await githubLatest(repo, null, fetchTimeoutMs, githubToken)
    if (!gh?.tarball) {
      return { ok: false, output: `获取 ${repo} Release 失败` }
    }
    // 提示用户或由本地套件接管
    return { ok: false, output: `该预设建议通过套件仓库或 Git 更新` }
  } catch (e: any) {
    return { ok: false, output: `更新异常: ${String(e?.message ?? e)}` }
  }
}

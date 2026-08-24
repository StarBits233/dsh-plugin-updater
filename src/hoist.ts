/**
 * @dsh-external/dsh-plugin-updater — Hoist 提升规则自愈与防崩预检模块。
 *
 * 针对 DSH 坑 2（ERR_MODULE_NOT_FOUND）与坑 7（!@deepseek-ai/* 符号冲突保护）：
 * 1. 扫描所有聚合包（如 @linxin666/dsh-web-ui-all）注册的子插件名称；
 * 2. 对比 profile 目录下的 .npmrc public-hoist-pattern；
 * 3. 自动发现缺失的提升 scope（如 @mlgbnb/*、dsh-*），并自动注入 .npmrc；
 * 4. 始终确保 !@deepseek-ai/* 位于末尾，杜绝跨副本 Symbol("dsh.scope") 冲突。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HoistCheckResult } from './types.js'

/** 读取 .npmrc 中的 public-hoist-pattern 规则列表。 */
export function readHoistPatterns(profileDir: string): { patterns: string[]; hasRootCheck: boolean } {
  const npmrcPath = join(profileDir, '.npmrc')
  if (!existsSync(npmrcPath)) return { patterns: [], hasRootCheck: false }
  const patterns: string[] = []
  let hasRootCheck = false
  try {
    const lines = readFileSync(npmrcPath, 'utf8').split(/\r?\n/)
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith(';')) continue
      if (line.startsWith('ignore-workspace-root-check')) {
        hasRootCheck = true
        continue
      }
      const m = /^public-hoist-pattern(?:\[\])?\s*=\s*(.+)$/.exec(line)
      if (m) {
        patterns.push(m[1].trim())
      }
    }
  } catch {
    // ignore
  }
  return { patterns, hasRootCheck }
}

/** 检查包名是否匹配已有的 hoist pattern 规则。 */
export function matchesHoistPattern(pkgName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue
    if (pattern === pkgName) return true
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      if (pkgName.startsWith(prefix)) return true
    }
  }
  return false
}

/** 扫描 profile 内部所有 bundle/package 的 cordis.patch.yml，提取所有被引用的插件包名。 */
export function scanPatchPluginNames(profileDir: string): string[] {
  const plugins = new Set<string>()
  const pkgPath = join(profileDir, 'package.json')
  if (!existsSync(pkgPath)) return []

  let deps: Record<string, string> = {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  } catch {
    return []
  }

  // 1. 直接依赖也是顶层插件
  for (const name of Object.keys(deps)) {
    if (!name.startsWith('@deepseek-ai/')) {
      plugins.add(name)
    }
  }

  // 2. 遍历 node_modules 中的 cordis.patch.yml（提取聚合包 insert 的子插件）
  const nm = join(profileDir, 'node_modules')
  if (!existsSync(nm)) return Array.from(plugins)

  for (const depName of Object.keys(deps)) {
    const depDir = join(nm, ...depName.split('/'))
    const patchYml = join(depDir, 'cordis.patch.yml')
    if (existsSync(patchYml)) {
      try {
        const content = readFileSync(patchYml, 'utf8')
        // 正则提取 name: '@scope/pkg' 或 name: 'pkg'
        const regex = /name:\s*['"]?([@a-zA-Z0-9_\-\.\/]+)['"]?/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
          const subPkg = match[1].trim()
          if (subPkg && !subPkg.startsWith('@deepseek-ai/')) {
            plugins.add(subPkg)
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return Array.from(plugins)
}

/** 生成针对指定包名的建议 hoist pattern 规则。 */
export function suggestHoistPattern(pkgName: string): string {
  if (pkgName.startsWith('@')) {
    const scope = pkgName.split('/')[0]
    return `${scope}/*`
  }
  if (pkgName.startsWith('dsh-')) {
    return 'dsh-*'
  }
  return pkgName
}

/**
 * 完整体检并可选自愈 .npmrc 中的 Hoist 规则。
 * @param profileDir Profile 根目录
 * @param autoHeal 是否自动写入修复 .npmrc
 */
export function inspectAndHealHoist(profileDir: string, autoHeal = true): HoistCheckResult {
  const { patterns: currentPatterns, hasRootCheck } = readHoistPatterns(profileDir)
  const subPlugins = scanPatchPluginNames(profileDir)
  const missingPatterns = new Set<string>()
  const unresolvable: string[] = []

  const nm = join(profileDir, 'node_modules')

  for (const name of subPlugins) {
    const isCovered = matchesHoistPattern(name, currentPatterns)
    const targetPath = join(nm, ...name.split('/'))
    const resolvable = existsSync(targetPath)
    if (!resolvable) {
      unresolvable.push(name)
    }
    if (!isCovered) {
      missingPatterns.add(suggestHoistPattern(name))
    }
  }

  const addedPatterns: string[] = []
  if (autoHeal && (missingPatterns.size > 0 || !hasRootCheck || !currentPatterns.includes('!@deepseek-ai/*'))) {
    const npmrcPath = join(profileDir, '.npmrc')
    const finalPatterns = new Set<string>()

    // 保留现有非 deepseek-ai 规则
    for (const p of currentPatterns) {
      if (p !== '!@deepseek-ai/*') finalPatterns.add(p)
    }
    // 添加缺失规则
    for (const p of missingPatterns) {
      finalPatterns.add(p)
      addedPatterns.push(p)
    }

    const lines: string[] = [
      'ignore-workspace-root-check=true',
      ...Array.from(finalPatterns).map((p) => `public-hoist-pattern[]=${p}`),
      'public-hoist-pattern[]=!@deepseek-ai/*', // 坑 7：必须排除核心包防 Symbol 冲突
      '',
    ]
    try {
      writeFileSync(npmrcPath, lines.join('\n'), 'utf8')
    } catch {
      // ignore
    }
  }

  const healthy = missingPatterns.size === 0 && unresolvable.length === 0

  return {
    healthy,
    patterns: currentPatterns,
    subPlugins,
    missingPatterns: Array.from(missingPatterns),
    addedPatterns,
    unresolvable,
  }
}

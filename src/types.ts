/**
 * @dsh-external/dsh-plugin-updater — 共享数据契约。
 *
 * 供 host 各模块（registry / git / service / updater / hoist / preset / process）与 client 引用。
 * 保持 /status、/update 的对外形状向后兼容（只增量、不破坏）。
 */

/** npm 插件条目（/status.npm[]）。 */
export interface NpmItem {
  name: string
  current: string | null
  latest: string | null
  outdated: boolean
  ignored?: boolean
  description?: string
  error?: string
  homepage?: string
}

/** link 插件条目（/status.linked[]）。 */
export interface LinkItem {
  name: string
  spec: string
  version?: string | null
  ignored?: boolean
  description?: string
  homepage?: string
  /** git 是否有远程新提交（落后 origin 时 true） */
  gitBehind?: boolean
  /** 本地 git 当前分支 */
  gitBranch?: string
  /** package.json `repository` 推导出的 GitHub owner/repo（3.5 用） */
  ghRepo?: string | null
  /** 是否有 GitHub 新版本（3.5 用） */
  ghLatest?: string | null
  /** 对应的 GitHub tag */
  ghTag?: string | null
}

/** Agent 预设条目（/status.presets[]）。 */
export interface PresetItem {
  name: string
  dir: string
  version?: string | null
  description?: string
  repo?: string | null
  latestVersion?: string | null
  outdated: boolean
  ignored?: boolean
  localSuiteAvailable?: boolean
}

/** 过时 npm 条目（旧 /status.outdated[]，保留兼容）。 */
export interface OutdatedItem {
  name: string
  current: string
  latest: string
}

/** /status 完整结果。 */
export interface UpdateResult {
  checkedAt: string
  profile: string
  profileDir: string
  npm: NpmItem[]
  outdated: OutdatedItem[]
  linked: LinkItem[]
  presets?: PresetItem[]
  processInfo?: ProcessDiagnostic
  errors: string[]
}

/** /status 命中缓存时的附加字段。 */
export type UpdateResultCached = UpdateResult & { cached?: boolean }

/** /update 单包结果。 */
export interface UpdateItemResult {
  name: string
  latest: string
  ok: boolean
  output: string
}

/** /update 完整结果。 */
export interface UpdateResultValue {
  results: UpdateItemResult[]
}

/** 站内通知（3.2）。 */
export interface Notification {
  id: string
  at: string
  /** 'update-available' | ... */
  kind: string
  title: string
  body?: string
  read: boolean
  /** 去重 key（如 `${name}@${latest}`），避免重复通知 */
  dedupe?: string
}

/** 插件忽略列表条目（3.9）。 */
export interface IgnoreEntry {
  name: string
  /** 'npm' | 'git' | 'manual' */
  kind: string
  at: string
}

/** 更新历史记录（3.9）。 */
export interface UpdateHistoryEntry {
  at: string
  name: string
  from?: string | null
  to?: string | null
  ok: boolean
  kind: 'npm' | 'git' | 'main' | 'preset'
  output?: string
}

/** Hoist 提升规则检查结果。 */
export interface HoistCheckResult {
  healthy: boolean
  patterns: string[]
  subPlugins: string[]
  missingPatterns: string[]
  addedPatterns: string[]
  unresolvable: string[]
}

/** 进程与端口诊断信息。 */
export interface ProcessDiagnostic {
  port: number
  inUse: boolean
  pid: number | null
  name: string | null
  commandLine: string | null
  parentPid: number | null
  parentName: string | null
  isOrphan: boolean
  isDesktop: boolean
}

/** /doctor 体检完整结果。 */
export interface DoctorResult {
  healthy: boolean
  scanned: number
  healedJunctions: string[]
  missingDeps: string[]
  hoist: HoistCheckResult
  process: ProcessDiagnostic
}

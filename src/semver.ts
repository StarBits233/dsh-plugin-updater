/**
 * 完整 semver 2.0 比较与工具（v 前缀 / prerelease / build metadata / 简单 range）。
 *
 * 纯函数、零 Node API 依赖，便于单测与复用。
 * 覆盖场景：npm 版本（1.2.3 / 1.2.3-beta.1 / 1.2.3+build.5）、
 * GitHub tag（v1.2.3、1.2.3-rc.2）、降级保护（latest < installed 不算更新）。
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  build: string[]
  /** 原始字符串（trim 后） */
  raw: string
}

const SEMVER_RE = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** 解析版本字符串；无法解析返回 null（不抛异常）。 */
export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  const m = SEMVER_RE.exec(raw)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
    build: m[5] ? m[5].split('.') : [],
    raw,
  }
}

/** 是否是预发布版本（含 -beta/-rc/-alpha 等）。 */
export function isPrerelease(input: string): boolean {
  const p = parseVersion(input)
  return !!p && p.prerelease.length > 0
}

/** 归一化：去 v/V 前缀、去 build metadata（保留 prerelease）。无法解析返回原 trim。 */
export function normalize(input: string): string {
  const p = parseVersion(input)
  if (!p) return (input || '').trim()
  const pre = p.prerelease.length > 0 ? `-${p.prerelease.join('.')}` : ''
  return `${p.major}.${p.minor}.${p.patch}${pre}`
}

/** 主版本号（供 display，无法解析返回 null）。 */
export function majorOf(input: string): number | null {
  const p = parseVersion(input)
  return p ? p.major : null
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a)
  const bn = /^\d+$/.test(b)
  if (an && bn) {
    const ai = parseInt(a, 10)
    const bi = parseInt(b, 10)
    return ai === bi ? 0 : ai < bi ? -1 : 1
  }
  // 数字 < 字母（SemVer 规则：数字标识符总是低于字母数字）
  if (an !== bn) return an ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1 // 无 prerelease 更大
  if (b.length === 0) return -1
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const c = compareIdentifiers(a[i], b[i])
    if (c !== 0) return c
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

/**
 * SemVer 2.0 比较。build metadata 不参与优先级（仅同版本时为 0）。
 * @returns -1 | 0 | 1
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0 // 无法解析视为相等（调用方自行降级处理）
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

/** `latest` 相对 `current` 是否为新版本（严格大于 + 降级保护）。 */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return normalize(latest) !== normalize(current) // 兜底：字符串不同即视为更新
  return compareVersions(latest, current) > 0
}

/** 简单 range 判断（后续 Config/过滤用）：支持 ^ ~ >= <= = * 精确/区间。 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version)
  if (!v) return false
  const r = (range || '').trim()
  if (!r || r === '*' || r === 'x' || r === 'X') return true
  const exact = parseVersion(r)
  if (exact) return compareVersions(version, r) === 0
  const ge = /^>=\s*(\S+)/.exec(r)
  if (ge) {
    const g = parseVersion(ge[1])
    if (!g) return false
    return compareVersions(version, ge[1]) >= 0
  }
  const gt = /^>\s*(\S+)/.exec(r)
  if (gt) {
    const g = parseVersion(gt[1])
    if (!g) return false
    return compareVersions(version, gt[1]) > 0
  }
  const le = /^<=\s*(\S+)/.exec(r)
  if (le) {
    const l = parseVersion(le[1])
    if (!l) return false
    return compareVersions(version, le[1]) <= 0
  }
  const lt = /^<\s*(\S+)/.exec(r)
  if (lt) {
    const l = parseVersion(lt[1])
    if (!l) return false
    return compareVersions(version, lt[1]) < 0
  }
  // ^major.minor.patch：允许不改变 major 的增量（含 prerelease 语义简化）
  const caret = /^\^\s*(\S+)/.exec(r)
  if (caret) {
    const c = parseVersion(caret[1])
    if (!c) return false
    if (v.major > c.major) return false
    if (v.major < c.major) return true
    if (c.major === 0) {
      if (v.minor > c.minor) return false
      if (v.minor < c.minor) return true
      if (c.minor === 0 && v.patch > c.patch) return false
    }
    return compareVersions(version, caret[1]) >= 0
  }
  const tilde = /^~\s*(\S+)/.exec(r)
  if (tilde) {
    const t = parseVersion(tilde[1])
    if (!t) return false
    if (v.major !== t.major) return false
    if (t.minor !== undefined as any) {
      if (v.minor !== t.minor) return false
      return v.patch >= t.patch
    }
    return compareVersions(version, tilde[1]) >= 0
  }
  return false
}

/** 取两者中较高版本；任一无法解析时返回可解析的那个，都失败返回 null。 */
export function maxVersion(a: string | null | undefined, b: string | null | undefined): string | null {
  const aa = a === null || a === undefined ? null : parseVersion(a)
  const bb = b === null || b === undefined ? null : parseVersion(b)
  if (aa && bb) return compareVersions(a!, b!) >= 0 ? a! : b!
  return (a ?? b) ?? null
}

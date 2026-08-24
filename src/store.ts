/**
 * @dsh-external/dsh-plugin-updater — 持久化存储。
 *
 * 存到 <DSH_HOME>/storages/dsh-plugin-updater/store.json（JSON，原子写）。
 * 承载：通知列表、忽略列表、更新历史、上次已知版本（用于发现"新更新"）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface StoreData {
  notifications: NotificationRecord[]
  ignored: IgnoreRecord[]
  history: HistoryRecord[]
  /** name → 上次已知 latest 版本（用于检测"新出现的更新"→ 通知去重） */
  knownLatest: Record<string, string>
  /** 上次检查时间 */
  lastCheckAt?: string
}

interface NotificationRecord {
  id: string
  at: string
  kind: string
  title: string
  body?: string
  read: boolean
  dedupe?: string
}

interface IgnoreRecord {
  name: string
  kind: 'npm' | 'git' | 'manual'
  at: string
}

interface HistoryRecord {
  at: string
  name: string
  from?: string | null
  to?: string | null
  ok: boolean
  kind: 'npm' | 'git' | 'main' | 'preset'
  output?: string
}

const EMPTY: StoreData = { notifications: [], ignored: [], history: [], knownLatest: {}, lastCheckAt: undefined }

export class PluginStore {
  private readonly file: string
  private data: StoreData

  constructor(dshHome: string) {
    const dir = join(dshHome, 'storages', 'dsh-plugin-updater')
    this.file = join(dir, 'store.json')
    this.data = this.load(dir)
  }

  private load(dir: string): StoreData {
    try {
      if (!existsSync(this.file)) return { ...EMPTY }
      const raw = readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoreData>
      return {
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
        ignored: Array.isArray(parsed.ignored) ? parsed.ignored : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        knownLatest: parsed.knownLatest && typeof parsed.knownLatest === 'object' ? parsed.knownLatest : {},
        lastCheckAt: typeof parsed.lastCheckAt === 'string' ? parsed.lastCheckAt : undefined,
      }
    } catch {
      return { ...EMPTY }
    }
    finally {
      // ensure dir (load 失败时也会建目录）
      try {
        mkdirSync(dirname(this.file), { recursive: true })
      } catch {
        // 忽略
      }
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch {
      // 持久化失败静默（进程内仍有数据，下次尝试）
    }
  }

  /** 完整快照（供 /state）。 */
  snapshot(): StoreData {
    return this.data
  }

  /** 未读通知数。 */
  unreadCount(): number {
    return this.data.notifications.filter((n) => !n.read).length
  }

  /** 追加通知（按 dedupe 去重：同 dedupe 只保留一条）。 */
  pushNotification(n: Omit<NotificationRecord, 'id' | 'at' | 'read'>): void {
    if (n.dedupe && this.data.notifications.some((x) => x.dedupe === n.dedupe)) return
    this.data.notifications.unshift({ ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), read: false })
    // 只保留最近 100 条
    if (this.data.notifications.length > 100) this.data.notifications = this.data.notifications.slice(0, 100)
    this.persist()
  }

  /** 全部已读。 */
  markAllRead(): void {
    for (const n of this.data.notifications) n.read = true
    this.persist()
  }

  /** 清空所有通知。 */
  clearNotifications(): void {
    this.data.notifications = []
    this.persist()
  }

  /** 记录"已知最新版本"，返回是否发生了新更新（用于触发通知）。 */
  rememberLatest(name: string, latest: string, current?: string | null): boolean {
    const prev = this.data.knownLatest[name]
    this.data.knownLatest[name] = latest
    this.persist()
    // 新出现（无记录 或 之前记录不同）且当前已安装版本低于最新 → 视为"新更新"
    if (prev === latest) return false
    if (current !== null && current !== undefined && current !== latest) return true
    return !!prev && prev !== latest
  }

  /** 忽略列表判断 + 增删。 */
  isIgnored(name: string): boolean {
    return this.data.ignored.some((i) => i.name === name)
  }

  addIgnore(name: string, kind: 'npm' | 'git' | 'manual'): void {
    if (this.data.ignored.some((i) => i.name === name)) return
    this.data.ignored.push({ name, kind, at: new Date().toISOString() })
    this.persist()
  }

  removeIgnore(name: string): void {
    this.data.ignored = this.data.ignored.filter((i) => i.name !== name)
    this.persist()
  }

  /** 记录更新历史。 */
  addHistory(h: Omit<HistoryRecord, 'at'>): void {
    this.data.history.unshift({ ...h, at: new Date().toISOString() })
    if (this.data.history.length > 200) this.data.history = this.data.history.slice(0, 200)
    this.persist()
  }

  setLastCheckAt(at: string): void {
    this.data.lastCheckAt = at
    this.persist()
  }
}

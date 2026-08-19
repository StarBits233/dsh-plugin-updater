/**
 * @dsh-external/dsh-plugin-updater — client 侧（React section）
 *
 * 挂点契约：ctx.slots.register(spec, ReactComponent) —— 组件是 React 函数组件，
 *           遵循 DSH 原生国际化架构（ctx.locale.register + ctx.locale.bind + locale: NS），
 *           自动与 DSH 通用设置中的语言（中文/English）深度联动切换。
 */
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NS, dicts } from './i18n.js'

type ClientContext = {
  slots: any
  effect: any
  locale: any
}

export const inject = ['slots', 'locale']

const API = '/@dsh-external/dsh-plugin-updater/api'

const C: Record<string, any> = {
  page: { fontSize: 13.5, color: 'var(--dsw-alias-label-primary, #ddd)', fontFamily: 'inherit', lineHeight: 1.5 },
  h3: { margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #ddd)' },
  stats: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12, margin: '0 0 12px' },
  row: { display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap', alignItems: 'center' },
  btn: { background: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #2563eb))', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnGhost: { background: 'var(--dsw-alias-bg-module-platform, transparent)', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))', color: 'var(--dsw-alias-label-primary, #ddd)' },
  btnDanger: { background: 'transparent', border: '1px solid #d33', color: '#d33' },
  btnDisabled: { opacity: 0.45, cursor: 'default' },
  section: { margin: '16px 0 8px', fontSize: 12.5, color: 'var(--dsw-alias-label-secondary, #999)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  grid: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: '11px 14px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))', borderRadius: 12, marginBottom: 0,
    background: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06)))',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', minHeight: 44,
  },
  itemHeader: { display: 'flex', alignItems: 'center', gap: 8, width: '100%' },
  desc: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #888)', marginTop: 3, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemUpdating: { borderColor: 'var(--dsw-alias-state-business-primary, #2563eb)', boxShadow: '0 0 0 1px var(--dsw-alias-state-business-primary, #2563eb)' },
  spinner: {
    display: 'inline-block', width: 11, height: 11, borderRadius: '50%', marginRight: 5,
    border: '2px solid rgba(255,255,255,.25)', borderTopColor: '#fff',
    animation: 'dshpu-spin .8s linear infinite', verticalAlign: 'middle',
  },
  nameWrapper: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' },
  name: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #ddd)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' },
  linkName: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-state-business-primary, #2563eb)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'none', display: 'inline-block', maxWidth: '100%' },
  ver: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary, #888)', whiteSpace: 'nowrap', fontWeight: 500 },
  arrow: { color: 'var(--dsw-alias-state-business-primary, #2563eb)', fontSize: 12 },
  st: { fontSize: 11.5, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap', fontWeight: 500 },
  stOut: { background: 'rgba(240,180,60,0.18)', color: '#d98b0f' },
  stOk: { background: 'rgba(46,204,113,0.18)', color: '#1e9e54' },
  stLink: { background: 'rgba(128,128,128,0.14)', color: 'var(--dsw-alias-label-secondary, #777)' },
  stErr: { background: 'rgba(220,50,50,0.18)', color: '#e74c3c' },
  updateBtn: { background: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #2563eb))', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 11px', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' },
  msg: { marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.06))', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))', color: 'var(--dsw-alias-label-primary, #ddd)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12 },
  msgErr: { borderColor: '#d33', color: '#e74c3c' },
  note: { color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #888))', fontSize: 12, marginTop: 10, lineHeight: 1.5 },
  searchInput: {
    background: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06)))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
    color: 'var(--dsw-alias-label-primary, #ddd)', borderRadius: 8, padding: '6px 12px', fontSize: 12.5,
    outline: 'none', flex: 1, minWidth: 160,
  },
  tabBtn: {
    background: 'var(--dsw-alias-bg-module-platform, transparent)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
    color: 'var(--dsw-alias-label-secondary, #888)', borderRadius: 16, padding: '4px 12px',
    fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
  },
  tabBtnActive: {
    background: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #2563eb))',
    borderColor: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #2563eb))',
    color: '#fff', fontWeight: 600,
  },
  changelogBtn: {
    background: 'transparent',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
    color: 'var(--dsw-alias-label-secondary, #888)',
    borderRadius: 6, fontSize: 11, cursor: 'pointer', padding: '2px 6px',
    whiteSpace: 'nowrap', transition: 'all .15s',
  },
  changelogBox: {
    marginTop: 8, padding: '8px 10px',
    background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.12))',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
    borderRadius: 6,
  },
}

interface NpmItem {
  name: string
  current: string | null
  latest: string | null
  outdated: boolean
  description?: string
  error?: string
  homepage?: string
}

interface LinkItem {
  name: string
  spec: string
  version?: string | null
  description?: string
  homepage?: string
  gitBehind?: boolean
  gitBranch?: string
  ghRepo?: string | null
  ghLatest?: string | null
  ghTag?: string | null
}

interface UpdaterState {
  npm: NpmItem[]
  linked: LinkItem[]
  errors: string[]
  checkedAt?: string
  cached?: boolean
}

function PluginUpdaterSection(props: { close?: () => void; t?: (key: string, params?: any) => string }): any {
  const t = props.t ?? ((k: string) => dicts.zh[k as keyof typeof dicts.zh] || k)

  const [state, setState] = useState<UpdaterState>({ npm: [], linked: [], errors: [] })
  const [msg, setMsg] = useState('')
  const [msgErr, setMsgErr] = useState(false)
  const [checking, setChecking] = useState(true)
  const [updating, setUpdating] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [main, setMain] = useState<any>(null)
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ok' | 'err' }[]>([])
  const toastSeq = useRef(0)

  const showToast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { id, text, kind }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const [ignoredNames, setIgnoredNames] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const loadState = useCallback(() => {
    fetch(API + '/state', { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json())
      .then((d: any) => {
        const v = d?.value
        if (!v) return
        setIgnoredNames(new Set((v.ignored ?? []).map((i: any) => i.name)))
        setHistory(Array.isArray(v.history) ? v.history : [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  const refresh = useCallback((force = false) => {
    setChecking(true)
    fetch(API + '/status' + (force ? '?force=1' : ''), { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json())
      .then((d: any) => {
        if (!d?.ok) {
          setMsg(JSON.stringify(d))
          setMsgErr(true)
          return
        }
        setState({
          npm: d.value?.npm ?? [],
          linked: d.value?.linked ?? [],
          errors: d.value?.errors ?? [],
          checkedAt: d.value?.checkedAt,
          cached: !!d.value?.cached,
        })
        setMsg('')
        setMsgErr(false)
      })
      .catch((e: any) => {
        setMsg(t('fetchFailed') + ': ' + e)
        setMsgErr(true)
      })
      .finally(() => setChecking(false))

    fetch(API + '/state', { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json())
      .then((d: any) => { if (d?.ok) setMain(d.value?.main ?? null) })
      .catch(() => {})
  }, [t])

  const toggleIgnore = useCallback((name: string) => {
    const ignoring = !ignoredNames.has(name)
    fetch(API + (ignoring ? '/ignore' : '/unignore'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    })
      .then(() => {
        setIgnoredNames((prev) => {
          const next = new Set(prev)
          if (ignoring) next.add(name); else next.delete(name)
          return next
        })
        showToast(ignoring ? `${t('ignored')} ${name}` : `${t('unignore')} ${name}`, 'ok')
        refresh(true)
      })
      .catch((e: any) => showToast('Error: ' + e, 'err'))
  }, [ignoredNames, refresh, showToast, t])

  useEffect(() => {
    refresh(false)
  }, [refresh])

  const runUpdate = (pkgs: { name: string; latest: string }[], label: string) => {
    if (!pkgs.length || busy) return
    setBusy(true)
    const names = pkgs.map((p) => p.name)
    setUpdating(names)
    setMsg(`${label} (${pkgs.length})…`)
    setMsgErr(false)
    fetch(API + '/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packages: pkgs }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (!d?.ok) {
          setMsg(JSON.stringify(d))
          setMsgErr(true)
          return
        }
        const results = d.value?.results ?? []
        const okCount = results.filter((r: any) => r.ok).length
        const failCount = results.length - okCount
        const lines = results.map((r: any) => `${r.ok ? '✅' : '❌'} ${r.name} → ${r.latest}${r.ok ? '' : '：' + r.output}`)
        setMsg(`${okCount} ok / ${failCount} fail\n\n${lines.join('\n')}`)
        setMsgErr(failCount > 0)
        showToast(failCount > 0 ? `${okCount} ok / ${failCount} fail` : `${t('update')} ${okCount}`, failCount > 0 ? 'err' : 'ok')
        if (okCount > 0) setNeedRestart(true)
        setTimeout(() => refresh(true), 1500)
      })
      .catch((e: any) => {
        setMsg('Error: ' + e)
        setMsgErr(true)
        showToast('Error: ' + e, 'err')
      })
      .finally(() => {
        setBusy(false)
        setUpdating([])
      })
  }

  const [needRestart, setNeedRestart] = useState(false)
  const [reloading, setReloading] = useState(false)

  const triggerHotReload = () => {
    setReloading(true)
    fetch(API + '/hot-reload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
      .then((r) => r.json())
      .then((d: any) => {
        showToast(d?.output || t('hotReloadDone'), 'ok')
      })
      .catch((e: any) => showToast(t('hotReloadFailed') + e, 'err'))
      .finally(() => setReloading(false))
  }

  const copyRestartCommand = () => {
    try {
      navigator.clipboard.writeText('dsh service restart')
      showToast(t('copiedCmd'), 'ok')
    } catch {
      showToast(t('copyFailed'), 'err')
    }
  }

  const runRollback = (name: string, targetVersion: string, kind: string) => {
    if (!window.confirm(`${t('rollbackTo')} ${name} → ${targetVersion}?`)) return
    setBusy(true)
    setMsg(`${name} → ${targetVersion}…`)
    fetch(API + '/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, targetVersion, kind }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.ok) {
          showToast(`${name} → ${targetVersion}`, 'ok')
          setMsg(`${name} → ${targetVersion}\n${d?.output || ''}`)
          setMsgErr(false)
          setNeedRestart(true)
          setTimeout(() => refresh(true), 1500)
        } else {
          showToast(`Rollback failed: ${d?.output || d?.error || ''}`, 'err')
          setMsg(`Rollback failed: ${d?.output || d?.error || ''}`)
          setMsgErr(true)
        }
      })
      .catch((e: any) => {
        showToast('Error: ' + e, 'err')
        setMsg('Error: ' + e)
        setMsgErr(true)
      })
      .finally(() => setBusy(false))
  }

  const outdatedNpm = state.npm.filter((n) => n.outdated && !n.ignored && !ignoredNames.has(n.name))
  const linkUpdatableCount = state.linked.filter((l) => !l.ignored && !ignoredNames.has(l.name) && (l.gitBehind || (!!l.ghLatest && !l.homepage))).length
  const totalIgnoredCount = state.npm.filter((n) => n.ignored || ignoredNames.has(n.name)).length + state.linked.filter((l) => l.ignored || ignoredNames.has(l.name)).length
  const updatingOne = (name: string) => updating.includes(name)

  const allUpdatableList = [
    ...outdatedNpm.map((n) => ({ name: n.name, latest: n.latest! })),
    ...state.linked.filter((l) => !l.ignored && !ignoredNames.has(l.name) && (l.gitBehind || (!!l.ghLatest && !l.homepage))).map((l) => ({ name: l.name, latest: l.ghLatest || '' })),
  ]

  const [selectedPkgs, setSelectedPkgs] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const [cfgInterval, setCfgInterval] = useState<number>(6)
  const [cfgNotify, setCfgNotify] = useState(true)
  const [cfgToken, setCfgToken] = useState('')
  const [doctorResult, setDoctorResult] = useState<any>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)

  const toggleSelect = (name: string) => {
    setSelectedPkgs((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedPkgs.size >= allUpdatableList.length) {
      setSelectedPkgs(new Set())
    } else {
      setSelectedPkgs(new Set(allUpdatableList.map((p) => p.name)))
    }
  }

  const runDoctor = () => {
    setDoctorRunning(true)
    fetch(API + '/doctor', { method: 'POST' })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.ok) {
          setDoctorResult(d.value)
          showToast(d.value?.healthy ? t('doctorToastPass') : t('doctorToastHealed'), 'ok')
        }
      })
      .catch((e: any) => showToast(t('doctorToastFailed') + e, 'err'))
      .finally(() => setDoctorRunning(false))
  }

  const saveConfig = () => {
    fetch(API + '/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        checkIntervalMs: cfgInterval === 0 ? 0 : cfgInterval * 3600 * 1000,
        notifyNewUpdates: cfgNotify,
        githubToken: cfgToken.trim() || undefined,
      }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.ok) {
          showToast(t('configSaved'), 'ok')
          setShowConfig(false)
        }
      })
      .catch((e: any) => showToast(t('configSaveFailed') + e, 'err'))
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'outdated' | 'npm' | 'link' | 'ignored'>('all')
  const [activeChangelog, setActiveChangelog] = useState<{ name: string; loading: boolean; data?: any; error?: string } | null>(null)

  const toggleChangelog = (name: string, version: string) => {
    if (activeChangelog?.name === name) {
      setActiveChangelog(null)
      return
    }
    setActiveChangelog({ name, loading: true })
    fetch(API + '/changelog?name=' + encodeURIComponent(name) + '&version=' + encodeURIComponent(version))
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.ok && d?.value) {
          setActiveChangelog({ name, loading: false, data: d.value })
        } else {
          setActiveChangelog({ name, loading: false, error: d?.error || t('fetchNotesFailed') })
        }
      })
      .catch((e: any) => {
        setActiveChangelog({ name, loading: false, error: String(e?.message ?? e) })
      })
  }

  const renderChangelog = (name: string) => {
    if (activeChangelog?.name !== name) return null
    if (activeChangelog.loading) {
      return jsx('div', {
        style: C.changelogBox,
        children: jsxs('div', {
          style: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 },
          children: [jsx('span', { style: C.spinner }), t('fetchingNotes')],
        }),
      })
    }
    const data = activeChangelog.data
    return jsxs('div', {
      style: C.changelogBox,
      children: [
        jsxs('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', paddingBottom: 4 },
          children: [
            jsx('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 12.5 }, children: data?.title || `📝 ${t('notes')}` }),
            data?.htmlUrl ? jsx('a', { href: data.htmlUrl, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 11.5, color: 'var(--dsw-alias-state-business-primary, #2563eb)', textDecoration: 'none' }, children: t('viewOnGithub') }) : null,
          ].filter(Boolean),
        }),
        jsx('div', {
          style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #aaa)', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto', lineHeight: 1.5 },
          children: data?.body || activeChangelog.error || t('noNotes'),
        }),
      ],
    })
  }

  const query = searchQuery.trim().toLowerCase()
  const matchQuery = (item: { name: string; description?: string }) => {
    if (!query) return true
    return item.name.toLowerCase().includes(query) || (item.description ? item.description.toLowerCase().includes(query) : false)
  }

  const filteredNpm = state.npm.filter((n) => {
    const isIgn = n.ignored || ignoredNames.has(n.name)
    if (tab === 'ignored') return isIgn && matchQuery(n)
    if (isIgn && tab === 'outdated') return false
    if (tab === 'link') return false
    if (tab === 'outdated' && !n.outdated) return false
    return matchQuery(n)
  })

  const filteredLinked = state.linked.filter((l) => {
    const isIgn = l.ignored || ignoredNames.has(l.name)
    if (tab === 'ignored') return isIgn && matchQuery(l)
    if (isIgn && tab === 'outdated') return false
    if (tab === 'npm') return false
    const isUpdatable = l.gitBehind || (!!l.ghLatest && !l.homepage)
    if (tab === 'outdated' && !isUpdatable) return false
    return matchQuery(l)
  })

  // npm 插件列表（卡片）
  const npmItems: any[] = filteredNpm.map((n) => {
    const isUpdating = updatingOne(n.name)
    const isIgn = n.ignored || ignoredNames.has(n.name)
    const style: any = { ...C.item, ...(isUpdating ? C.itemUpdating : {}) }
    const nameNode = jsx('div', {
      style: C.nameWrapper,
      children: n.homepage
        ? jsx('a', {
            className: 'dshpu-link',
            style: C.linkName,
            href: n.homepage,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: (e: any) => e.stopPropagation(),
            title: n.homepage,
            children: n.name,
          })
        : jsx('span', { style: C.name, children: n.name }),
    })
    // 状态区
    let statusNode: any
    let ignoreNode: any = null
    if (isIgn) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stLink }, children: t('ignored') }, 'ign')
      ignoreNode = jsx('button', {
        style: { ...C.btnGhost, padding: '3px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 6 },
        title: t('unignoreTitle'),
        onClick: (e: any) => {
          e.stopPropagation()
          toggleIgnore(n.name)
        },
        children: t('unignore'),
      }, 'unign-' + n.name)
    } else if (n.error) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stErr }, children: n.error }, 'err')
    } else if (n.latest === null) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stErr }, children: t('fetchFailed') }, 'err')
    } else {
      const verNode: any[] = [
        jsx('span', { style: C.ver, children: n.current ?? '?' }),
      ]
      if (n.outdated) {
        verNode.push(jsx('span', { style: C.arrow, children: '→' }, 'arr'))
        verNode.push(jsx('span', { style: { ...C.ver, color: '#d98b0f' }, children: n.latest }, 'latest'))
        verNode.push(jsx('button', {
          style: { ...C.changelogBtn, ...(activeChangelog?.name === n.name ? { borderColor: 'var(--dsw-alias-state-business-primary, #2563eb)', color: 'var(--dsw-alias-state-business-primary, #2563eb)' } : {}) },
          title: t('notes'),
          onClick: (e: any) => {
            e.stopPropagation()
            toggleChangelog(n.name, n.latest!)
          },
          children: activeChangelog?.name === n.name ? t('hideNotes') : t('notes'),
        }, 'clog-' + n.name))
        verNode.push(jsx('button', {
          style: { ...C.updateBtn, ...(isUpdating || busy ? C.btnDisabled : {}) },
          disabled: isUpdating || busy,
          onClick: (e: any) => {
            e.stopPropagation()
            if (n.latest) runUpdate([{ name: n.name, latest: n.latest }], t('update'))
          },
          children: isUpdating ? jsx('span', { style: C.spinner }) : t('update'),
        }, 'btn'))
        ignoreNode = jsx('button', {
          style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' },
          title: t('ignore'),
          onClick: (e: any) => {
            e.stopPropagation()
            if (window.confirm(`${t('ignore')} ${n.name}?`)) {
              toggleIgnore(n.name)
            }
          },
          children: t('ignore'),
        }, 'ignore-' + n.name)
      } else {
        verNode.push(jsx('span', { style: { ...C.st, ...C.stOk }, children: t('latest') }, 'ok'))
      }
      statusNode = jsxs('span', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: verNode })
    }

    const checkboxNode = n.outdated
      ? jsx('input', {
          type: 'checkbox',
          checked: selectedPkgs.has(n.name),
          onChange: (e: any) => {
            e.stopPropagation()
            toggleSelect(n.name)
          },
          style: { marginRight: 8, cursor: 'pointer', accentColor: 'var(--dsw-alias-state-business-primary, #2563eb)' },
        })
      : null

    const header = jsxs('div', { style: C.itemHeader, children: [checkboxNode, nameNode, statusNode, ignoreNode].filter(Boolean) })
    const desc = n.description ? jsx('div', { style: C.desc, title: n.description, children: n.description }) : null
    return jsxs('li', { style, children: [header, desc, renderChangelog(n.name)].filter(Boolean) }, 'npm-' + n.name)
  })

  // link 插件列表
  const linkItems: any[] = filteredLinked.map((l) => {
    const isUpdating = updatingOne(l.name)
    const isIgn = l.ignored || ignoredNames.has(l.name)
    const nameNode = jsx('div', {
      style: C.nameWrapper,
      children: l.homepage
        ? jsx('a', {
            className: 'dshpu-link',
            style: C.linkName,
            href: l.homepage,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: (e: any) => e.stopPropagation(),
            title: l.homepage,
            children: l.name,
          })
        : jsx('span', { style: C.name, children: l.name }),
    })
    let statusNode: any
    let buttonNode: any = null
    let ignoreNode: any = null
    const ghRepo = l.ghRepo
    const isGhUpdatable = !l.homepage && !isIgn && !!ghRepo && !!l.ghLatest
    const isGitUpdatable = !!l.homepage && !isIgn && !!l.gitBehind
    const isUpdatableLink = isGhUpdatable || isGitUpdatable

    const verSpan = l.version ? jsx('span', { style: C.ver, children: l.version }, 'ver-' + l.name) : null

    if (isIgn) {
      statusNode = jsxs('span', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [verSpan, jsx('span', { style: { ...C.st, ...C.stLink }, children: t('ignored') })].filter(Boolean) })
      buttonNode = jsx('button', {
        style: { ...C.btnGhost, padding: '3px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 6 },
        title: t('unignoreTitle'),
        onClick: (e: any) => {
          e.stopPropagation()
          toggleIgnore(l.name)
        },
        children: t('unignore'),
      }, 'unign-' + l.name)
    } else if (!l.homepage && !ghRepo) {
      statusNode = jsxs('span', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [verSpan, jsx('span', { style: { ...C.st, ...C.stLink }, children: t('localNoRemote') })].filter(Boolean) })
    } else if (isGhUpdatable) {
      statusNode = jsxs('span', {
        style: { display: 'flex', alignItems: 'center', gap: 6 },
        children: [
          verSpan,
          jsx('span', { style: C.arrow, children: '→' }, 'arr'),
          jsx('span', { style: { ...C.st, ...C.stOut }, children: `GitHub ${l.ghTag ?? l.ghLatest}` }, 'ghbehind'),
          jsx('button', {
            style: { ...C.changelogBtn, ...(activeChangelog?.name === l.name ? { borderColor: 'var(--dsw-alias-state-business-primary, #2563eb)', color: 'var(--dsw-alias-state-business-primary, #2563eb)' } : {}) },
            title: t('notes'),
            onClick: (e: any) => {
              e.stopPropagation()
              toggleChangelog(l.name, l.ghTag || l.ghLatest || '')
            },
            children: activeChangelog?.name === l.name ? t('hideNotes') : t('notes'),
          }, 'clog-' + l.name),
        ].filter(Boolean),
      })
      buttonNode = jsx('button', {
        style: { ...C.updateBtn, ...((isUpdating || busy) ? C.btnDisabled : {}) },
        disabled: isUpdating || busy,
        onClick: (e: any) => {
          e.stopPropagation()
          runUpdate([{ name: l.name, latest: l.ghLatest! }], `${t('update')} ${l.name}`)
        },
        children: isUpdating ? jsx('span', { style: C.spinner }) : t('gitUpdate'),
      } as any, 'ghbtn')
      ignoreNode = jsx('button', {
        style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' },
        title: t('ignore'),
        onClick: (e: any) => {
          e.stopPropagation()
          if (window.confirm(`${t('ignore')} ${l.name}?`)) {
            toggleIgnore(l.name)
          }
        },
        children: t('ignore'),
      }, 'ignore-' + l.name)
    } else if (l.homepage) {
      const gitStatusBadge = l.gitBehind
        ? jsx('span', { style: { ...C.st, ...C.stOut }, children: `${t('updatable')} (${l.gitBranch ?? 'git'})` }, 'behind')
        : jsx('span', { style: { ...C.st, ...C.stOk }, children: t('isLatest') }, 'ok')
      statusNode = jsxs('span', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [verSpan, gitStatusBadge].filter(Boolean) })
      buttonNode = jsx('button', {
        style: { ...C.updateBtn, ...((isUpdating || busy || !l.gitBehind) ? C.btnDisabled : {}) },
        disabled: isUpdating || busy || !l.gitBehind,
        onClick: (e: any) => {
          e.stopPropagation()
          runUpdate([{ name: l.name, latest: '' }], `${t('update')} ${l.name}`)
        },
        children: isUpdating ? jsx('span', { style: C.spinner }) : t('gitUpdate'),
      } as any, 'gitbtn')
      if (l.gitBehind) {
        ignoreNode = jsx('button', {
          style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11, cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' },
          title: t('ignore'),
          onClick: (e: any) => {
            e.stopPropagation()
            if (window.confirm(`${t('ignore')} ${l.name}?`)) {
              toggleIgnore(l.name)
            }
          },
          children: t('ignore'),
        }, 'ignore-' + l.name)
      }
    } else {
      statusNode = jsxs('span', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [verSpan, jsx('span', { style: { ...C.st, ...C.stLink }, children: t('localDir') })].filter(Boolean) })
    }

    const checkboxNode = isUpdatableLink
      ? jsx('input', {
          type: 'checkbox',
          checked: selectedPkgs.has(l.name),
          onChange: (e: any) => {
            e.stopPropagation()
            toggleSelect(l.name)
          },
          style: { marginRight: 8, cursor: 'pointer', accentColor: 'var(--dsw-alias-state-business-primary, #2563eb)' },
        })
      : null

    const header = jsxs('div', {
      style: C.itemHeader,
      children: [checkboxNode, nameNode, statusNode, buttonNode, ignoreNode].filter(Boolean),
    })
    const desc = l.description ? jsx('div', { style: C.desc, title: l.description, children: l.description }) : null
    return jsxs('li', {
      style: { ...C.item, ...(isUpdating ? C.itemUpdating : {}) },
      children: [header, desc, renderChangelog(l.name)].filter(Boolean),
    }, 'link-' + l.name)
  })

  const stats = `${new Date(state.checkedAt ?? Date.now()).toLocaleString()}${state.cached ? ' (cached)' : ''} · ${state.npm.length} ${t('npmSection')} (${outdatedNpm.length} ${t('updatable')}) · ${state.linked.length} ${t('linkSection')} (${linkUpdatableCount} ${t('updatable')})`

  // 主程序状态条（3.6）
  const mainNode = (() => {
    if (!main) return null
    const updateable = !!main.updateable
    const outdated = !!main.outdated
    const label = outdated
      ? `${t('updateMainBtn')}: ${main.current} → ${main.latest}`
      : `${t('isLatest')}: ${main.current ?? '?'}`
    const style: any = {
      display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', padding: '9px 12px',
      border: `1px solid ${outdated ? 'var(--dsw-alias-state-business-primary, #2563eb)' : 'var(--dsw-alias-border-l2, rgba(128,128,128,0.2))'}`,
      borderRadius: 8, background: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06)))', fontSize: 13,
    }
    const btn = outdated && updateable
      ? jsx('button', {
          style: { ...C.updateBtn },
          onClick: (e: any) => {
            e.stopPropagation()
            if (!window.confirm(t('updateMainConfirm'))) return
            fetch(API + '/update-main', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
              .then((r) => r.json())
              .then((d: any) => {
                setMsg(d?.value?.output ?? JSON.stringify(d ?? {}))
                setMsgErr(!(d?.ok ?? d?.value?.ok))
                setTimeout(() => refresh(true), 1500)
              })
              .catch((err: any) => { setMsg('Error: ' + err); setMsgErr(true) })
          },
          children: t('updateMainBtn'),
        }, 'mainbtn')
      : null
    return jsxs('div', {
      style,
      children: [
        jsx('span', { style: { color: outdated ? 'var(--dsw-alias-state-business-primary, #2563eb)' : 'var(--dsw-alias-label-secondary, #888)' }, children: label }),
        btn,
      ],
    }, 'main-status')
  })()

  const hasItems = state.npm.length > 0 || state.linked.length > 0
  const hasFilteredItems = filteredNpm.length > 0 || filteredLinked.length > 0

  return jsxs('div', {
    style: C.page,
    children: [
      jsx('style', {
        children: '@keyframes dshpu-spin{to{transform:rotate(360deg)}} .dshpu-link:hover{text-decoration:underline !important;} @keyframes dshpu-toast-in{from{opacity:0;transform:translateY(-12px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}',
      }),
      jsx('h3', { style: C.h3, children: t('title') }),
      jsx('p', { style: C.stats, children: stats }),
      mainNode,
      needRestart ? jsxs('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          margin: '10px 0', padding: '10px 14px', borderRadius: 8,
          background: 'rgba(240,180,60,0.12)', border: '1px solid rgba(240,180,60,0.4)',
          color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 12.5, flexWrap: 'wrap', gap: 8,
        },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: 6 },
            children: [
              jsx('span', { style: { fontSize: 16 }, children: '⚡' }),
              jsx('span', { style: { fontWeight: 500 }, children: t('restartBanner') }),
            ],
          }),
          jsxs('div', {
            style: { display: 'flex', gap: 6 },
            children: [
              jsx('button', {
                style: { ...C.btnGhost, padding: '4px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 6 },
                onClick: triggerHotReload,
                disabled: reloading,
                children: reloading ? t('hotReloading') : t('hotReload'),
              }),
              jsx('button', {
                style: { ...C.btnGhost, padding: '4px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 6 },
                onClick: copyRestartCommand,
                children: t('copyRestartCmd'),
              }),
            ],
          }),
        ],
      }) : null,
      jsxs('div', {
        style: { ...C.row, flexWrap: 'wrap', gap: 8 },
        children: [
          jsx('button', {
            style: { ...C.btn, ...C.btnGhost, ...(checking || busy ? C.btnDisabled : {}) },
            disabled: checking || busy,
            onClick: () => refresh(true),
            children: checking ? t('checking') : t('recheck'),
          }),
          jsx('button', {
            style: {
              ...C.btn,
              ...(allUpdatableList.length === 0 || busy ? C.btnDisabled : {}),
            },
            disabled: allUpdatableList.length === 0 || busy,
            onClick: () => {
              const toUpdate = selectedPkgs.size > 0
                ? allUpdatableList.filter((p) => selectedPkgs.has(p.name))
                : allUpdatableList
              runUpdate(toUpdate, selectedPkgs.size > 0 ? `${t('updateSelected')} (${toUpdate.length})` : t('updateAll'))
            },
            children: busy
              ? t('updating')
              : selectedPkgs.size > 0
              ? `${t('updateSelected')}（${selectedPkgs.size}）`
              : `${t('updateAll')}（${allUpdatableList.length}）`,
          }),
          allUpdatableList.length > 0
            ? jsx('button', {
                style: { ...C.btnGhost, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', borderRadius: 8 },
                onClick: toggleSelectAll,
                children: selectedPkgs.size >= allUpdatableList.length && allUpdatableList.length > 0 ? t('deselectAll') : `${t('selectAll')} (${allUpdatableList.length})`,
              })
            : null,
          jsx('button', {
            style: { ...C.btnGhost, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', borderRadius: 8 },
            disabled: doctorRunning,
            onClick: runDoctor,
            children: doctorRunning ? t('healthChecking') : t('healthCheck'),
          }),
          jsx('button', {
            style: { ...C.btnGhost, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', borderRadius: 8 },
            onClick: () => setShowConfig((v) => !v),
            children: showConfig ? t('closeSettings') : t('settings'),
          }),
        ].filter(Boolean),
      }),
      showConfig ? jsxs('div', {
        style: {
          margin: '10px 0', padding: '12px 14px', borderRadius: 8,
          background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.06))',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
          fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10,
        },
        children: [
          jsx('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #ddd)' }, children: t('settingsTitle') }),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
            children: [
              jsx('span', { style: { color: 'var(--dsw-alias-label-secondary, #888)' }, children: t('checkIntervalLabel') }),
              jsx('select', {
                style: { padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 12.5 },
                value: cfgInterval,
                onChange: (e: any) => setCfgInterval(Number(e.target.value)),
                children: [
                  jsx('option', { value: 1, children: t('interval1h') }),
                  jsx('option', { value: 3, children: t('interval3h') }),
                  jsx('option', { value: 6, children: t('interval6h') }),
                  jsx('option', { value: 12, children: t('interval12h') }),
                  jsx('option', { value: 24, children: t('interval24h') }),
                  jsx('option', { value: 0, children: t('intervalManual') }),
                ],
              }),
            ],
          }),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10 },
            children: [
              jsx('label', {
                style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--dsw-alias-label-primary, #ddd)' },
                children: [
                  jsx('input', { type: 'checkbox', checked: cfgNotify, onChange: (e: any) => setCfgNotify(e.target.checked) }),
                  t('notifyLabel'),
                ],
              }),
            ],
          }),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
            children: [
              jsx('span', { style: { color: 'var(--dsw-alias-label-secondary, #888)' }, children: t('githubTokenLabel') }),
              jsx('input', {
                type: 'password',
                style: { padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 12.5, minWidth: 200 },
                placeholder: t('githubTokenPlaceholder'),
                value: cfgToken,
                onChange: (e: any) => setCfgToken(e.target.value),
              }),
            ],
          }),
          jsxs('div', {
            style: { display: 'flex', gap: 8, marginTop: 4 },
            children: [
              jsx('button', { style: { ...C.btn, padding: '5px 14px', fontSize: 12 }, onClick: saveConfig, children: t('saveConfig') }),
              jsx('button', { style: { ...C.btnGhost, padding: '5px 14px', fontSize: 12, cursor: 'pointer', borderRadius: 8 }, onClick: () => setShowConfig(false), children: t('cancel') }),
            ],
          }),
        ],
      }) : null,
      doctorResult ? jsxs('div', {
        style: {
          margin: '10px 0', padding: '12px 14px', borderRadius: 8,
          background: doctorResult.healthy ? 'rgba(46,204,113,0.1)' : 'rgba(240,180,60,0.12)',
          border: `1px solid ${doctorResult.healthy ? 'rgba(46,204,113,0.4)' : 'rgba(240,180,60,0.4)'}`,
          fontSize: 12.5,
        },
        children: [
          jsxs('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
            children: [
              jsxs('span', {
                style: { fontWeight: 600, color: doctorResult.healthy ? '#1e9e54' : '#d98b0f' },
                children: [doctorResult.healthy ? t('doctorPass') : t('doctorWarn'), ` (scanned: ${doctorResult.scanned ?? 0})`],
              }),
              jsx('button', { style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--dsw-alias-label-secondary, #888)' }, onClick: () => setDoctorResult(null), children: '✕' }),
            ],
          }),
          doctorResult.healedJunctions?.length ? jsx('p', { style: { margin: '6px 0 0', color: 'var(--dsw-alias-label-primary, #ddd)' }, children: `🔧 ${doctorResult.healedJunctions.length} junctions healed: ${doctorResult.healedJunctions.join(', ')}` }) : null,
          doctorResult.missingDeps?.length ? jsx('p', { style: { margin: '6px 0 0', color: '#e74c3c' }, children: `⚠️ Missing modules: ${doctorResult.missingDeps.join(', ')}` }) : null,
        ].filter(Boolean),
      }) : null,
      hasItems ? jsxs('div', {
        style: { display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 8px', flexWrap: 'wrap' },
        children: [
          jsx('input', {
            style: C.searchInput,
            placeholder: t('searchPlaceholder'),
            value: searchQuery,
            onChange: (e: any) => setSearchQuery(e.target.value),
          }),
          jsxs('div', {
            style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
            children: [
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'all' ? C.tabBtnActive : {}) },
                onClick: () => setTab('all'),
                children: `${t('tabAll')} (${state.npm.length + state.linked.length})`,
              }),
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'outdated' ? C.tabBtnActive : {}) },
                onClick: () => setTab('outdated'),
                children: `${t('tabOutdated')} (${outdatedNpm.length + linkUpdatableCount})`,
              }),
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'npm' ? C.tabBtnActive : {}) },
                onClick: () => setTab('npm'),
                children: `${t('tabNpm')} (${state.npm.length})`,
              }),
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'link' ? C.tabBtnActive : {}) },
                onClick: () => setTab('link'),
                children: `${t('tabLink')} (${state.linked.length})`,
              }),
              totalIgnoredCount > 0
                ? jsx('button', {
                    style: { ...C.tabBtn, ...(tab === 'ignored' ? C.tabBtnActive : {}) },
                    onClick: () => setTab('ignored'),
                    children: `${t('tabIgnored')} (${totalIgnoredCount})`,
                  })
                : null,
            ].filter(Boolean),
          }),
        ],
      }) : null,
      state.errors.length
        ? jsx('div', { style: { ...C.msg, ...C.msgErr }, children: `⚠️ ${state.errors.join('；')}` }, 'err')
        : null,
      filteredNpm.length
        ? jsxs('div', {
            children: [
              jsx('div', { style: C.section, children: `${t('npmSection')} (${filteredNpm.length})` }),
              jsx('ul', { style: C.grid, children: npmItems }),
            ],
          })
        : null,
      filteredLinked.length
        ? jsxs('div', {
            children: [
              jsx('div', { style: C.section, children: `${t('linkSection')} (${filteredLinked.length})` }),
              jsx('ul', { style: C.grid, children: linkItems }),
            ],
          })
        : null,
      hasItems && !hasFilteredItems
        ? jsx('p', { style: { ...C.stats, margin: '20px 0', textAlign: 'center' }, children: t('noMatch') }, 'no-match')
        : null,
      !hasItems && !state.errors.length
        ? jsx('p', { style: C.stats, children: t('emptyList') }, 'empty')
        : null,
      msg ? jsx('div', { style: { ...C.msg, ...(msgErr ? C.msgErr : {}) }, children: msg }) : null,
      // 3.9: 更新历史（折叠）
      jsxs('div', {
        style: { marginTop: 12 },
        children: [
          jsx('button', {
            style: { ...C.btnGhost, padding: '5px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 8 },
            onClick: () => setShowHistory((v) => !v),
            children: showHistory ? t('hideHistory') : `${t('historyTitle')}（${history.length}）`,
          }),
          showHistory && history.length
            ? jsx('ul', {
                style: { ...C.list, marginTop: 8, fontSize: 12, maxHeight: 180, overflow: 'auto', background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.04))', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', borderRadius: 8, padding: '6px 8px' },
                children: history.slice(0, 30).map((h: any) =>
                  jsxs('li', {
                    style: { padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: h.ok ? 'var(--dsw-alias-label-primary, inherit)' : '#e74c3c' },
                    children: [
                      jsxs('div', {
                        children: [
                          jsx('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' }, children: `${h.at ? new Date(h.at).toLocaleString() : ''} ` }),
                          jsx('span', { style: { fontWeight: 600 }, children: h.name }),
                          jsx('span', { style: { color: 'var(--dsw-alias-label-secondary, #888)' }, children: h.from && h.to ? ` ${h.from} → ${h.to}` : '' }),
                          jsx('span', { children: h.ok ? ' ✅' : ' ❌' }),
                        ],
                      }),
                      h.ok && h.from && h.from !== 'rollback' && h.from !== h.to
                        ? jsx('button', {
                            style: { background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', color: 'var(--dsw-alias-state-business-primary, #2563eb)', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '1px 6px' },
                            title: `${t('rollbackTo')} ${h.from}`,
                            onClick: () => runRollback(h.name, h.from, h.kind),
                            children: `↩ ${h.from}`,
                          }, 'rb-' + h.name)
                        : null,
                    ].filter(Boolean),
                  }, 'hist-' + (h.at ?? '') + h.name),
                ),
              }, 'history')
            : null,
          !history.length && showHistory
            ? jsx('p', { style: { ...C.stats, marginTop: 6 }, children: t('noHistory') }, 'hist-empty')
            : null,
        ],
      }),
      jsx('p', {
        style: C.note,
        children: t('footerNote'),
      }),
      // 3.8: toast 容器（顶部水平居中悬浮，避让右上角关闭按钮与打开配置文件按钮）
      toasts.length
        ? jsx('div', {
            style: {
              position: 'fixed',
              top: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10000,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              maxWidth: 420,
              pointerEvents: 'none',
            },
            children: toasts.map((t) =>
              jsx('div', {
                style: {
                  padding: '9px 20px',
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 500,
                  whiteSpace: 'pre-wrap',
                  textAlign: 'center',
                  background: t.kind === 'ok' ? 'rgba(30, 158, 84, 0.95)' : 'rgba(220, 50, 50, 0.95)',
                  color: '#fff',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                  backdropFilter: 'blur(8px)',
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  animation: 'dshpu-toast-in 0.22s ease-out',
                },
                onClick: () => setToasts((prev) => prev.filter((item) => item.id !== t.id)),
                children: t.text,
              }, 'toast-' + t.id),
            ),
          }, 'toasts')
        : null,
    ],
  })
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en: dicts.en, zh: dicts.zh }), 'dsh-plugin-updater: locale')
  const t = ctx.locale.bind(NS)
  const injected = () => ({ t })

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-plugin-updater-section',
      order: 60,
      label: () => t('nav'),
      locale: NS,
      inject: injected,
    }, PluginUpdaterSection),
  )

  // 3.2：站内通知铃铛（纯 DOM 独立挂载，参考 whale-girl 模式）
  ctx.effect(() => mountBell(t), 'dsh-plugin-updater: notification bell')
}

/** 站内通知铃铛：智能按需浮现 + 清空 + 位置避让 + 点击跳转设置。 */
function mountBell(t: (key: string) => string): () => void {
  const root = document.getElementById('dshpu-bell-root')
  if (root) return () => {} // 已挂载

  const container = document.createElement('div')
  container.id = 'dshpu-bell-root'
  // 底部抬高到 76px 避让右下角任务栏，默认 display: none (无未读时完全隐形)
  container.style.cssText = 'position:fixed;right:20px;bottom:76px;z-index:9999;font-family:inherit;display:none;transition:opacity .2s;'

  const bell = document.createElement('button')
  bell.style.cssText = 'position:relative;width:40px;height:40px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-module-platform, #111));color:var(--dsw-alias-label-primary, #ddd);cursor:pointer;font-size:17px;box-shadow:0 3px 12px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;outline:none;'
  bell.textContent = '🔔'
  bell.title = t('notifTitle')

  const badge = document.createElement('span')
  badge.style.cssText = 'position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;border-radius:8px;background:#e74c3c;color:#fff;font-size:10px;font-weight:bold;line-height:16px;text-align:center;padding:0 4px;display:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#111);'

  const panel = document.createElement('div')
  panel.style.cssText = 'display:none;position:absolute;bottom:48px;right:0;width:310px;max-height:380px;overflow:hidden;background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-module-platform, #151515));border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary, #ddd);font-size:12.5px;flex-direction:column;'

  const panelHeader = document.createElement('div')
  panelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));font-weight:600;color:var(--dsw-alias-label-primary, #ddd);background:var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.03));'

  const titleSpan = document.createElement('span')
  titleSpan.textContent = t('notifTitle')

  const actionsGroup = document.createElement('div')
  actionsGroup.style.cssText = 'display:flex;gap:6px;align-items:center;'

  const readAll = document.createElement('button')
  readAll.style.cssText = 'background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));color:var(--dsw-alias-label-secondary, #ccc);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;'
  readAll.textContent = t('notifMarkAllRead')
  readAll.title = t('notifMarkAllRead')

  const clearAll = document.createElement('button')
  clearAll.style.cssText = 'background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));color:var(--dsw-alias-label-secondary, #ccc);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;'
  clearAll.textContent = t('notifClearAll')
  clearAll.title = t('notifClearAll')

  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'background:transparent;border:none;color:var(--dsw-alias-label-tertiary, #888);font-size:13px;cursor:pointer;padding:0 2px;line-height:1;'
  closeBtn.textContent = '✕'
  closeBtn.title = '✕'

  actionsGroup.appendChild(readAll)
  actionsGroup.appendChild(clearAll)
  actionsGroup.appendChild(closeBtn)
  panelHeader.appendChild(titleSpan)
  panelHeader.appendChild(actionsGroup)

  const list = document.createElement('div')
  list.style.cssText = 'padding:4px 0;max-height:300px;overflow-y:auto;'

  panel.appendChild(panelHeader)
  panel.appendChild(list)
  container.appendChild(bell)
  bell.appendChild(badge)
  container.appendChild(panel)
  document.body.appendChild(container)

  const openSettings = () => {
    const navCells = Array.from(document.querySelectorAll<HTMLElement>('button[class*="navCell"], div[class*="navCell"]'))
    const targetCell = navCells.find((c) => c.textContent?.includes('插件更新') || c.textContent?.includes('Plugin Updates'))
    if (targetCell) {
      targetCell.click()
      return
    }
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'))
    const settingsBtn = buttons.find((b) =>
      b.getAttribute('aria-label')?.includes('设置') ||
      b.getAttribute('aria-label')?.includes('Settings') ||
      b.title?.includes('设置') ||
      b.title?.includes('Settings') ||
      b.textContent?.includes('设置') ||
      b.textContent?.includes('Settings') ||
      (b.className.includes('trigger') && b.querySelector('svg')),
    )
    if (settingsBtn) {
      settingsBtn.click()
      setTimeout(() => {
        const cells = Array.from(document.querySelectorAll<HTMLElement>('button[class*="navCell"], div[class*="navCell"]'))
        const cell = cells.find((c) => c.textContent?.includes('插件更新') || c.textContent?.includes('Plugin Updates'))
        if (cell) cell.click()
      }, 120)
    }
  }

  const empty = () => {
    list.innerHTML = ''
    const e = document.createElement('div')
    e.style.cssText = 'padding:20px 10px;color:var(--dsw-alias-label-secondary, #888);text-align:center;font-size:12px;'
    e.textContent = t('notifEmpty')
    list.appendChild(e)
  }

  const refresh = () => {
    fetch('/@dsh-external/dsh-plugin-updater/api/state', { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json())
      .then((d: any) => {
        const state = d?.value
        if (!state) return
        const unread = state.unread ?? 0
        const notifs = Array.isArray(state.notifications) ? state.notifications : []

        if (unread > 0) {
          container.style.display = 'block'
          badge.style.display = 'block'
          badge.textContent = String(unread > 99 ? '99+' : unread)
        } else {
          badge.style.display = 'none'
          if (panel.style.display !== 'flex') {
            container.style.display = 'none'
          }
        }

        if (!notifs.length) {
          empty()
          return
        }

        list.innerHTML = ''
        for (const n of notifs.slice(0, 20)) {
          const row = document.createElement('div')
          row.style.cssText = `padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.12));cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:background .15s;${n.read ? 'opacity: 0.6;' : ''}`
          row.onmouseenter = () => { row.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))' }
          row.onmouseleave = () => { row.style.background = 'transparent' }

          const content = document.createElement('div')
          content.style.cssText = 'flex: 1; min-width: 0;'

          const tEl = document.createElement('div')
          tEl.style.cssText = 'font-weight:600;color:var(--dsw-alias-label-primary,#ddd);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
          tEl.textContent = n.title
          content.appendChild(tEl)

          if (n.body) {
            const b = document.createElement('div')
            b.style.cssText = 'color:var(--dsw-alias-label-secondary,#888);font-size:11.5px;margin-top:2px;'
            b.textContent = n.body
            content.appendChild(b)
          }

          const arrow = document.createElement('span')
          arrow.style.cssText = 'color:var(--dsw-alias-state-business-primary,#2563eb);font-size:12px;margin-left:8px;white-space:nowrap;'
          arrow.textContent = '›'

          row.appendChild(content)
          row.appendChild(arrow)

          row.addEventListener('click', () => {
            panel.style.display = 'none'
            if (badge.style.display === 'none') container.style.display = 'none'
            openSettings()
          })

          list.appendChild(row)
        }
      })
      .catch(() => {})
  }

  readAll.addEventListener('click', (e) => {
    e.stopPropagation()
    fetch('/@dsh-external/dsh-plugin-updater/api/notifications/read', { method: 'POST', headers: { 'content-type': 'application/json' } })
      .then(() => refresh())
      .catch(() => {})
  })

  clearAll.addEventListener('click', (e) => {
    e.stopPropagation()
    fetch('/@dsh-external/dsh-plugin-updater/api/notifications/clear', { method: 'POST', headers: { 'content-type': 'application/json' } })
      .then(() => {
        panel.style.display = 'none'
        container.style.display = 'none'
        refresh()
      })
      .catch(() => {})
  })

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    panel.style.display = 'none'
    if (badge.style.display === 'none') container.style.display = 'none'
  })

  bell.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = panel.style.display === 'flex'
    panel.style.display = open ? 'none' : 'flex'
    if (!open) refresh()
  })

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target as Node)) {
      if (panel.style.display === 'flex') {
        panel.style.display = 'none'
        if (badge.style.display === 'none') container.style.display = 'none'
      }
    }
  })

  refresh()
  const interval = window.setInterval(refresh, 60_000)

  return () => {
    window.clearInterval(interval)
    container.remove()
  }
}
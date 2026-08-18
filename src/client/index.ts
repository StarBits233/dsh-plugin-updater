/**
 * @dsh-external/dsh-plugin-updater — client 侧（React section）
 *
 * 在「设置 → 插件更新」section 提供：
 *   - 进入页面自动检查（命中 10 分钟缓存则即时返回）+ 「重新检查」按钮（?force=1 强制刷新）
 *   - 全部 npm 插件列表（current → latest，有更新时高亮 + 单独「更新」按钮）
 *   - link 本地插件列表（灰色标注，手动更新，无 npm 版本）
 *   - 「全部更新」按钮（逐个调用 host /update）
 *
 * 挂点契约：ctx.slots.register(spec, ReactComponent) —— 组件必须是 React 函数组件，
 *           作为 register 的第二个参数传入（与官方 skin-center / settings 系列一致）。
 */
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'

type ClientContext = {
  slots: any
  effect: any
}

export const inject = ['slots']

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
  name: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #ddd)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  linkName: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-state-business-primary, #2563eb)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'none' },
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
  description?: string
  homepage?: string
  gitBehind?: boolean
  gitBranch?: string
  /** 3.5：package.json repository 推导的 GitHub owner/repo */
  ghRepo?: string | null
  /** 3.5：GitHub 是否有新版本 */
  ghLatest?: string | null
  /** 3.5：对应 GitHub tag */
  ghTag?: string | null
}

interface UpdaterState {
  npm: NpmItem[]
  linked: LinkItem[]
  errors: string[]
  checkedAt?: string
  cached?: boolean
}

function PluginUpdaterSection(_props: { close?: () => void }): any {
  const [state, setState] = useState<UpdaterState>({ npm: [], linked: [], errors: [] })
  const [msg, setMsg] = useState('')
  const [msgErr, setMsgErr] = useState(false)
  const [checking, setChecking] = useState(true)
  const [updating, setUpdating] = useState<string[]>([]) // 正在更新的包名集合
  const [busy, setBusy] = useState(false) // 全部更新进行中
  const [main, setMain] = useState<any>(null) // 主程序状态（3.6）
  // 3.8: toast
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ok' | 'err' }[]>([])
  const toastSeq = useRef(0)

  const showToast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { id, text, kind }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  // 3.9: 忽略列表 + 更新历史（从 /state 读）
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
        setMsg('检查失败: ' + e)
        setMsgErr(true)
      })
      .finally(() => setChecking(false))
    // 3.6：顺带拉主程序状态
    fetch(API + '/state', { headers: { 'content-type': 'application/json' } })
      .then((r) => r.json())
      .then((d: any) => { if (d?.ok) setMain(d.value?.main ?? null) })
      .catch(() => {})
  }, [])

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
        showToast(ignoring ? `已忽略 ${name} 的更新` : `已取消忽略 ${name}`, 'ok')
        refresh(true)
      })
      .catch((e: any) => showToast('忽略操作失败: ' + e, 'err'))
  }, [ignoredNames, refresh, showToast])

  useEffect(() => {
    refresh(false)
  }, [refresh])

  const runUpdate = (pkgs: { name: string; latest: string }[], label: string) => {
    if (!pkgs.length || busy) return
    setBusy(true)
    const names = pkgs.map((p) => p.name)
    setUpdating(names)
    setMsg(`${label} ${pkgs.length} 个插件（每个可能耗时数十秒）…`)
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
        setMsg(`更新完成：${okCount} 成功 / ${failCount} 失败\n\n${lines.join('\n')}\n\n⚠️ 请重启 DSH（托盘 → 重启服务）使新版本生效！`)
        setMsgErr(failCount > 0)
        // 3.8: toast
        showToast(failCount > 0
          ? `更新完成：${okCount} 成功 / ${failCount} 失败`
          : `已更新 ${okCount} 个插件（热重启已执行${results.some((r: any) => r.output?.includes('热重启')) ? '，免手动重启' : '，请重启 DSH'}）`,
          failCount > 0 ? 'err' : 'ok')
        setTimeout(() => refresh(true), 1500)
      })
      .catch((e: any) => {
        setMsg('更新请求失败: ' + e)
        setMsgErr(true)
        showToast('更新请求失败: ' + e, 'err')
      })
      .finally(() => {
        setBusy(false)
        setUpdating([])
      })
  }

  const outdatedNpm = state.npm.filter((n) => n.outdated)
  const linkUpdatableCount = state.linked.filter((l) => l.gitBehind || (!!l.ghLatest && !l.homepage)).length
  const updatingOne = (name: string) => updating.includes(name)

  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'outdated' | 'npm' | 'link'>('all')

  const query = searchQuery.trim().toLowerCase()
  const matchQuery = (item: { name: string; description?: string }) => {
    if (!query) return true
    return item.name.toLowerCase().includes(query) || (item.description ? item.description.toLowerCase().includes(query) : false)
  }

  const filteredNpm = state.npm.filter((n) => {
    if (tab === 'link') return false
    if (tab === 'outdated' && !n.outdated) return false
    return matchQuery(n)
  })

  const filteredLinked = state.linked.filter((l) => {
    if (tab === 'npm') return false
    const isUpdatable = l.gitBehind || (!!l.ghLatest && !l.homepage)
    if (tab === 'outdated' && !isUpdatable) return false
    return matchQuery(l)
  })

  // npm 插件列表（卡片）
  const npmItems: any[] = filteredNpm.map((n) => {
    const isUpdating = updatingOne(n.name)
    const style: any = { ...C.item, ...(isUpdating ? C.itemUpdating : {}) }
    const nameNode = n.homepage
      ? jsx('a', {
          className: 'dshpu-link',
          style: C.linkName,
          href: n.homepage,
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (e: any) => e.stopPropagation(),
          title: '打开 ' + n.homepage,
          children: n.name,
        })
      : jsx('span', { style: C.name, children: n.name })
    // 状态区：错误/获取失败/版本+按钮
    let statusNode: any
    if (n.error) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stErr }, children: n.error }, 'err')
    } else if (n.latest === null) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stErr }, children: '获取失败' }, 'err')
    } else {
      const verNode: any[] = [
        jsx('span', { style: C.ver, children: n.current ?? '?' }),
      ]
      if (n.outdated) {
        verNode.push(jsx('span', { style: C.arrow, children: '→' }, 'arr'))
        verNode.push(jsx('span', { style: { ...C.ver, color: '#d98b0f' }, children: n.latest }, 'latest'))
        verNode.push(jsx('button', {
          style: { ...C.updateBtn, ...(isUpdating || busy ? C.btnDisabled : {}) },
          disabled: isUpdating || busy,
          onClick: (e: any) => {
            e.stopPropagation()
            if (n.latest) runUpdate([{ name: n.name, latest: n.latest }], '更新')
          },
          children: isUpdating ? jsx('span', { style: C.spinner }) : '更新',
        }, 'btn'))
      } else {
        verNode.push(jsx('span', { style: { ...C.st, ...C.stOk }, children: '最新' }, 'ok'))
      }
      statusNode = jsxs('span', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: verNode })
    }
    const ignoreBtn = jsx('button', {
      style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #888))', fontSize: 11.5, cursor: 'pointer', padding: 2, whiteSpace: 'nowrap' },
      title: ignoredNames.has(n.name) ? '取消忽略' : '忽略此插件更新',
      onClick: (e: any) => {
        e.stopPropagation()
        toggleIgnore(n.name)
      },
      children: ignoredNames.has(n.name) ? '已忽略↩' : '忽略',
    }, 'ignore-' + n.name)

    const header = jsxs('div', { style: C.itemHeader, children: [nameNode, statusNode, ignoreBtn] })
    const desc = n.description ? jsx('div', { style: C.desc, title: n.description, children: n.description }) : null
    return jsxs('li', { style, children: [header, desc].filter(Boolean) }, 'npm-' + n.name)
  })

  // link 插件列表
  const linkItems: any[] = filteredLinked.map((l) => {
    const isUpdating = updatingOne(l.name)
    const nameNode = l.homepage
      ? jsx('a', {
          className: 'dshpu-link',
          style: C.linkName,
          href: l.homepage,
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (e: any) => e.stopPropagation(),
          title: '打开 ' + l.homepage,
          children: l.name,
        })
      : jsx('span', { style: C.name, children: l.name })
    // 状态区：无 git/GH → 本地目录；有 git → gitBehind 显示；无 git 有 GH → ghLatest 显示
    let statusNode: any
    let buttonNode: any = null
    const ghRepo = l.ghRepo
    const isGhUpdatable = !l.homepage && !!ghRepo && !!l.ghLatest
    const isUpdatingNode = isUpdating && buttonNode
    if (!l.homepage && !ghRepo) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stLink }, children: '本地目录（无远程）' }, 'local')
    } else if (isGhUpdatable) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stOut }, children: `可更新（GitHub ${l.ghTag ?? l.ghLatest}）` }, 'ghbehind')
      buttonNode = jsx('button', {
        style: { ...C.updateBtn, ...((isUpdating || busy) ? C.btnDisabled : {}) },
        disabled: isUpdating || busy,
        onClick: (e: any) => {
          e.stopPropagation()
          runUpdate([{ name: l.name, latest: l.ghLatest! }], `更新 ${l.name}`)
        },
        children: isUpdating ? jsx('span', { style: C.spinner }) : 'git 更新',
      } as any, 'ghbtn')
    } else if (l.homepage) {
      statusNode = l.gitBehind
        ? jsx('span', { style: { ...C.st, ...C.stOut }, children: `可更新（${l.gitBranch ?? 'git'}）` }, 'behind')
        : jsx('span', { style: { ...C.st, ...C.stOk }, children: '已是最新' }, 'ok')
      buttonNode = jsx('button', {
        style: { ...C.updateBtn, ...((isUpdating || busy || !l.gitBehind) ? C.btnDisabled : {}) },
        disabled: isUpdating || busy || !l.gitBehind,
        onClick: (e: any) => {
          e.stopPropagation()
          runUpdate([{ name: l.name, latest: '' }], `更新 ${l.name}`)
        },
        children: isUpdating ? jsx('span', { style: C.spinner }) : 'git 更新',
      } as any, 'gitbtn')
    } else {
      statusNode = jsx('span', { style: { ...C.st, ...C.stLink }, children: '本地目录' }, 'local2')
    }

    const header = jsxs('div', {
      style: C.itemHeader,
      children: [
        nameNode, statusNode, buttonNode,
        jsx('button', {
          style: { background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #888))', fontSize: 11.5, cursor: 'pointer', padding: 2, whiteSpace: 'nowrap' },
          title: ignoredNames.has(l.name) ? '取消忽略' : '忽略此插件更新',
          onClick: (e: any) => {
            e.stopPropagation()
            toggleIgnore(l.name)
          },
          children: ignoredNames.has(l.name) ? '已忽略↩' : '忽略',
        }, 'ignore-link-' + l.name),
      ],
    })
    const desc = l.description ? jsx('div', { style: C.desc, title: l.description, children: l.description }) : null
    return jsxs('li', {
      style: { ...C.item, ...(isUpdatingNode ? C.itemUpdating : {}) },
      children: [header, desc].filter(Boolean),
    }, 'link-' + l.name)
  })

  const stats = `检查时间: ${new Date(state.checkedAt ?? Date.now()).toLocaleString()}${state.cached ? '（缓存）' : ''} · ${state.npm.length} 个 npm 插件 · ${outdatedNpm.length} 可更新 · ${state.linked.length} 个 link（${linkUpdatableCount} 可更新）`

  // 主程序状态条（3.6）
  const mainNode = (() => {
    if (!main) return null
    const updateable = !!main.updateable
    const outdated = !!main.outdated
    const label = outdated
      ? updateable
        ? `主程序可更新（${main.current} → ${main.latest}）`
        : `主程序可更新（${main.current} → ${main.latest}，需在配置启用）`
      : `主程序已是最新（${main.current ?? '?'}）`
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
            if (!window.confirm('确定更新 DSH 主程序？更新后需重启 DSH。')) return
            fetch(API + '/update-main', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
              .then((r) => r.json())
              .then((d: any) => {
                setMsg(d?.value?.output ?? JSON.stringify(d ?? {}))
                setMsgErr(!(d?.ok ?? d?.value?.ok))
                setTimeout(() => refresh(true), 1500)
              })
              .catch((err: any) => { setMsg('更新主程序失败: ' + err, ); setMsgErr(true) })
          },
          children: '更新主程序',
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
      jsx('style', { children: '@keyframes dshpu-spin{to{transform:rotate(360deg)}} .dshpu-link:hover{text-decoration:underline !important;}' }),
      jsx('h3', { style: C.h3, children: '插件更新检查（dsh-plugin-updater）' }),
      jsx('p', { style: C.stats, children: stats }),
      mainNode,
      jsxs('div', {
        style: C.row,
        children: [
          jsx('button', {
            style: { ...C.btn, ...C.btnGhost, ...(checking || busy ? C.btnDisabled : {}) },
            disabled: checking || busy,
            onClick: () => refresh(true),
            children: checking ? '检查中…' : '重新检查',
          }),
          jsx('button', {
            style: { ...C.btn, ...(outdatedNpm.length === 0 || busy ? C.btnDisabled : {}) },
            disabled: outdatedNpm.length === 0 || busy,
            onClick: () => runUpdate(outdatedNpm.map((o) => ({ name: o.name, latest: o.latest! })), '全部'),
            children: busy ? '更新中…' : `全部更新（${outdatedNpm.length}）`,
          }),
        ],
      }),
      hasItems ? jsxs('div', {
        style: { display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 8px', flexWrap: 'wrap' },
        children: [
          jsx('input', {
            style: C.searchInput,
            placeholder: '搜索插件名称或功能简介...',
            value: searchQuery,
            onChange: (e: any) => setSearchQuery(e.target.value),
          }),
          jsxs('div', {
            style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
            children: [
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'all' ? C.tabBtnActive : {}) },
                onClick: () => setTab('all'),
                children: `全部 (${state.npm.length + state.linked.length})`,
              }),
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'outdated' ? C.tabBtnActive : {}) },
                onClick: () => setTab('outdated'),
                children: `可更新 (${outdatedNpm.length + linkUpdatableCount})`,
              }),
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'npm' ? C.tabBtnActive : {}) },
                onClick: () => setTab('npm'),
                children: `NPM (${state.npm.length})`,
              }),
              jsx('button', {
                style: { ...C.tabBtn, ...(tab === 'link' ? C.tabBtnActive : {}) },
                onClick: () => setTab('link'),
                children: `Link (${state.linked.length})`,
              }),
            ],
          }),
        ],
      }) : null,
      state.errors.length
        ? jsx('div', { style: { ...C.msg, ...C.msgErr }, children: `⚠️ ${state.errors.join('；')}` }, 'err')
        : null,
      filteredNpm.length
        ? jsxs('div', {
            children: [
              jsx('div', { style: C.section, children: `npm 插件 (${filteredNpm.length})` }),
              jsx('ul', { style: C.grid, children: npmItems }),
            ],
          })
        : null,
      filteredLinked.length
        ? jsxs('div', {
            children: [
              jsx('div', { style: C.section, children: `本地安装（link） (${filteredLinked.length})` }),
              jsx('ul', { style: C.grid, children: linkItems }),
            ],
          })
        : null,
      hasItems && !hasFilteredItems
        ? jsx('p', { style: { ...C.stats, margin: '20px 0', textAlign: 'center' }, children: '未找到符合条件的插件' }, 'no-match')
        : null,
      !hasItems && !state.errors.length
        ? jsx('p', { style: C.stats, children: '暂无插件信息' }, 'empty')
        : null,
      msg ? jsx('div', { style: { ...C.msg, ...(msgErr ? C.msgErr : {}) }, children: msg }) : null,
      // 3.9: 更新历史（折叠）
      jsxs('div', {
        style: { marginTop: 12 },
        children: [
          jsx('button', {
            style: { ...C.btnGhost, padding: '5px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 8 },
            onClick: () => setShowHistory((v) => !v),
            children: showHistory ? '收起更新历史' : `更新历史（${history.length}）`,
          }),
          showHistory && history.length
            ? jsx('ul', {
                style: { ...C.list, marginTop: 8, fontSize: 12, maxHeight: 180, overflow: 'auto', background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.04))', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', borderRadius: 8, padding: '6px 8px' },
                children: history.slice(0, 30).map((h: any) =>
                  jsxs('li', {
                    style: { padding: '4px 6px', color: h.ok ? 'var(--dsw-alias-label-primary, inherit)' : '#e74c3c' },
                    children: [
                      jsx('span', { style: { color: 'var(--dsw-alias-label-tertiary, #999)' }, children: `${h.at ? new Date(h.at).toLocaleString() : ''} ` }),
                      jsx('span', { style: { fontWeight: 600 }, children: h.name }),
                      jsx('span', { style: { color: 'var(--dsw-alias-label-secondary, #888)' }, children: h.from && h.to ? ` ${h.from} → ${h.to}` : '' }),
                      jsx('span', { children: h.ok ? ' ✅' : ' ❌' }),
                    ],
                  }, 'hist-' + (h.at ?? '') + h.name),
                ),
              }, 'history')
            : null,
          !history.length && showHistory
            ? jsx('p', { style: { ...C.stats, marginTop: 6 }, children: '（暂无更新记录）' }, 'hist-empty')
            : null,
        ],
      }),
      jsx('p', {
        style: C.note,
        children: '说明：点插件名可打开官网/仓库；npm 插件可单独或全部更新；link 插件若为 git 仓库用「git 更新」同步，非 git 请手动更新。结果缓存 10 分钟，「重新检查」强制刷新。更新后需重启 DSH 生效。',
      }),
      // 3.8: toast 容器
      toasts.length
        ? jsx('div', {
            style: { position: 'fixed', top: 16, right: 16, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 },
            children: toasts.map((t) =>
              jsx('div', {
                style: {
                  padding: '10px 14px', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap',
                  background: t.kind === 'ok' ? 'rgba(46,204,113,.95)' : 'rgba(220,50,50,.95)',
                  color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,.3)',
                },
                children: t.text,
              }, 'toast-' + t.id),
            ),
          }, 'toasts')
        : null,
    ],
  })
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-plugin-updater-section',
      order: 60,
      label: () => '插件更新',
    }, PluginUpdaterSection),
  ), 'dsh-plugin-updater: settings section')

  // 3.2：站内通知铃铛（纯 DOM 独立挂载，参考 whale-girl 模式）
  ctx.effect(() => mountBell(), 'dsh-plugin-updater: notification bell')
}

/** 站内通知铃铛：智能按需浮现 + 清空 + 位置避让 + 点击跳转设置。 */
function mountBell(): () => void {
  const root = document.getElementById('dshpu-bell-root')
  if (root) return () => {} // 已挂载

  const container = document.createElement('div')
  container.id = 'dshpu-bell-root'
  // 底部抬高到 76px 避让右下角任务栏，默认 display: none (无未读时完全隐形)
  container.style.cssText = 'position:fixed;right:20px;bottom:76px;z-index:9999;font-family:inherit;display:none;transition:opacity .2s;'

  const bell = document.createElement('button')
  bell.style.cssText = 'position:relative;width:40px;height:40px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-module-platform, #111));color:var(--dsw-alias-label-primary, #ddd);cursor:pointer;font-size:17px;box-shadow:0 3px 12px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;outline:none;'
  bell.textContent = '🔔'
  bell.title = '插件更新通知（点击查看）'

  const badge = document.createElement('span')
  badge.style.cssText = 'position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;border-radius:8px;background:#e74c3c;color:#fff;font-size:10px;font-weight:bold;line-height:16px;text-align:center;padding:0 4px;display:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#111);'

  const panel = document.createElement('div')
  panel.style.cssText = 'display:none;position:absolute;bottom:48px;right:0;width:310px;max-height:380px;overflow:hidden;background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-module-platform, #151515));border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary, #ddd);font-size:12.5px;flex-direction:column;'

  const panelHeader = document.createElement('div')
  panelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));font-weight:600;color:var(--dsw-alias-label-primary, #ddd);background:var(--dsw-alias-bg-module-platform, rgba(128,128,128,0.03));'

  const titleSpan = document.createElement('span')
  titleSpan.textContent = '更新通知'

  const actionsGroup = document.createElement('div')
  actionsGroup.style.cssText = 'display:flex;gap:6px;align-items:center;'

  const readAll = document.createElement('button')
  readAll.style.cssText = 'background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));color:var(--dsw-alias-label-secondary, #ccc);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;'
  readAll.textContent = '已读'
  readAll.title = '标记所有通知为已读'

  const clearAll = document.createElement('button')
  clearAll.style.cssText = 'background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));color:var(--dsw-alias-label-secondary, #ccc);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;'
  clearAll.textContent = '清空'
  clearAll.title = '清空所有通知并隐藏'

  const closeBtn = document.createElement('button')
  closeBtn.style.cssText = 'background:transparent;border:none;color:var(--dsw-alias-label-tertiary, #888);font-size:13px;cursor:pointer;padding:0 2px;line-height:1;'
  closeBtn.textContent = '✕'
  closeBtn.title = '关闭弹窗'

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
    // 尝试打开 DSH 设置并在面板中切换到「插件更新」
    const navCells = Array.from(document.querySelectorAll<HTMLElement>('button[class*="navCell"], div[class*="navCell"]'))
    const targetCell = navCells.find((c) => c.textContent?.includes('插件更新'))
    if (targetCell) {
      targetCell.click()
      return
    }
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'))
    const settingsBtn = buttons.find((b) =>
      b.getAttribute('aria-label')?.includes('设置') ||
      b.title?.includes('设置') ||
      b.textContent?.includes('设置') ||
      (b.className.includes('trigger') && b.querySelector('svg')),
    )
    if (settingsBtn) {
      settingsBtn.click()
      setTimeout(() => {
        const cells = Array.from(document.querySelectorAll<HTMLElement>('button[class*="navCell"], div[class*="navCell"]'))
        const cell = cells.find((c) => c.textContent?.includes('插件更新'))
        if (cell) cell.click()
      }, 120)
    }
  }

  const empty = () => {
    list.innerHTML = ''
    const e = document.createElement('div')
    e.style.cssText = 'padding:20px 10px;color:var(--dsw-alias-label-secondary, #888);text-align:center;font-size:12px;'
    e.textContent = '暂无未处理的更新通知'
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

        // 核心优化：未读 > 0 时才主动浮现，否则若弹窗未开启则自动隐藏
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

          const t = document.createElement('div')
          t.style.cssText = 'font-weight:600;color:var(--dsw-alias-label-primary,#ddd);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
          t.textContent = n.title
          content.appendChild(t)

          if (n.body) {
            const b = document.createElement('div')
            b.style.cssText = 'color:var(--dsw-alias-label-secondary,#888);font-size:11.5px;margin-top:2px;'
            b.textContent = n.body
            content.appendChild(b)
          }

          const arrow = document.createElement('span')
          arrow.style.cssText = 'color:var(--dsw-alias-state-business-primary,#2563eb);font-size:12px;margin-left:8px;white-space:nowrap;'
          arrow.textContent = '去更新 ›'

          row.appendChild(content)
          row.appendChild(arrow)

          // 点击通知行直接打开设置页
          row.addEventListener('click', () => {
            panel.style.display = 'none'
            if (badge.style.display === 'none') container.style.display = 'none'
            openSettings()
          })

          list.appendChild(row)
        }
      })
      .catch(() => { /* 静默：宿主未就绪 */ })
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

  // 点击面板外部自动关闭
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
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
import { useCallback, useEffect, useState } from 'react'

type ClientContext = {
  slots: any
  effect: any
}

export const inject = ['slots']

const API = '/@dsh-external/dsh-plugin-updater/api'

const C: Record<string, any> = {
  page: { fontSize: 13, color: 'var(--theme-text,#ddd)', fontFamily: 'inherit' },
  h3: { margin: '0 0 8px', fontSize: 15 },
  stats: { color: 'var(--theme-text-secondary,#888)', fontSize: 11, margin: '0 0 10px' },
  row: { display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap', alignItems: 'center' },
  btn: { background: 'var(--theme-accent,#4f8cff)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
  btnGhost: { background: 'transparent', border: '1px solid var(--theme-border,#333)', color: 'var(--theme-text,#ddd)' },
  btnDanger: { background: 'transparent', border: '1px solid #d33', color: '#d33' },
  btnDisabled: { opacity: 0.5, cursor: 'default' },
  section: { margin: '14px 0 6px', fontSize: 12, color: 'var(--theme-text-secondary,#999)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--theme-border,#333)', borderRadius: 6, marginBottom: 6, background: 'var(--theme-input-bg,#111)' },
  name: { fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ver: { fontSize: 11, color: 'var(--theme-text-secondary,#888)', whiteSpace: 'nowrap' },
  arrow: { color: 'var(--theme-accent,#4f8cff)' },
  st: { fontSize: 10, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' },
  stOut: { background: 'rgba(240,180,60,.15)', color: '#f0b43c' },
  stOk: { background: 'rgba(46,204,113,.15)', color: '#2ecc71' },
  stLink: { background: 'rgba(150,150,150,.15)', color: '#999' },
  stErr: { background: 'rgba(220,50,50,.15)', color: '#e74c3c' },
  updateBtn: { background: 'var(--theme-accent,#4f8cff)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' },
  msg: { marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'var(--theme-input-bg,#111)', border: '1px solid var(--theme-border,#333)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 11 },
  msgErr: { borderColor: '#d33' },
  note: { color: 'var(--theme-text-secondary,#888)', fontSize: 11, marginTop: 8 },
}

interface NpmItem {
  name: string
  current: string | null
  latest: string | null
  outdated: boolean
  error?: string
  homepage?: string
}

interface LinkItem {
  name: string
  spec: string
  homepage?: string
  gitBehind?: boolean
  gitBranch?: string
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
  }, [])

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
        setTimeout(() => refresh(true), 1500)
      })
      .catch((e: any) => {
        setMsg('更新请求失败: ' + e)
        setMsgErr(true)
      })
      .finally(() => {
        setBusy(false)
        setUpdating([])
      })
  }

  const outdatedNpm = state.npm.filter((n) => n.outdated)
  const updatingOne = (name: string) => updating.includes(name)

  // npm 插件列表
  const npmItems: any[] = state.npm.map((n) => {
    const isUpdating = updatingOne(n.name)
    const style: any = { ...C.item }
    const nameNode = n.homepage
      ? jsx('a', {
          style: { ...C.name, color: 'var(--theme-accent,#4f8cff)', cursor: 'pointer', textDecoration: 'none' },
          href: n.homepage,
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (e: any) => e.stopPropagation(),
          title: '打开 ' + n.homepage,
          children: n.name,
        })
      : jsx('span', { style: C.name, children: n.name })
    return jsxs('li', {
      style,
      children: [
        nameNode,
        n.error ? jsx('span', { style: { ...C.st, ...C.stErr }, children: n.error }, 'err')
          : n.latest === null
            ? jsx('span', { style: { ...C.st, ...C.stErr }, children: '获取失败' }, 'err')
            : jsxs('span', {
                style: { display: 'flex', alignItems: 'center', gap: 6 },
                children: [
                  jsx('span', { style: C.ver, children: n.current ?? '?' }),
                  n.outdated ? jsx('span', { style: C.arrow, children: '→' }) : null,
                  n.outdated ? jsx('span', { style: { ...C.ver, color: '#f0b43c' }, children: n.latest }) : null,
                  n.outdated
                    ? jsx('button', {
                        style: { ...C.updateBtn, ...(isUpdating || busy ? C.btnDisabled : {}) },
                        disabled: isUpdating || busy,
                        onClick: (e: any) => {
                          e.stopPropagation()
                          if (n.latest) runUpdate([{ name: n.name, latest: n.latest }], '更新')
                        },
                        children: isUpdating ? '更新中…' : '更新',
                      }, 'btn')
                    : jsx('span', { style: { ...C.st, ...C.stOk }, children: '最新' }, 'ok'),
                ],
              }),
      ],
    }, 'npm-' + n.name)
  })

  // link 插件列表
  const linkItems: any[] = state.linked.map((l) => {
    const isUpdating = updatingOne(l.name)
    const nameNode = l.homepage
      ? jsx('a', {
          style: { ...C.name, color: 'var(--theme-accent,#4f8cff)', cursor: 'pointer', textDecoration: 'none' },
          href: l.homepage,
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (e: any) => e.stopPropagation(),
          title: '打开 ' + l.homepage,
          children: l.name,
        })
      : jsx('span', { style: C.name, children: l.name })
    // 状态区：无 git → 本地目录；有 git → 按 gitBehind 显示可更新/最新
    let statusNode: any
    let buttonNode: any = null
    if (!l.homepage) {
      statusNode = jsx('span', { style: { ...C.st, ...C.stLink }, children: '本地目录（无远程）' }, 'local')
    } else {
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
        children: isUpdating ? '更新中…' : 'git 更新',
      }, 'gitbtn')
    }
    return jsxs('li', {
      style: { ...C.item },
      children: [nameNode, statusNode, buttonNode],
    }, 'link-' + l.name)
  })

  const gitUpdatableCount = state.linked.filter((l) => l.gitBehind).length
  const stats = `检查时间: ${new Date(state.checkedAt ?? Date.now()).toLocaleString()}${state.cached ? '（缓存）' : ''} · ${state.npm.length} 个 npm 插件 · ${outdatedNpm.length} 可更新 · ${state.linked.length} 个 link（${gitUpdatableCount} 个 git 可更新）`

  return jsxs('div', {
    style: C.page,
    children: [
      jsx('h3', { style: C.h3, children: '插件更新检查（dsh-plugin-updater）' }),
      jsx('p', { style: C.stats, children: stats }),
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
      state.errors.length
        ? jsx('div', { style: { ...C.msg, ...C.msgErr }, children: `⚠️ ${state.errors.join('；')}` }, 'err')
        : null,
      state.npm.length
        ? jsxs('div', {
            children: [
              jsx('div', { style: C.section, children: 'npm 插件' }),
              jsx('ul', { style: C.list, children: npmItems }),
            ],
          })
        : null,
      state.linked.length
        ? jsxs('div', {
            children: [
              jsx('div', { style: C.section, children: '本地安装（link）' }),
              jsx('ul', { style: C.list, children: linkItems }),
            ],
          })
        : null,
      !state.npm.length && !state.linked.length && !state.errors.length
        ? jsx('p', { style: C.stats, children: '暂无插件信息' }, 'empty')
        : null,
      msg ? jsx('div', { style: { ...C.msg, ...(msgErr ? C.msgErr : {}) }, children: msg }) : null,
      jsx('p', {
        style: C.note,
        children: '说明：点插件名可打开官网/仓库；npm 插件可单独或全部更新；link 插件若为 git 仓库用「git 更新」同步，非 git 请手动更新。结果缓存 10 分钟，「重新检查」强制刷新。更新后需重启 DSH 生效。',
      }),
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
}
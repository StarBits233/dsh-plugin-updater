/**
 * @dsh-external/dsh-plugin-updater — 热重启（3.4）。
 *
 * 更新完插件后重建该插件的 Cordis fiber，免手动重启 DSH。
 * 配方来自 Alyosha28/dsh-plugin-updater 的已验证实现（弱类型访问 loader/registry 内部 API）：
 *   1. purge loader.internal.loadCache（该包路径相关缓存）
 *   2. loader.import(entryUrl) + unwrapExports 重新导入新模块
 *   3. 校验新模块有效（有 apply）
 *   4. 用 registry.plugin 重建 fiber（旧 fiber dispose）
 *   5. 失败 restoreCache() 恢复缓存 + 回滚
 *   6. clientModules.processOne(name) 补扫 client rev
 *
 * 注意：依赖 DSH loader/registry 内部形状，任何一步失败都不阻塞（返回 ok=false，调用方提示手动重启）。
 */

export type CtxGetter = () => any

/** 热重启单个插件 entry。pkgDir 为插件安装目录（含 lib/index.js）。 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function hotReloadPlugin(ctx: any, pluginName: string, pkgDir: string): Promise<{ ok: boolean; output: string }> {
  try {
    const loader = ctx.loader
    if (!loader || typeof loader.entries !== 'function') {
      return { ok: false, output: 'loader 服务不可用，跳过热重启（请手动重启 DSH）' }
    }

    // 1) purge loadCache（该包路径相关）
    const loadCache = loader.internal?.loadCache
    const pathKey = pkgDir.replace(/\\/g, '/')
    const purged: Array<[string, unknown]> = []
    if (loadCache && typeof loadCache.delete === 'function' && typeof loadCache.keys === 'function') {
      for (const u of [...loadCache.keys()]) {
        if (typeof u === 'string' && decodeURIComponent(u).includes(pathKey)) {
          purged.push([u, loadCache.get(u)])
          // 绕过用户自定义原型，用原生 Map 方法
          Map.prototype.delete.call(loadCache, u)
        }
      }
    }
    const restoreCache = () => {
      if (!loadCache || typeof loadCache.set !== 'function') return
      for (const [u, job] of purged) {
        if (job === undefined) Map.prototype.delete.call(loadCache, u)
        else Map.prototype.set.call(loadCache, u, job)
      }
    }

    // 2) 找 entry
    const entries = [...(loader.entries() as Iterable<any>)]
    const entry = entries.find((e: any) => e?.options?.name === pluginName)
    if (!entry) {
      restoreCache()
      return { ok: false, output: '未找到该插件的 loader entry，跳过热重启（重启后生效）' }
    }
    if (!entry.fiber) {
      restoreCache()
      return { ok: false, output: '该插件无活动 fiber，无需热重启（下次启动加载新文件）' }
    }

    // 3) 重新导入新模块
    const main = join(pkgDir, 'lib', 'index.js')
    let fresh: unknown
    try {
      const url = pathToFileURL(main).href
      fresh = loader.unwrapExports
        ? loader.unwrapExports(await loader.import(url, () => []))
        : await loader.import(url, () => [])
    } catch (error: any) {
      restoreCache()
      return { ok: false, output: `热重启：新模块导入失败（${String(error?.message ?? error)}），请手动重启` }
    }
    if (!fresh || (typeof fresh !== 'function' && typeof (fresh as any)?.apply !== 'function')) {
      restoreCache()
      return { ok: false, output: '热重启：新模块不是有效插件（缺 apply），请手动重启' }
    }

    // 4) 重建 fiber
    const registry = ctx.registry
    if (!registry || typeof registry.plugin !== 'function') {
      restoreCache()
      return { ok: false, output: 'registry 服务不可用，跳过热重启（请手动重启）' }
    }
    const oldPlugin = entry.fiber?.runtime?.callback ?? null
    const runtime = oldPlugin !== null ? registry.get(oldPlugin) : undefined
    const configOf = (fallback: unknown) => {
      const cfg = entry.options?.config
      if (cfg && typeof cfg === 'object' && fallback && typeof fallback === 'object') {
        return { ...(fallback as Record<string, unknown>), ...(cfg as Record<string, unknown>) }
      }
      return cfg ?? fallback
    }

    const rebuildOne = async (fiber: any) => {
      if (fiber && typeof fiber.dispose === 'function') {
        try { await fiber.dispose() } catch { /* best-effort */ }
      }
      const parent = fiber?.parent?.registry ?? registry
      const newFiber = parent.plugin(fresh, configOf(fiber?._config), () => [])
      ;(newFiber as any).entry = fiber?.entry ?? entry
      if (fiber?.entry) entry.fiber = newFiber
      if (typeof newFiber.await === 'function') await newFiber.await()
    }

    try {
      if (runtime && typeof runtime.fibers?.[Symbol.iterator] === 'function') {
        const fibers = [...(runtime.fibers as Iterable<any>)]
        if (oldPlugin) { try { registry.delete(oldPlugin) } catch { /* best-effort */ } }
        for (const f of fibers) await rebuildOne(f)
        await Promise.allSettled(fibers.map((f) => (typeof f.await === 'function' ? f.await() : Promise.resolve())))
      } else {
        await rebuildOne(entry.fiber)
      }
      // 5) 补扫 client
      try {
        const cm = ctx.get?.('clientModules')
        if (cm && typeof cm.processOne === 'function') {
          const changed = cm.processOne(pluginName)
          if (changed && typeof cm.compose === 'function' && typeof cm.notifyGraphChanged === 'function') {
            cm.compose()
            cm.notifyGraphChanged()
          }
        }
      } catch { /* client rescan best-effort */ }

      return { ok: true, output: '已热重启插件（免手动重启）' }
    } catch (error: any) {
      // 回滚：恢复缓存（新 fiber 已按新模块建，若失败则宿主下次重启兜底）
      restoreCache()
      return { ok: false, output: `热重启失败（${String(error?.message ?? error)}），请手动重启 DSH 生效` }
    }
  } catch (error: any) {
    return { ok: false, output: `热重启异常（${String(error?.message ?? error)}），请手动重启 DSH 生效` }
  }
}

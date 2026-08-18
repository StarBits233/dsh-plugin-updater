import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const base = 'D:/MyProject/Tools/DSHTools/dsh-plugin-updater/lib/'
const registry = await import(pathToFileURL(base + 'registry.js').href)
const storeMod = await import(pathToFileURL(base + 'store.js').href)
const gitMod = await import(pathToFileURL(base + 'git.js').href)

test('readRegistryUrl: 从 profile .npmrc 解析（存在则返回，否则用户/官方源）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpu-reg-'))
  writeFileSync(join(dir, '.npmrc'), 'registry=https://npmmirror.test.example\n', 'utf8')
  const url = registry.readRegistryUrl(dir, homedir())
  assert.equal(url, 'https://npmmirror.test.example')
  // 无 profile .npmrc → 用户主目录 .npmrc 或官方源（断言是合法 https registry 而非崩溃）
  const empty = mkdtempSync(join(tmpdir(), 'dshpu-reg2-'))
  const fallback = registry.readRegistryUrl(empty, homedir())
  assert.ok(/^https:\/\/.+/.test(fallback), `fallback registry: ${fallback}`)
  rmSync(dir, { recursive: true, force: true })
  rmSync(empty, { recursive: true, force: true })
})

test('registryPath: @ 字面量保留，/ 编码', () => {
  assert.equal(registry.registryPath('@scope/pkg'), '@scope%2Fpkg')
  assert.equal(registry.registryPath('plain-pkg'), 'plain-pkg')
})

test('npmHomepage: 构造 npmjs URL', () => {
  assert.equal(registry.npmHomepage('@scope/pkg'), 'https://www.npmjs.com/package/%40scope%2Fpkg')
  assert.equal(registry.npmHomepage('plain'), 'https://www.npmjs.com/package/plain')
})

test('checkNpmUpdates: mock fetch 返回版本、isIgnored 过滤', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpu-npm-'))
  // 模拟装了 @a/pkg@1.0.0
  const pkgDir = join(dir, 'node_modules', '@a', 'pkg')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@a/pkg', version: '1.0.0' }), 'utf8')

  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('@a%2Fpkg') || u.includes('@a/pkg')) return { ok: true, json: async () => ({ version: '1.2.0' }) }
    return { ok: true, json: async () => ({ version: '0.0.1' }) }
  }

  try {
    const r1 = await registry.checkNpmUpdates(dir, ['@a/pkg', 'other'], 'https://reg', { timeoutMs: 2000, isIgnored: (n) => n === 'other' })
    assert.equal(r1.npm.length, 1)
    assert.equal(r1.npm[0].name, '@a/pkg')
    assert.equal(r1.npm[0].outdated, true)
    assert.equal(r1.npm[0].current, '1.0.0')
    assert.equal(r1.npm[0].latest, '1.2.0')
    // isIgnored 过滤掉 other
    assert.equal(r1.npm.some((n) => n.name === 'other'), false)
  } finally {
    globalThis.fetch = origFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store: 持久化全流程（临时 home）', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshpu-store-'))
  mkdirSync(join(home, 'storages'), { recursive: true })
  const s1 = new storeMod.PluginStore(home)
  s1.pushNotification({ kind: 'update-available', title: 't', body: '1->2', dedupe: 'x@2' })
  s1.pushNotification({ kind: 'update-available', title: 't', body: '1->2', dedupe: 'x@2' }) // dedupe
  assert.equal(s1.unreadCount(), 1)
  s1.addIgnore('pkg', 'npm')
  s1.addHistory({ name: 'pkg', from: '1', to: '2', ok: true, kind: 'npm' })
  // 重新加载（持久化生效）
  const s2 = new storeMod.PluginStore(home)
  assert.equal(s2.unreadCount(), 1)
  assert.equal(s2.isIgnored('pkg'), true)
  assert.equal(s2.snapshot().history.length, 1)
  s2.markAllRead()
  const s3 = new storeMod.PluginStore(home)
  assert.equal(s3.unreadCount(), 0)
  rmSync(home, { recursive: true, force: true })
})

test('git: findGitRoot 向上查找 + resolveLinkTarget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpu-git-'))
  mkdirSync(join(dir, '.git'), { recursive: true }) // 模拟仓库根
  mkdirSync(join(dir, 'sub', 'pkg'), { recursive: true })
  // findGitRoot 从子目录向上找到根
  assert.equal(gitMod.findGitRoot(join(dir, 'sub', 'pkg')), dir)
  // resolveLinkTarget 解析 link:
  assert.equal(gitMod.resolveLinkTarget(dir, `link:${join(dir, 'sub', 'pkg')}`), join(dir, 'sub', 'pkg'))
  assert.equal(gitMod.resolveLinkTarget(dir, 'link:not-exist-dir'), null)
  rmSync(dir, { recursive: true, force: true })
})

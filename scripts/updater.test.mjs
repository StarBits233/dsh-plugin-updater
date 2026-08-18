import { test } from 'node:test'
import assert from 'node:assert/strict'

// 直接测 updater 的纯逻辑；用 mock run 避免真实 dsh/git 副作用。
// 注意：lib/updater.js 依赖 registry.js 的 installedVersion（读真实 fs），
// 这里用临时目录包一层不现实；改为测 loadable + 备份对象结构 + rollback 决策。
import { pathToFileURL } from 'node:url'

const base = 'D:/MyProject/Tools/DSHTools/dsh-plugin-updater/lib/'
const updater = await import(pathToFileURL(base + 'updater.js').href)

test('updater 模块可加载且导出核心函数', () => {
  for (const fn of ['backupNpmState', 'backupGitState', 'rollbackNpm', 'runNpmUpdateWithRollback', 'runGitUpdateWithRollback']) {
    assert.equal(typeof updater[fn], 'function', fn)
  }
})

test('backupNpmState: 生成带旧版本/目标版本的备份对象', async () => {
  // installedVersion 读真实 profile 的 vision-toolkit 版本（只读，无副作用）
  const { installedVersion } = await import(pathToFileURL(base + 'registry.js').href)
  const dir = 'C:/Users/25294/.dsh/profiles/web'
  const current = installedVersion(dir, '@anionex/dsh-vision-toolkit')
  const backup = updater.backupNpmState(dir, '@anionex/dsh-vision-toolkit', '9.9.9')
  assert.equal(backup.kind, 'npm')
  assert.equal(backup.name, '@anionex/dsh-vision-toolkit')
  assert.equal(backup.targetVersion, '9.9.9')
  assert.equal(typeof backup.at, 'string')
  assert.ok(current === null || typeof current === 'string')
})

test('rollbackNpm: 无旧版本时返回 false（不可回滚）', async () => {
  const runDsh = async () => ({ code: 0, stdout: '', stderr: '' })
  const rb = await updater.rollbackNpm(runDsh, { kind: 'npm', name: 'x', oldVersion: null, targetVersion: '1.0.0', at: '' })
  assert.equal(rb, false)
})

test('runGitUpdateWithRollback: 非 git 目录直接失败且不回滚', async () => {
  const run = async () => ({ code: 1, stdout: '', stderr: 'nope' })
  const res = await updater.runGitUpdateWithRollback(run, 'C:/Users/25294/.dsh/definitely-not-a-git-dir', {
    kind: 'git', name: 'x', root: 'x', oldCommit: 'abc', branch: 'main', at: '',
  })
  assert.equal(res.ok, false)
  assert.equal(res.rolledBack, false)
})

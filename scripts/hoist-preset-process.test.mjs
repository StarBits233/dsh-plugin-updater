import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readHoistPatterns,
  matchesHoistPattern,
  suggestHoistPattern,
  scanPatchPluginNames,
  inspectAndHealHoist,
} from '../lib/hoist.js'

import {
  readPresetMetadata,
  PRESET_REPOS,
  findLocalSuitePresetDir,
} from '../lib/preset.js'

import { diagnoseDshProcess } from '../lib/process.js'

test('hoist: matchesHoistPattern and suggestHoistPattern', () => {
  const patterns = ['@linxin666/*', 'dsh-*', 'lodash', '!@deepseek-ai/*']
  assert.equal(matchesHoistPattern('@linxin666/dsh-web-ui-all', patterns), true)
  assert.equal(matchesHoistPattern('dsh-better-sidebar', patterns), true)
  assert.equal(matchesHoistPattern('lodash', patterns), true)
  assert.equal(matchesHoistPattern('@mlgbnb/dsh-archive-manager', patterns), false)

  assert.equal(suggestHoistPattern('@mlgbnb/dsh-archive-manager'), '@mlgbnb/*')
  assert.equal(suggestHoistPattern('dsh-plugin-foo'), 'dsh-*')
  assert.equal(suggestHoistPattern('some-lib'), 'some-lib')
})

test('hoist: inspectAndHealHoist auto-heals missing hoist patterns and keeps deepseek exclusion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpu-hoist-test-'))
  try {
    // 写入 package.json
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: {
        '@linxin666/dsh-web-ui-all': '^0.3.2',
      }
    }), 'utf8')

    // 写入 node_modules/@linxin666/dsh-web-ui-all/cordis.patch.yml
    const subDir = join(dir, 'node_modules', '@linxin666', 'dsh-web-ui-all')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, 'cordis.patch.yml'), `
insert:
  - name: '@mlgbnb/dsh-archive-manager'
  - name: 'dsh-better-sidebar'
    `, 'utf8')

    // 初始 .npmrc 仅有 @linxin666/*
    writeFileSync(join(dir, '.npmrc'), 'public-hoist-pattern[]=@linxin666/*\n', 'utf8')

    const res = inspectAndHealHoist(dir, true)
    assert.equal(res.missingPatterns.includes('@mlgbnb/*'), true)
    assert.equal(res.missingPatterns.includes('dsh-*'), true)

    // 验证写入后的 .npmrc
    const healedNpmrc = readFileSync(join(dir, '.npmrc'), 'utf8')
    assert.equal(healedNpmrc.includes('ignore-workspace-root-check=true'), true)
    assert.equal(healedNpmrc.includes('public-hoist-pattern[]=@mlgbnb/*'), true)
    assert.equal(healedNpmrc.includes('public-hoist-pattern[]=!@deepseek-ai/*'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('preset: readPresetMetadata and PRESET_REPOS', () => {
  assert.equal(PRESET_REPOS['router-standard'], 'yjh051108/dsh-router-standard')
  assert.equal(PRESET_REPOS['router-spec'], 'yjh051108/dsh-routing-suite')

  const dir = mkdtempSync(join(tmpdir(), 'dshpu-preset-test-'))
  try {
    writeFileSync(join(dir, 'preset.yml'), 'version: 1.10.0\ndescription: 经典路由规约\n', 'utf8')
    const meta = readPresetMetadata(dir)
    assert.equal(meta.version, '1.10.0')
    assert.equal(meta.description, '经典路由规约')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('process: diagnoseDshProcess returns valid diagnostic schema', async () => {
  const diag = await diagnoseDshProcess(3080)
  assert.equal(typeof diag.port, 'number')
  assert.equal(typeof diag.inUse, 'boolean')
  assert.equal(typeof diag.isOrphan, 'boolean')
  assert.equal(typeof diag.isDesktop, 'boolean')
})

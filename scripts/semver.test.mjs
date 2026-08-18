import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVersion, isPrerelease, normalize, compareVersions, isNewer, satisfies, maxVersion, majorOf } from '../lib/semver.js'

test('parseVersion: 标准/ v前缀 / prerelease / build', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [], build: [], raw: '1.2.3' })
  assert.equal(parseVersion('v1.2.3')?.major, 1)
  assert.equal(parseVersion('V2.0.0-rc.1')?.prerelease.join('.'), 'rc.1')
  assert.equal(parseVersion('1.2.3+build.5')?.build.join('.'), 'build.5')
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion('abc'), null)
  assert.equal(parseVersion(''), null)
})

test('isPrerelease', () => {
  assert.equal(isPrerelease('1.2.3-beta.1'), true)
  assert.equal(isPrerelease('1.2.3'), false)
  assert.equal(isPrerelease('1.2.3+build'), false)
})

test('normalize: 去v 去build 保留prerelease', () => {
  assert.equal(normalize('v1.2.3'), '1.2.3')
  assert.equal(normalize('1.2.3+build.5'), '1.2.3')
  assert.equal(normalize('v1.2.3-rc.1'), '1.2.3-rc.1')
  assert.equal(normalize('not-a-version'), 'not-a-version')
})

test('compareVersions: 基础排序', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1)
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
})

test('compareVersions: prerelease 语义', () => {
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-alpha'), 1)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-beta.2'), 1)
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha'), 1)
  assert.equal(compareVersions('1.0.0-alpha.beta', '1.0.0-alpha.1'), 1)
  // build metadata 不参与
  assert.equal(compareVersions('1.0.0+build1', '1.0.0'), 0)
})

test('compareVersions: 数字 vs 字母 prerelease（数字更低）', () => {
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1)
})

test('isNewer: 升级与降级保护', () => {
  assert.equal(isNewer('1.0.2', '1.0.1'), true)
  assert.equal(isNewer('1.0.1', '1.0.1'), false)
  assert.equal(isNewer('1.0.1', '1.0.2'), false) // 降级不算更新
  assert.equal(isNewer('1.0.1', '1.0.0-beta.1'), true) // 稳定版 > 预发布
  assert.equal(isNewer('2.0.0-rc.1', '1.9.9'), true) // 高位预发布 > 低位稳定
  // 无法解析的兜底
  assert.equal(isNewer('weird-a', 'weird-b'), true)
  assert.equal(isNewer('weird', 'weird'), false)
})

test('satisfies: 简单 range', () => {
  assert.equal(satisfies('1.2.3', '*'), true)
  assert.equal(satisfies('1.2.3', '1.2.3'), true)
  assert.equal(satisfies('1.2.3', '^1.2.0'), true)
  assert.equal(satisfies('1.5.0', '^1.2.0'), true)
  assert.equal(satisfies('2.0.0', '^1.2.0'), false)
  assert.equal(satisfies('1.2.5', '~1.2.3'), true)
  assert.equal(satisfies('1.3.0', '~1.2.3'), false)
  assert.equal(satisfies('1.2.3', '>=1.2.0'), true)
  assert.equal(satisfies('1.1.0', '>=1.2.0'), false)
})

test('maxVersion', () => {
  assert.equal(maxVersion('1.0.1', '1.0.2'), '1.0.2')
  assert.equal(maxVersion('1.0.2', '1.0.2'), '1.0.2')
  assert.equal(maxVersion(null, '1.0.1'), '1.0.1')
  assert.equal(maxVersion('1.0.1', null), '1.0.1')
  assert.equal(maxVersion(null, null), null)
})

test('majorOf', () => {
  assert.equal(majorOf('v2.3.4'), 2)
  assert.equal(majorOf('nope'), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { parseGhRepo } = await import(pathToFileURL('D:/MyProject/Tools/DSHTools/dsh-plugin-updater/lib/github.js').href)

test('parseGhRepo: 各种 repository 形式', () => {
  const cases = [
    ['github.com/owner/repo', 'owner/repo'],
    ['git+https://github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/OwnerX/RepoY.git', 'OwnerX/RepoY'],
    ['github:owner/repo', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['https://gitlab.com/o/r', null],
    ['link:../local', null],
    ['file:./x', null],
    [{ url: 'https://github.com/a/b' }, 'a/b'],
    [null, null],
    ['not a repo', null],
    ['owner/repo', 'owner/repo'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(parseGhRepo(input), expected, `input=${JSON.stringify(input)}`)
  }
})

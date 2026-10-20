import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('the English-first docs gate passes', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    execFileSync(process.execPath, ['scripts/check-i18n.mjs'], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    assert.fail(error.stderr?.toString() || error.message)
  }
})

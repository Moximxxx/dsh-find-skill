import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMetadata, readMetadata, METADATA_FILE } from '../src/metadata.ts'

describe('install metadata', () => {
  it('round-trips provenance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'))
    try {
      await writeMetadata(dir, { source: 'vercel-labs/agent-skills', skill: 'web-design-guidelines', installedAt: 123, scope: 'project' })
      expect(await readMetadata(dir)).toEqual({
        source: 'vercel-labs/agent-skills',
        skill: 'web-design-guidelines',
        installedAt: 123,
        scope: 'project',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('omits the skill filter when absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'))
    try {
      await writeMetadata(dir, { source: 'vercel-labs/agent-skills', installedAt: 1, scope: 'temp' })
      expect(await readMetadata(dir)).toEqual({ source: 'vercel-labs/agent-skills', installedAt: 1, scope: 'temp' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns undefined for missing or malformed metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meta-'))
    try {
      expect(await readMetadata(dir)).toBeUndefined()
      writeFileSync(join(dir, METADATA_FILE), 'not json', 'utf8')
      expect(await readMetadata(dir)).toBeUndefined()
      writeFileSync(join(dir, METADATA_FILE), JSON.stringify({ source: 42 }), 'utf8')
      expect(await readMetadata(dir)).toBeUndefined()
      writeFileSync(join(dir, METADATA_FILE), JSON.stringify({ source: 'x', installedAt: 1, scope: 'bogus' }), 'utf8')
      expect(await readMetadata(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

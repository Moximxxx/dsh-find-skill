import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateInstalledSkill } from '../src/cli.ts'

describe('locateInstalledSkill', () => {
  it('matches a single installed directory', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cli-'))
    const root = join(base, '.agents/skills')
    mkdirSync(join(root, 'react-best-practices'), { recursive: true })
    writeFileSync(
      join(root, 'react-best-practices/SKILL.md'),
      ['---', 'name: react-best-practices', 'description: d', '---', 'body'].join('\n'),
    )
    try {
      expect(await locateInstalledSkill(root)).toBe(join(root, 'react-best-practices'))
      expect(await locateInstalledSkill(root, 'react-best-practices')).toBe(join(root, 'react-best-practices'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('selects by frontmatter name among several directories', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cli-'))
    const root = join(base, '.agents/skills')
    mkdirSync(join(root, 'a'), { recursive: true })
    mkdirSync(join(root, 'b'), { recursive: true })
    writeFileSync(join(root, 'a/SKILL.md'), ['---', 'name: skill-a', 'description: d', '---', 'a'].join('\n'))
    writeFileSync(join(root, 'b/SKILL.md'), ['---', 'name: skill-b', 'description: d', '---', 'b'].join('\n'))
    try {
      expect(await locateInstalledSkill(root, 'skill-b')).toBe(join(root, 'b'))
      await expect(locateInstalledSkill(root)).rejects.toThrow(/multiple skill directories/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('throws when nothing was installed', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cli-'))
    const root = join(base, '.agents/skills')
    mkdirSync(root, { recursive: true })
    try {
      await expect(locateInstalledSkill(root)).rejects.toThrow(/no installed skill directories/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

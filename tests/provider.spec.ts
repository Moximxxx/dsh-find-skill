import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedSkillProvider } from '../src/provider.ts'
import { Config } from '../src/config.ts'

function fixtureSkill(root: string, dir: string, frontmatter: string, body = 'body') {
  const skillDir = join(root, dir)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), ['---', frontmatter, '---', '', body].join('\n'))
}

describe('ManagedSkillProvider', () => {
  it('lists project and global candidates with configured rank', async () => {
    const base = mkdtempSync(join(tmpdir(), 'prov-'))
    const projectRoot = join(base, 'proj')
    const globalRoot = join(base, 'global')
    mkdirSync(join(projectRoot, '.git'), { recursive: true })
    fixtureSkill(join(projectRoot, '.dsh/skills-bridge'), 'alpha-skill', 'name: alpha-skill\ndescription: Alpha skill')
    fixtureSkill(join(globalRoot, 'skills-bridge/global'), 'beta-skill', 'name: beta-skill\ndescription: Beta skill')
    try {
      const config = Config({ globalSkillRoot: join(globalRoot, 'skills-bridge/global'), providerRank: 350 })
      const invalidations: number[] = []
      const provider = new ManagedSkillProvider(config, () => { invalidations.push(invalidations.length) })
      const candidates = await provider.list({ cwd: join(projectRoot, 'sub') })
      expect(candidates.map(c => c.name).sort()).toEqual(['alpha-skill', 'beta-skill'])
      expect(candidates.every(c => c.rank === 350)).toBe(true)
      expect(candidates.every(c => c.source === 'custom' && c.provider === 'dsh-find-skill')).toBe(true)
      const alpha = candidates.find(c => c.name === 'alpha-skill')!
      expect(alpha.resourceBase).toEqual({ kind: 'directory', path: join(projectRoot, '.dsh/skills-bridge/alpha-skill') })
      const definition = await provider.get(alpha)
      expect(definition?.content).toContain('body')
      expect(invalidations).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('ignores directories without SKILL.md', async () => {
    const base = mkdtempSync(join(tmpdir(), 'prov-'))
    const projectRoot = join(base, 'proj')
    mkdirSync(join(projectRoot, '.git'), { recursive: true })
    mkdirSync(join(projectRoot, '.dsh/skills-bridge/empty-dir'), { recursive: true })
    try {
      const config = Config({})
      const provider = new ManagedSkillProvider(config, () => {})
      const candidates = await provider.list({ cwd: projectRoot })
      expect(candidates).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fails loud on invalid skill frontmatter in managed roots', async () => {
    const base = mkdtempSync(join(tmpdir(), 'prov-'))
    const projectRoot = join(base, 'proj')
    mkdirSync(join(projectRoot, '.git'), { recursive: true })
    fixtureSkill(join(projectRoot, '.dsh/skills-bridge'), 'bad-name', 'name: Bad Name\ndescription: d')
    try {
      const config = Config({})
      const provider = new ManagedSkillProvider(config, () => {})
      await expect(provider.list({ cwd: projectRoot })).rejects.toThrow(/not a valid kebab-case/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

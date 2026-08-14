import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPanelListing, SessionSkillPanel } from '../src/panel.ts'
import { ManagedSkillProvider } from '../src/provider.ts'
import { TempSkillManager } from '../src/temp.ts'
import { Config } from '../src/config.ts'

function skillDir(root: string, name: string, description = name + ' desc') {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), ['---', 'name: ' + name, 'description: ' + description, '---', 'body'].join('\n'))
  return dir
}

describe('buildPanelListing', () => {
  it('groups managed skills by root and scopes temp rows to the session', async () => {
    const base = mkdtempSync(join(tmpdir(), 'panel-'))
    const projectRoot = join(base, 'proj')
    mkdirSync(join(projectRoot, '.git'), { recursive: true })
    const projectDir = join(projectRoot, '.dsh/skills-bridge')
    const globalDir = join(base, 'global')
    skillDir(projectDir, 'project-skill')
    skillDir(globalDir, 'global-skill')
    const config = Config({ globalSkillRoot: globalDir })
    const panel = new SessionSkillPanel({} as never)
    const provider = new ManagedSkillProvider(config, () => {})
    const tempManager = new TempSkillManager(() => () => {}, join(base, 'tmp'))
    const tempDir = skillDir(join(base, 'tmp'), 'my-temp', 'temp desc')
    await tempManager.add({ name: 'my-temp', description: 'x', content: 'b', source: 'custom' }, tempDir, 'session-A')
    await tempManager.add({ name: 'other-session-temp', description: 'x', content: 'b', source: 'custom' }, skillDir(join(base, 'tmp'), 'other-session-temp'), 'session-B')
    try {
      const listing = await buildPanelListing(config, provider, tempManager, panel, projectRoot, 'session-A')
      expect(listing.levels.project.map(r => r.name)).toEqual(['project-skill'])
      expect(listing.levels.global.map(r => r.name)).toEqual(['global-skill'])
      expect(listing.levels.temp.map(r => r.name)).toEqual(['my-temp'])
      expect(listing.levels.temp[0]!.description).toBe('temp desc')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

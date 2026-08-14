import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptNewSkills } from '../src/install.ts'

function skillDir(root: string, name: string, frontmatterName = name) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), ['---', 'name: ' + frontmatterName, 'description: d', '---', 'body'].join('\n'))
  return dir
}

describe('adoptNewSkills', () => {
  it('moves only newly added valid skill dirs into the managed root', async () => {
    const base = mkdtempSync(join(tmpdir(), 'sync-'))
    const installed = join(base, '.agents', 'skills')
    const dest = join(base, 'managed')
    mkdirSync(installed, { recursive: true })
    skillDir(installed, 'preexisting')
    skillDir(installed, 'new-skill')
    // 无效条目（无 SKILL.md）不被收养
    mkdirSync(join(installed, 'not-a-skill'), { recursive: true })
    try {
      const adopted = await adoptNewSkills(installed, dest, ['preexisting'])
      expect(adopted).toEqual(['new-skill'])
      expect(existsSync(join(dest, 'new-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(installed, 'new-skill'))).toBe(false)
      expect(existsSync(join(installed, 'preexisting'))).toBe(true)
      expect(existsSync(join(installed, 'not-a-skill'))).toBe(true)
      expect(existsSync(join(dest, 'new-skill', '.dsh-find-skill.json'))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('adopts nothing when the CLI added no directories', async () => {
    const base = mkdtempSync(join(tmpdir(), 'sync-'))
    const installed = join(base, '.agents', 'skills')
    const dest = join(base, 'managed')
    mkdirSync(installed, { recursive: true })
    skillDir(installed, 'only-existing')
    try {
      expect(await adoptNewSkills(installed, dest, ['only-existing'])).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

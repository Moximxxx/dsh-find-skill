import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findProjectRoot, resolveRoots } from '../src/roots.ts'
import { Config } from '../src/config.ts'

describe('findProjectRoot', () => {
  it('finds the nearest ancestor containing .git', () => {
    const base = mkdtempSync(join(tmpdir(), 'fsr-'))
    mkdirSync(join(base, 'a', 'b'), { recursive: true })
    mkdirSync(join(base, 'a', '.git'))
    try {
      expect(findProjectRoot(join(base, 'a', 'b'))).toBe(join(base, 'a'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('falls back to the cwd without a git root', () => {
    const base = mkdtempSync(join(tmpdir(), 'fsr-'))
    try {
      expect(findProjectRoot(base)).toBe(base)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('resolveRoots', () => {
  it('resolves defaults under DSH_HOME', () => {
    const base = mkdtempSync(join(tmpdir(), 'fsr-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = base
    try {
      const config = Config({})
      const roots = resolveRoots(config, base)
      expect(roots.projectSkillDir).toBe(join(base, '.dsh/skills-bridge'))
      expect(roots.globalSkillDir).toBe(join(base, 'skills-bridge/global'))
      expect(roots.tempSkillDir).toBe(join(base, 'skills-bridge/tmp'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(base, { recursive: true, force: true })
    }
  })
})

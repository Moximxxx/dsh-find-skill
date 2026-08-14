import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TempSkillManager } from '../src/temp.ts'

function baseDir(): string {
  return mkdtempSync(join(tmpdir(), 'temp-'))
}

function makeManager(base: string, log: string[] = []): { manager: TempSkillManager; register: (s: unknown) => () => void } {
  const register = (skill: unknown) => {
    log.push('register:' + (skill as { name: string }).name)
    return () => { log.push('dispose:' + (skill as { name: string }).name) }
  }
  return { manager: new TempSkillManager(register, base), register }
}

const skill = (name: string) => ({ name, description: name + ' desc', source: 'custom' as const, content: 'body' })

describe('TempSkillManager', () => {
  it('adds, lists, and removes entries with directory cleanup', async () => {
    const base = baseDir()
    const { manager } = makeManager(base)
    const dir = join(base, 'alpha-skill')
    await manager.add(skill('alpha-skill'), dir)
    expect(manager.list().map(e => e.name)).toEqual(['alpha-skill'])
    expect(manager.has('alpha-skill')).toBe(true)
    expect(existsSync(dir)).toBe(true)
    expect(await manager.remove('alpha-skill')).toBe(true)
    expect(manager.has('alpha-skill')).toBe(false)
    expect(existsSync(dir)).toBe(false)
    rmSync(base, { recursive: true, force: true })
  })

  it('re-add replaces the previous disposer', async () => {
    const base = baseDir()
    const log: string[] = []
    const { manager } = makeManager(base, log)
    await manager.add(skill('alpha-skill'), join(base, 'alpha-skill'))
    await manager.add(skill('alpha-skill'), join(base, 'alpha-skill'))
    expect(log.filter(l => l.startsWith('register:')).length).toBe(2)
    expect(log.filter(l => l.startsWith('dispose:')).length).toBe(1)
    rmSync(base, { recursive: true, force: true })
  })

  it('disposes all entries', async () => {
    const base = baseDir()
    const log: string[] = []
    const { manager } = makeManager(base, log)
    await manager.add(skill('a'), join(base, 'a'))
    await manager.add(skill('b'), join(base, 'b'))
    await manager.disposeAll()
    expect(log.filter(l => l.startsWith('dispose:')).sort()).toEqual(['dispose:a', 'dispose:b'])
    expect(manager.list()).toEqual([])
    rmSync(base, { recursive: true, force: true })
  })

  it('uses the per-add register override and its disposer', async () => {
    const base = baseDir()
    const log: string[] = []
    const { manager } = makeManager(base, log)
    const scopedRegister = (skill: unknown) => {
      log.push('scoped-register:' + (skill as { name: string }).name)
      return () => { log.push('scoped-dispose:' + (skill as { name: string }).name) }
    }
    await manager.add(skill('alpha-skill'), join(base, 'alpha-skill'), 'session-1', scopedRegister)
    expect(log).toEqual(['scoped-register:alpha-skill'])
    await manager.remove('alpha-skill')
    expect(log).toContain('scoped-dispose:alpha-skill')
    rmSync(base, { recursive: true, force: true })
  })
  it('disposes only entries owned by one session', async () => {
    const base = baseDir()
    const log: string[] = []
    const { manager } = makeManager(base, log)
    await manager.add(skill('a'), join(base, 'a'), 'session-1')
    await manager.add(skill('b'), join(base, 'b'), 'session-2')
    await manager.add(skill('c'), join(base, 'c'))
    expect(await manager.disposeOwned('session-1')).toBe(true)
    expect(log.filter(l => l.startsWith('dispose:')).sort()).toEqual(['dispose:a'])
    expect(manager.list().map(e => e.name).sort()).toEqual(['b', 'c'])
    expect(await manager.disposeOwned('session-1')).toBe(false)
    rmSync(base, { recursive: true, force: true })
  })
})

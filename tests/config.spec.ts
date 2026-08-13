import { describe, expect, it } from 'vitest'
import { Config, apply, name } from '../src/index.ts'

describe('dsh-find-skill config', () => {
  it('exposes the plugin name', () => {
    expect(name).toBe('dsh-find-skill')
  })

  it('fills documented defaults for an empty config', () => {
    const config = Config({})
    expect(config.searchApiBase).toBe('https://skills.sh')
    expect(config.searchLimit).toBe(20)
    expect(config.cliCommand).toBe('npx -y skills@latest')
    expect(config.installDefaultScope).toBe('temp')
    expect(config.projectSkillRoot).toBe('.dsh/skills-bridge')
    expect(config.providerRank).toBe(350)
    expect(config.compactDisposePolicy).toBe('keep')
    expect(config.registerFindTool).toBe(true)
    expect(config.registerInstallTool).toBe(true)
    expect(config.registerRemoveTool).toBe(true)
    expect(config.registerCommand).toBe(true)
  })

  it('applies explicit overrides', () => {
    const config = Config({ searchLimit: 5, installDefaultScope: 'global' })
    expect(config.searchLimit).toBe(5)
    expect(config.installDefaultScope).toBe('global')
  })

  it('fails loud on invalid values', () => {
    expect(() => Config({ searchLimit: 0 })).toThrow()
    expect(() => Config({ installDefaultScope: 'bogus' as never })).toThrow()
  })
})

describe('plugin apply smoke', () => {
  it('applies on a bare Context with default config', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    ctx.provide('skills', {
      registerProvider: () => () => {},
      register: () => () => {},
    })
    ctx.provide('tools', { register: () => {} })
    expect(() => apply(ctx)).not.toThrow()
  })
})

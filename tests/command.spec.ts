import { describe, expect, it } from 'vitest'
import { parseSkillCommand } from '../src/command.ts'

describe('parseSkillCommand', () => {
  it('parses find with a query', () => {
    expect(parseSkillCommand('find react performance')).toEqual({ action: 'find', arg: 'react performance' })
  })

  it('parses install with options', () => {
    expect(parseSkillCommand('install vercel-labs/agent-skills --skill react --scope global')).toEqual({
      action: 'install',
      arg: 'vercel-labs/agent-skills',
      skill: 'react',
      scope: 'global',
    })
  })

  it('parses remove without scope', () => {
    expect(parseSkillCommand('remove react-best-practices')).toEqual({ action: 'remove', arg: 'react-best-practices' })
  })

  it('defaults to list', () => {
    expect(parseSkillCommand('')).toEqual({ action: 'list' })
  })

  it('parses update with scope', () => {
    expect(parseSkillCommand('update web-design-guidelines --scope project')).toEqual({
      action: 'update',
      arg: 'web-design-guidelines',
      scope: 'project',
    })
  })
  it('parses sync without arguments', () => {
    expect(parseSkillCommand('sync')).toEqual({ action: 'sync' })
  })

  it('rejects invalid actions and scopes', () => {
    expect(() => parseSkillCommand('frobnicate x')).toThrow(/not a \/skill action/)
    expect(() => parseSkillCommand('install x --scope bogus')).toThrow(/not a valid scope/)
  })
})

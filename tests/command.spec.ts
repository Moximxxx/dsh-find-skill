import { describe, expect, it } from 'vitest'
import { parseSkillCommand, resolveLoadTarget } from '../src/command.ts'

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

  it('parses panel, disable, enable and load', () => {
    expect(parseSkillCommand('panel')).toEqual({ action: 'panel' })
    expect(parseSkillCommand('disable web-design-guidelines')).toEqual({ action: 'disable', arg: 'web-design-guidelines' })
    expect(parseSkillCommand('enable web-design-guidelines')).toEqual({ action: 'enable', arg: 'web-design-guidelines' })
    expect(parseSkillCommand('load vercel-react-best-practices')).toEqual({ action: 'load', arg: 'vercel-react-best-practices' })
  })

  it('resolves load targets from --path and --cwd', () => {
    expect(resolveLoadTarget('load x --path /tmp/skills/foo')).toEqual({ mode: 'path', value: '/tmp/skills/foo' })
    expect(resolveLoadTarget('load x --cwd /workspace')).toEqual({ mode: 'cwd', value: '/workspace' })
    expect(resolveLoadTarget('load x --cwd')).toEqual({ mode: 'cwd', value: '' })
    expect(resolveLoadTarget('load x --cwd ')).toEqual({ mode: 'cwd', value: '' })
    expect(resolveLoadTarget('load x')).toBeUndefined()
    expect(resolveLoadTarget('load x --scope temp')).toBeUndefined()
  })

  it('rejects invalid actions and scopes', () => {
    expect(() => parseSkillCommand('frobnicate x')).toThrow(/not a \/skill action/)
    expect(() => parseSkillCommand('install x --scope bogus')).toThrow(/not a valid scope/)
  })
})

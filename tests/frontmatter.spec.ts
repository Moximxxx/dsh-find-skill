import { describe, expect, it } from 'vitest'
import { parseSkillContent } from '../src/frontmatter.ts'

describe('parseSkillContent', () => {
  it('parses name, description and body', () => {
    const parsed = parseSkillContent(
      ['---', 'name: react-best-practices', 'description: React performance guidance', '---', '', '# Body', 'content here'].join('\n'),
      'fixture',
    )
    expect(parsed.name).toBe('react-best-practices')
    expect(parsed.description).toBe('React performance guidance')
    expect(parsed.content).toContain('# Body')
    expect(parsed.modelInvocable).toBe(true)
    expect(parsed.userInvocable).toBe(true)
  })

  it('reads invocation flags', () => {
    const parsed = parseSkillContent(
      ['---', 'name: user-only', 'description: d', 'disable-model-invocation: true', 'user-invocable: true', '---', 'body'].join('\n'),
      'fixture',
    )
    expect(parsed.modelInvocable).toBe(false)
    expect(parsed.userInvocable).toBe(true)
  })

  it('reads when-to-use and metadata', () => {
    const parsed = parseSkillContent(
      ['---', 'name: guided', 'description: d', 'when-to-use: only for x', 'metadata:', '  weight: 3', '---', 'body'].join('\n'),
      'fixture',
    )
    expect(parsed.whenToUse).toBe('only for x')
    expect(parsed.metadata).toEqual({ weight: 3 })
  })

  it('fails loud on invalid names', () => {
    expect(() => parseSkillContent(['---', 'name: Not Kebab', 'description: d', '---', 'b'].join('\n'), 'fixture')).toThrow()
  })

  it('fails loud on missing description', () => {
    expect(() => parseSkillContent(['---', 'name: ok-name', '---', 'b'].join('\n'), 'fixture')).toThrow()
  })

  it('fails loud on documents without frontmatter', () => {
    expect(() => parseSkillContent('plain body', 'fixture')).toThrow(/name/)
  })
})

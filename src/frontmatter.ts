/**
 * SKILL.md frontmatter parsing shared by the managed provider and installs.
 *
 * @module dsh-find-skill/frontmatter
 */

import { parse as parseYaml } from 'yaml'
import { isSkillName } from '@deepseek-ai/dsh-skill'

/** Parsed skill file: validated routing fields plus the instruction body. */
export interface ParsedSkillFile {
  /** Kebab-case skill name from frontmatter. */
  readonly name: string
  /** Routing description from frontmatter. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Whether the model may load this skill. */
  readonly modelInvocable: boolean
  /** Whether a user may invoke this skill directly. */
  readonly userInvocable: boolean
  /** Optional provider-specific metadata object. */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** Markdown instruction body after frontmatter removal. */
  readonly content: string
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanField(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function optionalMetadata(data: Record<string, unknown>): { metadata?: Readonly<Record<string, unknown>> } {
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value as Record<string, unknown> }
  }
  return {}
}

/**
 * Split YAML frontmatter from the markdown body.
 * @param raw - full SKILL.md text.
 * @returns parsed YAML data plus the remaining body.
 */
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }
  const data = (parseYaml(match[1] ?? '') as Record<string, unknown>) ?? {}
  return { data, content: match[2] ?? '' }
}

/**
 * Parse and validate one SKILL.md document.
 * @param raw - full SKILL.md text.
 * @param source - human-readable source label used in error messages.
 * @returns validated routing fields and body; throws on invalid names or a missing description.
 */
export function parseSkillContent(raw: string, source: string): ParsedSkillFile {
  const { data, content } = parseFrontmatter(raw)
  const name = stringField(data, 'name')
  const description = stringField(data, 'description')
  if (name === undefined || !isSkillName(name)) {
    throw new Error(`${source}: frontmatter name "${name ?? ''}" is not a valid kebab-case skill name`)
  }
  if (description === undefined) {
    throw new Error(`${source}: frontmatter description is required`)
  }
  const disableModelInvocation = booleanField(data, 'disable-model-invocation')
  const userInvocable = booleanField(data, 'user-invocable')
  const whenToUse = stringField(data, 'when-to-use')
  return {
    name,
    description,
    ...whenToUse !== undefined ? { whenToUse } : {},
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
    ...optionalMetadata(data),
    content,
  }
}

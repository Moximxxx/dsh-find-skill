/**
 * Human-facing /skill command family: find / install / remove / list.
 *
 * The command registry is a closed client-side namespace; the /skill command
 * complements the model-facing tools without intercepting /<skill-name>
 * invocation gestures.
 *
 * @module dsh-find-skill/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult, CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { Config, InstallScope } from './config.ts'
import type { ManagedSkillProvider } from './provider.ts'
import type { TempSkillManager } from './temp.ts'
import { searchSkills } from './search.ts'
import { installSkill, removeSkill, syncSkills, updateSkill, type RegisterSkill } from './install.ts'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { buildPanelListing, type SessionSkillPanel } from './panel.ts'

/**
 * Register the /skill human command when the commands service is present.
 * @param ctx - host context; the commands service is looked up opportunistically.
 * @param config - validated plugin configuration.
 * @param provider - managed provider for catalog invalidation.
 * @param tempManager - temporary skill lifecycle manager.
 */
export function registerCommand(
  ctx: Context,
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  panel: SessionSkillPanel,
): void {
  const commands = ctx.get('commands') as { register: (definition: unknown) => () => void } | undefined
  if (commands === undefined) return
  commands.register({
    name: 'skill',
    description: 'Manage agent skills from the skills.sh ecosystem: find / install / update / sync / remove / list.',
    input: { hint: 'find <query> | install <source> [--skill name] [--scope temp|project|global] | update <name> [--scope ...] | sync | remove <name> [--scope ...] | list' },
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      try {
        return await handleSkillCommand(ctx, invocation, config, provider, tempManager, panel)
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

async function handleSkillCommand(
  ctx: Context,
  invocation: CommandInvocation,
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  panel: SessionSkillPanel,
): Promise<CommandResult> {
  const cwd = invocation.agent.session?.header.cwd
  const parsed = parseSkillCommand(invocation.rawInput)
  switch (parsed.action) {
    case 'find': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill find <query>' }
      const candidates = await searchSkills(
        config.searchApiBase ?? 'https://skills.sh',
        parsed.arg,
        config.searchLimit ?? 20,
        undefined,
        undefined,
        config.prioritySources,
      )
      if (candidates.length === 0) return { kind: 'success', text: 'no skills matched on skills.sh' }
      return {
        kind: 'success',
        text: candidates.map((candidate, index) =>
          `${index + 1}. ${candidate.name} (${candidate.id}) — ${candidate.installs} installs, ${candidate.source}\n   ${candidate.url}`,
        ).join('\n'),
      }
    }
    case 'install': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill install <source> [--skill name] [--scope temp|project|global]' }
      const registerSkill: RegisterSkill = (skill) => (invocation.agent.ctx.get('skills') as { register: (s: SkillRegistration) => () => void }).register(skill)
      const result = await installSkill(registerSkill, config, provider, tempManager, parsed.scope, parsed.arg, parsed.skill, cwd)
      return {
        kind: 'success',
        text: `${result.name} installed (${result.scope}) at ${result.path}`,
      }
    }
    case 'update': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill update <name> [--scope temp|project|global]' }
      const registerSkill: RegisterSkill = (skill) => (invocation.agent.ctx.get('skills') as { register: (s: SkillRegistration) => () => void }).register(skill)
      const result = await updateSkill(registerSkill, config, provider, tempManager, parsed.scope, parsed.arg, cwd)
      return { kind: 'success', text: `${result.name} updated (${result.scope})` }
    }
    case 'panel': {
      const sessionId = String(invocation.agent.session.header.id)
      const listing = await buildPanelListing(config, provider, tempManager, panel, cwd, sessionId)
      return { kind: 'success', text: JSON.stringify(listing) }
    }
    case 'disable': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill disable <name>' }
      const sessionId = String(invocation.agent.session.header.id)
      const error = await panel.disable(invocation.agent as never, sessionId, parsed.arg)
      return error === undefined
        ? { kind: 'success', text: `disabled ${parsed.arg} for this session` }
        : { kind: 'error', text: error }
    }
    case 'enable': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill enable <name>' }
      const sessionId = String(invocation.agent.session.header.id)
      return panel.enable(sessionId, parsed.arg)
        ? { kind: 'success', text: `enabled ${parsed.arg} for this session` }
        : { kind: 'error', text: `${parsed.arg} is not disabled in this session` }
    }
    case 'load': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill load <name> --path <dir>' }
      const path = optionValue(invocation.rawInput.trim().split(/\s+/).filter(Boolean).slice(1), '--path')
      if (path === undefined) return { kind: 'error', text: 'usage: /skill load <name> --path <dir>' }
      const error = await panel.loadFromPath(invocation.agent as never, parsed.arg, path)
      return error === undefined
        ? { kind: 'success', text: `loaded ${parsed.arg} into the latest context` }
        : { kind: 'error', text: error }
    }
    case 'sync': {
      const result = await syncSkills(config, provider, cwd)
      const summary = result.synced.length === 0
        ? 'no new node_modules skills found'
        : result.synced.map(item => item.name).join(', ')
      return { kind: 'success', text: 'synced: ' + summary }
    }
    case 'remove': {
      if (parsed.arg === undefined) return { kind: 'error', text: 'usage: /skill remove <name> [--scope temp|project|global]' }
      const result = await removeSkill(provider, tempManager, parsed.scope, parsed.arg, cwd)
      return { kind: 'success', text: `${result.name} removed from ${result.scope}` }
    }
    case 'list': {
      const scope = parsed.scope
      const lines: string[] = []
      if (scope === undefined || scope === 'temp') {
        const entries = tempManager.list()
        if (entries.length > 0) lines.push('temp:', ...entries.map(entry => '  ' + entry.name))
      }
      if (scope === undefined || scope === 'project' || scope === 'global') {
        const candidates = await provider.list({ cwd })
        if (candidates.length > 0) {
          lines.push((scope ?? 'managed') + ':', ...candidates.map(candidate => '  ' + candidate.name + ' — ' + candidate.description))
        }
      }
      if (lines.length === 0) return { kind: 'success', text: 'no managed skills installed' }
      return { kind: 'success', text: lines.join('\n') }
    }
    default:
      return { kind: 'error', text: `${parsed.action} is not a /skill action (find | install | remove | list)` }
  }
}

/** Parsed /skill command line. */
export interface ParsedSkillCommand {
  /** Action to perform. */
  readonly action: 'find' | 'install' | 'update' | 'sync' | 'remove' | 'list' | 'panel' | 'disable' | 'enable' | 'load'
  /** Positional argument (query, source, or name). */
  readonly arg?: string
  /** --skill option value. */
  readonly skill?: string
  /** --scope option value. */
  readonly scope?: InstallScope
}

/**
 * Parse one /skill command line into its parts.
 * @param rawInput - text following the command name, including whitespace.
 * @returns the parsed action, positional argument, and options.
 */
export function parseSkillCommand(rawInput: string): ParsedSkillCommand {
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean)
  const action = tokens[0] ?? 'list'
  if (action !== 'find' && action !== 'install' && action !== 'update' && action !== 'sync' && action !== 'remove' && action !== 'list' && action !== 'panel' && action !== 'disable' && action !== 'enable' && action !== 'load') {
    throw new Error(`${action} is not a /skill action (find | install | update | sync | remove | list | panel | disable | enable | load)`)
  }
  const rest = tokens.slice(1)
  const positional = rest.find(token => !token.startsWith('--'))
  const scope = optionValue(rest, '--scope')
  return {
    action,
    // find takes the whole remaining line as the query; other actions take the first positional.
    ...action === 'find'
      ? rest.length > 0 ? { arg: rest.join(' ') } : {}
      : positional !== undefined ? { arg: positional } : {},
    ...optionValue(rest, '--skill') !== undefined ? { skill: optionValue(rest, '--skill') } : {},
    ...scope !== undefined ? { scope: parseScope(scope) } : {},
  }
}

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  if (index < 0 || index + 1 >= tokens.length) return undefined
  return tokens[index + 1]!
}

function parseScope(value: string | undefined): InstallScope | undefined {
  if (value === undefined) return undefined
  if (value === 'temp' || value === 'project' || value === 'global') return value
  throw new Error(`${value} is not a valid scope (temp | project | global)`)
}

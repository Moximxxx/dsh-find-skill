/**
 * Model-facing tools: skill_find / skill_install / skill_remove.
 *
 * The tools are deliberately low-priority: their descriptions instruct the
 * model to use them only when no existing tool or loaded skill fits.
 *
 * @module dsh-find-skill/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config, InstallScope } from './config.ts'
import type { ManagedSkillProvider } from './provider.ts'
import type { TempSkillManager } from './temp.ts'
import { searchSkills } from './search.ts'
import { installSkill, removeSkill } from './install.ts'

const FIND_DESCRIPTION = 'Search the open agent-skills ecosystem (skills.sh) for installable skills. '
  + 'Use ONLY when no existing tool and no already-loaded skill can handle the user request. '
  + 'Returns remote candidates with install counts, sources, and local availability.'

const INSTALL_DESCRIPTION = 'Install a skill discovered by skill_find into a managed scope: '
  + 'temp (default; current session only), project (shared with the workspace), or global (all sessions). '
  + 'The installed skill immediately appears in the skill catalog and loads via the skill tool. '
  + 'If the user has not indicated a scope, ask them first via ask_user_question.'

const REMOVE_DESCRIPTION = 'Remove a skill previously installed by this plugin (temp/project/global). '
  + 'When no scope is given, temp is tried first, then project, then global.'

/** One candidate row in a skill_find result. */
export interface FindCandidateValue {
  readonly id: string
  readonly name: string
  readonly installs: number
  readonly source: string
  readonly url: string
  readonly installed: boolean
}

/**
 * Render skill_find results as model-facing prose.
 * @param query - the search query the results answer.
 * @param candidates - normalized candidate rows.
 * @returns the rendered text block.
 */
export function renderFindResults(query: string, candidates: FindCandidateValue[]): string {
  if (candidates.length === 0) return `${query} matched no skills on skills.sh`
  return candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.name} (${candidate.id}) — ${candidate.installs} installs, ${candidate.source}${candidate.installed ? ' [installed]' : ''}\n   ${candidate.url}`,
  ).join('\n')
}

/**
 * Render a successful install as model-facing prose.
 * @param name - installed skill name.
 * @param scope - installed scope.
 * @param path - absolute installed directory.
 * @param description - routing description.
 * @returns the rendered text block.
 */
export function renderInstallResult(name: string, scope: string, path: string, description: string): string {
  return `${name} installed (${scope}) at ${path}\n${description}`
}

/**
 * Render a successful removal as model-facing prose.
 * @param name - removed skill name.
 * @param scope - scope the skill was removed from.
 * @returns the rendered text block.
 */
export function renderRemoveResult(name: string, scope: string): string {
  return `${name} removed from ${scope}`
}

/**
 * Register the three model-facing tools.
 * @param ctx - host context whose tools registry receives the tools.
 * @param config - validated plugin configuration.
 * @param provider - managed provider for catalog invalidation.
 * @param tempManager - temporary skill lifecycle manager.
 */
export function registerTools(
  ctx: Context,
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
): void {
  if (config.registerFindTool !== false) {
    ctx.tools.register(defineTool({
      name: 'skill_find',
      description: FIND_DESCRIPTION,
      parameters: {
        query: { type: 'string', required: true, description: 'Search keywords for the skills.sh ecosystem search.' },
        limit: { type: 'number', description: 'Maximum candidates; defaults to the configured search limit.' },
        owner: { type: 'string', description: 'Optional GitHub owner filter (e.g. vercel-labs).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidates: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  installs: { type: 'number', required: true },
                  source: { type: 'string', required: true },
                  url: { type: 'string', required: true },
                  installed: { type: 'boolean', required: true },
                },
              },
            },
          },
        },
        render: (args, value) => [
          {
            type: 'text',
            text: renderFindResults(args.query, value.candidates),
          },
        ],
      },
      async execute(args, exec) {
        const limit = args.limit ?? config.searchLimit ?? 20
        const candidates = await searchSkills(
          config.searchApiBase ?? 'https://skills.sh',
          args.query,
          limit,
          args.owner,
          exec.signal,
        )
        const installedNames = new Set<string>([
          ...tempManager.list().map(entry => entry.name),
          ...(await provider.list({ cwd: exec.agent?.session.header.cwd, signal: exec.signal })).map(candidate => candidate.name),
        ])
        return {
          candidates: candidates.map(candidate => ({
            id: candidate.id,
            name: candidate.name,
            installs: candidate.installs,
            source: candidate.source,
            url: candidate.url,
            installed: installedNames.has(candidate.id) || installedNames.has(candidate.name),
          })),
        }
      },
      presentCall(args) {
        return { card: 'generic', title: `${args.query} on skills.sh`, kind: 'search' }
      },
    }))
  }

  if (config.registerInstallTool !== false) {
    ctx.tools.register(defineTool({
      name: 'skill_install',
      description: INSTALL_DESCRIPTION,
      parameters: {
        source: {
          type: 'string',
          required: true,
          description: 'Skill source: owner/repo, a full URL, or owner/repo@skill-name.',
        },
        skill: { type: 'string', description: 'Exact skill name to install when the source contains several.' },
        scope: {
          type: 'string',
          description: 'Target scope: temp (default), project, or global.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            installed: { type: 'boolean', required: true, const: true },
            name: { type: 'string', required: true },
            scope: { type: 'string', required: true },
            path: { type: 'string', required: true },
            description: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderInstallResult(value.name, value.scope, value.path, value.description),
          },
        ],
      },
      async execute(args, exec) {
        const scope = parseScope(args.scope)
        const agent = exec.agent
        return installSkill(
          ctx,
          config,
          provider,
          tempManager,
          scope,
          args.source,
          args.skill,
          agent?.session.header.cwd,
          exec.signal,
          agent?.session.header.id,
        )
      },
      presentCall(args) {
        return {
          card: 'generic',
          title: `${args.source}${args.skill !== undefined ? ' — ' + args.skill : ''}`,
          kind: 'edit',
        }
      },
    }))
  }

  if (config.registerRemoveTool !== false) {
    ctx.tools.register(defineTool({
      name: 'skill_remove',
      description: REMOVE_DESCRIPTION,
      parameters: {
        name: { type: 'string', required: true, description: 'Kebab-case skill name to remove.' },
        scope: { type: 'string', description: 'Scope to remove from: temp, project, or global.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            removed: { type: 'boolean', required: true, const: true },
            name: { type: 'string', required: true },
            scope: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: renderRemoveResult(value.name, value.scope) }],
      },
      async execute(args, exec) {
        return removeSkill(provider, tempManager, parseScope(args.scope), args.name, exec.agent?.session.header.cwd)
      },
      presentCall(args) {
        return { card: 'generic', title: `${args.name}`, kind: 'delete' }
      },
    }))
  }
}

function parseScope(value: string | undefined): InstallScope | undefined {
  if (value === undefined || value === '') return undefined
  if (value === 'temp' || value === 'project' || value === 'global') return value
  throw new Error(`${value} is not a valid scope (temp | project | global)`)
}

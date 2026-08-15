/**
 * Per-session skill panel support: disable shadows (session-local hiding of
 * project/global skills), session-scoped cleanup, and context loading.
 *
 * @module dsh-find-skill/panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SkillDefinition, SkillRegistration, SkillSummary } from '@deepseek-ai/dsh-skill'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Config } from './config.ts'
import type { ManagedSkillProvider } from './provider.ts'
import type { TempSkillManager } from './temp.ts'
import { resolveRoots } from './roots.ts'
import { parseSkillContent } from './frontmatter.ts'

/** Durable whole-value panel snapshot appended to the session log on change. */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-value skill panel state for the owning session. */
    'skill-panel/state': PanelListing
  }
}

/** Session append surface used by panel state publishing. */
export interface PanelSession {
  append(type: 'skill-panel/state', data: PanelListing): unknown
}

/**
 * Publish the panel state for one agent by appending a whole-value event to
 * its session log. The client renders the panel from this replayable stream.
 * @param agent - the owning agent whose session receives the snapshot.
 * @param config - validated plugin configuration.
 * @param provider - managed provider for project/global rows.
 * @param tempManager - temporary skill lifecycle manager.
 * @param panel - panel manager for disable state.
 */
export async function publishPanelState(
  ctx: Context,
  session: { header: { readonly cwd?: string; readonly id: string }; append: PanelSession['append'] },
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  panel: SessionSkillPanel,
): Promise<void> {
  const sessionId = String(session.header.id)
  const agents = ctx.get('agents') as { get: (id: unknown) => unknown } | undefined
  const agent = agents?.get(sessionId)
  const skills = ctx.get('skills') as { list: (o: unknown) => Promise<readonly SkillSummary[]> } | undefined
  const summaries = skills === undefined || agent === undefined
    ? []
    : await skills.list({ cwd: session.header.cwd, scope: agent })
  const listing = await buildPanelListing(
    config,
    provider,
    tempManager,
    panel,
    session.header.cwd,
    sessionId,
    summaries,
  )
  session.append('skill-panel/state', listing)
}
/** One row of the panel's per-level skill listing. */
export interface PanelSkillRow {
  readonly name: string
  readonly description: string
  readonly level: 'temp' | 'project' | 'global'
  readonly disabled: boolean
  /** Short owning-session id for temp rows (UI and agent sessions differ). */
  readonly owner?: string
  /** Absolute skill directory (drives path-based load, independent of cwd). */
  readonly path: string
}

/** The panel's full listing grouped by level. */
export interface PanelListing {
  readonly levels: {
    readonly temp: readonly PanelSkillRow[]
    readonly project: readonly PanelSkillRow[]
    readonly global: readonly PanelSkillRow[]
  }
  /** Session cwd recorded with the snapshot (name-based load fallback). */
  readonly cwd: string
}

/** Structural agent view used by panel operations. */
export interface PanelAgent {
  readonly ctx: Context
  readonly session: { readonly header: { readonly cwd?: string; readonly id: string } }
  inject(message: unknown): void
}

/**
 * Build the panel listing for one session: temp rows from the lifecycle
 * manager, plus the full merged registry view for project/global levels
 * (native roots like .dsh/skills and managed roots alike).
 * @param config - validated plugin configuration.
 * @param provider - managed provider for managed rows and paths.
 * @param tempManager - temporary skill lifecycle manager.
 * @param panel - panel manager for disable state.
 * @param cwd - workspace selector for managed roots.
 * @param sessionId - the viewing session (disable state key).
 * @param summaries - merged registry summaries for native roots.
 * @returns the three-level listing.
 */
export async function buildPanelListing(
  config: Config,
  provider: ManagedSkillProvider,
  tempManager: TempSkillManager,
  panel: SessionSkillPanel,
  cwd: string | undefined,
  sessionId: string,
  summaries: readonly SkillSummary[] = [],
): Promise<PanelListing> {
  const roots = resolveRoots(config, cwd)
  const summaryBy = new Map(summaries.map(summary => [summary.name, summary]))
  const tempRows: PanelSkillRow[] = []
  for (const entry of tempManager.list()) {
    // The UI session id and the agent session id differ in the web app, so
    // filtering by owner hides skills the user installed moments ago. List
    // every live temp skill; dsh's scoped registry keeps the model-visible
    // isolation, and the panel is a management view with an owner hint.
    void sessionId
    let description = ''
    try {
      const parsed = parseSkillContent(await readFile(join(entry.dir, 'SKILL.md'), 'utf8'), entry.dir)
      description = parsed.description
    } catch {
      // Missing or invalid SKILL.md still renders the row without a description.
    }
    tempRows.push({
      name: entry.name,
      description,
      level: 'temp',
      disabled: panel.isDisabled(sessionId, entry.name),
      ...entry.owner !== undefined ? { owner: entry.owner.replace(/^session-/, '').slice(0, 8) } : {},
      path: entry.dir,
    })
  }
  const managedBy = new Map((await provider.list({ cwd })).map(candidate => [candidate.name, candidate]))
  const projectRows: PanelSkillRow[] = []
  const globalRows: PanelSkillRow[] = []
  for (const summary of summaries) {
    if (summary.name === '') continue
    const managed = managedBy.get(summary.name)
    if (managed !== undefined) {
      // Managed entries carry absolute paths and take precedence over bare summaries.
      const dir = dirname(managed.path ?? '')
      const level: 'project' | 'global' = dir.startsWith(roots.projectSkillDir) ? 'project' : 'global'
      ;(level === 'project' ? projectRows : globalRows).push({
        name: managed.name,
        description: managed.description,
        level,
        disabled: panel.isDisabled(sessionId, managed.name),
        path: dir,
      })
      continue
    }
    // Native roots (.dsh/skills, .agents/skills, user roots): no path;
    // load falls back to name + recorded cwd.
    const level: 'project' | 'global' = summary.source.startsWith('project') ? 'project' : 'global'
    ;(level === 'project' ? projectRows : globalRows).push({
      name: summary.name,
      description: summary.description,
      level,
      disabled: panel.isDisabled(sessionId, summary.name),
      path: '',
    })
  }
  // Managed entries missing from the merged view (registry anomaly fallback).
  for (const candidate of managedBy.values()) {
    if (summaryBy.has(candidate.name)) continue
    const dir = dirname(candidate.path ?? '')
    const level: 'project' | 'global' = dir.startsWith(roots.projectSkillDir) ? 'project' : 'global'
    ;(level === 'project' ? projectRows : globalRows).push({
      name: candidate.name,
      description: candidate.description,
      level,
      disabled: panel.isDisabled(sessionId, candidate.name),
      path: dir,
    })
  }
  return {
    levels: {
      temp: tempRows,
      project: projectRows,
      global: globalRows,
    },
    cwd: cwd ?? '',
  }
}

export class SessionSkillPanel {
  /** session id -> skill name -> shadow disposer. */
  private readonly disabled = new Map<string, Map<string, () => void>>()

  /**
   * Create the panel manager.
   * @param ctx - host context (used for lookups and diagnostics).
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Whether a skill is disabled for one session.
   * @param sessionId - owning session id.
   * @param name - skill name.
   * @returns whether a disable shadow is active.
   */
  isDisabled(sessionId: string, name: string): boolean {
    return this.disabled.get(sessionId)?.has(name) ?? false
  }

  /**
   * Disable a project/global skill for one session by registering an
   * agent-layer shadow with both invocation flags off.
   * @param agent - the session's agent (scoped context for the shadow).
   * @param sessionId - owning session id.
   * @param name - skill name to disable.
   * @returns an error message when the shadow cannot be registered, else undefined.
   */
  async disable(agent: PanelAgent, sessionId: string, name: string): Promise<string | undefined> {
    const register = (agent.ctx.get('skills') as { register: (skill: SkillRegistration) => () => void } | undefined)?.register
    if (register === undefined) return 'skills service unavailable for this agent'
    const disposer = register({
      name,
      description: 'disabled in this session by dsh-find-skill',
      content: '',
      source: 'custom',
      invocation: { modelInvocable: false, userInvocable: false },
    })
    let session = this.disabled.get(sessionId)
    if (session === undefined) {
      session = new Map()
      this.disabled.set(sessionId, session)
    }
    session.get(name)?.()
    session.set(name, disposer)
    return undefined
  }

  /**
   * Re-enable a disabled skill for one session.
   * @param sessionId - owning session id.
   * @param name - skill name to re-enable.
   * @returns whether a shadow was active.
   */
  enable(sessionId: string, name: string): boolean {
    const session = this.disabled.get(sessionId)
    const disposer = session?.get(name)
    if (disposer === undefined) return false
    session!.delete(name)
    disposer()
    return true
  }

  /**
   * Dispose every shadow owned by one session.
   * @param sessionId - the ended session id.
   */
  disposeSession(sessionId: string): void {
    const session = this.disabled.get(sessionId)
    if (session === undefined) return
    this.disabled.delete(sessionId)
    for (const disposer of session.values()) disposer()
  }

  /**
   * Load a skill into the agent's latest context (durable injection), reading
   * the skill body directly from its directory so no cwd/scope resolution can
   * miss it.
   * @param agent - the session's agent receiving the injected content.
   * @param name - skill name for the injected label.
   * @param dir - absolute skill directory containing SKILL.md.
   * @returns an error message when the skill cannot be read, else undefined.
   */
  /**
   * Load a skill by name through the registry (fallback for non-managed
   * skills whose directories the panel does not know).
   * @param agent - the session's agent receiving the injected content.
   * @param name - skill name to load.
   * @param cwd - workspace selector recorded with the panel snapshot.
   * @returns an error message when the skill cannot be resolved, else undefined.
   */
  async loadByName(agent: PanelAgent, name: string, cwd: string): Promise<string | undefined> {
    const skills = agent.ctx.get('skills') as { get: (n: string, o: unknown) => Promise<SkillDefinition | undefined> } | undefined
    if (skills === undefined) return 'skills service unavailable for this agent'
    const skill = await skills.get(name, { cwd: cwd === '' ? undefined : cwd, scope: agent })
    if (skill === undefined) return `skill ${name} is unknown or no longer available`
    try {
      agent.inject(createUserMessage({
        content: [{
          type: 'text',
          text: renderSkillContent({
            name: skill.name,
            provider: skill.provider,
            ...skill.resourceBase !== undefined ? { resourceBase: skill.resourceBase } : {},
            content: skill.content,
          }),
        }],
        source: { kind: 'plugin', plugin: 'dsh-find-skill' },
      }))
    } catch (error) {
      return `failed to inject: ${error instanceof Error ? error.message : String(error)}`
    }
    return undefined
  }

  async loadFromPath(agent: PanelAgent, name: string, dir: string): Promise<string | undefined> {
    try {
      const parsed = parseSkillContent(await readFile(join(dir, 'SKILL.md'), 'utf8'), dir)
      try {
        agent.inject(createUserMessage({
          content: [{
            type: 'text',
            text: renderSkillContent({
              name: parsed.name,
              provider: 'dsh-find-skill',
              resourceBase: { kind: 'directory', path: dir },
              content: parsed.content,
            }),
          }],
          source: { kind: 'plugin', plugin: 'dsh-find-skill' },
        }))
      } catch (error) {
        return `failed to inject: ${error instanceof Error ? error.message : String(error)}`
      }
      return undefined
    } catch {
      return `skill ${name} is unknown or no longer available`
    }
  }
}

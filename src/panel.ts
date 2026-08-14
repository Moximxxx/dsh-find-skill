/**
 * Per-session skill panel support: disable shadows (session-local hiding of
 * project/global skills), session-scoped cleanup, and context loading.
 *
 * @module dsh-find-skill/panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SkillDefinition, SkillRegistration } from '@deepseek-ai/dsh-skill'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Structural agent view used by panel operations. */
export interface PanelAgent {
  readonly ctx: Context
  readonly session: { readonly header: { readonly cwd?: string; readonly id: string } }
  inject(message: unknown): void
}

/** One row of the panel's per-level skill listing. */
export interface PanelSkillRow {
  readonly name: string
  readonly description: string
  readonly level: 'temp' | 'project' | 'global'
  readonly disabled: boolean
}

/** The panel's full listing grouped by level. */
export interface PanelListing {
  readonly levels: {
    readonly temp: readonly PanelSkillRow[]
    readonly project: readonly PanelSkillRow[]
    readonly global: readonly PanelSkillRow[]
  }
}

/**
 * Tracks per-session disable shadows and context loads for the web skill
 * panel. Shadows are agent-layer runtime registrations with both invocation
 * flags off, which win over global-layer provider candidates for the owning
 * agent only; disposing the shadow re-enables the skill for that session.
 */
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
   * Load a skill into the agent's latest context (durable injection).
   * @param agent - the session's agent receiving the injected content.
   * @param name - skill name to load.
   * @returns an error message when the skill cannot be resolved, else undefined.
   */
  async load(agent: PanelAgent, name: string): Promise<string | undefined> {
    const skills = agent.ctx.get('skills') as { get: (n: string, o: unknown) => Promise<SkillDefinition | undefined> } | undefined
    if (skills === undefined) return 'skills service unavailable for this agent'
    const skill = await skills.get(name, { cwd: agent.session.header.cwd, scope: agent })
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
}

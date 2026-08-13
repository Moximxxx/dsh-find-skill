/**
 * Web client contribution for dsh-find-skill: conversation cards for the
 * skill_find / skill_install / skill_remove tool calls.
 *
 * @module dsh-find-skill-client/client
 */

import { createElement } from 'react'
import type {
  ClientContext,
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Which plugin tool produced this card. */
export type SkillToolAction = 'find' | 'install' | 'remove'

/** Replayable card data for one skill tool call. */
export interface SkillCallData {
  /** The tool that was called. */
  readonly action: SkillToolAction
  /** Parsed tool arguments (query/source/skill/scope/name). */
  readonly args: Readonly<Record<string, unknown>>
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'dsh-find-skill': SkillCallData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'dsh-find-skill': SkillCallData
  }
}

const TOOL_ACTIONS: Record<string, SkillToolAction> = {
  skill_find: 'find',
  skill_install: 'install',
  skill_remove: 'remove',
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
  } catch {
    // Malformed arguments still render a card with empty args.
  }
  return {}
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

const skillCallDefinition: ConversationNodeDefinition<SkillCallData> = {
  kind: 'dsh-find-skill',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'tool/call') return null
    const action = TOOL_ACTIONS[event.data.name]
    if (action === undefined) return null
    return { id: String(event.data.callId), role: 'start' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') throw new Error('dsh-find-skill requires tool/call')
    return {
      action: TOOL_ACTIONS[match.event.data.name]!,
      args: parseArguments(match.event.data.arguments),
    }
  },
  update: (context) => context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'dsh-find-skill',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

function titleOf(data: SkillCallData): string {
  const args = data.args
  switch (data.action) {
    case 'find':
      return `Search skills: ${String(args.query ?? '')}`
    case 'install':
      return `Install skill: ${String(args.source ?? '')}${args.scope !== undefined ? ' (' + String(args.scope) + ')' : ''}`
    case 'remove':
      return `Remove skill: ${String(args.name ?? '')}${args.scope !== undefined ? ' (' + String(args.scope) + ')' : ''}`
  }
}

function SkillCallNodeView({ node }: ChatNodeViewProps<'dsh-find-skill'>) {
  const title = titleOf(node.data)
  return createElement('div', { style: { padding: '4px 0' } },
    createElement('strong', null, title),
    createElement('div', { style: { opacity: 0.7, fontSize: 12 } }, node.data.action),
  )
}

/** Client services required by this plugin. */
export const inject = ['conversationEvents', 'slots']

/**
 * Register the skill tool card node and its keyed chat renderer.
 * @param ctx - the client context hosting this plugin.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(skillCallDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'dsh-find-skill',
  }, SkillCallNodeView))
}

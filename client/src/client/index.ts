/**
 * Web client contribution for dsh-find-skill: conversation cards for the
 * skill_find / skill_install / skill_remove tool calls.
 *
 * @module dsh-find-skill-client/client
 */

import { createElement, useEffect, useState } from 'react'
import type { CSSProperties as ReactCSSProperties } from 'react'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const React = { CSSProperties: undefined }
import type {
  ClientContext,
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Locale namespace for this client plugin. */
export const NS = 'dsh-find-skill'

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
      return '🔍 ' + String(args.query ?? '')
    case 'install':
      return '📦 ' + String(args.source ?? '') + (args.scope !== undefined ? ' (' + String(args.scope) + ')' : '')
    case 'remove':
      return '🗑 ' + String(args.name ?? '') + (args.scope !== undefined ? ' (' + String(args.scope) + ')' : '')
  }
}

function SkillCallNodeView({ node }: ChatNodeViewProps<'dsh-find-skill'>) {
  return createElement('div', { style: { padding: '4px 0' } },
    createElement('strong', null, titleOf(node.data)),
    createElement('div', { style: { opacity: 0.7, fontSize: 12 } }, 'skill tool · ' + node.data.action),
  )
}

/** Client services required by this plugin. */
export const inject = ['conversationEvents', 'slots', 'remote', 'remote.commands']

/**
 * Register the skill tool card node and its keyed chat renderer.
 * @param ctx - the client context hosting this plugin.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(skillCallDefinition)
  registerSkillPanel(ctx)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'dsh-find-skill',
    // The slot's t seat is bound to the conversation namespace; this plugin
    // renders plain strings and does not call t.
    locale: 'conversation',
  }, SkillCallNodeView))
}

/** One row of the skill panel listing. */
export interface PanelRow {
  readonly name: string
  readonly description: string
  readonly level: 'temp' | 'project' | 'global'
  readonly disabled: boolean
}

/** Actions the skill panel face injects per session. */
export interface SkillPanelActions {
  /** Refresh the listing from the host. */
  list(): Promise<PanelRow[]>
  /** Run one /skill command line and return its result text. */
  run(line: string): Promise<string>
}

function flattenListing(raw: string): PanelRow[] {
  try {
    const parsed = JSON.parse(raw) as {
      levels?: { temp?: PanelRow[]; project?: PanelRow[]; global?: PanelRow[] }
    }
    return [
      ...(parsed.levels?.temp ?? []),
      ...(parsed.levels?.project ?? []),
      ...(parsed.levels?.global ?? []),
    ]
  } catch {
    return []
  }
}

function rowLabel(row: PanelRow): string {
  const levelLabel = row.level === 'temp' ? '临时' : row.level === 'project' ? '项目' : '全局'
  return levelLabel + ' · ' + row.name + (row.disabled ? '（已禁用）' : '')
}

const btnStyle: ReactCSSProperties = {
  fontSize: 12,
  padding: '2px 8px',
  cursor: 'pointer',
  borderRadius: 4,
  border: '1px solid rgba(128,128,128,0.4)',
  background: 'transparent',
}

function SkillPanelView({ list, run }: SkillPanelActions) {
  const [rows, setRows] = useState<PanelRow[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const refresh = async () => {
    setLoading(true)
    setRows(await list())
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])
  const act = async (line: string) => {
    setNotice(await run(line))
    await refresh()
  }
  return createElement('div', { style: { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid rgba(128,128,128,0.2)' } },
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      createElement('strong', null, '技能面板'),
      createElement('button', { onClick: () => void refresh(), style: btnStyle }, '刷新'),
    ),
    loading ? createElement('div', null, '加载中…') : rows.length === 0
      ? createElement('div', { style: { opacity: 0.6 } }, '暂无技能')
      : rows.map(row => createElement('div', { key: row.name, style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
          createElement('span', { style: { flex: 1 } }, rowLabel(row)),
          createElement('button', { onClick: () => void act(`/skill load ${row.name}`), style: btnStyle }, '加载'),
          row.level === 'temp'
            ? createElement('button', { onClick: () => void act(`/skill remove ${row.name} --scope temp`), style: btnStyle }, '移除')
            : row.disabled
              ? createElement('button', { onClick: () => void act(`/skill enable ${row.name}`), style: btnStyle }, '启用')
              : createElement('button', { onClick: () => void act(`/skill disable ${row.name}`), style: btnStyle }, '禁用'),
        )),
    notice === '' ? null : createElement('div', { style: { marginTop: 4, opacity: 0.7 } }, notice),
  )
}

function registerSkillPanel(ctx: ClientContext): void {
  const runCommand = async (sessionId: SessionId, line: string): Promise<string> => {
    const result = await ctx.remote.commands.execute(sessionId, line)
    if (!result.ok) {
      const detail = result.error.message ?? 'unknown'
      return '执行失败: ' + String(detail)
    }
    const text = result.value?.result?.text
    return text === undefined ? '(无输出)' : text
  }
  const listFor = async (sessionId: SessionId): Promise<PanelRow[]> =>
    flattenListing(await runCommand(sessionId, '/skill panel'))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'skill-panel',
    order: 20,
    locale: 'conversation',
    inject: (sessionId): SkillPanelActions => ({
      list: () => listFor(sessionId),
      run: (line) => runCommand(sessionId, line),
    }),
  }, SkillPanelView))
}

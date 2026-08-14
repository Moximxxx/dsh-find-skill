/**
 * Web client contribution for dsh-find-skill: conversation cards for the
 * skill_find / skill_install / skill_remove tool calls, plus the floating
 * skill management panel driven by durable skill-panel/state session events.
 *
 * @module dsh-find-skill/client
 */

import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties as ReactCSSProperties } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconRefreshOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SkillPanel.module.css'
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
  readonly action: SkillToolAction
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

/** One row of the skill panel listing. */
export interface PanelRow {
  readonly name: string
  readonly description: string
  readonly level: 'temp' | 'project' | 'global'
  readonly disabled: boolean
  readonly owner?: string
  readonly path: string
}

/** Host-side panel listing shape mirrored from the session event stream. */
export interface PanelListing {
  readonly levels: {
    readonly temp: readonly PanelRow[]
    readonly project: readonly PanelRow[]
    readonly global: readonly PanelRow[]
  }
}

/** Latest panel snapshot delivered by skill-panel/state session events. */
let panelState: PanelListing | null = null
const stateListeners = new Set<(state: PanelListing) => void>()

function publishState(state: PanelListing): void {
  panelState = state
  for (const listener of stateListeners) listener(state)
}

/** Subscribe to panel state updates (immediate delivery of the latest state). */
export function addPanelStateListener(listener: (state: PanelListing) => void): void {
  stateListeners.add(listener)
  if (panelState !== null) listener(panelState)
}

/** Unsubscribe from panel state updates. */
export function removePanelStateListener(listener: (state: PanelListing) => void): void {
  stateListeners.delete(listener)
}

/** Replayable conversation definition consuming the host's panel snapshots. */
const panelStateDefinition: ConversationNodeDefinition<PanelListing> = {
  kind: 'dsh-find-skill-panel-state',
  match: (event) => {
    // 每个快照事件独立 id（同一 id 的重复 start 会被引擎忽略，后续快照就丢了）。
    if ((event as { type: string }).type !== 'skill-panel/state') return null
    return { id: String((event as { seq: number }).seq), role: 'start' }
  },
  start: (_context, match) => {
    const state = match.event.data as unknown as PanelListing
    publishState(state)
    return state
  },
  update: (context) => {
    publishState(context.state)
    return context.state
  },
  publication: () => 'none',
}

/** Actions the skill panel face injects per session. */
export interface SkillPanelActions {
  /** Owning session id (refresh key). */
  readonly sessionId: string
  /** Run one /skill command line and return its result text. */
  run(line: string): Promise<string>
}

const LEVEL_LABELS: Record<PanelRow['level'], string> = { global: '全局', project: '项目', temp: '临时' }
const POSITION_KEY = 'dsh-find-skill.panel.position'

interface PanelPosition { readonly left: number; readonly bottom: number }

function readPosition(): PanelPosition | undefined {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as { left?: unknown; bottom?: unknown }
    if (typeof parsed.left === 'number' && typeof parsed.bottom === 'number') {
      return { left: parsed.left, bottom: parsed.bottom }
    }
  } catch {
    // Corrupt saved position falls back to the anchored default.
  }
  return undefined
}

function SkillPanelView({ sessionId, run }: SkillPanelActions) {
  const [listing, setListing] = useState<PanelListing | null>(panelState)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<PanelRow['level'], boolean>>({ global: false, project: false, temp: false })
  const [position, setPosition] = useState<PanelPosition | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const rows = listing === null ? [] : [
    ...listing.levels.temp,
    ...listing.levels.project,
    ...listing.levels.global,
  ]

  useLayoutEffect(() => {
    const saved = readPosition()
    if (saved !== undefined) {
      setPosition(saved)
      return
    }
    const element = rootRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    setPosition({ left: rect.left, bottom: window.innerHeight - rect.bottom })
  }, [])

  useEffect(() => {
    const listener = (state: PanelListing) => { setListing(state) }
    addPanelStateListener(listener)
    setListing(panelState)
    return () => removePanelStateListener(listener)
  }, [sessionId])

  const refresh = () => {
    setLoading(true)
    setListing(panelState)
    setLoading(false)
  }

  const act = async (line: string) => {
    try {
      setNotice(await run(line))
    } catch (cause) {
      setNotice('执行失败: ' + (cause instanceof Error ? cause.message : String(cause)))
    }
    refresh()
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const origin = position ?? { left: 0, bottom: 0 }
    const startX = event.clientX
    const startY = event.clientY
    const baseLeft = origin.left
    const baseBottom = origin.bottom
    const move = (moveEvent: PointerEvent) => {
      const left = Math.max(0, baseLeft + moveEvent.clientX - startX)
      const bottom = Math.max(0, baseBottom - (moveEvent.clientY - startY))
      setPosition({ left, bottom })
    }
    const up = (upEvent: PointerEvent) => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      const left = Math.max(0, baseLeft + upEvent.clientX - startX)
      const bottom = Math.max(0, baseBottom - (upEvent.clientY - startY))
      try { localStorage.setItem(POSITION_KEY, JSON.stringify({ left, bottom })) } catch { /* storage unavailable */ }
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const toggleLevel = (level: PanelRow['level']) => {
    setCollapsed(previous => ({ ...previous, [level]: !previous[level] }))
  }

  return createElement('div', {
    ref: rootRef,
    className: css.panel,
    style: position === undefined
      ? { visibility: 'hidden' }
      : { left: position.left, bottom: position.bottom },
  },
    createElement('div', { className: css.titlebar, onPointerDown: startDrag },
      createElement('strong', { className: css.title }, '技能面板'),
      createElement('button', {
        className: css.iconButton,
        title: '恢复默认位置',
        onClick: () => {
          try { localStorage.removeItem(POSITION_KEY) } catch { /* storage unavailable */ }
          setPosition(undefined)
          const element = rootRef.current
          if (element !== null) {
            const rect = element.getBoundingClientRect()
            setPosition({ left: rect.left, bottom: window.innerHeight - rect.bottom })
          }
        },
      }, createElement(IconChevronRightOutline14)),
      createElement('button', {
        className: css.iconButton,
        title: '刷新',
        disabled: loading,
        onClick: refresh,
      }, createElement(IconRefreshOutline14)),
    ),
    loading
      ? createElement('div', { className: css.stateLine }, rows.length === 0 ? '加载中…' : null)
      : ['global', 'project', 'temp'].map(level => {
          const levelRows = rows.filter(row => row.level === level)
          const levelCollapsed = collapsed[level as PanelRow['level']]
          return createElement('section', { key: level, className: css.section },
            createElement('button', {
              className: css.sectionHeader,
              onClick: () => toggleLevel(level as PanelRow['level']),
            },
              createElement(levelCollapsed ? IconChevronRightOutline14 : IconChevronDownOutline14),
              createElement('span', null, LEVEL_LABELS[level as PanelRow['level']] + '技能'),
              createElement('span', { className: css.count }, String(levelRows.length)),
            ),
            levelCollapsed ? null : levelRows.length === 0
              ? createElement('div', { className: css.emptyLine }, '暂无')
              : levelRows.map(row => createElement('div', { key: row.name, className: css.row },
                  createElement('span', {
                    className: css.rowName,
                    title: row.description === '' ? row.name : row.name + '：' + row.description,
                  }, row.name + (row.disabled ? '（已禁用）' : '') + (row.owner !== undefined ? ' @' + row.owner : '')),
                  createElement('button', { className: css.actionButton, onClick: () => void act(`/skill load ${row.name} --path ${row.path}`) }, '加载'),
                  row.level === 'temp'
                    ? createElement('button', { className: css.actionButton, onClick: () => void act(`/skill remove ${row.name} --scope temp`) }, '移除')
                    : row.disabled
                      ? createElement('button', { className: css.actionButton, onClick: () => void act(`/skill enable ${row.name}`) }, '启用')
                      : createElement('button', { className: css.actionButton, onClick: () => void act(`/skill disable ${row.name}`) }, '禁用'),
                )),
          )
        }),
    notice === '' ? null : createElement('div', { className: css.stateLine }, notice),
  )
}

function registerSkillPanel(ctx: ClientContext): void {
  const runCommand = async (sessionId: SessionId, line: string): Promise<string> => {
    const result = await ctx.remote.commands.execute(sessionId, line)
    if (!result.ok) {
      const code = 'code' in result.error ? String(result.error.code) : 'unknown'
      const detail = result.error.message ?? 'unknown'
      throw new Error(code + ': ' + String(detail))
    }
    const text = result.value?.result?.text
    return text === undefined ? '(无输出)' : text
  }

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'skill-panel',
    order: 20,
    locale: 'conversation',
    inject: (sessionId): SkillPanelActions => ({
      sessionId: String(sessionId),
      run: (line) => runCommand(sessionId, line),
    }),
  }, SkillPanelView))
}

/** Client services required by this plugin. */
export const inject = ['conversationEvents', 'slots', 'remote', 'remote.commands']

/**
 * Register the skill tool card node, the panel state consumer, and the
 * keyed dock renderer.
 * @param ctx - the client context hosting this plugin.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(skillCallDefinition)
  ctx.conversationEvents.register(panelStateDefinition)
  registerSkillPanel(ctx)
}

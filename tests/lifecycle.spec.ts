import { describe, expect, it, vi } from 'vitest'
import { applyCompactPolicy } from '../src/lifecycle.ts'
import { Config } from '../src/config.ts'

describe('applyCompactPolicy', () => {
  it('dispose policy disposes the session owner', async () => {
    const disposeOwned = vi.fn(async () => true)
    const ask = vi.fn(async () => true)
    await applyCompactPolicy('dispose', 'session-1', disposeOwned, ask)
    expect(disposeOwned).toHaveBeenCalledWith('session-1')
    expect(ask).not.toHaveBeenCalled()
  })

  it('keep policy does nothing', async () => {
    const disposeOwned = vi.fn(async () => true)
    const ask = vi.fn(async () => true)
    await applyCompactPolicy('keep', 'session-1', disposeOwned, ask)
    expect(disposeOwned).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })

  it('ask policy disposes when the user chooses cleanup', async () => {
    const disposeOwned = vi.fn(async () => true)
    const ask = vi.fn(async () => true)
    await applyCompactPolicy('ask', 'session-1', disposeOwned, ask)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(disposeOwned).toHaveBeenCalledWith('session-1')
  })

  it('ask policy keeps skills when the user declines', async () => {
    const disposeOwned = vi.fn(async () => true)
    const ask = vi.fn(async () => false)
    await applyCompactPolicy('ask', 'session-1', disposeOwned, ask)
    expect(disposeOwned).not.toHaveBeenCalled()
  })

  it('ask policy fails closed when the ask errors', async () => {
    const disposeOwned = vi.fn(async () => true)
    const ask = vi.fn(async () => { throw new Error('no answerer') })
    await expect(applyCompactPolicy('ask', 'session-1', disposeOwned, ask)).resolves.toBeUndefined()
    expect(disposeOwned).not.toHaveBeenCalled()
  })
})

describe('compactDisposePolicy config', () => {
  it('accepts ask as a valid policy', () => {
    expect(Config({ compactDisposePolicy: 'ask' }).compactDisposePolicy).toBe('ask')
    expect(Config({}).compactDisposePolicy).toBe('keep')
    expect(() => Config({ compactDisposePolicy: 'bogus' as never })).toThrow()
  })
})

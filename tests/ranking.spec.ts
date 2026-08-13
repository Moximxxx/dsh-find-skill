import { describe, expect, it } from 'vitest'
import { rankCandidates, DEFAULT_PRIORITY_SOURCES } from '../src/search.ts'
import { Config } from '../src/config.ts'

const cand = (id: string, source: string, installs: number) => ({
  id, name: id, installs, source, url: 'https://skills.sh/' + source + '/' + id,
})

describe('rankCandidates', () => {
  it('boosts priority sources before others, then sorts by installs', () => {
    const ranked = rankCandidates([
      cand('a', 'random-org/skills', 999999),
      cand('b', 'vercel-labs/agent-skills', 100),
      cand('c', 'anthropics/skills', 500),
      cand('d', 'microsoft/skills', 50),
    ], DEFAULT_PRIORITY_SOURCES)
    expect(ranked.map(c => c.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('keeps relative order for equal keys (stable)', () => {
    const ranked = rankCandidates([
      cand('a', 'x/y', 10),
      cand('b', 'x/y', 20),
    ], [])
    expect(ranked.map(c => c.id)).toEqual(['b', 'a'])
  })

  it('matches owners case-insensitively', () => {
    const ranked = rankCandidates([cand('a', 'VERCEL-LABS/s', 1), cand('b', 'other/s', 2)], ['vercel-labs'])
    expect(ranked.map(c => c.id)).toEqual(['a', 'b'])
  })
})

describe('prioritySources config', () => {
  it('defaults to the official list and accepts overrides', () => {
    expect(Config({}).prioritySources).toEqual(DEFAULT_PRIORITY_SOURCES)
    expect(Config({ prioritySources: ['vercel-labs'] }).prioritySources).toEqual(['vercel-labs'])
  })
})

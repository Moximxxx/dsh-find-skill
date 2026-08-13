import { describe, expect, it, vi, afterEach } from 'vitest'
import { searchSkills } from '../src/search.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('searchSkills', () => {
  it('queries the API and normalizes candidates', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skills: [
          { id: 'react-best-practices', name: 'React Best Practices', installs: 185000, source: 'vercel-labs/agent-skills' },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const candidates = await searchSkills('https://skills.sh', 'react performance', 20)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://skills.sh/api/search?q=react+performance&limit=20',
      { signal: undefined },
    )
    expect(candidates).toEqual([
      {
        id: 'react-best-practices',
        name: 'React Best Practices',
        installs: 185000,
        source: 'vercel-labs/agent-skills',
        url: 'https://skills.sh/vercel-labs/agent-skills/react-best-practices',
      },
    ])
  })

  it('returns an empty list on non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await searchSkills('https://skills.sh', 'x', 5)).toEqual([])
  })
})

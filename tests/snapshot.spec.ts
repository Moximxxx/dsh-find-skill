import { describe, expect, it } from 'vitest'
import { renderFindResults, renderInstallResult, renderRemoveResult } from '../src/tools.ts'

describe('tool render snapshots', () => {
  it('renders find results with mixed availability', () => {
    const text = renderFindResults('react performance', [
      { id: 'react-best-practices', name: 'React Best Practices', installs: 185000, source: 'vercel-labs/agent-skills', url: 'https://skills.sh/vercel-labs/agent-skills/react-best-practices', installed: false },
      { id: 'react-performance', name: 'React Performance', installs: 3239, source: 'affaan-m/ecc', url: 'https://skills.sh/affaan-m/ecc/react-performance', installed: true },
    ])
    expect(text).toMatchSnapshot()
  })

  it('renders an empty find result', () => {
    expect(renderFindResults('zzz-nothing', [])).toMatchSnapshot()
  })

  it('renders an install result', () => {
    expect(renderInstallResult('vercel-react-best-practices', 'temp', '/tmp/roots/tmp/vercel-react-best-practices', 'React and Next.js performance guidance.')).toMatchSnapshot()
  })

  it('renders a remove result', () => {
    expect(renderRemoveResult('web-design-guidelines', 'project')).toMatchSnapshot()
  })
})

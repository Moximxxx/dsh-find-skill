/**
 * End-to-end smoke test: real skills.sh API search plus a real CLI install
 * into managed roots. Network required; not part of the unit suite.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchSkills } from '../lib/search.js'
import { installSkill, removeSkill, updateSkill } from '../lib/install.js'
import { ManagedSkillProvider } from '../lib/provider.js'
import { TempSkillManager } from '../lib/temp.js'
import { Config } from '../lib/config.js'
import { resolveRoots } from '../lib/roots.js'

const base = join(tmpdir(), 'dsh-find-skill-smoke')
rmSync(base, { recursive: true, force: true })
mkdirSync(join(base, 'proj', '.git'), { recursive: true })

const config = Config({
  tempSkillRoot: join(base, 'tmp'),
  globalSkillRoot: join(base, 'global'),
})

const provider = new ManagedSkillProvider(config, () => {})
const roots = resolveRoots(config, join(base, 'proj'))
const tempManager = new TempSkillManager(() => () => {}, roots.tempSkillDir)

// 1) 真实搜索
console.log('== search: react performance ==')
const candidates = await searchSkills('https://skills.sh', 'react performance', 5)
console.log(candidates.map(c => `- ${c.name} (${c.id}) [${c.installs}] ${c.source}`).join('\n'))
if (candidates.length === 0) throw new Error('search returned nothing')

// 2) 真实 CLI 安装到 temp
console.log('\n== install via npx skills (temp) ==')
const installed = await installSkill(
  () => () => {},
  config, provider, tempManager, 'temp',
  'vercel-labs/agent-skills', 'vercel-react-best-practices',
  join(base, 'proj'),
)
console.log('installed:', JSON.stringify(installed))
if (!installed.installed) throw new Error('install failed')

// 3) provider 应该能看到它（temp 走 runtime 注册，project/global 走 provider）
console.log('\n== provider list ==')
const listed = await provider.list({ cwd: join(base, 'proj') })
console.log('provider candidates:', listed.map(c => c.name))

// 4) 再装一个 project 作用域，验证 provider 能看到
console.log('\n== install (project) ==')
const installedProject = await installSkill(
  () => () => {},
  config, provider, tempManager, 'project',
  'vercel-labs/agent-skills', 'web-design-guidelines',
  join(base, 'proj'),
)
console.log('installed:', JSON.stringify(installedProject))
const listed2 = await provider.list({ cwd: join(base, 'proj') })
console.log('provider candidates after project install:', listed2.map(c => c.name))
if (!listed2.some(c => c.name === 'web-design-guidelines')) throw new Error('provider does not see project skill')

// 5) update（重新拉取同一来源替换）
console.log('\\n== update (project) ==')
const updated = await updateSkill(
  () => () => {},
  config, provider, tempManager, 'project', 'web-design-guidelines',
  join(base, 'proj'),
)
console.log('updated:', JSON.stringify(updated))
if (!updated.updated) throw new Error('update failed')
const listedAfterUpdate = await provider.list({ cwd: join(base, 'proj') })
if (!listedAfterUpdate.some(c => c.name === 'web-design-guidelines')) throw new Error('provider lost skill after update')

// 6) 移除
console.log('\n== remove (project) ==')
const removed = await removeSkill(provider, tempManager, 'project', 'web-design-guidelines', join(base, 'proj'))
console.log('removed:', JSON.stringify(removed))
const listed3 = await provider.list({ cwd: join(base, 'proj') })
console.log('provider candidates after remove:', listed3.map(c => c.name))

console.log('\nSMOKE OK')

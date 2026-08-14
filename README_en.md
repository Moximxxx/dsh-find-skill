# dsh-find-skill

English | [中文](README.md)

Bridge the [vercel-labs/skills](https://github.com/vercel-labs/skills) open agent-skills ecosystem into [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

The plugin lets the **LLM decide** when a task needs a skill no existing tool or loaded skill covers: the model searches the ecosystem (`skill_find`), asks the user which candidate and scope to install (`ask_user_question`, built into dsh), and loads it as **temp** (default, current session), **project** (shared with the workspace), or **global** (all sessions). Installs land in plugin-owned roots, isolated from hand-written `.dsh/skills` and shared `.agents/skills`.

## Features

- **`skill_find`** — remote search over the official skills.sh API (the same source the CLI `find` command queries). Candidates carry install counts, sources, browse URLs, and a local "installed" marker. Low-priority description: the model is told to use it only when no existing tool or loaded skill fits.
- **`skill_install`** — fetch through the official CLI (`npx -y skills@latest`, auto-latest per project decision) inside an isolated throwaway work/home pair, then adopt only the requested skill into a managed scope. Temp installs register as runtime skills; project/global installs are written to managed roots and exposed through a self-owned `ctx.skills` provider (rank 350, configurable).
- **`skill_remove`** — remove from temp / project / global; temp is tried first when no scope is given.
- **`/skill` command** — human-facing `find | install | update | sync | remove | list`; `update` re-fetches the recorded source and replaces the bundle; `sync` scans project `node_modules` skills via the official CLI's `experimental_sync` and adopts them into the managed root.
- **Lifecycle** — temp skills register through the installing agent's scoped context: **visible only to that session** (other sessions cannot read them), the registration unwinds when the agent/session is disposed, and materialized directories are cleaned on `session/disposed`; `compactDisposePolicy: keep | dispose | ask` controls compaction behavior.
- **Web UI cards and skill management panel** — **one dual-face package**: this package ships both the host plugin and the browser client (`./client` export plus the `dsh.client` manifest). Conversation cards render `skill_find`/`skill_install`/`skill_remove` tool calls (replayable, read-only); a floating draggable panel (anchored beside the composer by default) offers collapsible global/project/temp views with row actions (load into the latest context, per-session disable/enable, remove temp skills).; `compactDisposePolicy: keep | dispose` controls behavior at compaction.

## Install / Load

### From source

```bash
git clone https://github.com/Moximxxx/dsh-find-skill.git
cd dsh-find-skill
git checkout develop          # full develop branch (includes AGENTS.md, .dsh/)
pnpm install --config.minimumReleaseAge=0   # rc.6 packages need the release-age policy bypass
pnpm build                    # tsc → lib/
pnpm test                     # unit + snapshot tests
```

Load it into dsh — development overlay (hot source):

```yaml
- insert:
    - id: dsh-find-skill
      name: '/abs/path/to/dsh-find-skill/src/index.ts'
```

Or install the local checkout as a bundle (build first, then):

```bash
dsh plugin --profile web add /abs/path/to/dsh-find-skill
dsh --profile web --dump-config   # confirm the dsh-find-skill row is in the plugin tree
```

### From npm

```bash
dsh plugin --profile web add dsh-find-skill
```

> Published to npm; install directly.

## Configuration

All fields are optional; defaults shown.

| Field | Default | Meaning |
|---|---|---|
| `searchApiBase` | `https://skills.sh` | Search API base (same source as CLI `find`). |
| `searchLimit` | `20` | Max candidates per search. |
| `prioritySources` | official list | Source owners boosted to the front of search results (priority first, then install count). |
| `cliCommand` | `npx -y skills@latest` | Command running the official CLI; swap in a local binary path if desired. |
| `installDefaultScope` | `temp` | Scope used when the model omits `scope`. |
| `projectSkillRoot` | `.dsh/skills-bridge` | Project-managed root, relative to the git root. |
| `globalSkillRoot` | `<dshHome>/skills-bridge/global` | User-global managed root. |
| `tempSkillRoot` | `<dshHome>/skills-bridge/tmp` | Temp materialization root. |
| `providerRank` | `350` | Rank of provider candidates (lower wins duplicates). |
| `compactDisposePolicy` | `keep` | `keep` / `dispose` / `ask` for temporary skills at compaction. |
| `registerFindTool` / `registerInstallTool` / `registerRemoveTool` | `true` | Model tool switches. |
| `registerCommand` | `true` | `/skill` command switch (looked up opportunistically). |

## Usage flow (model-driven)

1. User asks for something; the model finds no existing tool or loaded skill fits.
2. Model calls `skill_find` → reviews candidates (installs, source, URL).
3. Model asks the user via the built-in `ask_user_question` (which candidate? temp/project/global?).
4. Model calls `skill_install` → the skill appears in the session skill catalog on the next step; load it with the `skill` tool or the user can type `/<skill-name>`.
5. Cleanup: temp skills disappear at session end or via `skill_remove`; project/global persist until removed.

## Model Experience

- The three tools are registered with low-priority descriptions and can be disabled per tool; catalog noise is bounded by `searchLimit` and by installing only selected skills.
- Tool calls and results flow through the standard `tool/call` / `tool/result` session events; nothing is injected outside the session log.
- CLI installs can take tens of seconds on first use (npx downloads the latest `skills` package into the shared npm cache; the fetch itself runs in a throwaway HOME so no agent directories are touched).
- Project/global skills are durable files; temp skills are in-memory registrations with materialized directories under `tempSkillRoot`.

## Known Limitations and Deferred Work

- **Search candidates carry no description**: the skills.sh search API returns id/name/installs/source only; descriptions arrive after install.
- **Version compatibility**: development and loading tests target npm `@deepseek-ai/*@0.1.0-rc.6`; the source checkout (rc.5) was verified in an isolated instance (probe-confirmed apply execution and healthy boot).
- **CLI stdout is advisory**: outcomes are judged from the filesystem (the adopted skill directory), never from CLI prose.
- **Real-session model-driven flow verified** (headless with a real model: skill_find → skill_install temp → skill load); the full loop passed, including **temp-skill session isolation** (visible to the installing agent, invisible to a subagent).
- **node_modules-synced skills have no remote source**: `update` is unavailable for `/skill sync` adoptions; re-sync or install manually.
- **Panel labels are fixed Chinese**: the panel and card labels are not i18n-wired yet; the drag position is stored in browser localStorage.

## License

MIT
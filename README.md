# dsh-find-skill

English | [中文](README.zh.md)

Bridge the [vercel-labs/skills](https://github.com/vercel-labs/skills) open agent-skills ecosystem into [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

The plugin lets the **LLM decide** when a task needs a skill no existing tool or loaded skill covers: the model searches the ecosystem (`skill_find`), asks the user which candidate and scope to install (`ask_user_question`, built into dsh), and loads it as **temp** (default, current session), **project** (shared with the workspace), or **global** (all sessions). Installs land in plugin-owned roots, isolated from hand-written `.dsh/skills` and shared `.agents/skills`.

## Features

- **`skill_find`** — remote search over the official skills.sh API (the same source the CLI `find` command queries). Candidates carry install counts, sources, browse URLs, and a local "installed" marker. Low-priority description: the model is told to use it only when no existing tool or loaded skill fits.
- **`skill_install`** — fetch through the official CLI (`npx -y skills@latest`, auto-latest per project decision) inside an isolated throwaway work/home pair, then adopt only the requested skill into a managed scope. Temp installs register as runtime skills; project/global installs are written to managed roots and exposed through a self-owned `ctx.skills` provider (rank 350, configurable).
- **`skill_remove`** — remove from temp / project / global; temp is tried first when no scope is given.
- **`/skill` command** — human-facing `find | install | remove | list` for users who prefer commands over model-driven flows.
- **Lifecycle** — temp skills are owned by the installing session and disposed on `session/disposed`; `compactDisposePolicy: keep | dispose` controls behavior at compaction.

## Install / load

The plugin is a standard dsh plugin. Load it from a patch overlay:

```yaml
- insert:
    - id: dsh-find-skill
      name: 'dsh-find-skill'
```

Or point at a local checkout during development:

```yaml
- insert:
    - id: dsh-find-skill
      name: '/abs/path/to/dsh-find-skill/src/index.ts'
```

## Configuration

All fields are optional; defaults shown.

| Field | Default | Meaning |
|---|---|---|
| `searchApiBase` | `https://skills.sh` | Search API base (same source as CLI `find`). |
| `searchLimit` | `20` | Max candidates per search. |
| `cliCommand` | `npx -y skills@latest` | Command running the official CLI; swap in a local binary path if desired. |
| `installDefaultScope` | `temp` | Scope used when the model omits `scope`. |
| `projectSkillRoot` | `.dsh/skills-bridge` | Project-managed root, relative to the git root. |
| `globalSkillRoot` | `<dshHome>/skills-bridge/global` | User-global managed root. |
| `tempSkillRoot` | `<dshHome>/skills-bridge/tmp` | Temp materialization root. |
| `providerRank` | `350` | Rank of provider candidates (lower wins duplicates). |
| `compactDisposePolicy` | `keep` | `keep` or `dispose` temporary skills at compaction. |
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

## Development

```bash
pnpm install        # deps; uses --config.minimumReleaseAge=0 for rc.6 packages
pnpm build          # tsc → lib/
pnpm test           # vitest (unit + snapshot)
node scripts/smoke.mjs   # real-network end-to-end (search + CLI install + remove)
```

The smoke script requires network and a working `npx`.

### Release to main

`main` is the clean release branch and never contains the dev-only `.dsh/` and `AGENTS.md` paths (they are tracked and updated normally on `develop`). Publish the current `develop` to `main` with:

```bash
bash scripts/release-to-main.sh
```

The script merges `develop` into `main` with full history, strips the two dev-only paths from `main`'s index, and pushes. Conflicts abort the script for manual resolution.

## Known Limitations and Deferred Work

- **`compactDisposePolicy: 'ask'`** is deferred; only `keep` and `dispose` are implemented.
- **No update command**: re-installing a skill replaces it; a dedicated `update` action is future work.
- **Search candidates carry no description**: the skills.sh search API returns id/name/installs/source only; descriptions arrive after install.
- **Real-session model-driven verification** (find → ask_user_question → install → skill load) requires model credentials and was not executed in this environment; unit/snapshot tests and the network smoke cover the plugin side, and the catalog/skill-tool path is native dsh behavior.
- **Version skew**: development and loading tests target npm `@deepseek-ai/*@0.1.0-rc.6`; the local source checkout (rc.5) was not re-verified.
- **CLI stdout is advisory**: outcomes are judged from the filesystem (the adopted skill directory), never from CLI prose.

## License

MIT

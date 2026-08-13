# 可行性分析 v2：接入 vercel-labs/skills 生态的技能管理插件

> 目标：dsh 插件结合已发布的 npm 工具 `skills`（[vercel-labs/skills](https://github.com/vercel-labs/skills)），让 **LLM 在合适时机自行决定**去搜索/推荐 skill，经用户确认后加载为**临时 / 项目 / 全局**作用域。
>
> 本分析基于双方源码逐一核实（2026-08-13）：vercel-labs/skills 主分支（npm `skills` v1.5.22）与 dsh 检出（dsh 0.1.0-rc.5 之后，commit 47f943859b）。

## 0. 结论摘要

**总体可行，且大部分"加载链路"是 dsh 原生能力**，插件只需提供：3 个模型工具（`skill_find` / `skill_install` / `skill_remove`）+ 1 个自管 provider + 临时技能生命周期管理（含 compact 策略）。用户决策复用 dsh 已有的 `ask_user_question` 工具（Web UI 弹选项卡），插件不重复造轮子。

## 1. 已核实的双方现状（摘要，详见 v1）

### 1.1 vercel-labs/skills（npm 包 `skills` v1.5.22）

- 定位：开放 agent skills 生态的**包管理器 CLI**（不是单个 skill 的 npm 包；`@vercel-labs/skills` 在 npm 上不存在，实测 404）。
- Skill 形态：仓库内 `skills/<name>/SKILL.md`，YAML frontmatter（`name`、`description`）+ Markdown 正文 + 可选附带文件。
- 搜索 API（公开 JSON，无需 CLI）：`GET https://skills.sh/api/search?q=<query>&limit=20`（可选 `owner`），返回 `{skills:[{id,name,installs,source}]}`；base 可被 `SKILLS_API_URL` 覆盖。
- 安装：项目 `./.agents/skills/<name>/`、全局 `~/.agents/skills/<name>/`（universal）；非交互 `-y`；`-s <name>` 精确选择；写 `skills-lock.json`。
- `use <owner/repo>@<skill>`：不安装，物化到临时目录并**把渲染后 prompt 打印到 stdout**。
- Node `>=22.20`；dsh `^22.19 || >=24`（本地 v24.18.0 ✓）。

### 1.2 dsh skill 子系统

- `ctx.skills`（SkillRegistry）：`registerProvider()` / `register()`（运行时内存技能，disposer 卸载）/ `list()` / `snapshot()` / `get()`；分层（host 全局 + 按 agent scope），同层内 rank 小者胜。
- 本地 fs 提供者按 rank 扫描：100 `.dsh/skills`、200 `.agents/skills`、300 `customSkillDirs`、400 `~/.dsh/skills`、500 `~/.agents/skills`、600 bundled；chokidar 监视 + `skills/change` 失效。
- `dsh-tool-skill` 消费者：pre-step 注入目录（`<available_skills>`，digest 变更整段替换）；模型 `skill` 工具按需加载；**用户 `/<name>` 手势**直接加载（userInvocable）。
- **`ask_user_question` 工具已内置**（`@deepseek-ai/dsh-tool-ask-user`，经 `ctx.userQuestions` 服务）：**暂停工具调用直到 UI provider 返回人类答案**（Web UI 弹出选项卡），支持 options/multi_select/custom 输入 —— 正是用户决策所需，直接复用。
- **compaction**：`ctx.compaction` 服务 + 会话日志事件 `compaction/start` / `compaction/summary` / `compaction/end`（带 `compactionId`）；技能目录是注册表状态而非历史消息，compact 后目录会由下一次 snapshot 重建（临时技能注册天然存活），所以"是否清除"是纯策略问题。

## 2. 关键发现：安装即用（v1 保留）

`npx skills add` 的 universal 安装路径（`.agents/skills` / `~/.agents/skills`）正是 dsh 的 rank 200/500 扫描根：**用官方 CLI 安装完，dsh 下一轮对话自动发现**。但按本轮决策（自管隔离），插件默认**不走共享目录**，而是自管根 + 自注册 provider（见 §5）。

## 3. 决策记录（2026-08-13，用户拍板）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 推荐时机 | **LLM 决定**。模型在"用户交代任务但无对应工具/skill"时自行调用 `skill_find`，然后用 `ask_user_question` 询问用户，按需临时/项目/全局加载。插件不做 pre-step 主动注入。 |
| 2 | 推荐策略 | **单远程**（只搜 skills.sh API）。**低优先级**：工具描述明示"仅当现有工具与已加载 skill 均不适用时使用"；工具默认注册、可配置关闭。 |
| 3 | 安装默认作用域 | **临时**；**自管隔离**（插件自己的目录 + 自己的 provider，不混入 `.dsh/skills` 与 `.agents/skills`）；compact 时按配置策略决定是否清除。 |
| 4 | CLI 依赖 | **不固定版本**：默认 `npx -y skills@latest` 自动取最新；**安装与搜索都依赖 skills 仓库能力**（搜索 = 官方 `/api/search`，与 CLI find 同源；安装 = 官方 CLI）。无内置实现。 |
| 5 | 交互形态 | 复用内置 `ask_user_question`（弹出选项卡）；"需要用户决策"的流程由模型驱动调用它。 |

## 4. 需求 → 机制映射（v2）

| 需求 | 实现 |
|---|---|
| LLM 主动寻找 | 模型工具 `skill_find`：调 skills.sh API（单远程），返回候选（名称/描述/安装数/来源），`output.schema + render` 卡片展示 |
| 用户决策 | 复用内置 `ask_user_question`：模型把候选做成选项卡让用户选（含"临时/项目/全局"作用域选择） |
| 临时加载（默认） | `skill_install(scope: temp)`：下载 skill 到插件自管临时根 → `ctx.skills.register()` 注册运行时技能（resourceBase 指向临时目录）→ 会话结束 / compact 策略 / `skill_remove` 时 dispose |
| 项目级加载 | `skill_install(scope: project)`：写入 `<projectRoot>/.dsh/skills-bridge/`（自管根），由插件自注册 provider 暴露 |
| 全局加载 | `skill_install(scope: global)`：写入 `<dshHome>/skills-bridge/global/`，同一 provider 暴露 |
| 清理 | `skill_remove`（按作用域列出已装技能并移除）+ compact 策略自动清理 |
| 用户主动命令（可选项） | `/skill find|install|remove|list` 人类命令（ctx.commands），不经过模型 |

## 5. 自管隔离设计

- **provider**：插件 `ctx.skills.registerProvider()` 注册 `skills-bridge` provider：
  - `list()` 扫描自管根（项目根 + 全局根，cwd 感知），候选 rank 取 `Config.providerRank`（默认 350：低于用户级 400/500 与 custom 300 的优先级，高于用户手写项目技能 100/200 —— 即**项目手写技能赢、自管安装的比用户级安装优先**，可配置）。
  - `get()` 读 SKILL.md + frontmatter 解析（复用与 dsh fs provider 相同的 YAML 解析语义），`resourceBase: {kind:'directory'}`。
  - 安装/卸载后调 `control.invalidate()` 失效缓存；`skills/change` 驱动目录刷新。
- **temp 技能**：不进 provider，直接 `ctx.skills.register()`（内存、首胜去重、disposer 卸载）；附带文件落在 `<dshHome>/skills-bridge/tmp/<name>/`。
- **隔离收益**：不污染 `.dsh/skills`（用户手写技能）与 `.agents/skills`（其他 agent 共享）；provider 可选择性暴露（例如项目根不存在时只暴露全局+临时）。

## 6. CLI 依赖策略（决策 4 的落地方案，v3）

**"CLI 依赖"= 插件用什么方式执行安装/更新/搜索。** 用户决策（2026-08-13）：

- **不固定版本**：默认 spawn `npx -y skills@latest`，自动取 npm 最新版；`Config.cliCommand` 可覆盖为本地二进制路径（如 `npm i -g skills` 后的可执行文件）。
- **安装与搜索都依赖 skills 仓库能力**：安装/移除/更新 = 官方 CLI（`skills add/remove/update`）；搜索 = 官方 `skills.sh/api/search` JSON 接口——与 CLI `find` 命令**同源**（CLI find 内部就是调这个 API），插件直接调 API 是为了无 TTY 可编程，不引入第二套实现。
- 不提供内置（builtin）实现：避免重复造轮子、保证与生态行为一致。
- 程序化判定以**文件系统状态为准**（`<root>/<name>/SKILL.md` 存在性 + `skills-lock.json`），stdout 仅展示。
- 风险：latest 引入破坏性变更 → `cliCommand` 覆盖 + 测试中对 CLI 调用做 mock 锁定参数契约。

## 6. CLI 依赖策略（决策 4 的落地方案）

**"CLI 依赖"= 插件用什么方式执行安装/更新。** 三条路径：

| 路径 | 说明 | 取舍 |
|---|---|---|
| A. `npx -y skills@<固定版本>`（默认） | 每次 spawn `npx -y skills@1.5.22 add ... -y` | 复用官方工具、行为随生态演进；首次需联网下载；版本 pin 可复现 |
| B. 本地二进制 | `Config.cliCommand` 指向 `npm i -g skills` 的二进制路径 | 离线可用；版本由部署者掌控 |
| C. 内置实现 | 插件自己 git clone + frontmatter 解析（约 200 行） | 零 npm 依赖；但重复造轮子、不走官方逻辑 |

- 程序化判定以**文件系统状态为准**（`<root>/<name>/SKILL.md` 存在性 + `skills-lock.json`），stdout 仅展示。
- 搜索**不走 CLI**（直接调 `/api/search` JSON 接口），所以搜索无 CLI 依赖；CLI 只用于 add/remove/update。
      cliCommand: 'npx -y skills@latest'   # 自动最新版；可换本地二进制路径
      installDefaultScope: temp            # temp | project | global
      projectSkillRoot: '.dsh/skills-bridge'   # 相对项目根
      globalSkillRoot: ''                  # 默认 <dshHome>/skills-bridge/global
      tempSkillRoot: ''                    # 默认 <dshHome>/skills-bridge/tmp
      providerRank: 350
      compactDisposePolicy: keep           # keep | dispose | ask
      registerFindTool: true
      registerInstallTool: true
      registerRemoveTool: true
      registerCommand: true                # 额外 /skill 人类命令
```

## 11. 里程碑与工作量

| 里程碑 | 内容 | 估时 |
|---|---|---|
| M1 | `skill_find`（远程搜索 + render）+ `skill_install`（temp 为主，project/global 落盘）+ `skill_remove` + 自管 provider | 2–3 天 |
| M2 | 临时技能生命周期：物化目录、register/dispose、会话结束清理、compact 策略（keep/dispose/ask） | 1 天 |
| M3 | 与 `ask_user_question` 的模型引导流程联调（候选→选项卡→scope 选择→加载）+ 快照测试 | 1 天 |
| M4 | 发布 npm（`@deepseek-ai/cordis` peerDependencies、`dsh-plugin` topic）+ README Known Limitations | 0.5–1 天 |

## 12. 剩余小问题（不阻塞，实现时可定）

1. `skill_find` 是否要本地已装标记（标注"已安装/可用"便于模型去重）？→ 倾向：要，list() 合并。
2. compact 策略 `ask` 的实现是否值得（compaction 发生在 turn 内，交互可用）？→ 先做 keep/dispose，ask 列为 deferred。
3. 是否提供 `/skill` 人类命令（决策 5 说工具优先，命令仅作补充）？→ 默认开，可关。

## 参考来源

- https://github.com/vercel-labs/skills （src/cli.ts、src/add.ts、src/find.ts、src/use.ts、src/agents.ts、src/constants.ts）
- https://skills.sh （搜索 API：`/api/search`）
- 本仓库 `docs/subsystems/skills.md`、`docs/tool-catalog.md` 与 dsh 检出 `packages/skill/*`、`packages/interaction/tool-ask-user`、`packages/interaction/user-approval`、`packages/compaction/*` 源码
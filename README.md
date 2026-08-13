# dsh-find-skill

[English](README_en.md) | 中文

将 [vercel-labs/skills](https://github.com/vercel-labs/skills) 开放 agent 技能生态接入 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness)。

插件让 **LLM 自行决定**何时需要加载技能：当任务超出既有工具与已加载技能的能力时，模型搜索技能生态（`skill_find`）、通过 dsh 内置的 `ask_user_question` 询问用户选择哪个技能与作用域，然后加载为 **临时**（默认，仅当前会话）、**项目**（随工作区共享）或 **全局**（所有会话）。安装落在插件自有的根目录，与手写的 `.dsh/skills` 和共享的 `.agents/skills` 完全隔离。

## 功能

- **`skill_find`** —— 通过官方 skills.sh API 远程搜索（与 CLI `find` 命令同源）。候选携带安装数、来源、浏览链接与本地"已安装"标记。工具描述为低优先级：明确要求模型仅在既有工具与已加载技能都不适用时使用。
- **`skill_install`** —— 通过官方 CLI（`npx -y skills@latest`，按项目决策自动取最新版）在隔离的一次性 work/home 环境内抓取，只收养目标技能目录到托管作用域。临时安装注册为运行时技能；项目/全局安装写入托管根目录，并通过自有的 `ctx.skills` provider 暴露（rank 350，可配置）。
- **`skill_remove`** —— 从临时/项目/全局移除；未指定作用域时按 临时→项目→全局 顺序尝试。
- **`/skill` 命令** —— 面向人的 `find | install | update | remove | list` 子命令，适合偏好命令而非模型驱动流程的用户；`update` 按安装时记录的来源重新拉取并替换。
- **生命周期** —— 临时技能归属于安装它的会话，会话结束时（`session/disposed`）自动清理；`compactDisposePolicy: keep | dispose | ask` 控制压缩（compact）时的行为。

## 安装 / 加载

### 从源码下载（当前可用）

```bash
git clone https://github.com/Moximxxx/dsh-find-skill.git
cd dsh-find-skill
git checkout develop          # 完整开发分支（含 AGENTS.md、.dsh/）
pnpm install --config.minimumReleaseAge=0   # rc.6 依赖需绕过发布年龄策略
pnpm build                    # tsc → lib/
pnpm test                     # 单元 + 快照测试
```

加载进 dsh —— 开发期 overlay（热加载源码）：

```yaml
- insert:
    - id: dsh-find-skill
      name: '/abs/path/to/dsh-find-skill/src/index.ts'
```

或把本地检出作为 bundle 安装（先构建，再执行）：

```bash
dsh plugin --profile web add /abs/path/to/dsh-find-skill
dsh --profile web --dump-config   # 确认 dsh-find-skill 行在插件树内
```

### 从 npm 下载

```bash
dsh plugin --profile web add dsh-find-skill
```

> 插件已发布到 npm，可直接安装使用。

## 配置

所有字段可选，括号内为默认值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `searchApiBase` | `https://skills.sh` | 搜索 API 基址（与 CLI `find` 同源）。 |
| `searchLimit` | `20` | 每次搜索的最大候选数。 |
| `cliCommand` | `npx -y skills@latest` | 运行官方 CLI 的命令；可换成本地二进制路径。 |
| `installDefaultScope` | `temp` | 模型未指定作用域时使用的默认作用域。 |
| `projectSkillRoot` | `.dsh/skills-bridge` | 项目托管根目录（相对 git 根）。 |
| `globalSkillRoot` | `<dshHome>/skills-bridge/global` | 用户全局托管根目录。 |
| `tempSkillRoot` | `<dshHome>/skills-bridge/tmp` | 临时物化根目录。 |
| `providerRank` | `350` | provider 候选的 rank（越小越优先）。 |
| `compactDisposePolicy` | `keep` | 压缩时对临时技能 `keep`（保留）/ `dispose`（清除）/ `ask`（询问用户）。 |
| `registerFindTool` / `registerInstallTool` / `registerRemoveTool` | `true` | 模型工具开关。 |
| `registerCommand` | `true` | `/skill` 命令开关（按可用性查找 commands 服务）。 |

## 使用流程（模型驱动）

1. 用户提出需求；模型发现既有工具与已加载技能均不适用。
2. 模型调用 `skill_find` → 评估候选（安装数、来源、链接）。
3. 模型通过内置 `ask_user_question` 询问用户（选哪个技能？临时/项目/全局？）。
4. 模型调用 `skill_install` → 技能在下一步进入会话技能目录；用 `skill` 工具加载，或用户直接输入 `/<skill-name>`。
5. 清理：临时技能在会话结束或 `skill_remove` 时消失；项目/全局技能持久存在直到移除。

## 模型体验

- 三个工具以低优先级描述注册，可逐工具关闭；目录噪音由 `searchLimit` 与"只安装选定技能"约束。
- 工具调用与结果走标准 `tool/call` / `tool/result` 会话事件，无会话日志之外的旁路注入。
- CLI 安装首次可能耗时数十秒（npx 向共享 npm 缓存下载最新 `skills` 包；抓取本身运行在一次性 HOME 中，不触碰任何 agent 目录）。
- 项目/全局技能是持久文件；临时技能是内存注册 + `tempSkillRoot` 下的物化目录。

## 已知限制与后续工作

- **搜索候选不含描述**：skills.sh 搜索 API 只返回 id/name/installs/source；描述在安装后才有。
- **真实会话的模型驱动验证**（find → ask_user_question → install → skill 加载）需要模型凭据，本环境未执行；插件侧由单元/快照测试与网络冒烟覆盖，目录与 skill 工具路径是 dsh 原生行为。
- **版本偏差**：开发与加载测试针对 npm `@deepseek-ai/*@0.1.0-rc.6`；本地源码检出（rc.5）未重新验证。
- **CLI stdout 仅供参考**：结果以文件系统为准（收养的技能目录），从不依赖 CLI 散文输出。

## 许可证

MIT
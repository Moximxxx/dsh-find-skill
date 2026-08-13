# AGENTS.md — dsh 插件开发项目 / dsh Plugin Development Project

本仓库为 DeepSeek Harness（dsh）开发插件：产出可被 dsh 加载的 TypeScript 插件（模型工具、人类命令、skill、服务、LLM 适配器、Web UI 节点）。dsh 是 DeepSeek 开源的 agent 运行时，基于 Cordis 框架：**一切皆插件**——模型适配器、工具注册表、会话日志、agent 主循环本身都是插件，全部可从配置替换。插件运行在 Node 的 host 进程里，不在浏览器里；Web UI 是独立的 client 半边。

This repository develops plugins for DeepSeek Harness (dsh): TypeScript plugins dsh loads into its Cordis plugin tree. Everything in dsh is a plugin, including the model adapter, tool registry, session log, and the agent loop itself. Plugins run in the Node host process; the Web UI is a separate client half.

## 核心心智模型 / Cordis mental model

- 插件 = 导出 `name` + `apply(ctx)` 的 TS 模块。dsh 加载时调用 `apply(ctx)` 注册能力；**不需要返回值**。
- `ctx` 是服务仓库：`ctx.tools`（工具注册表）、`ctx.llm`（模型）、`ctx.sessions`（会话日志）、`ctx.commands`（人类命令）、`ctx.skills`（技能注册表）……
- `inject: ['tools']` 声明依赖：dsh **等依赖服务就绪才调用 apply**，加载顺序由服务可用性表达，不是手动排序。
- **注册即副作用**：`ctx.on()` / `ctx.effect()` / `ctx.tools.register()` 等所有注册在插件卸载时自动回滚，绝不手动清理（无 removeListener / clearInterval）。
- 事件派发四模式：`emit`（观察）、`waterfall`（中间件链，**监听者必须调 `next()` 委托**，不调 = 短路拦截）、`parallel`（并行）、`serial`（串行）。
- 类型化事件用 declaration merging 扩展 `SessionEventMap` 与 Context 接口。

A plugin is a TS module exporting `name` and `apply(ctx)`. `ctx` is the service repository; `inject` declares dependencies; every registration is a reversible effect that unwinds on unload. Events dispatch as emit / waterfall / parallel / serial.

## 版本号铁律 / Versioning rules

**任何版本号变更（package.json version、git tag、npm 发布版本）必须先询问用户并获得确认，禁止自行 bump。** 不提前规划版本号（文档/issue/评论中不得预告未来版本号）；版本号必须与未完成功能高度统一（每次变更前审计 README 的 Known Limitations and Deferred Work 并同步更新）。完整策略见 `VERSIONING.md`。

Version changes (package.json version, git tags, npm release versions) require explicit user confirmation first; never bump on your own. Do not pre-announce future version numbers. Versions must stay consistent with the Known Limitations and Deferred Work list in the README. Full policy: `VERSIONING.md`.

## 铁律 / Non-negotiable rules

1. **模型可见 ⟺ 已记录**：任何到达模型请求的输入必须能从会话日志（`SessionEventMap` 事件流）重建；新模型输入 = 新增会话事件。
2. **注册是 effect**：每个注册返回 disposer，卸载自动回滚。
3. **参数可配置**：部署相关选择必须是 cordis.yml 可配置、schemastery Schema 校验的 `Config` 字段，不硬编码常量。
4. **工具要设计渲染意图**：`output.schema` + `output.render`（generic/terminal/diff）；展示是 args 的纯函数。
5. **跨边界 id 用 `Branded` 类型**（如 `Branded<'SessionId'>`），不裸用 string。
6. **ESM 一切**：`"type": "module"`，相对导入写 `.ts` 后缀。
7. **配置错误 fail loud**：启动即报错，不静默跳过缺失引用。

Model-visible means logged; registrations are effects; deployment choices are validated Config fields; tools declare their render intent; cross-boundary ids are branded; ESM everywhere; misconfiguration fails loud.

## 官方文档 / Official documentation

**首选：加载项目技能 `.dsh/skills/dsh-plugin-dev/SKILL.md`** —— 已内嵌全部必要契约，自包含、可直接执行，无需查外部文档。

细节查阅用**本项目的官方文档快照**（`docs/`，来源 dsh 仓库 docs/，快照说明见 `docs/README.md`；以 dsh 仓库为权威源）：

| 目的 | 路径（本仓库内） |
|---|---|
| 插件开发指南（首选） | `docs/user/develop/`（basic → framework → practice） |
| Cordis 动手教程（7 章，免 API key） | `docs/cordis-tutorial/` |
| 菜谱（照着做） | `docs/cookbook/adding-a-tool.md`、`adding-a-package.md`、`adding-a-conversation-node.md`、`adding-an-llm-adapter.md` |
| 概念速查 | `docs/cordis-primer.md`、`docs/architecture.md`（重点：最后"Where new behavior goes"扩展点总表） |
| 类型/API/工具/配置参考（生成式） | `docs/subsystems/`、`docs/tool-catalog.md`、`docs/config-catalog.md` |
| 事件生产消费矩阵 | `docs/event-producer-consumer.md` |

## 开发工作流 / Workflow

1. 新插件在 `src/` 下建文件：导出 `name` + `apply`（+ `inject` + `Config`）。
2. 本地加载：`cordis.yml` 里 `insert` 一行指向插件文件**绝对路径**，然后 `pnpm dsh web --patch ./cordis.yml`（在 dsh 仓库根运行）。
3. 验证：终端出现加载日志；`pnpm dsh --profile web --dump-config` 查看最终插件树确认行在内。
4. 迭代：HMR 自动重载，无需重启。
5. 发布：npm 包（`@deepseek-ai/cordis` 放 peerDependencies + devDependencies），加 `dsh-plugin` topic 便于发现；发布流程见 `docs/user/develop/basic/publish.md`。

## 各类型插件速查 / Cheat sheet

| 类型 | 入口 | 关键点 |
|---|---|---|
| 模型工具 | `ctx.tools.register(defineTool({...}))` | `parameters` 自动生成 JSON Schema 并校验；`execute` 返回 `output.schema` 声明的值 |
| 人类命令 | `ctx.commands` | 用户触发，**不经过模型** |
| skill | `.dsh/skills/<name>/SKILL.md`（零代码）或注册 `SkillProvider`（`list`/`get`） | frontmatter 必须含 `name` + `description` |
| 服务 | `Service` 子类 + Context 声明合并 | 可选服务用 `ctx.get(name)`；`ctx.<name>` 只用于声明注入 |
| Web UI 节点 | `ConversationNodeDefinition` + keyed renderer | React；从会话日志按 `seq` 增量组装，**必须可重放**，不依赖进程内存 |
| LLM 适配器 | `ctx.llm.registerAdapter` | 见 `cookbook/adding-an-llm-adapter.md` |

## 测试与质量 / Testing and quality

- 单测 + **keyless 快照测试**（模型/用户可见输出可无 key 回归）；真实组合测试（经 Loader 装配），不只用 mock。
- 导出函数必须带 `@param`/`@returns` JSDoc；注释写契约，不写推理过程与代码复述。
- 改动模型/用户可见行为时同步更新 README、快照与 Model Experience 说明（token/KV 缓存影响）。
- 包 README 含 `Known Limitations and Deferred Work` 段或注明理由。

## 本项目的技能 / Project skill

`.dsh/skills/dsh-plugin-dev/SKILL.md` 是项目级 skill：dsh 自动发现 `<项目根>/.dsh/skills/`（rank 100），模型通过内置 `skill` 工具按需加载。需要深度插件开发指导（示例代码、各类型完整写法、常见坑）时，加载它。

The project skill at `.dsh/skills/dsh-plugin-dev/SKILL.md` is auto-discovered by dsh and loadable on demand via the model-facing `skill` tool.

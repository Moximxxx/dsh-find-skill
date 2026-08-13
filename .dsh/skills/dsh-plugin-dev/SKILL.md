---
name: dsh-plugin-dev
description: Use when writing, reviewing, or debugging DeepSeek Harness (dsh) plugins — model-facing tools, human commands, skills, services, LLM adapters, or Web UI conversation nodes. Load when a task requires code that dsh mounts via apply(ctx), or when asked to add a capability to dsh. This skill is self-contained; do not require reading external docs first.
---

# dsh 插件开发技能 / dsh Plugin Development Skill

本技能为 DeepSeek Harness（dsh）插件开发的自包含手册。dsh 是 DeepSeek 开源的 agent 运行时，基于 Cordis 框架：**一切皆插件**（模型适配器、工具注册表、会话日志、agent 主循环都是插件，全部可从配置替换）。插件运行在 Node host 进程，不在浏览器。所有代码示例可直接使用；文中内容已覆盖官方文档（user/develop 系列、cordis-primer、cookbook、subsystems）的全部必需契约。

This skill is a self-contained manual for developing DeepSeek Harness (dsh) plugins. Everything in dsh is a plugin; plugins run in the Node host process.

## 1. 最小插件 / Minimal plugin

插件 = 导出 `name` + `apply(ctx)` 的 TypeScript 模块。dsh 加载时调用 `apply(ctx)` 注册能力；**不需要返回值**。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // ctx 是服务仓库：ctx.tools / ctx.llm / ctx.sessions / ctx.commands / ctx.skills ...
}
```

- **注册即副作用**：`ctx.on()` / `ctx.effect()` / 各种 `register()` 在插件卸载时自动回滚，绝不手动清理（无 removeListener / clearInterval）。
- 需要显式清理的资源（如网络连接）用 `ctx.effect(() => { ...; return () => cleanup() })`。
- 事件监听器、工具、适配器、prompt 片段全部走 effect 语义，HMR 重载旧实例的注册自动消失。

## 2. 生命周期 / Lifecycle

每个插件拥有一个 Fiber 作用域：`PENDING → LOADING → ACTIVE`（失败 → `FAILED`）；`ACTIVE → UNLOADING → DISPOSED`。

- `inject: ['tools']` 声明必需服务：**dsh 等依赖服务就绪才调用 apply**，加载顺序由服务可用性表达。
- 必需服务消失（如 provider 被替换）→ 依赖插件自动卸载，服务回来时自动重新加载。
- 可选服务：不写 inject，使用时 `const svc = ctx.get('tools')`（`ctx.<name>` 只用于已声明注入）。

## 3. 服务 / Services

**消费**：`export const inject = ['tools']`，apply 内 `ctx.tools` 保证就绪。

**提供**：继承 `Service`，`super(ctx, 'name')` 注册到 ctx；可用 `static inject` 声明服务自身依赖：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']

  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

**声明类型**（declaration merging，类型与运行时分开）：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}
```

**服务隔离**：cordis.yml 可用 `isolate` 让不同插件组看到同一服务的不同实例（如两个 group 各自配置不同 timeoutMs 的 bash）。

## 4. 事件 / Events

事件是插件间通信机制，命名 `namespace/action`（如 `tools/result`、`agent/request`）。**监听是 effect**，卸载自动移除。

| 模式 | 方法 | 语义 |
|---|---|---|
| emit | `ctx.emit` | 广播观察，忽略返回值 |
| bail | `ctx.bail` | 短路：第一个非 null/false/undefined 的返回值成为最终结果 |
| serial | `ctx.serial` | 按注册顺序 await；首个非空值停止后续 |
| waterfall | `ctx.waterfall` | 中间件链：**监听者必须调 `next()` 委托下游**，不调 = 短路拦截（策略设计） |
| parallel | `ctx.parallel` | 并行 await 所有监听者 |

```ts
// 类型化事件：合并 Events 接口
declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```

**注意区分**：`turn/*`、`step/*`、`tool/call`、`tool/result` 是**持久会话事件类型**（写会话日志），不是同名 Cordis 事件；要观察它们请监听 `session/event` 并检查 `event.type`。

## 5. 配置 / Configuration

导出 `Config` 类型 + 同名 schemastery Schema（**不能导出普通对象**，必须实现 Standard Schema）。默认值直接写在 schema 字段上：

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  greeting: string
  maxRetries: number
}

export const Config = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
})

export function apply(ctx: Context, config: Config) {
  // config 已校验、已填默认值
}
```

- **不硬编码可调参数**：两个部署可能想设不同的值（超时、上限、开关）都必须是 Config 字段——测试标准是"cordis.yml 能否不改代码改这个值"。
- **配置错误 fail loud**：约束写进 schema，加载期即报错；不静默跳过缺失引用。
- HMR：改配置 → 框架卸载旧实例、加载新实例，注册自动清理。

## 6. 模型工具 / Model-facing tools

入口：`ctx.tools.register(defineTool({...}))`，`defineTool` 来自 `@deepseek-ai/dsh-tools`。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',   // 模型靠 description 决定何时调用
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },             // 默认可选
    },
    output: {
      schema: { type: 'string' },            // 规范返回值：object/array/scalar/null 皆可
      render: (_args, value) => [{ type: 'text', text: value }],  // 模型可见内容
    },
    async execute(args, exec) {
      // args 由 schema 推断类型并被自动校验（类型/必填/字面量/联合/嵌套）
      // exec.signal 是操作字段：取消时停止在途工作
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

execute() 契约要点：

- **args 自动校验**：defineTool 在 execute 前校验模型生成的 arguments；DSL 表达不了的约束（非空字符串、正数、跨字段）自己手检。
- **返回一个规范 JSON 值**：execute 只返回 `output.schema` 声明的值；不要返回 content 块，不要让调用方解析散文取 id/字段。
- **抛错或返回非法值 = isError**：基础设施故障抛异常；成功的域结果放进规范值（即使 renderer 解释非理想状态，如非零退出码）。
- **尊重 exec.signal**：触发即取消在途工作。
- **异步通知**：`exec.agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` 追加**持久化**上下文给下一次模型请求（不是唤醒）；对已 dispose 的 agent 要 try/catch。
- **后台长任务**：`ctx.jobs.start({ kind, label, owner: exec.agent, run })`（生产级参考 dsh-tool-bash）；成功后返回类型化句柄如 `{ kind: 'background', jobId }`。

UI 渲染意图（presentCall / presentResult 返回 card 标签联合，必须是 `args` 的纯函数——**直播和重放都会跑，禁止 I/O/时钟/随机**）：

- `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` — 默认；`locations: [{ path, line? }]` 供编辑器跳转
- `{ card: 'terminal', title, description?, cwd? }` — 你的调用就是一个 shell 命令
- `{ card: 'diff', title, diffs, locations? }` — 创建/修改文件，`diffs: [{ path, oldText, newText }]`（新文件 oldText: null）
- `{ card: 'search', ... }`（discovery 结果，从持久化 result.meta 重建）、`{ card: 'web', kind: 'search' | 'fetch', ... }`
- UI 专属格式不进模型结果：`output.render` 拥有模型面向的散文；`presentationMeta(args, value)` 产出可重放的持久化卡片数据（写进 tool/result 的 meta）

策略与观察（不要内建部署策略进工具）：`tools/pre-execute`（允许/拒绝/询问）、`ctx.tools.guard()`（最终单调拒绝）、`tools/execute`（包装派发：超时/重试/指标）、`tools/post-execute`（替换呈现/返回值、阻断结果）、`tools/result`（观察不可变结果）。

Code Mode 免费可用：每个注册工具变成 `await tools.<name>(args)`，类型从同一 schema 派生，成功解析为规范 JSON 值，失败抛 `ToolCallError`（只能读 name/toolName/message）。

## 7. 加载进 dsh / Loading into dsh

本地开发（cordis.yml 里 insert 一行，**路径必须绝对**）：

```yaml
- insert:
    - id: my-tool
      name: '/abs/path/to/my-tool.ts'
      config: { greeting: 'Hi' }   # 对应 Config；可选
```

启动：`pnpm dsh web --patch ./cordis.yml`（dsh 仓库根运行）；验证：终端出现加载日志、`pnpm dsh --profile web --dump-config` 看到你的行；迭代靠 HMR 自动重载。

## 8. 发布为 bundle / Publishing

- **bundle** = 带 `dsh.bundle` 清单的 npm 包：`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，patch 里的行用包名引用（`name: dsh-hello-plugin`），用户 `dsh plugin --profile <name> add <pkg>` 安装进 profile。
- **profile** = `$DSH_HOME/profiles/<name>/` 下声明 `dsh.profile.bundles` 的清单，`dsh plugin` 命令自动维护。
- **层顺序**：profile 的 bundles 按列表顺序 → profile 自身 cordis.patch.yml → `$DSH_HOME/cordis.patch.yml` → 每个 `--patch` overlay。**后写赢，且 patch 整行替换 config（不深合并）**——覆盖早层行要重述全部键；用户可覆盖你的行，schema 承担默认值。
- git 安装：pnpm 拉的是源码，需要作者提供自包含 `prepare` 脚本构建，用户要在 profile 的 pnpm-workspace.yaml `allowBuilds` 显式允许（= 允许在安装时执行你的代码，来源必须可信，钉 commit）。
- 发布到 npm 的包（lib/ 预先构建好）或 tarball 则无需任何构建权限。

## 9. 能力接缝 / Capability seams

可替换能力 = **Service Definition（声明接口）+ Service Provider（实现）+ Consumer（通常是对模型暴露的工具）** 三个角色；三件套齐全才算完整能力，单独一个角色不是接缝。需要独立演进的场景拆包（参考 shell 三件套：dsh-shell / dsh-bash-local / dsh-tool-bash）；单用途插件保持一个包。

## 10. LLM 适配器 / LLM adapters

```ts
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { ... }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config = Schema.object({ apiKey: Schema.string() })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(config))
}
```

协议义务（两个已实现适配器验证过的契约）：

- `usage` 必须在 `finish` **之前**发出；`finish` 之后什么也不发（稳妥做法：缓冲到 provider 流结束标记再刷出）。
- 工具调用 `arguments` 端到端是 **RAW JSON 字符串**；流式片段用 `argumentsDelta`；provider 给回对象就在 block-end 重新字符串化。
- block `index` 按首见流序分配，同一 block 的每个 delta 复用 index。
- 错误只有两条合法路径：`stream()` 内 throw（传输/协议故障，用带稳定 code 的 `LlmError`），或流以 `finish {kind: 'error' | 'aborted'}` 结束（provider 带内失败）。
- 尊重 `options.signal`；无法兑现的 `GenerateOptions` 字段（如无 stop 序列的 provider）抛 `LlmError(..., 'UNSUPPORTED')`，不要静默丢弃。
- 密钥走 schemastery Config + env 回退（`!!js process.env.MY_KEY`），绝不读临时 key 文件。

## 11. 注册 skill / Registering skills

**零代码方式**：一个目录 + 一个带 frontmatter 的 `SKILL.md`（frontmatter 必须含 `name` + `description`；可选 `disable-model-invocation` / `user-invocable` 布尔）。放入自动发现目录：

| 优先级 | 目录 | 范围 |
|---|---|---|
| 100 | `<项目根>/.dsh/skills/` | 项目级 |
| 200 | `<项目根>/.agents/skills/` | 项目级 |
| 300 | 配置 `customSkillDirs` | 自定义 |
| 400 | `$DSH_HOME/skills/` | 用户级 |

**Provider 方式**（动态/远程源）：实现 `SkillProvider`（`name`、`list()` 返回候选、`get(candidate)` 返回完整定义含正文），在 `ctx.skills` 注册；`list()` 内可 await 远程发现，尊重 `options.signal`。模型通过内置 `skill` 工具看到合并后的 catalog（名字+描述），按需加载全文。

## 12. 会话日志铁律 / Session log rules

- **模型可见 ⟺ 已记录**：任何到达模型请求的输入必须能从会话日志重建；新模型输入 = 新增 `SessionEventMap` 事件（declaration merging 扩展）并写入日志。
- 持久事件（`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*`、`compaction/*`）是追加式无损 JSON 日志；模型历史由日志 `deriveMessages()` 投影。
- 不要为了 UI 好看把内容写进模型结果；持久卡片数据走 `presentationMeta`。

## 13. 常见坑 / Pitfalls

- waterfall 监听者忘调 `next()` → 静默短路，下游永远不执行。
- 模型可见输入没记日志 → 违反铁律。
- 用 `ctx.<name>` 读未声明注入的可选服务 → 用 `ctx.get(name)`。
- 前端思维误区：插件跑在 Node host 进程，不在浏览器；浏览器侧只有 client 包的 `ui-*` 模块。
- 新增事件/服务类型忘写 declaration merging → 类型报错。
- 工具 schema 或结果里写 UI/传输词汇 → 模型面向的契约只含任务概念。
- 硬编码超时/上限 → 必须 Config 字段。
- 跨进程/持久化边界用裸 string id → 用 `Branded<B>`。

## 14. 质量要求 / Quality

- 单测 + keyless 快照测试（模型/用户可见输出可无 key 回归）+ 真实组合测试（经 Loader 装配），不只用 mock。
- 导出函数带 `@param`/`@returns` JSDoc；注释写契约，不写推理过程。
- 改动模型/用户可见行为同步更新 README、快照与 Model Experience（token/KV 缓存影响）；README 含 Known Limitations 段。
- 验证加载：`--dump-config` 看树 + 终端加载日志；行为验证走真实会话而非单测断言。

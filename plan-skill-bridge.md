# 任务工作流计划：dsh-skill-bridge 插件

> 状态：P0–P1 已完成（决策固化 + 本计划落盘），等待用户确认后进入执行。
> 关联文档：`feasibility-vercel-skills-bridge.md`（可行性 v3，含全部已核实事实）。

## 0. 目标（Objective）

在 dsh 中提供技能桥接插件：**LLM 在无对应工具/已加载 skill 时自行决定**调用 `skill_find`（skills.sh 官方 API，单远程）→ 经内置 `ask_user_question` 让用户决策 → `skill_install` 加载为**临时（默认）/ 项目 / 全局**作用域；自管隔离目录 + 自注册 provider；临时技能生命周期管理（会话结束 / compact 策略清理）。

## 1. 工作流总览

| 阶段 | 内容 | 产出 | 退出标准 |
|---|---|---|---|
| P0 决策固化 | 可行性分析 + 用户 5 项决策 | feasibility v3（已完成） | 决策表完整 |
| P1 计划落盘 | 本计划文档 + todo 列表 | plan-skill-bridge.md（本文件，已完成） | 用户确认 |
| P2 工程骨架 | 包初始化、本地加载、测试基座 | package.json / tsconfig / src 布局 / cordis.yml 验证 | 空插件可加载、测试可跑 |
| P3 M1 工具与 provider | skill_find / skill_install / skill_remove / 自管 provider / /skill 命令 | 工具 + provider + 单测 | 端到端手动验证（临时安装→目录出现→skill 工具可加载） |
| P4 M2 临时生命周期 | 物化目录、register/dispose、会话结束清理、compact 策略 | 生命周期模块 + 测试 | 生命周期/compact 模拟测试绿 |
| P5 M3 联调与质量 | ask_user_question 全流程、快照测试、README | 无 key 测试 + 文档 | 手工 UI 走查通过 |
| P6 M4 发布 | npm 发布 | 已发布包 | 安装后可加载 |

## 2. 阶段任务明细

### P2 工程骨架
- P2.1 包初始化：`name`（默认 `dsh-skill-bridge`，待确认）、`"type": "module"`、`@deepseek-ai/cordis`（peer + dev）、`@deepseek-ai/schemastery`；tsconfig 严格模式；相对导入带 `.ts` 后缀。
- P2.2 最小插件：`src/index.ts` 导出 `name` + `apply(ctx)` + 完整 Config schema（§10 草案字段全量占位，fail loud 校验）。
- P2.3 本地加载验证：dsh 仓库 `cordis.yml` insert 绝对路径 → `pnpm dsh web --patch ./cordis.yml` → 加载日志 + `--dump-config` 确认插件树。
- P2.4 测试基座：vitest + keyless 快照目录；Loader 组合装配测试骨架（不只用 mock）。

### P3 M1 工具与 provider
- P3.1 自管 provider：`ctx.skills.registerProvider()`；`list()` 扫描项目/全局自管根（cwd 感知，`control.invalidate()` 失效）；`get()` 读 SKILL.md + frontmatter 解析（YAML，语义对齐 dsh fs provider）；`providerRank` 可配（默认 350）。
- P3.2 `skill_find`：fetch `{searchApiBase}/api/search?q=&limit=`；`output.schema` + `render`（generic 卡片：名称/描述/安装数/来源）；已装标注（与 provider list 合并）；低优先级描述（"仅当现有工具与已加载 skill 均不适用时使用"）；超时/失败 fail loud。
- P3.3 `skill_install`：scope `temp`（默认）= 下载物化到 `tempSkillRoot` + `ctx.skills.register()`；scope `project/global` = 写自管根 + invalidate；spawn `Config.cliCommand`（默认 `npx -y skills@latest`）执行 add；以文件系统状态 + `skills-lock.json` 校验结果；返回 `{installed, name, scope, catalogName}`。
- P3.4 `skill_remove`：temp = dispose 注册；project/global = 删目录 + invalidate；幂等。
- P3.5 `/skill` 人类命令（默认开，可关）：find/install/remove/list，经 `ctx.commands`。

### P4 M2 临时技能生命周期
- P4.1 物化目录管理：`tempSkillRoot`（默认 `<dshHome>/skills-bridge/tmp`），同名冲突、残留清理。
- P4.2 会话结束 dispose：监听会话生命周期事件，统一清理该会话产生的 temp 注册。
- P4.3 compact 策略：监听 `session/event` 中 `compaction/start`（`event.type` 匹配）→ `compactDisposePolicy: keep | dispose | ask`（ask 失败回退 keep；ask 列为 deferred，先做 keep/dispose）。

### P5 M3 联调与质量
- P5.1 全流程联调：模型驱动 find → `ask_user_question`（候选选项卡 + 作用域选择）→ install → `skill` 工具 / `/<name>` 加载。
- P5.2 keyless 快照测试：工具输出、目录消息、render 输出可回归；CLI 调用 mock 锁定参数契约。
- P5.3 README：用法、Model Experience 说明（token/上下文影响）、Known Limitations and Deferred Work 段。

### P6 M4 发布
- 按 `docs/user/develop/basic/publish.md`：`@deepseek-ai/cordis` peerDependencies + devDependencies；`dsh-plugin` topic；npm 包安装后本地加载验证。

## 3. 执行纪律（AGENTS.md 铁律映射）

- 注册即 effect：所有 register 返回 disposer，卸载自动回滚，无手动清理。
- 模型可见 ⟺ 已记录：工具结果走 `tool/call`/`tool/result` 会话事件；无旁路注入。
- 配置可配置：部署选择全部进 Config schema（searchApiBase/searchLimit/cliCommand/installDefaultScope/各根目录/providerRank/compactDisposePolicy/工具开关）。
- 工具渲染意图：每个工具 `output.schema` + `output.render`。
- 跨边界 id 用 Branded；ESM 一切；配置错误 fail loud。
- 每阶段结束：同步 README / 快照 / Model Experience 说明。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| `skills@latest` 破坏性变更 | `cliCommand` 覆盖；测试 mock CLI 锁定参数契约；真实 CLI 联调一次记录版本 |
| skills.sh API 变更 | `searchApiBase` 可配；快照测试锁定响应解析 |
| 网络依赖（npx 下载、API） | 单元测试 mock fetch/spawn；真实联调放 P5 一次性验证 |
| compact `ask` 交互复杂度 | 先 keep/dispose，ask 进 Known Limitations（deferred） |
| 与既有 skill 重名冲突 | providerRank 可配 + 文档说明层级规则 |

## 5. 执行前待确认

1. 插件包名：默认 `dsh-skill-bridge`（无 scope）？
2. 本地加载验证用 dsh 仓库 `cordis.yml` 临时 insert（开发期）即可？
3. 测试框架：vitest（与 dsh 一致）？

## 6. 参考

- 可行性文档：`feasibility-vercel-skills-bridge.md`
- 项目技能：`.dsh/skills/dsh-plugin-dev/SKILL.md`（P2 起每次编码前加载）
- 发布流程：`docs/user/develop/basic/publish.md`


---

## 执行状态（2026-08-14 更新）

| 阶段 | 状态 | 验证 |
|---|---|---|
| P0–P1 | ✅ | feasibility v3 + 本计划 |
| P2 工程骨架 | ✅ | tsc 构建、5 测试、隔离实例加载（探针法确认 apply 执行 + fail loud） |
| P3 M1 | ✅ | 22 测试 + 真实网络冒烟（search → CLI 安装 temp/project → provider 可见 → remove） |
| P4 M2 | ✅ | 会话归属追踪 + `session/disposed` 清理 + compact 策略；26 测试 |
| P5 M3 | ✅ | render 纯函数 + 快照测试 + 命令解析测试（35 测试全绿）+ README（Model Experience / Known Limitations） |
| P6 M4 | ✅ 已完成 | **npm 已发布** `dsh-find-skill@0.1.0`（latest）；隔离实例从 npm 拉取安装验证通过；tag `0.1.0` 已推送；GitHub Release 待网页创建（token 无权限）；README 双语 npm 路径标记为可用 |

### 发布状态（2026-08-14 更新）

- ✅ npm 已发布：`dsh-find-skill@0.1.0`（latest），`npm view dsh-find-skill` 可查
- ✅ tag `0.1.0` 已推送到 GitHub（main 分支）
- ⏳ GitHub Release：token 无 Release 写权限，网页创建：https://github.com/Moximxxx/dsh-find-skill/releases/new → 选 tag `0.1.0`
- 发布流程详见 `PUBLISHING.md`；版本纪律见 `VERSIONING.md`

### 测试实例
- npm 独立 dsh：`http://127.0.0.1:3900`（`/home/qjy/code/dsh-npm-test`，DSH_HOME=/tmp/dsh-test-home，PID 见 /tmp/dsh-3900.pid）
- 用户 dsh（3080）全程未受影响


### 0.1.x 功能迭代状态（2026-08-14 追加）

| 里程碑 | 内容 | 状态 | 验证 |
|---|---|---|---|
| 0.1.1 | /skill update（来源元数据 + 替换语义） | ✅ d29ae05 | 39 测试 + 真实网络冒烟含 update |
| 0.1.2 | compactDisposePolicy ask（会话粒度 dispose） | ✅ ad3fcbe | 45 测试 |
| 0.1.3 | find 来源信誉排序 | ✅ 6a78cae | 49 测试 |
| 0.1.4 | /skill sync（experimental_sync 收养） | ✅ 9cae1ad | 52 测试 |
| 0.1.5 | rc.5 兼容验证 | ✅ cf82007 | 隔离实例探针 + 健康启动 |
| 0.1.6 | 真实会话模型驱动联调 | ✅ 891274f | headless + 真实模型全流程（find→install temp→skill 加载） |
| 0.1.7 | Web UI 推荐卡（dsh-find-skill-client） | ✅ 81d6d61 + eb6dfc9 | client.js 200 + boot manifest 收录 + `__ModuleLoader__` 格式修复；**浏览器确认通过** |

**版本纪律**：以上全部在 develop 上完成并推送；版本号仍为 0.1.0（未 bump）；main/npm 未动。版本变更与发布等待用户确认。


---

# 技能面板 UI 重构计划（面板 v2）

## 问题清单（用户反馈）

1. **数据丢失**：页面刷新后技能列表消失；面板中途加载时，之前装的技能也刷新不出来。
2. **UI 简陋**：需统一 dsh web 现有风格（复用 ui-primitives 图标/按钮/Tooltip + CSS Modules）。
3. **形态**：悬浮可拖动面板；默认位置在 web 输入框左侧平齐。
4. **结构**：全局级 / 项目级 / 临时级三个可折叠分组，折叠面板在卡片内部。

## 阶段

### P1 数据层诊断与修复
- 把 /skill panel 的数据组装抽成纯函数 `buildPanelListing(...)` 并补单测（三层分组 + 禁用标记）。
- headless 实测 `/skill panel` 输出，确认命令链路（execute remote → handler → JSON）无截断/异常。
- 定位"刷新丢列表"根因（候选：a) 刷新后 UI 开了新会话，临时技能属于旧 agent 作用域；b) panel 数据未按当前会话过滤；c) 命令失败返回非 JSON 文本被静默吞掉）。修复方向：面板数据按当前会话过滤 + 区分"空列表/加载失败"两个状态 + 失败信息显式展示。

### P2 UI 重构（client）
- 风格：`@deepseek-ai/dsh-client-ui-primitives`（Icon*/Tooltip/Text 等）+ CSS Modules（构建预设已支持），视觉对齐 dsh 现有面板（参照 GoalBar/设置面板）。
- 悬浮拖拽：fixed 定位面板 + 拖动手柄（pointer events）；默认锚点 = 输入框左侧平齐；拖动位置记忆 localStorage。
- 内部结构：标题栏（拖拽区 + 折叠全部 + 刷新按钮）+ 三个可折叠分组（全局/项目/临时），行 = 名称/描述 + 操作按钮（加载、禁用⇄启用、移除[临时]）。
- 状态：loading / 空态（"暂无技能"）/ 错误态；mount + 会话切换 + 每次操作后自动刷新。

### P3 验证
- 3900 部署 + 浏览器验证清单：折叠、拖动与位置记忆、禁用/启用、加载注入、移除、刷新持久、无技能空态。

### P4 版本与发布（完成后询问用户）
- 新能力 → MINOR 0.3.0；确认后走 npm + main + tag 流程（VERSIONING.md）。

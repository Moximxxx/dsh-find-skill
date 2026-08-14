# VERSIONING.md — 版本控制策略 / Versioning policy

本文件定义 dsh-find-skill 的版本控制铁律。**任何违反下列规则的版本变更都不得发生。**

This file defines the versioning rules of dsh-find-skill. **No version change may violate these rules.**

## 当前版本 / Current version

**0.2.1** — 0.2.0 的 bug 修复版：临时技能改为 agent 作用域注册（仅安装会话可见、销毁自动回滚），真实模型隔离验证通过。

历史版本：**0.2.0** — 功能完整版（0.1.x 开发线全部收编）：

- skill_find / skill_install / skill_remove / skill_update 模型工具与自管 provider（临时/项目/全局作用域，隔离根目录）
- /skill 人类命令：find / install / update / sync / remove / list（安装来源元数据、node_modules 收养）
- 临时技能生命周期：会话结束清理 + compact 策略 keep / dispose / ask
- find 结果来源信誉排序（prioritySources 可配）
- Web UI 推荐卡（dsh-find-skill-client，只读展示）
- 双语 README、MIT 许可证、dsh bundle 清单

发布状态：**0.2.0 已发布 npm**（dsh-find-skill + dsh-find-skill-client）+ GitHub tag `0.2.0`。

## 铁律 / Rules

1. **版本号变更必须询问用户**：任何版本号变更——package.json 的 `version` 字段、git tag、npm 发布版本——都必须先向用户提出明确建议（当前版本 → 目标版本 + 理由 + 变更清单）并获得用户确认。agent 与协作者均**不得自行 bump 版本号**。

2. **不提前规划版本号**：禁止在任何文档、issue、commit message、评论中预告未来版本号（例如不写"0.2.0 将包含 X"）。版本号只在实际变更发生的时刻决定。

3. **版本号与未完成功能高度统一**：版本号必须真实反映功能完成度。每次版本变更前必须审计 README 的 **Known Limitations and Deferred Work** 段，并与之同步更新——未完成功能清单的变化是版本变更的主要依据。

## 何时升哪个号 / When to bump

| 变更类型 | 版本动作 | 示例 |
|---|---|---|
| 缺陷修复、文档、测试、构建调整 | PATCH：0.1.0 → 0.1.1 | compact 策略 bug 修复；README 修正 |
| 新能力（新工具/新命令/新作用域/Web UI） | MINOR：0.1.0 → 0.2.0 | 新增 update 命令；compactDisposePolicy: ask；Web UI 推荐卡 |
| 1.0 之前的破坏性设计变更 | 仍为 MINOR（0.x.y 语义内） | 工具参数不兼容重命名 |
| 首个稳定发布（全部 Known Limitations 清零） | MAJOR：1.0.0 | 真实会话模型驱动联调完成；无未完成功能 |

## 流程 / Process

1. 功能变更完成、测试全绿后，先在 README 的 Known Limitations and Deferred Work 段增删对应条目（版本变更与功能清单同步）。
2. 向用户提出版本变更建议并获得确认（不得跳过）。
3. 更新 package.json 的 `version` 字段；如有必要同步更新 README/文档中的版本引用；发布时在 main 打 tag。
4. 发布完成后更新本文件"当前版本"段。

## 与分支模型的关系 / Branch model

- 版本号统一在 `develop` 上维护。
- 发布到 `main` 使用 `scripts/release-to-main.sh`（合并时剥离 `.dsh/` 与 `AGENTS.md`）：`bash scripts/release-to-main.sh`。内容冲突自动取 develop 侧；仅 `.dsh/` 与 `AGENTS.md` 的 modify/delete 冲突被解析为删除；其他未合并条目会中止脚本等待手动解决。
- 发行 tag 打在 `main`：`git tag v<version> && git push origin v<version>`（打 tag 属于版本变更动作，同样必须先询问用户）。

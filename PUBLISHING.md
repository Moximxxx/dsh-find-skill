# PUBLISHING.md — npm 发布与 GitHub Release 教程

> 版本纪律：按 `VERSIONING.md`，任何版本号变更（含打 tag）必须先询问用户并获得确认。本教程只描述**发布当前版本**的流程，不涉及 bump。

## 前置条件

- `pnpm build` 通过（lib/ 存在）、`pnpm test` 全绿
- 已登录 npm：`npm whoami` 能输出用户名（未登录先执行 `npm login`，交互式完成）
- gh 已登录（`gh auth status`）；SSH 可推送（`ssh -T git@github.com` 输出 Hi <user>）

## 步骤

### 1. 发布前预检

```bash
cd /home/qjy/code/dsh-plugins
pnpm build && pnpm test          # 构建 + 测试
npm pack                         # 生成 dsh-find-skill-<version>.tgz
tar -tzf dsh-find-skill-<version>.tgz   # 确认内容：lib/、README.md、cordis.patch.yml
```

### 2. 发布到 npm

```bash
npm publish                      # 发布当前 package.json 的 version（单包双面：host + client 同包）
npm view dsh-find-skill          # 验证已上线（dist-tags.latest）
```

> 首次发布自动打 `latest` tag。后续发布前若版本号有变，必须先询问用户（VERSIONING.md）。

### 3. 验证安装（可选，在隔离环境）

```bash
cd /tmp && mkdir -p dsh-pub-test && cd dsh-pub-test
npm i dsh-find-skill
# 在任意 dsh 部署：
dsh plugin --profile web add dsh-find-skill
```

### 4. GitHub Release

```bash
git checkout main                 # 发布分支
git pull --ff-only origin main
git tag v<version>                # 例如 v0.1.0 —— 需用户确认
git push origin v<version>
gh release create v<version> --generate-notes --title "dsh-find-skill v<version>" --notes "…"
```

> 若 gh token 无 Release 写权限（fine-grained PAT），改用网页创建：GitHub 仓库页 → Releases → Draft a new release → 选 tag → 写说明 → Publish。

### 5. 发布后收尾

- 更新 README.md / README_en.md 中"从 npm 下载（待发布）"标记为可用（含实际命令）
- 更新 VERSIONING.md"当前版本"段（若有 bump）
- 发布到 main 分支的变更走 `scripts/release-to-main.sh`

## 回滚与注意事项

- npm 发布后 72 小时内可 `npm unpublish dsh-find-skill@<version>`（仅限无依赖的包；过期后只能发修复版）
- 一旦其他包依赖了该版本，unpublish 会被拒绝——优先发布新版本修复
- 版本纪律：不提前规划版本号、变更先问用户、版本与 Known Limitations 同步

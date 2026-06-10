# Hexo + GitHub Pages 个人技术博客实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配置 Hexo + Shion 主题 + GitHub Actions 自动部署，推送到私有仓库测试

**Architecture:** 修改 `_config.yml` 完成站点/主题配置，创建 GitHub Actions workflow 实现 push-to-deploy，迁移主题图片到正确位置，初始化 git 并推送到 GitHub 私有仓库

**Tech Stack:** Hexo 8.x、Shion 主题、GitHub Actions、pnpm

---

### Task 1: 迁移主题图片到正确位置

**Files:**
- Create: `source/images/shion/` （目录）
- Move: `themes/shion/*.png` → `source/images/shion/`

Shion 主题配置引用的图片路径为 `/images/shion/xxx.png`，Hexo 约定主题静态资源应放在 `source/images/` 下才能被正确生成。这 5 张 PNG 目前位于主题根目录，需要迁移。

- [ ] **Step 1: 创建目标目录**

```bash
mkdir -p source/images/shion
```

- [ ] **Step 2: 移动图片文件**

```bash
mv themes/shion/404.png source/images/shion/
mv themes/shion/avatar.png source/images/shion/
mv themes/shion/bg.png source/images/shion/
mv themes/shion/default-cover.png source/images/shion/
mv themes/shion/hero.png source/images/shion/
mv themes/shion/search.png source/images/shion/
```

- [ ] **Step 3: 验证文件已迁移**

```bash
ls source/images/shion/
```

Expected: 看到 6 个 PNG 文件。

- [ ] **Step 4: 提交**

```bash
git add source/images/shion/
git commit -m "chore: move theme images to source/images/shion"
```

---

### Task 2: 更新站点配置文件 `_config.yml`

**Files:**
- Modify: `_config.yml`

将默认 Hexo 配置修改为你的站点信息。站点标题留给你自行填写（当前用 `Shionyori's Blog` 占位）。

- [ ] **Step 1: 修改站点基本信息**（第 5-11 行）

将：
```yaml
title: Hexo
subtitle: ''
description: ''
keywords:
author: John Doe
language: en
timezone: ''
```

替换为：
```yaml
title: Shionyori's Blog
subtitle: ''
description: ''
keywords:
author: Shionyori
language: zh-CN
timezone: ''
```

- [ ] **Step 2: 修改 URL**（第 16 行）

将：
```yaml
url: http://example.com
```

替换为：
```yaml
url: https://shionyori.github.io
```

- [ ] **Step 3: 修改 permalink 配置**（第 17-21 行）

将：
```yaml
permalink: :year/:month/:day/:title/
permalink_defaults:
pretty_urls:
  trailing_index: true
  trailing_html: true
```

替换为：
```yaml
permalink: :year/:month/:day/:title/
permalink_defaults:
pretty_urls:
  trailing_index: false
  trailing_html: false
```

- [ ] **Step 4: 启用 post_asset_folder**（第 43 行）

Shion 主题的封面图功能依赖 `post_asset_folder`。将：
```yaml
post_asset_folder: false
```

替换为：
```yaml
post_asset_folder: true
```

- [ ] **Step 5: 修改主题**（第 99 行）

将：
```yaml
theme: landscape
```

替换为：
```yaml
theme: shion
```

- [ ] **Step 6: 修改部署配置**（第 103-105 行）

将：
```yaml
deploy:
  type: ''
```

替换为：
```yaml
deploy:
  type: git
  repo: https://github.com/Shionyori/shionyori.github.io.git
  branch: gh-pages
  message: "Site updated: {{ now('YYYY-MM-DD HH:mm:ss') }}"
```

- [ ] **Step 7: 提交**

```bash
git add _config.yml
git commit -m "config: update site info, theme, and deploy settings"
```

---

### Task 3: 更新主题配置文件

**Files:**
- Modify: `themes/shion/_config.yml`

将主题中的示例链接更新为你的实际信息。

- [ ] **Step 1: 修改 GitHub 社交链接**（第 86 行）

将：
```yaml
    GitHub: https://github.com/
```

替换为：
```yaml
    GitHub: https://github.com/Shionyori
```

- [ ] **Step 2: 确认评论已关闭**（第 97 行）

确认：
```yaml
comments:
  enable: false
```

- [ ] **Step 3: 确认分析已关闭**（第 131-133 行）

确认：
```yaml
analytics:
  google: null
  baidu: null
```

- [ ] **Step 4: 提交**

```bash
git add themes/shion/_config.yml
git commit -m "config: update theme social link and confirm settings"
```

---

### Task 4: 创建 GitHub Actions 部署工作流

**Files:**
- Create: `.github/workflows/deploy.yml`

每次推送 `main` 分支时，自动构建 Hexo 并部署到 `gh-pages` 分支。

- [ ] **Step 1: 创建工作流目录**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: 写入 deploy.yml**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    concurrency:
      group: ${{ github.ref }}
      cancel-in-progress: true

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate static files
        run: npx hexo generate

      - name: Deploy to gh-pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
          publish_branch: gh-pages
          force_orphan: true
          commit_message: 'deploy: ${{ github.event.head_commit.message }}'
```

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions deploy workflow"
```

---

### Task 5: 本地验证构建

**Files:** None（验证）  
**前置条件:** Task 1-4 已完成

- [ ] **Step 1: 安装依赖**

```bash
pnpm install
```

- [ ] **Step 2: 清理并生成静态文件**

```bash
npx hexo clean && npx hexo generate
```

Expected: 无报错，`public/` 目录生成成功。

- [ ] **Step 3: 检查 public/ 产物**

```bash
ls public/
```

Expected: 看到 `index.html`、`archives/`、`css/` 等目录和文件。

- [ ] **Step 4: 可选 - 本地预览**

```bash
npx hexo server
```

浏览器打开 `http://localhost:4000` 查看效果。

---

### Task 6: 初始化 Git 仓库并推送

**Files:** None（Git 操作）  
**前置条件:** Task 4 构建验证通过

- [ ] **Step 1: 初始化 Git 仓库**

```bash
git init
```

- [ ] **Step 2: 确认 .gitignore 已就位**

```bash
cat .gitignore
```

Expected: 包含 `node_modules/`、`public/`、`.deploy*/` 等。

- [ ] **Step 3: 提交所有文件**

```bash
git add -A
git commit -m "init: hexo blog with shion theme"
```

- [ ] **Step 4: 添加远程仓库**

在 GitHub 上创建一个**私有仓库**（可由你先手动操作），然后：

```bash
git remote add origin https://github.com/Shionyori/<你的私有仓库名>.git
```

- [ ] **Step 5: 推送到 GitHub**

```bash
git branch -M main
git push -u origin main
```

- [ ] **Step 6: 检查 Actions 运行状态**

打开 GitHub 仓库的 **Actions** 标签页，确认 workflow 运行成功（绿色 ✅）。

---

### Task 7: 验证 gh-pages 分支

**前置条件:** Task 6 Actions 运行成功

- [ ] **Step 1: 检查 gh-pages 分支**

在 GitHub 上打开仓库，切换到 `gh-pages` 分支，确认静态文件已部署。

- [ ] **Step 2: 确认分支结构**

`gh-pages` 分支应包含 `index.html`、`archives/`、`css/` 等构建产物，不包含源码。

---

## 阶段二：公开发布（后续由你手动操作）

1. 修改 `_config.yml` 中的 `url` 为 `https://shionyori.github.io`（如测试时使用了占位值）
2. 将仓库名改为 `shionyori.github.io`
3. 在 Settings → General 将仓库可见性改为 Public
4. 在 Settings → Pages 确认 Source 为 `gh-pages` 分支
5. 访问 `https://shionyori.github.io` 确认上线

---

## 日常发文章流程

```
npx hexo new "文章标题"           # 生成新文章
# 编辑 source/_posts/xxx.md
git add source/_posts/
git commit -m "post: 新文章标题"
git push                         # 自动部署
```

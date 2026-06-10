# Hexo + GitHub Pages 个人技术博客设计文档

## 概述

基于 Hexo 静态网站生成器和 GitHub Actions 自动化部署，搭建一个中文技术博客。使用 Shion 主题，先部署到私有 GitHub 仓库测试，确认无误后再公开上线。

## 技术栈

- **静态生成器**: Hexo 8.x
- **主题**: Shion（自备完整主题，位于 `themes/shion/`）
- **部署**: GitHub Actions → gh-pages 分支 → GitHub Pages
- **包管理器**: pnpm（已有 `pnpm-lock.yaml`）

## 目标地址

- 最终地址: `https://shionyori.github.io`
- 测试阶段: 私有仓库（仓库名灵活），`url` 使用占位值

## 阶段规划

### 阶段一：私有仓库测试

1. 修改 `_config.yml` 关键配置
2. 创建 `.github/workflows/deploy.yml`
3. 初始化 git 仓库并关联 GitHub 私有仓库
4. 推送并观察 Actions 构建结果
5. 本地预览确认效果

### 阶段二：公开发布（用户自行操作）

1. 修改 `_config.yml` 中的 `url` 为 `https://shionyori.github.io`
2. 将仓库名改为 `shionyori.github.io`
3. 仓库设为 public
4. GitHub Pages 自动生效

## 配置详情

### `_config.yml` 修改

```yaml
# Site
title: <博客名称>           # 用户决定
subtitle: ''
description: ''
author: Shionyori
language: zh-CN

# URL
url: https://shionyori.github.io  # 最终地址；测试阶段可留占位值

# Extensions
theme: shion

# Deployment
deploy:
  type: git
  repo: https://github.com/Shionyori/shionyori.github.io.git
  branch: gh-pages
```

### GitHub Actions Workflow (`deploy.yml`)

触发条件: push 到 main 分支

步骤:
1. Checkout 仓库
2. 安装 Node.js
3. 安装 pnpm + 依赖
4. 运行 `hexo generate`
5. 将 `public/` 目录部署到 gh-pages 分支

## 文章发布流程

```
1. npx hexo new "文章标题"
2. 编辑 source/_posts/xxx.md（Markdown）
3. git add & commit & push
4. GitHub Actions 自动构建部署
```

## 主题特性（Shion）

- 多语言支持（zh-CN 已就绪）
- 响应式布局
- 搜索功能
- 阅读进度条
- 多种评论系统（本次不开启）
- 归档/分类/标签页面
- 语法高亮

## 不包含

- 评论系统
- 自定义域名
- 搜索引擎 SEO 优化（后续可加）
- CDN 加速（GitHub Pages 自带）

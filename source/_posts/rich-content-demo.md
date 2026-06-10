---
title: 富文本综合演示
date: 2026-06-10 22:44:00
categories: [测试, 综合]
tags: [demo, formatting]
cover: cover.png
---

本文模拟一篇真正的技术文档——包含 API 接口说明、参数表、代码架构对比、任务清单和框架选型对比，综合测试主题在各种内容形态下的渲染表现。

---

{% note info %}
本文是一篇综合演示文章，包含了多种 Markdown 元素和主题组件。
{% endnote %}

## 技术文档示例

### API 接口说明

获取用户信息的 RESTful 接口：

```http
GET /api/v1/users/:id HTTP/1.1
Host: api.example.com
Authorization: Bearer <token>
Content-Type: application/json
```

响应示例：

```json
{
  "code": 0,
  "data": {
    "id": "u_123456",
    "name": "张三",
    "email": "zhangsan@example.com",
    "avatar": "https://example.com/avatars/default.png",
    "created_at": "2026-01-15T08:30:00Z"
  },
  "message": "success"
}
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `id` | string | ✅ | 用户唯一标识 |
| `fields` | string | ❌ | 返回字段，逗号分隔 |
| `include` | string | ❌ | 关联数据，如 `posts` |

## 代码架构图

{% tabs %}
<!-- tab "目录结构" -->
```
my-blog/
├── source/
│   ├── _posts/        # 文章
│   ├── about/         # 关于页面
│   └── images/        # 图片资源
├── themes/
│   └── shion/          # 主题 (submodule)
├── _config.yml         # 站点配置
└── _config.shion.yml   # 主题覆盖配置
```
<!-- tab "npm scripts" -->
```json
{
  "scripts": {
    "build": "hexo generate",
    "clean": "hexo clean",
    "server": "hexo server"
  }
}
```
<!-- tab "Docker" -->
```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm i -g pnpm hexo-cli
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN hexo generate
EXPOSE 4000
CMD ["hexo", "server", "-p", "4000"]
```
{% endtabs %}

## 任务清单

- [x] 博客搭建
- [x] 主题配置
- [x] GitHub Actions 自动部署
- [x] 404 页面优化
- [ ] 自定义域名
- [ ] 评论系统
- [ ] RSS 订阅

## 对比表格

### 静态博客框架对比

| 框架 | 语言 | 构建速度 | 学习曲线 | 生态 |
|------|------|:--:|:--:|:--:|
| Hexo | Node.js | ⚡ 快 | 低 | 丰富 |
| Hugo | Go | ⚡⚡ 极快 | 中 | 丰富 |
| Jekyll | Ruby | 🐢 慢 | 低 | 非常丰富 |
| Astro | Node.js | ⚡⚡ 极快 | 中 | 成长中 |

## 嵌套引用

> 系统设计的第一原则：
>
> > 简单是可靠的先决条件。
> >
> > — Edsger W. Dijkstra
>
> 这一原则适用于所有工程领域。

## 总结

{% note success %}
主题的富文本渲染能力已经覆盖了技术博客的常见需求：代码高亮、表格、任务列表、嵌套引用、公式支持和各类标签组件。
{% endnote %}

---
title: hexo-theme-shion 配置指南
date: 2026-07-05
updated: 2026-07-06
cover: /images/posts/hexo-theme-shion 配置指南/cover.png
sticky: true
categories: 其他
tags:
  - Hexo
  - 主题
  - 教程
  - Shion
  - 配置
---

介绍 hexo-theme-shion 的安装配置、文章写作规范以及内容组织方式。

---

# 快速开始

## 环境要求

- Hexo 8.x 及以上
- Node.js 18 及以上

## 安装

```bash
cd your-hexo-site
git clone https://github.com/Shionyori/hexo-theme-shion themes/shion

cd themes/shion
npm install && npm run build
```

## 启用

编辑站点根目录的 `_config.yml`，将 `theme` 改为 `shion`：

```yaml
theme: shion
```

## 配置文件

主题的默认配置位于 `themes/shion/_config.yml`。要覆盖默认值，将配置文件复制到站点根目录：

```bash
cp themes/shion/_config.yml _config.shion.yml
```

Hexo 会将 `_config.shion.yml` 深度合并到主题默认配置之上，只需在文件中写入要覆盖的选项。下文的配置示例均指写入 `_config.shion.yml` 的内容。

---

## 站点配置

根目录的 `_config.yml` 是 Hexo 站点配置，几个关键项：

```yaml
# 站点信息
title: My Blog
author: Your Name
language: zh-CN

# 文章资源文件夹（建议开启）
post_asset_folder: true

# 固定链接格式
permalink: :year/:month/:day/:title/

# 主题
theme: shion

# 部署
deploy:
  type: git
  repo: https://github.com/username/username.github.io.git
  branch: gh-pages
```

---

# 文章写作规范

## 创建文章

```bash
hexo new "文章标题"
```

这会在 `source/_posts/` 下生成 `文章标题.md` 以及同名的资源文件夹（需要 `post_asset_folder: true`）。

## Frontmatter

每篇文章顶部的 YAML 区域定义元数据，基本结构：

```yaml
---
title: 文章标题
date: 2026-07-05
categories: Tutorial
tags:
  - Hexo
  - 教程
cover: cover.png
---
```

## 分类

一篇文章只设置一个分类，用于顶层归类：

```yaml
categories: Tutorial
```

注意值是字符串而非列表。常用的分类命名参考：

| 分类 | 用途 |
|------|------|
| `Tutorial` | 教程、指南 |
| `Tech` | 技术分享 |
| `Life` | 生活、随笔 |
| `Notes` | 学习笔记 |
| `DevLog` | 开发日志 |

## 标签

一篇文章可以有多个标签，用于细粒度描述文章涉及的 topic：

```yaml
tags:
  - Hexo
  - JavaScript
  - 前端
```

标签使用建议：

- 每个标签应独立有意义
- 同一含义只用一个标签（不要同时出现 `Tutorial` 和 `教程`）
- 数量控制在 3–8 个，太多会稀释标签云的导航价值

## 封面图

将图片放入文章的资源文件夹，在 frontmatter 中引用：

```yaml
cover: cover.png
```

主题会将其解析为文章资源文件夹下的相对路径。未设置时使用默认封面。

## 摘要

在正文中使用 `<!-- more -->` 截断，之前的段落会显示在首页卡片上：

```markdown
首页显示的摘要内容。

<!-- more -->

文章正文从这里开始。
```

## 草稿

```bash
hexo new draft "草稿标题"
hexo server --draft     # 预览草稿
hexo publish "草稿标题"  # 发布为正式文章
```

---

# 主题配置

`_config.shion.yml` 中可覆盖的配置项按功能分组如下。

## 站点标识

```yaml
favicon: /images/shion/favicon.png
logo:
  text:          # 导航栏文字标题（留空使用站点 title）
  image:         # 导航栏图片 Logo
```

## 导航菜单

导航栏采用三等分布局，菜单项居中于页面中轴，左侧为站点 Logo，右侧为搜索和主题切换按钮。

```yaml
menu:
  Home: /
  Archives: /archives/
  Tags: /tags/
  Categories: /categories/
  About: /about/
  Friends: /friends/
```

键是显示文字，值是页面路径，可自由增删。


## 外观

```yaml
appearance:
  default_mode: auto        # auto | light | dark
  code_theme: auto          # auto | light | dark
  reading_progress: true    # 页面顶部阅读进度条
```

## 首页

```yaml
home:
  posts_per_page: 10
  display_excerpt: true     # 显示摘要而非全文
  excerpt_length: 280       # 自动摘要的字符数上限
```

## 文章

```yaml
post:
  toc: true                 # 右侧目录
  toc_max_depth: 3          # 目录最大标题层级
  copyright: true           # 版权声明
  reading_time: true        # 阅读时间估计
  word_count: true          # 字数统计
  date_format: 'YYYY-MM-DD'
  cover:
    enable: true
    default: /images/shion/default-cover.png
  share:
    enable: true
    platforms: ['twitter', 'facebook', 'linkedin', 'copy']
  copyright_license: 'CC BY-NC-SA 4.0'
  copyright_license_url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
  code:
    highlight: highlight.js
    line_numbers: true
    copy_button: true
  math:
    enable: true
    engine: katex
  image:
    lazy_load: true
    lightbox: true           # 点击图片放大
```

如需在特定文章关闭目录，在 frontmatter 中设置 `toc: false`。需要数学公式的文章设置 `math: true`。

## 侧边栏

侧边栏由个人信息卡片、音乐播放器和若干小部件（widget）组成。全局配置定义默认行为：

```yaml
sidebar:
  enable: true
  position: left             # left | right
  avatar:
    enable: true
    image: /images/avatar.png
  social:
    GitHub: https://github.com/your-username
    Bilibili: https://space.bilibili.com/your-id
  widgets:                   # 全局默认小部件
    - recent-posts
    - categories-widget
    - tags-widget
  recent_posts_count: 5
  tagcloud_min_font: 1.2
  tagcloud_max_font: 2.8
```

### 按页面配置

每个页面的侧边栏可以独立定制。通过 `layouts` 字段按页面类型覆盖，**所有页面统一在这里管理**：

```yaml
sidebar:
  widgets:                          # 全局默认
    - recent-posts
    - categories-widget
    - tags-widget
  layouts:                          # 按页面覆盖
    index:                          # 主页 /
    archive:                        # 归档 /archives/
      widgets: []
    friends:                        # 友链 /friends/
      widgets: []
    tags:                           # 标签 /tags/
      widgets: []
    categories:                     # 分类 /categories/
      widgets: []
    about:                          # 关于 /about/
      widgets: []
```

每个 layout 支持四个键：`enable`（开关侧边栏）、`profile`（个人信息）、`music`（音乐播放器）、`widgets`（小部件列表）。未设置的键自动沿用全局默认值。

> 主页和归档页是 Hexo 自动生成的，没有 `.md` 源文件，只能通过 `layouts` 配置。友链、关于、分类、标签页除了 `layouts` 外，也可在各自的 `.md` frontmatter 中写 `sidebar:` 做一次性覆盖。

### 社交图标与小部件

支持的社交平台键名：`GitHub`, `Twitter`, `Facebook`, `Instagram`, `YouTube`, `Bilibili`, `Email`, `RSS`, `Steam`, `Discord`, `Telegram`, `LinkedIn`, `Weibo`, `Zhihu`, `Douban`, `NPM`, `Patreon`, `Reddit`, `Twitch`, `Spotify`, `Medium`, `CodePen`, `GitLab`, `StackOverflow`, `Mastodon`。

可选的小部件：`recent-posts`, `categories-widget`, `tags-widget`, `tagcloud`, `archives-widget`。

## 评论

```yaml
comments:
  enable: true
  type: giscus               # giscus | disqus | waline | twikoo | valine | gitalk | utterances
  giscus:
    repo: username/repo
    repo_id: 'xxx'
    category: Announcements
    category_id: 'xxx'
    mapping: pathname
```

不同系统的具体参数见[主题配置文档](https://github.com/Shionyori/hexo-theme-shion/blob/main/docs/configuration.md)。

## 搜索

基于 Fuse.js 的本地搜索，快捷键 `Ctrl+K` / `Cmd+K`：

```yaml
search:
  enable: true
```

## 数据分析

```yaml
analytics:
  google: G-XXXXXXXXXX      # Google Analytics
  baidu: xxxxxxxxxxxxx       # 百度统计
```

## 音乐播放器

侧边栏内置 HTML5 音乐播放器，支持 MP3/OGG/WAV：

```yaml
music:
  enable: true
  playlist:
    - name: '曲名'
      artist: '艺术家'
      url: '/music/song.ogg'
      cover: '/music/cover.jpg'
```

快捷键：`Space` 播放/暂停，`Ctrl+→` 下一首，`Ctrl+←` 上一首。播放状态通过 localStorage 持久化，跨页面导航不中断。

## 页脚

```yaml
footer:
  since: 2024               # 版权起始年份
  powered_by: true
  theme_by: true
  icp: ''                   # ICP 备案号
```

## 过期提醒

超过指定天数的文章顶部显示提醒：

```yaml
outdate:
  enable: true
  days: 365
```

## 自定义样式与脚本

```yaml
custom_css: /css/custom.css
custom_js: /js/custom.js
```

## 字体

```yaml
fonts:
  heading: "'Noto Serif SC', Georgia, serif"
  body: "'Noto Sans SC', Inter, sans-serif"
  code: "'JetBrains Mono', 'Fira Code', Consolas, monospace"
  size_root: 15px
```

外部字体需要自行加载（通过 `custom_css` 或在模板中注入 `<link>` 标签）。

---

# 内容组织

## 目录结构

```
source/
├── _posts/
│   ├── 2026-07-05-my-post.md
│   ├── 2026-07-05-my-post/        # 资源文件夹
│   │   ├── cover.png
│   │   └── diagram.png
│   └── ...
├── about/
│   └── index.md
├── categories/
│   └── index.md
├── tags/
│   └── index.md
├── friends/
│   └── index.md
├── music/
│   └── song.ogg
└── images/
    └── avatar.png
```

## 创建独立页面

```bash
hexo new page about
hexo new page friends
```

各页面的 `layout` 字段：

| 页面 | layout |
|------|--------|
| 关于 | `about` |
| 友链 | `friends` |
| 分类 | `categories` |
| 标签 | `tags` |

友链页面使用 `layout: friends`，在 frontmatter 中填写 `friends` 数据。卡片采用双列网格布局，带有浮现入场动画：

```yaml
---
title: 友链
layout: friends
friends:
  - name: Example Blog
    url: https://example.com
    avatar: https://example.com/avatar.jpg
    description: A great tech blog
---
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 显示名称 |
| `url` | 是 | 链接地址 |
| `avatar` | 否 | 头像 URL，失败时回落为首字母图标 |
| `description` | 否 | 一行简介 |

如需调整友链页的侧边栏组件，在 `_config.shion.yml` 的 `sidebar.layouts.friends` 中配置即可。

---

# 常用命令

```bash
hexo new "标题"             # 新建文章
hexo new page "页面名"       # 新建页面
hexo new draft "草稿"       # 新建草稿
hexo server                 # 启动开发服务器
hexo server -p 5000         # 指定端口
hexo server --draft         # 预览草稿
hexo generate               # 生成静态文件
hexo clean                  # 清除缓存
hexo deploy                 # 部署
hexo publish "草稿名"       # 发布草稿
```

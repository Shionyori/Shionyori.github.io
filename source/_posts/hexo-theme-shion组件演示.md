---
title: hexo-theme-shion 组件演示
date: 2026-07-05
updated: 2026-07-06
cover: /images/posts/hexo-theme-shion 组件演示/cover.png
sticky: true
categories: 其他
tags:
  - Hexo
  - 主题
  - 教程
  - Shion
  - 标签组件
math: true
---

逐一演示 hexo-theme-shion 内置的标签组件和主要功能特性。

---

# 标签组件

## Note 提示框

四种语义的提示框：`info`（信息）、`warning`（警告）、`success`（成功）、`danger`（危险）。

{% note info %}
补充说明或背景信息。适合放在正文中提供额外上下文。
{% endnote %}

{% note warning %}
提醒注意潜在风险或重要事项。不要过度使用，否则会降低警示效果。
{% endnote %}

{% note success %}
操作完成、结论总结时使用。比如"以上配置完成后即可正常运行"。
{% endnote %}

{% note danger %}
可能导致数据丢失或系统异常的严重警告。例如"此操作不可逆，执行前请备份"。
{% endnote %}

语法：

```njk
{% note info %}
补充说明内容。
{% endnote %}
```

四种样式通过 `info` / `warning` / `success` / `danger` 切换。

---

## Image 图片

图片标签支持命名参数模式。未设置 `nozoom` 的图片可点击放大。

{% image src=https://shionyori.github.io/images/shion/hero.png alt=Hero caption="带标题的图片，点击可放大" %}

指定宽度的图片：

{% image src=https://shionyori.github.io/images/shion/hero.png alt=Hero size="300" caption="宽度 300 像素" %}

居中显示：

{% image src=https://shionyori.github.io/images/shion/hero.png alt=Hero align=center size="300" caption="居中对齐" %}

禁用点击缩放（适合图标类小图）：

{% image src=https://shionyori.github.io/images/shion/favicon.png alt=Favicon nozoom=true %}

语法：

```njk
{% image src=image.png alt=描述 caption=标题 %}
{% image src=image.png size="400" %}
{% image src=image.png size="600 400" %}
{% image src=image.png align=center %}
{% image src=image.png nozoom=true %}
{% image src=icon.png inline=true %}
```

| 参数 | 说明 |
|------|------|
| `src` | 图片路径，必填 |
| `alt` | 替代文本 |
| `caption` | 图片下方标题 |
| `size` | `"宽 高"` 格式，单值表示宽度 |
| `align` | `left` / `center` / `right` |
| `nozoom` | `true` 禁用点击放大 |
| `inline` | `true` 内联展示 |

---

## Quote 引用块

带作者和来源标注的引用样式。

{% blockquote "Steve Jobs" "Apple Special Event (2005)" %}
Stay hungry, stay foolish.
{% endblockquote %}

{% blockquote "杜甫" "茅屋为秋风所破歌" %}
安得广厦千万间，大庇天下寒士俱欢颜。
{% endblockquote %}

语法：

```njk
{% blockquote "作者" "出处" %}
引用文字。
{% endblockquote %}
```

第二个参数（来源）可省略，两个参数都省略时退化为普通引用块样式。

---

## Details 折叠面板

{% details "点击展开：环境配置步骤" %}

1. 安装 Node.js 20+
2. 全局安装 Hexo CLI：`npm i -g hexo-cli`
3. 初始化站点：`hexo init blog && cd blog`
4. 安装主题：`git clone https://github.com/Shionyori/hexo-theme-shion themes/shion`
5. 构建主题：`cd themes/shion && npm install && npm run build`
6. 启动开发服务器：`cd ../.. && hexo server`

{% enddetails %}

语法：

```njk
{% details "点击展开的标题" %}
折叠内容，支持 Markdown、代码块等。
{% enddetails %}
```

---

## Tabs 标签页

适合并排展示同类内容的变体。

{% tabs %}
<!-- tab TypeScript -->
```typescript
interface SiteConfig {
  title: string
  author: string
  theme: string
}

function loadConfig(): SiteConfig {
  return require('./_config.yml') as SiteConfig
}
```
<!-- tab JavaScript -->
```javascript
function loadConfig() {
  const fs = require('fs')
  const yaml = require('js-yaml')
  const raw = fs.readFileSync('./_config.yml', 'utf8')
  return yaml.load(raw)
}
```
<!-- tab Python -->
```python
import yaml

def load_config():
    with open('_config.yml', 'r') as f:
        return yaml.safe_load(f)
```
{% endtabs %}

指定默认激活的标签页（从 0 计数）：

{% tabs 1 %}
<!-- tab 第一项 -->
默认不显示的内容。
<!-- tab 第二项 -->
默认显示的内容。
{% endtabs %}

语法：

```njk
{% tabs %}
<!-- tab "标签名" -->
标签内容
<!-- tab "另一个标签" -->
另一个标签内容
{% endtabs %}
```

`{% tabs 1 %}` 中的数字指定默认激活的 tab 索引。

---

## LinkCard 链接卡片

{% linkCard "Hexo" "https://hexo.io" "A fast, simple & powerful blog framework" %}

{% linkCard "hexo-theme-shion" "https://github.com/Shionyori/hexo-theme-shion" "A clean, content-first Hexo blog theme themed around Shion Yorigami" %}

语法：

```njk
{% linkCard "标题" "https://url" "描述（可选）" %}
```

---

## PostLinkCard 文章内链卡片

{% postLinkCard "hexo-theme-shion-setup" %}

参数为文章的文件名（不含日期前缀和 `.md` 后缀）。渲染效果为可点击的卡片，包含标题和日期。

语法：

```njk
{% postLinkCard "文章文件名" %}
```

---

# 内容排版

## 代码块

主题集成 highlight.js，支持 190+ 种语言的语法高亮。默认显示行号和复制按钮。

```typescript
// 带有高亮、行号和复制按钮的代码块
async function fetchPosts(page: number): Promise<Post[]> {
  const res = await fetch(`/api/posts?page=${page}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
```

也可以通过配置关闭行号或复制按钮：

```yaml
post:
  code:
    line_numbers: false
    copy_button: false
```

---

## 表格

Markdown 表格直接渲染，自动适配主题配色：

| 评论系统 | 类型 | 配置复杂度 |
|----------|------|:--:|
| Giscus | GitHub Discussions | 低 |
| Waline | 自托管 | 中 |
| Disqus | SaaS | 低 |
| Twikoo | 腾讯云 | 中 |

---

## 数学公式

主题内置 KaTeX 渲染。在 frontmatter 中设置 `math: true` 后，用 `$` 包裹行内公式，`$$` 包裹块级公式。

行内公式举例：$E = mc^2$

块级公式：

$$\int_{a}^{b} f(x) \, dx = F(b) - F(a)$$

$$\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}$$

没有 `math: true` 的文章不会加载 KaTeX，以减少页面体积。

---

# 主题功能

## 搜索

按下 `Ctrl+K`（macOS 为 `Cmd+K`）或点击导航栏搜索图标唤出搜索框。基于 Fuse.js 实现本地模糊搜索，不需要后端服务。

需要确保配置中开启：

```yaml
search:
  enable: true
```

---

## 暗色模式

导航栏的调色板按钮切换三种模式：跟随系统、浅色、深色。选择保存在 localStorage 中，刷新不丢失。

默认模式配置：

```yaml
appearance:
  default_mode: auto
```

---

## 音乐播放器

侧边栏底部内置音乐播放器，支持播放列表、四种播放模式（顺序、列表循环、单曲循环、随机）。

键盘快捷键（输入框聚焦时不触发）：

| 快捷键 | 操作 |
|--------|------|
| `Space` | 播放 / 暂停 |
| `Ctrl+→` | 下一首 |
| `Ctrl+←` | 上一首 |

播放进度、音量、当前曲目和播放模式跨页面保持。

---

## 过期提醒

超过设定天数的文章会在顶部显示提醒横幅：

```yaml
outdate:
  enable: true
  days: 365
```

## 版权声明

文章末尾自动生成版权信息，许可协议可在配置中自定义。

---

## 阅读进度条

页面顶部显示阅读进度条，基于 `IntersectionObserver` 实现，随页面滚动实时更新。通过配置开关：

```yaml
appearance:
  reading_progress: true
```

---

## 友链页面

主题内置友链页面（`layout: friends`），以双列卡片网格展示外部链接。每张卡片包含头像、名称和简介，加载时带有依次浮现的入场动画。

创建 `source/friends/index.md`：

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

头像加载失败时自动回落为首字母占位图标。未填写 URL 的卡片变为静态展示（无悬浮效果、不可点击）。

---

## 侧边栏按页配置

侧边栏组件（个人信息、音乐、小部件）可以按页面类型独立配置。在 `_config.shion.yml` 的 `sidebar.layouts` 中统一管理：

```yaml
sidebar:
  widgets:                    # 全局默认
    - recent-posts
  layouts:
    index:                    # 主页
    archive:                  # 归档
      widgets: []
    friends:                  # 友链
      widgets: []
    tags:                     # 标签
      widgets: []
    categories:               # 分类
      widgets: []
    about:                    # 关于
      widgets: []
```

每个 layout 支持 `enable`、`profile`、`music`、`widgets` 四个键，未设自动沿用全局值。主页和归档页由 Hexo 自动生成，只能通过 `layouts` 配置。

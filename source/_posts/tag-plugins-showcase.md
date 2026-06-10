---
title: 标签组件展示
date: 2026-06-10 22:42:00
categories: [测试, 组件]
tags: [tag-plugins, demo]
cover: cover.png
---

Shion 主题内置了七种 Nunjucks 标签组件，无需编写 HTML 即可在文章中插入丰富的交互元素。本文逐一展示 Note、Details、Tabs、Quote、LinkCard 和 PostLinkCard 的用法与效果。

---

## Note 提示框

{% note info %}
**信息提示** — 用于补充说明、背景信息或温馨提示。
{% endnote %}

{% note warning %}
**警告提示** — 提醒读者注意潜在风险或重要事项。
{% endnote %}

{% note success %}
**成功提示** — 操作完成、目标达成时使用。
{% endnote %}

{% note danger %}
**危险提示** — 可能导致数据丢失、系统崩溃等严重后果的操作。
{% endnote %}

## Details 折叠面板

{% details "点击展开：环境配置步骤" %}
1. 安装 Node.js（推荐 v20+）
2. 安装 pnpm：`npm i -g pnpm`
3. 克隆项目：`git clone <repo-url>`
4. 安装依赖：`pnpm install`
5. 启动开发：`npx hexo server`

```bash
node --version  # v20.x
pnpm --version  # 9.x
```
{% enddetails %}

## Tabs 标签页

{% tabs %}
<!-- tab "TypeScript" -->
```typescript
interface Config {
  port: number;
  debug: boolean;
}

function loadConfig(path: string): Config {
  const raw = Deno.readTextFileSync(path);
  return JSON.parse(raw) as Config;
}
```
<!-- tab "Python" -->
```python
from dataclasses import dataclass
import json

@dataclass
class Config:
    port: int
    debug: bool

def load_config(path: str) -> Config:
    with open(path) as f:
        return Config(**json.load(f))
```
<!-- tab "Rust" -->
```rust
use serde::Deserialize;
use std::fs;

#[derive(Deserialize)]
struct Config {
    port: u16,
    debug: bool,
}

fn load_config(path: &str) -> Config {
    let raw = fs::read_to_string(path).unwrap();
    serde_json::from_str(&raw).unwrap()
}
```
{% endtabs %}

## Quote 引用块

{% blockquote "Steve Jobs" "Apple Special Event (2005)" %}
Stay hungry, stay foolish.
{% endblockquote %}

{% blockquote "杜甫" "茅屋为秋风所破歌" %}
安得广厦千万间，大庇天下寒士俱欢颜。
{% endblockquote %}

## LinkCard

{% linkCard "https://hexo.io" "Hexo" "A fast, simple & powerful blog framework" %}

## PostLinkCard

{% postLinkCard "hello-world" %}

---
title: 代码高亮测试
date: 2026-06-10 22:31:00
categories:
 - [Theme]
tags:
 - [JavaScript]
 - [TypeScript]
 - [CSS]
 - [HTML]
 - [Shell]
cover: cover.png
---

主题内置 highlight.js 语法高亮，支持 190+ 种语言。本文逐一展示前端开发中最常用的几种语言代码块渲染效果，涵盖行号、高亮主题、一键复制等功能。

---

{% note info %}
所有代码块默认**显示行号**，右上角有**一键复制**按钮。
{% endnote %}

## HTML

一段典型的 HTML5 文档结构，展示了语义化标签和嵌套缩进：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>示例页面</title>
</head>
<body>
  <div class="container">
    <h1>Hello World</h1>
    <p>这是一个 HTML 示例。</p>
  </div>
</body>
</html>
```

## CSS

使用 CSS 自定义属性（变量）管理主题色和圆角，配合过渡动画实现悬停效果：

```css
:root {
  --color-primary: #6b7eb5;
  --radius-md: 8px;
}

.card {
  background: var(--color-bg);
  border-radius: var(--radius-md);
  padding: 24px;
  transition: box-shadow 0.3s ease;
}

.card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}
```

## JavaScript

迭代版斐波那契数列，时间复杂度 O(n)，空间复杂度 O(1)：

```javascript
function fibonacci(n) {
  if (n <= 1) return n;

  let prev = 0, curr = 1;
  for (let i = 2; i <= n; i++) {
    [prev, curr] = [curr, prev + curr];
  }
  return curr;
}

console.log(fibonacci(10)); // 55
```

## TypeScript

带类型定义的异步数据获取函数，展示 interface、泛型和错误处理：

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }
  return response.json() as Promise<User>;
}
```

## Shell

批量处理 Markdown 文件的换行符转换脚本：

```bash
#!/bin/bash
for file in *.md; do
  echo "Processing: $file"
  sed -i 's/\r$//' "$file"
done
echo "Done!"
```

---

> 主题支持的语言高亮参见 [highlight.js 文档](https://highlightjs.readthedocs.io/)。

---
title: 代码示例
date: 2026-06-10 22:31:00
categories: 测试
tags: [code, demo]
cover: cover.png
---

## HTML

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
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

```css
:root {
  --color-primary: #6b7eb5;
  --radius-md: 8px;
}

.card {
  background: var(--color-bg);
  border-radius: var(--radius-md);
  transition: box-shadow 0.3s ease;
}

.card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}
```

## JavaScript

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

```bash
#!/bin/bash
for file in *.md; do
  echo "Processing: $file"
  sed -i 's/\r$//' "$file"
done
echo "Done!"
```

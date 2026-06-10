---
title: 图片插入测试
date: 2026-06-10 22:43:00
categories: [测试, 组件]
tags: [images, demo]
cover: cover.png
---

本文测试主题的图片插入功能。

## 基础图片

{% image src=813822.png alt=示例图片 caption=基础图片展示 %}

## 指定尺寸

{% image src=1066785.png alt=尺寸示例 caption="宽度 400 像素" size="400" %}

## 居中对齐 + 标题

{% image src=1125589.png alt=居中图片 caption="居中对齐，带标题" align=center %}

## 禁用缩放

{% image src=1280230.png alt=禁用缩放 caption="点击无效，不会放大" nozoom=true %}

## 右对齐

{% image src=1308599.png alt=右对齐 caption="右对齐图片" align=right size="300" %}

## 内联图片

这是一段文字，中间插入一个 {% image src=7A0AE2A9760CAF09D2C4360798FA4677.png alt=内联 inline=true %} 内联小图标，文字继续。

## 图片并排对比

| {% image src=9E1217217AF97EDE2F808A658C36FDA0.png alt=左图 nozoom=true %} | {% image src=813822.png alt=右图 nozoom=true %} |
|:--:|:--:|
| 左图 | 右图 |

## 大图

{% image src=1066785.png alt=大图 caption="宽屏图片" %}

---

> 点击图片可以放大查看（未设置 `nozoom=true` 的图片）。

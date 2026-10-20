---
title: Powershell 更新通知加载失败导致的崩溃
date: 2026-10-20
categories: 
  - 杂谈
tags:
  - Powershell
---

# Powershell 启动时崩溃

尝试启动 Powershell 7.6.6 时，进程会直接闪退，无法正常启动。

{% image src=/images/posts/Powershell更新通知加载失败导致的崩溃/1.png %}

# 为什么启动时会崩溃？

这是 PowerShell 7.6.6 目前已知的一个 Bug。

简单来说，是因为 PowerShell 错误地计算了更新通知消息的宽度，进而触发异常，导致进程崩溃。

当 PowerShell 检测到有新版本可用，并准备在启动时显示更新通知时，会调用 `UpdatesNotification.ShowUpdateNotification()` 方法来绘制提示框。这个方法里的代码有一个错误的假设，它认为通知消息的第一行永远是最长的，并据此用第一行的长度去为其他行计算填充宽度。

在简体中文环境下，通知的第三行包含一个完整的发布链接，其实际长度（例如 57 个字符）反而超过了第一行（例如 37 个字符）。这就导致计算出的填充宽度变成了一个负数（37 - 57 + 3 = -17，正如图中信息所示）。当程序试图调用 `PadRight(-17)` 时，抛出 `ArgumentOutOfRangeException`，并触发 `Environment.FailFast()` 导致进程直接闪退。日文、韩文等环境也会遇到类似问题，只是负数数值不同（如日文为 -10，韩文为 -23）。

# 目前的解决方案

在官方彻底修复这个 Bug 之前，为了能够正常启动 PowerShell，建议暂时禁用更新通知功能。

可以直接在 Windows PowerShell 中执行命令来禁用 PowerShell 7 的更新通知:

{% image src=/images/posts/Powershell更新通知加载失败导致的崩溃/2.png %}
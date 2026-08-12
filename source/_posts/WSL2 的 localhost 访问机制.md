---
title: WSL2 的 localhost 访问机制
date: 2026-08-12
updated: 2026-08-12
cover: cover.png
categories: 其他
tags:
  - WSL2
  - localhost
  - Mirrored 模式
  - NAT 模式
---

在 WSL2 中运行 Vite 服务时，发现在宿主机的浏览器上无法通过 `localhost:5173` 进行访问。已知 Vite 绑定到回环地址 `127.0.0.1`，而且 WSL2 开启了 Mirrored 模式，按理来说会共享宿主机的局域网 IP。

---

# Windows 不能通过本机局域网 IP 访问 WSL2 上的服务

首先经过多次尝试发现，mirrored 模式允许宿主机和 WSL2 之间直接通过回环地址访问对方的服务，但是 Windows 无法直接通过本机局域网 IP（`192.168.1.x`） 访问 WSL2。

| Attempt                         | 宿主机（Windows）      | WSL2（服务所在） |
| ------------------------------- | ----------------- | ---------- |
| `curl http://192.168.1.16:5173` | Failed to connect | Succeed    |
| `curl localhost:5173`           | Succeed           | Succeed    |
| `curl 127.0.0.1:5173`           | Succeed           | Succeed    |

对此去了解了具体的通信流程，得知这主要是 Windows 自身的回环短路优化机制导致的。

数据包的具体交换流程如下：

1. 浏览器发起请求，目标 IP = `192.168.1.16`
2. Windows 网络栈查路由表，发现 `192.168.1.16` 属于本机
3. 触发**内核级回环短路优化**，数据包直接在 Windows 网络栈内部回转
4. 数据包未经过物理网卡，也未经过 Hyper-V 虚拟交换机
5. WSL2 虚拟机无法感知任何数据包，连接失败

因此想要在 Windows 访问 WSL2 上的服务不能使用本机局域网 IP，而应该使用回环地址。

# Windows 与 WSL2 通过回环地址的相互访问

于是我做了进一步的测试：使用回环地址，服务分别位于宿主机和 WSL2，测试在不同的网络模式下的可达性。

| Request                       | 网络模式           | 可达性 / 数据包入口     |
| ----------------------------- | -------------- | ------------- |
| Windows → WSL2（localhost） | NAT           | 成功，WSL2 的 `lo`（经代理模拟）  |
| Windows → WSL2（localhost） | Mirrored      | 成功，WSL2 的 `eth0`（Hyper-V 投递） |
| WSL2 → Windows（localhost） | NAT           | 失败                     |
| WSL2 → Windows（localhost） | Mirrored      | 成功，Windows 的 `lo`（识别为本地回环）  |
| WSL2 → Windows（网关/局域网IP）    | NAT / Mirrored | Windows 的物理/虚拟网卡（外部流量）       |

1. Windows 浏览器访问 `localhost:5173`（WSL2 上的服务）
    - NAT 模式：Windows 主机的 `wslservice.exe` 进程在 `127.0.0.1` 的端口上进行监听。发出的请求被该进程接收后，经由应用层的转发管道，投递至 WSL2 内部的代理服务，然后**由该代理在 WSL2 内部发起新的请求**，源 IP 为 `127.0.0.1`，命中 `lo` 回环接口。
    - Mirrored 模式：Windows 将目标为 `127.0.0.1` 的数据包通过 Hyper-V 虚拟交换机直接投递给 WSL2 的虚拟网卡 `eth0`。

2. WSL2 内部访问 `localhost:7890`（Windows 上的服务）
    - NAT 模式：WSL2 内部的 `127.0.0.1` 仅指向 Linux 自身的 `lo` 回环接口。在 WSL2 内部访问 `localhost:7890` 只会在 Linux 的网络栈内相应的进程，数据包根本无法到达 Windows 主机。
    - Mirrored 模式：WSL2 的 Linux 内核中注入了 BPF 钩子，它会拦截发往 `127.0.0.1` 的数据包，将其出口由 `lo` 接口切换至虚拟网卡 `eth0`。数据包从 `eth0` 发出后，经由 Hyper-V 虚拟交换机送达 Windows 主机。与 Linux 不同，Windows 的 TCP/IP 协议栈只要看到一个数据包的目标 IP 是 `127.0.0.1`，**无论来源，都会作为本机回环流量处理**，投递给 Windows 的 `lo` 回环接口。

可见在 NAT 模式下数据包只能从 Windows 到 WSL2；而在 Mirrored 模式下数据包在 Windows 与 WSL2 之间的交换可以是双向的，但是机制有所不同。

# WSL2 上的服务进程需要监听 0.0.0.0

从上面的分析可知，在 Mirrored 模式下，当我们从 Windows 浏览器访问 `localhost:5173` 时，数据包在 Linux 内核中是从 `eth0`（外部网卡）进入的，它的源 IP 为 `192.168.1.16`，也就是主机的局域网 IP。

| Listen          | 含义                          | 在 WSL2 中的具体表现       |
| --------------- | --------------------------- | ------------------------------------ |
| `127.0.0.1` | 只监听 `lo`（回环接口）             | 只能接受来源 IP 是 `127.0.0.1` 的包 |
| `0.0.0.0`   | 监听本机所有网络接口（`lo` + `eth0` 等） | 只要目标端口匹配，Linux 内核就会接收 |

而 Linux 内核存在一种**源地址校验机制**：源 IP 非 `127.0.0.1` 的包不允许发往 `127.0.0.1`。这也就意味着，如果服务进程只监听 `127.0.0.1`，Linux 内核会因源地址校验机制而将数据包丢弃。

因此，为了让 Windows 能通过 `localhost` 访问 WSL2 的服务，其上的服务进程必须监听 `0.0.0.0`。 
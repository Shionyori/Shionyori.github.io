---
title: IO 模型
date: 2025-09-24
updated: 2026-10-04
cover: /images/posts/IO 模型/cover.png
categories: 网络编程
tags:
  - IO模型
  - epoll
  - select
  - poll
  - C++
  - 网络编程
---

IO 模型是描述程序与输入/输出操作之间交互方式的抽象概念，广泛应用于网络编程和操作系统中。

一次 `socket` 读取在底层其实可以拆成两个阶段：

1. 等待数据就绪：数据包从网卡到达，经过内核协议栈处理，被放进该 `socket` 的**接收缓冲区**。这个阶段要等网络，耗时不确定。
2. 拷贝数据：把数据从内核的接收缓冲区**拷贝到用户空间**。这个阶段是纯内存操作，很快。

按照这两个阶段的阻塞情况，可以将 IO 模型分为五种：

| IO 模型 | 等待数据 | 拷贝数据 |
| --- | --- | --- |
| 阻塞 IO | 阻塞 | 阻塞 |
| 非阻塞 IO | 轮询，不阻塞 | 阻塞 |
| IO 多路复用 | 阻塞在 `select` / `poll` / `epoll` 上 | 阻塞 |
| 信号驱动 IO | 不阻塞（等 `SIGIO` 信号） | 阻塞 |
| 异步 IO | 不阻塞 | 不阻塞 |

---

# 1. 阻塞与非阻塞

`socket` 存在两种模式：
1. **阻塞**：当一个线程对一个 `socket` 进行读写操作时（如调用 `recv()`），如果 `socket` 缓冲区没有可读数据/可写空间，线程就会被阻塞
2. **非阻塞**：当一个线程对一个 `socket` 进行读写操作时，线程不会被阻塞，而是返回错误码，程序需要不断轮询 `socket` 状态直到 `socket` 就绪并完成相应读写操作

`socket` 默认为阻塞模式，可以通过以下方式改为非阻塞模式：

```cpp
int flags = fcntl(fd, F_GETFL, 0); // 先获取 fd 的当前标志位
fcntl(fd, F_SETFL, flags | O_NONBLOCK); // 将原有标志位与 O_NONBLOCK 进行或运算，再一并写回
```

如果不引入额外机制，非阻塞模式会导致 IO 不断轮询，浪费 CPU 资源。

因此 `socket` 的非阻塞模式一般与 IO 多路复用机制（如 `epoll`）配合使用：
- IO 多路复用：内核主动告知哪些 `fd` 就绪，避免用户态无效轮询
- 非阻塞：确保拿到就绪通知后，实际的读写操作不会意外卡住线程

两者结合，既消除了 CPU 空转浪费，又避免了线程阻塞开销，构成了高性能网络模型（如 Reactor）的基石。

# 2. IO 多路复用

IO 多路复用是指**一个线程同时监听多个文件描述符（socket）**，当某个 `socket` **就绪时再进行处理**。

常见实现方式：

- `select`：同时监视多个文件描述符集合，调用会返回就绪的文件描述符数量；`socket` 数量有限制，每次调用会在用户态和内核态之间复制文件描述符集合，线性状态检查。
- `poll`：通过数组存储文件描述符，每一个都对应一个 `pollfd` 结构，调用返回就绪的文件描述符数量，程序通过遍历数组找到就绪的 `socket`；没有数量限制，但是和 `select` 一样会在用户态和内核态之间复制，状态检查也是线性的。
- `epoll`：内核维护一个文件描述符表，通过红黑树存储文件描述符，只返回就绪的 `fd`，同时避免了上面两者的重复拷贝和线性扫描。

## 2.1 select

`select` 使用 **位图** (`fd_set`) 存储所有需要监听的文件描述符。

### 2.1.1 工作流程

1. 用户态准备：用户程序构造 `fd_set` 位图，将关心的 `fd` 对应位设置为 1，并设置超时时间。
2. 系统调用：调用 `select()`，内核将用户态的 `fd_set` 完整拷贝到内核态。
3. 内核态处理：
    - 内核线性遍历拷贝过来的所有 `fd`，对每一个调用它对应的 `poll` 方法。
    - 每个 `poll` 方法会把这个进程登记到该 `fd` 的等待队列上；全部登记完成后，进程进入睡眠。
    - 当某个 `socket` 有数据到达时，协议栈会唤醒它等待队列上的进程；超时同样会唤醒。
    - 进程被唤醒后，内核再次线性遍历所有 `fd`，检查哪些就绪，并把结果写回 `fd_set`。
4. 返回用户态：内核将修改后的 `fd_set` 完整拷贝回用户态。
5. 用户态处理：用户程序再次线性遍历 `fd_set`，通过检查位状态找到就绪的 `fd` 并进行读写。

### 2.1.2 函数原型

```cpp
int select(int maxfdp, fd_set *readfds, fd_set *writefds, fd_set *errorfds, struct timeval *timeout);
```

- `maxfdp`：监听的最大 `fd` 加 1（内核要遍历 `0` 到 `maxfdp - 1`）
- `timeout`：`nullptr` 表示无限等待，`{0, 0}` 表示立即返回（纯轮询）

### 2.1.3 使用示例

```cpp
fd_set readfds;

FD_ZERO(&readfds);
FD_SET(server_fd, &readfds);
FD_SET(client_fd, &readfds);

int max_fd = std::max(server_fd, client_fd);

int activity = select(max_fd + 1, &readfds, nullptr, nullptr, nullptr);

if (activity > 0) {
    if (FD_ISSET(server_fd, &readfds)) {
        // 新连接到达
    }

    if (FD_ISSET(client_fd, &readfds)) {
        // 客户端数据可读
    }
}
```

### 2.1.4 select 存在的问题

- `select()` 返回后，传入的 `fd_set` 会被内核修改，只有就绪的 `fd` 对应的位还保留着 1，其他位会被清零。这就意味着原本记录了用户态关心的（需要监听的） `fd` 的 `fd_set` 会被破坏，无法重复使用。因此每次调用 `select()` 前都**需要重新构造** `fd_set`。
- `fd_set` 的大小由**编译期常量** `FD_SETSIZE` 决定（通常为 1024），想要修改就必须重新编译。
- 如果 `fd` 的编号大于等于 `FD_SETSIZE`，`FD_SET` 就会**越界写内存**；而 `fd` 的编号一般是进程内递增复用的，很容易到 1024 以上。
- 每次都**需要遍历整个** `fd_set`，即使只有少数几个 `fd` 就绪，也要为所有 `fd` 付出 O(n) 的开销。

## 2.2 poll

`poll` 使用 `pollfd` 数组存储所有需要监听的文件描述符。

### 2.2.1 工作流程

1. 用户态准备：用户程序构造 `pollfd` 结构体数组，填写 `fd` 和关注的事件（events）。
2. 系统调用：调用 `poll()`，内核将用户态的 `pollfd` 数组 完整拷贝到内核态。
3. 内核态处理：
    - 内核线性遍历数组中的每个 `pollfd` 条目，对每一个调用它对应的 `poll` 方法。
    - 每个 `poll` 方法会把这个进程登记到该 `fd` 的等待队列上；全部登记完成后，进程进入睡眠。
    - 当某个 `socket` 有数据到达时，协议栈会唤醒它等待队列上的进程；超时同样会唤醒。
    - 进程被唤醒后，内核再次线性遍历所有条目，检查哪些就绪，并把结果填入 `revents`。
4. 返回用户态：内核将修改后的 `pollfd` 数组 完整拷贝回用户态。
5. 用户态处理：用户程序再次线性遍历数组，检查 `revents` 字段找到就绪的 `fd`。

### 2.2.2 结构体与函数原型

```cpp
struct pollfd {
    int fd;        // 文件描述符
    short events;  // 监听事件（输入）
    short revents; // 实际发生事件（输出）
};

int poll(struct pollfd *fds, nfds_t nfds, int timeout);
```

对比 `select`，`poll` 做了两个改进：

1. 没有数量上限：数组大小由你自己决定，不受 `FD_SETSIZE` 约束
2. 输入输出分离：`events` 是你要监听的，`revents` 是内核填的结果，两者是不同的字段（`pollfd` 数组**可以重复使用**，不需要每轮重建）

### 2.2.3 使用示例

```cpp
struct pollfd fds[2];

fds[0].fd = server_fd;
fds[0].events = POLLIN;

fds[1].fd = client_fd;
fds[1].events = POLLIN;

int activity = poll(fds, 2, -1);

if (activity > 0) {
    if (fds[0].revents & POLLIN) {
        // 服务器 socket 就绪
    }

    if (fds[1].revents & POLLIN) {
        // 客户端 socket 有数据
    }
}
```

`poll` 仍然遗留的问题是：每次调用都要**把整个数组拷贝进内核**，内核还要**线性扫描全部条目**。连接数到几万时，这个 O(n) 的开销就成了瓶颈，哪怕只有 10 个连接活跃，也要为所有 10 万个 `fd` 付出拷贝和扫描的代价。

## 2.3 epoll

`epoll` 是 Linux 高性能 IO 多路复用机制，核心思想是**只返回就绪的** `fd`。

它在内核里维护两张结构：

- **红黑树**：存放所有被监听的 fd，支持 `O(log n)` 的增删改查
- **就绪队列**：存放已经就绪的 fd，是一个双向链表

### 2.3.1 工作流程

1. 用户态准备（分离管理）：
    - 调用 `epoll_create()` 创建内核事件表（红黑树）。
    - 调用 `epoll_ctl()` 将关心的 `fd` 添加/修改/删除到内核事件表中（此时发生拷贝，但仅针对单个 fd）。
2. 系统调用：调用 `epoll_wait()`，无需传递 fd 集合，只传递最大等待数。
3. 内核态处理：
    - 内核直接检查就绪队列（只需查看队首元素判断队列是否为空，时间复杂度为 O(1)）。
    - 关键机制：当某个 `fd` 就绪时，其注册的回调函数会直接将该 `fd` 对应的就绪事件信息添加到就绪队列中（无需遍历所有 fd）。
    - 若就绪链表为空，进程阻塞；若有数据，直接唤醒。
4. 返回用户态：内核将就绪队列中的 就绪事件结构体 `epoll_event` 拷贝到用户提供的数组中。
5. 用户态处理：用户遍历返回的数组（只包含 `epoll_event`），获取事件类型 `events` 和绑定的用户数据 `data`。

### 2.3.2 epoll_event 与 epoll_data

`epoll_event` 的组成：
```cpp
struct epoll_event
{
  uint32_t events;    // 事件标志（例如 EPOLLIN、EPOLLOUT、EPOLLERR）
  epoll_data_t data;  // 用户绑定的自定义数据，用于在用户程序中确定事件的所有者（即由谁处理）
};
```

`epoll_data` 是一个联合体（同一时间只有一个成员有效）：
```cpp
typedef union epoll_data
{
  void *ptr;
  int fd;
  uint32_t u32;
  uint64_t u64;
} epoll_data_t;
```

### 2.3.3 相关函数

1. 创建 epoll 实例

```cpp
int epoll_create(int size);
int epoll_create1(int flags);  // size 参数已被内核忽略，flags = 0 等价于旧方法
```

`size` 从 Linux 2.6.8 起就不再表示容量上限了，只是历史遗留参数，新代码应使用 `epoll_create1()`。

2. 注册 / 修改 / 删除事件

```cpp
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
```

- `EPOLL_CTL_ADD`：添加
- `EPOLL_CTL_MOD`：修改
- `EPOLL_CTL_DEL`：删除

3. 等待事件

```cpp
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
```

- `timeout` 为等待时间（毫秒），`-1` 表示无限等待
- `maxevents` 必须大于 0

### 2.3.4 使用示例

```cpp
int epfd = epoll_create1(0);

struct epoll_event ev, events[10];

ev.events = EPOLLIN;
ev.data.fd = server_fd;

epoll_ctl(epfd, EPOLL_CTL_ADD, server_fd, &ev);

int nfds = epoll_wait(epfd, events, 10, -1);

for (int i = 0; i < nfds; i++) {
    if (events[i].data.fd == server_fd) {
        // 有新连接
    }
}
```

### 2.3.5 水平触发与边缘触发

`epoll` 有两种触发模式：

- **水平触发（LT）**：只要 `fd` 的缓冲区里还有数据没读完，每次调用 `epoll_wait` 都会返回该 `fd` 就绪（只要还有数据，就会一直通知）
- **边缘触发（ET）**：只有当 `fd` 的状态发生了变化（即缓冲区**由空变为非空**，产生一个“边沿”），`epoll_wait` 才会返回该 `fd` 就绪（只通知一次，除非再次发生状态变化）

默认情况下，`epoll` 使用水平触发，行为与 `select` / `poll` 类似。

启用边缘触发，需要在注册事件时加上 `EPOLLET`：

```cpp
struct epoll_event ev;
ev.events = EPOLLIN | EPOLLET; // 设置为边缘触发模式
ev.data.fd = connfd;
epoll_ctl(epfd, EPOLL_CTL_ADD, connfd, &ev);
```

使用 ET 模式，必须遵守以下规则：
1. 必须循环读写，直到 `EAGAIN`，否则可能会错过后续的就绪通知
2. `socket` 必须设置为非阻塞模式，否则可能会阻塞在读写操作上，导致无法处理其他就绪的 `fd`

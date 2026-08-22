---
title: IO 模型
date: 2025-09-24
updated: 2026-07-06
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

---

# 1. 阻塞I/O与非阻塞I/O

`socket` 存在两种模式：
1. **阻塞**：当一个线程对一个`socket` 进行读写操作时（如调用 `recv()`），如果 `socket` 缓冲区没有可读数据/可写空间，线程就会被堵塞。
2. **非阻塞**：当一个线程对一个 `socket` 进行读写操作时，线程不会被堵塞，而是返回错误码，程序需要不断轮询 `socket` 状态直到 `socket` 就绪并完成相应读写操作。

`socket` 默认为阻塞模式，可以通过以下方式改为非阻塞模式：
```cpp
fcntl(fd, F_SETFL, flags | O_NONBLOCK)
```

如果不引入额外机制，非阻塞模式会导致 I/O 不断轮询，浪费 CPU 资源，因此 `socket` 的非阻塞模式一般与 I/O 多路复用机制（如 `epoll`）配合使用。

{% note info %}
在这种组合下：
- I/O多路复用：内核主动告知哪些 `fd` 就绪，避免用户态无效轮询
- 非阻塞：确保拿到就绪通知后，实际的读写操作不会意外卡住线程

两者结合，既消除了 CPU 空转浪费，又避免了线程阻塞开销，构成了高性能网络模型（如 Reactor）的基石。
{% endnote %}

---

# 2. I/O多路复用

I/O多路复用是指**一个线程同时监听多个文件描述符（socket）**，当某个 socket **就绪时再进行处理**。

常见实现方式：
1. `select`：同时监视多个文件描述符集合，调用会返回就绪的文件描述符数量；socket 数量有限制，每次调用会再用户态和内核态之间复制文件描述符集合，线性状态检查。
2. `poll`：通过数组存储文件描述符，每一个都对应一个 pollfd 结构，调用返回就绪的文件描述符数量，程序通过遍历数组找到就绪的 socket；没有数量限制，但是和 `select` 一样会在用户态和内核态之间复制，状态检查也是线性的。
3. `epoll`：后台维护一个文件描述符表，通过红黑树等数据结构存储文件描述符，且兼有以上优势。

## 2.1 `select`

`select` 使用 **位图 (`fd_set`)** 存储所有需要监听的文件描述符。  
  
工作流程：  
1. 用户态准备：用户程序构造 `fd_set` 位图，将关心的 `fd` 对应位设置为 1，并设置超时时间。
2. 系统调用：调用 `select()`，内核将用户态的 `fd_set` 完整拷贝到内核态。
3. 内核态处理：
    - 内核线性遍历拷贝过来的所有 `fd`。
    - 为每个 `fd` 注册回调（或轮询驱动），然后进程阻塞。
    - 当任意 `fd` 就绪或超时，进程唤醒。
    - 内核再次线性遍历所有 `fd`，找出哪些就绪了，修改 `fd_set` 中对应的位。
4. 返回用户态：内核将修改后的 `fd_set` 完整拷贝回用户态。
5. 用户态处理：用户程序再次线性遍历 `fd_set`，通过检查位状态找到就绪的 `fd` 并进行读写。

`select()`：
```cpp
int select(int maxfdp, fd_set *readfds, fd_set *writefds, fd_set *errorfds, struct timeval *timeout);
```

使用示例：
```cpp
fd_set readfds;

FD_ZERO(&readfds);
FD_SET(server_fd, &readfds);
FD_SET(client_fd, &readfds);

int activity = select(max_fd + 1, &readfds, NULL, NULL, NULL);

if (activity > 0) {
    if (FD_ISSET(server_fd, &readfds)) {
        // 新连接到达
    }

    if (FD_ISSET(client_fd, &readfds)) {
        // 客户端数据可读
    }
}
```

## 2.2 `poll`

`poll` 使用 **`pollfd` 数组** 存储所有需要监听的文件描述符。

工作流程：
1. 用户态准备：用户程序构造 `pollfd` 结构体数组，填写 `fd` 和关注的事件（events）。
2. 系统调用：调用 `poll()`，内核将用户态的 `pollfd` 数组 完整拷贝到内核态。
3. 内核态处理：
    - 内核线性遍历数组中的每个 `pollfd` 条目。
    - 为每个 `fd` 注册回调，然后进程阻塞。
    - 当任意 `fd` 就绪或超时，进程唤醒。
    - 内核再次线性遍历所有条目，将就绪事件填入 `revents` 字段。
4. 返回用户态：内核将修改后的 `pollfd` 数组 完整拷贝回用户态。
5. 用户态处理：用户程序再次线性遍历数组，检查 `revents` 字段找到就绪的 `fd`。

`pollfd`：
```cpp
struct pollfd {
    int fd;        // 文件描述符
    short events;  // 监听事件
    short revents; // 实际发生事件
};
```

`poll()`：
```cpp
int poll(struct pollfd *fds, nfds_t nfds, int timeout);
```

使用示例：
```cpp
struct pollfd fds[2];

fds[0].fd = server_fd;
fds[0].events = POLLIN;

fds[1].fd = client_fd;
fds[1].events = POLLIN;

int activity = poll(fds, 2, -1);

if (activity > 0) {
    if (fds[0].revents & POLLIN) {
        // 服务器socket就绪
    }

    if (fds[1].revents & POLLIN) {
        // 客户端socket有数据
    }
}
```

## 2.3 `epoll`

{% note info %}
`epoll` 是 Linux 高性能 IO 多路复用机制，核心思想是只返回就绪的 `fd`；其内部维护了用于存储所有监听的 `fd` 的红黑树，以及存储已就绪的 `fd` 就绪队列。
{% endnote %}

工作流程：
1. 用户态准备（分离管理）：
    - 调用 `epoll_create()` 创建内核事件表（红黑树）。
    - 调用 `epoll_ctl()` 将关心的 `fd` 添加/修改/删除到内核事件表中（此时发生拷贝，但仅针对单个 fd）。
2. 系统调用：调用 `epoll_wait()`，无需传递 fd 集合，只传递最大等待数。
3. 内核态处理：
    - 内核直接检查就绪队列（只需查看队首元素判断队列是否为空，时间复杂度为O(1)）。
    - 关键机制：当某个 `fd` 就绪时，其注册的回调函数会直接将该 `fd` 对应的 就绪事件信息 添加到就绪队列中（无需遍历所有 fd）。
    - 若就绪链表为空，进程阻塞；若有数据，直接唤醒。
4. 返回用户态：内核将就绪队列中的 就绪事件结构体 `epoll_event` 拷贝到用户提供的数组中。
5. 用户态处理：用户遍历返回的数组（只包含 `epoll_event` ），获取事件类型 `events` 和绑定的用户数据 `data`。

`epoll` 的相关方法：

1. 创建 `epoll`
```cpp
int epoll_create(int size);
int epoll_create1(int flags); // size 参数现在已被内核忽略，设 flags = 0 相当于省略 size 参数的旧方法
```

2. 注册/修改/删除事件
```
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
```

3. 等待事件，事件就绪后将其拷贝到用户提供的数组中，timeout 为等待时间，-1为无限等待
```
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout); 
```

使用示例：
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

`epoll_event` 的组成：
```cpp
struct epoll_event
{
  uint32_t events;    // 事件标志（例如 EPOLLIN、EPOLLOUT、EPOLLERR）
  epoll_data_t data;  // 用户绑定的自定义数据，用于在用户程序中确定事件的所有者（即由谁处理）
}
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

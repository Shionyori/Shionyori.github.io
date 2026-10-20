---
title: Socket 编程
date: 2025-04-10
updated: 2026-09-30
cover: /images/posts/Socket 编程/cover.png
categories: 网络编程
tags:
  - Socket
  - TCP
  - UDP
  - C++
  - 网络编程
---

由于不同操作系统对网络的实现方式不同，**C++ 标准库并没有提供统一的网络接口**。因此在进行网络编程时，通常直接调用操作系统提供的 API。在 Linux 下最常见的方式是使用 **Socket API** 进行网络通信。

---

# 1. 基于 Socket 的 TCP 通信

TCP 是面向连接的协议，通信双方需要先建立连接才能进行数据传输。因此 TCP 通信的服务端需要先调用 `listen()` 进入监听状态，然后使用 `accept()` 接受客户端的连接请求；而客户端则需要调用 `connect()` 连接服务端。连接建立后，双方就可以使用 `send()` 和 `recv()` 进行数据的发送和接收。

## 1.1 TCP 服务端

### 1.1.1 创建 socket

使用 `socket()` 函数创建一个 socket，返回一个文件描述符（`fd`），用于后续的网络通信。
- `AF_INET` 表示使用 IPv4 地址族
- `SOCK_STREAM` 表示使用面向连接的 TCP 协议
- `IPPROTO_TCP` 表示使用 TCP 协议

```cpp
int sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
```

`socket()` 返回的 `fd` 和文件描述符本质上没有区别。在 Linux 下一切皆文件，网络连接也是如此。这意味着 `close()`、`fcntl()`、`read()`、`write()` 这些用在文件上的函数同样能用在 socket 上，这也是“非阻塞”和“多路复用”等文件 IO 的技术可以直接用在网络 IO 上的原因。

### 1.1.2 绑定 socket

先创建一个 `sockaddr_in` 结构体，设置 IP 地址和端口号，然后使用 `bind()` 函数将 socket 绑定到指定的地址和端口。

```cpp
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in addr;
std::memset(&addr, 0, sizeof(addr));
addr.sin_family = AF_INET;
addr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
addr.sin_port = htons(port); // 端口号转大端序 host -> net (short)

if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
{
    printf("socket bind error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

网络字节序是大端序，而 x86 架构的 CPU 是小端序，因此所有跨网络传输的数据都要转换。
- `htons()`（host to network short）将主机字节序转换为 16 位网络字节序（用于端口号）
- `htonl()`（host to network long）将主机字节序转换为 32 位网络字节序（用于 IP 地址）
- `inet_addr()` 将 IPv4 的点分十进制字符串转换为网络字节序的 32 位二进制地址，结果已经是网络字节序，所以不用再 `htonl()`

需要注意的是 `inet_addr()` 已经被标记为过时，现在更推荐使用 `inet_pton()`：

```cpp
struct sockaddr_in addr;
std::memset(&addr, 0, sizeof(addr));
addr.sin_family = AF_INET;
addr.sin_port = htons(port);

if (inet_pton(AF_INET, ip.c_str(), &addr.sin_addr) <= 0)
{
    // 地址格式非法时 inet_pton 返回 0，且不会设置 errno，所以这里不能像其他系统调用那样打印 errno
    printf("invalid ip address: %s\n", ip.c_str());
    return 1;
}
```

### 1.1.3 监听 socket

使用 `listen()` 函数使 socket 进入监听状态，等待客户端的连接请求。

```cpp
if (listen(sockfd, 1024) < 0)
{
    printf("socket listen error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

第二个参数是全连接队列的最大长度：三次握手完成后，连接会进入全连接队列，等待服务端调用 `accept()` 把它取走。如果队列已满，内核默认会丢弃新来的握手请求，客户端只能超时重试；只有设置了 `tcp_abort_on_overflow` 时，服务端才会回一个 RST，让客户端立刻收到 `ECONNREFUSED`。常见的 `1024` 是经验值，可以换成 `SOMAXCONN` 让内核自行取合适的上限。

### 1.1.4 接受客户端连接

使用 `accept()` 函数接受客户端的连接请求，返回一个新的 socket（用于与客户端通信）。

```cpp
int confd = accept(sockfd, nullptr, nullptr); // 连接成功返回一个新的socket（用于与客户端通信）
if (confd < 0)
{
    printf("socket accept error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

区分这里的两个 socket：`sockfd` 是“监听 socket”，它只负责接收新连接，不承载任何数据；`confd` 是这次连接专属的“已连接 socket”，收发数据都使用它。服务端只有一个 `sockfd`，但每接受一个客户端连接就会多一个 `confd`。

### 1.1.5 接收与发送数据

使用 `recv()` 函数接收客户端发送的数据。

```cpp
char buf[1024] = {0};
ssize_t len = recv(confd, buf, sizeof(buf) - 1, 0);
```

使用 `send()` 函数向客户端发送数据。

```cpp
ssize_t send_len = send(confd, buf, strlen(buf), 0);
```

这里用的是 `ssize_t`（有符号）而不是 `size_t`（无符号），因为 `recv()` 和 `send()` 的返回值可能是负数，表示出错。

### 1.1.6 关闭 socket

```cpp
close(confd); // 关闭已连接 socket
close(sockfd); // 关闭监听 socket
```

### 1.1.7 完整的代码

```cpp
#include <cstdio>
#include <cerrno>

#include <sys/socket.h>
#include <netinet/in.h>

#include <cstring>
#include <string>

#include <arpa/inet.h>
#include <unistd.h>

int main()
{
    // 1. 创建 socket
    int sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if(sockfd < 0)
    {
        printf("create socket error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("create socket successfully\n");
    }

    // 2. 绑定 socket
    std::string ip = "127.0.0.1";
    int port = 8080;

    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
    addr.sin_port = htons(port); // 端口号转大端序 host -> net (short)
    if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
    {
        printf("socket bind error: %d %s\n", errno, strerror(errno));
        return 1;
    }

    // 3. 监听 socket
    if (listen(sockfd, 1024) < 0)
    {
        printf("socket listen error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("socket listening ...\n");
    }

    while (true)
    {
        // 4. 接受客户端连接
        int confd = accept(sockfd, nullptr, nullptr); // 连接成功返回一个新的socket
        if (confd < 0)
        {
            // EINTR 表示被信号打断，不是真错误，重试即可
            // 单个连接的问题不该让整个服务器退出
            if (errno == EINTR)
            {
                continue;
            }
            printf("socket accept error: %d %s\n", errno, strerror(errno));
            return 1;
        }

        char buf[1024] = {0};

        // 5. 接收客户端数据
        ssize_t len = recv(confd, buf, sizeof(buf) - 1, 0);
        if (len > 0)
        {
            buf[len] = '\0';
            printf("received data from client: %s\n", buf);

            // 6. 向客户端发送数据
            // 用 buf + len 拼出回复，而不是在 buf 上 strcat（buf 已经接近写满时，strcat 追加后缀会越界）
            std::string reply = std::string(buf, len) + " [processed]";
            ssize_t send_len = send(confd, reply.c_str(), reply.size(), 0);
            if (send_len < 0)
            {
                printf("send error: %d %s\n", errno, strerror(errno));
            }
        }

        // 7. 关闭这条连接，否则 fd 会泄漏
        close(confd);
    }

    close(sockfd);
    return 0;
}
```

注意这段代码只判断了 `recv()` 是否成功，没有区分失败时的几种 `errno`；`send()` 也只检查了是否出错，没有处理只发出去一部分的情况。这些都会在第 2 节展开。这里先保持最朴素的写法，方便看清每一步在做什么。

## 1.2 TCP 客户端

### 1.2.1 创建 socket

```cpp
int sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
```

### 1.2.2 连接服务端

先创建一个 `sockaddr_in` 结构体，设置目标（服务端）的 IP 地址和端口号，然后使用 `connect()` 函数连接服务端。

`connect()` 成功返回 `0`，失败返回 `-1`。

```cpp
// 设置目标服务端的地址与端口
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in addr;
std::memset(&addr, 0, sizeof(addr));
addr.sin_family = AF_INET;
addr.sin_addr.s_addr = inet_addr(ip.c_str());
addr.sin_port = htons(port);

// 尝试连接
if (connect(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
{
    printf("connect server failed\n");
    return 1;
}
```

### 1.2.3 发送与接收数据

使用 `send()` 函数向服务端发送数据。

```cpp
std::string data = "test content";
ssize_t send_len = send(sockfd, data.c_str(), data.size(), 0);
```

使用 `recv()` 函数接收服务端发送的数据。

```cpp
char buf[1024] = {0};
ssize_t len = recv(sockfd, buf, sizeof(buf) - 1, 0);
```

### 1.2.4 关闭 socket

```cpp
close(sockfd);
```

### 1.2.5 完整的代码

```cpp
#include <cstdio>
#include <cerrno>

#include <sys/socket.h>
#include <netinet/in.h>

#include <cstring>
#include <string>

#include <arpa/inet.h>
#include <unistd.h>

int main()
{
    // 1. 创建 socket
    int sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sockfd < 0)
    {
        printf("create socket error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("create socket successfully\n");
    }

    // 2. 连接服务端
    std::string ip = "127.0.0.1";
    int port = 8080;

    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str());
    addr.sin_port = htons(port);
    if (connect(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
    {
        printf("connect server failed\n");
        return 1;
    }
    else
    {
        printf("connect server successfully\n");
    }

    // 3. 向服务端发送数据
    std::string data = "test content";
    ssize_t send_len = send(sockfd, data.c_str(), data.size(), 0);
    if (send_len < 0)
    {
        printf("send error: %d %s\n", errno, strerror(errno));
        return 1;
    }

    // 4. 接收服务端的数据
    char buf[1024] = {0};
    ssize_t len = recv(sockfd, buf, sizeof(buf) - 1, 0);
    if (len > 0)
    {
        buf[len] = '\0';
        printf("received data from server: %s\n", buf);
    }
    else
    {
        printf("recv data failed\n");
    }

    // 5. 关闭 socket
    close(sockfd);
    return 0;
}
```

# 2. TCP 容易写错的地方

## 2.1 recv() / send() 返回值的三种情况

`recv()` 的返回值不是“成功 / 失败”二选一，而是三态：

| 返回值 | 含义 | 该怎么处理 |
| --- | --- | --- |
| `> 0` | 实际读到的字节数 | 正常处理，但注意它可能**小于请求的长度** |
| `= 0` | 对端已关闭连接（收到 FIN） | 关闭本端 socket，清理资源 |
| `< 0` | 出错 | 看 `errno` 做进一步处理 |

`send()` 的返回值同样是三态，但语义和 `recv()` 不同：

| 返回值 | 含义 | 该怎么处理 |
| --- | --- | --- |
| `> 0` | 实际写进内核发送缓冲区的字节数 | 继续发送剩余的数据，直到全部发送完 |
| `= 0` | 没有写入任何数据 | TCP 下几乎不会出现（只有请求长度为 0 时才会）；一旦出现必须退出循环，否则会死循环 |
| `< 0` | 出错 | 看 `errno` 做进一步处理 |

两者在 `< 0` 时都要再看 `errno` 区分：

- `errno == EINTR`：调用被信号中断，这不是真错误，**应该重试**而不是当成连接断开
- `errno == EAGAIN` / `EWOULDBLOCK`：只出现在非阻塞模式下。对 `recv()` 表示“当前没有数据”，对 `send()` 表示“发送缓冲区已满”，同样不是真错误，应该稍后重试
- 其他值（`ECONNRESET`、`ETIMEDOUT` 等）：真正的错误，关闭连接

## 2.2 send() / recv() 不保证一次完成

`send()` 返回的是实际写进内核发送缓冲区的字节数，它可能小于你请求的长度；`recv()` 也一样，它返回的是实际从内核接收缓冲区读到的字节数，可能小于你请求的长度。缓冲区满的时候（对端读得慢、或者网络拥塞），它们可能只处理了一部分数据就返回。

正确的做法是循环调用 `send()`，直到把所有数据都写进缓冲区为止：

```cpp
void send_all(int sockfd, const char* data, size_t len)
{
    size_t sent = 0;
    while (sent < len)
    {
        ssize_t n = send(sockfd, data + sent, len - sent, 0);
        if (n < 0)
        {
            if (errno == EINTR)
            {
                continue;
            }
            else
            {
                perror("send");
                break;
            }
        }
        else if (n == 0)
        {
            // 一个字节都没写出去，必须退出，否则 sent 不前进会导致死循环
            break;
        }
        else
        {
            sent += n;
        }
    }
}
```

`recv()` 也一样。如果你**已经知道**要收多少字节（比如协议头里写明了长度），可以这样循环读满：

```cpp
void recv_all(int sockfd, char* buf, size_t len)
{
    size_t received = 0;
    while (received < len)
    {
        ssize_t n = recv(sockfd, buf + received, len - received, 0);
        if (n < 0)
        {
            if (errno == EINTR)
            {
                continue;
            }
            else
            {
                perror("recv");
                break;
            }
        }
        else if (n == 0)
        {
            // 对端关闭连接
            break;
        }
        else
        {
            received += n;
        }
    }
}
```

但这个函数成立的前提是“事先知道要收多少字节”。在流式协议里，接收方往往并不知道一条消息有多长（拆包与粘包问题）。

## 2.3 TCP 的拆包与粘包问题

TCP 是字节流协议，没有消息边界。`recv()` 读到的长度与 `send()` 写入的长度**没有任何对应关系**。

这涉及到经典的“拆包与粘包”问题：
- 拆包：发送方一次 `send()` 发送了 N 个字节，但接收方可能分多次 `recv()` 才能读完这 N 个字节
- 粘包：发送方连续两次 `send()`，但接收方可能一次 `recv()` 就读到了两次发送的数据

接收方无法确定一条消息的边界在哪里，影响了消息的正确解析。

要划分消息边界，只能由应用层协议自己解决，以下是常见的三种做法：
1. **固定长度**：每条消息固定 N 个字节，接收方每次只读 N 个字节（简单但浪费带宽）
2. **分隔符**：每条消息以特定字符结尾（如 `\n`），接收方读到分隔符就知道一条消息结束了（适合文本协议，如 HTTP，但不适合二进制协议）
3. **长度前缀**：每条消息前加一个固定长度的头部，表示消息体的长度（最通用）

## 2.4 关闭的正确姿势

关闭一条 TCP 连接可以使用两个不同的函数，它们的语义并不一样：

- `close(fd)`：把 `fd` 的引用计数减一，减到 `0` 时才真正关闭，并且**同时关闭读写两个方向**
- `shutdown(fd, SHUT_WR)`：**只关闭写方向**，会向对端发送一个 `FIN` 类型的控制包，但本端仍然可以继续读对端发来的数据

`shutdown()` 用于“自己发完了，但还想接收对方的回复”的半关闭场景，例如 HTTP 的 `Connection: close` 方法。

服务端还有一个容易踩的坑：向一个已经被对端关闭的 socket 写数据时，内核会发送 `SIGPIPE` 信号，而这个信号的**默认行为是直接终止进程**，这会使得服务器毫无征兆地挂掉，且不留下任何错误信息。通常的做法是忽略它，改用 `send()` 的返回值判断：

```cpp
signal(SIGPIPE, SIG_IGN);
```

也可以给单次调用加上 `MSG_NOSIGNAL` 标志，效果相同：

```cpp
send(confd, buf, len, MSG_NOSIGNAL);
```

# 3. 基于 Socket 的 UDP 通信

UDP 是无连接的协议，通信双方不需要建立连接即可发送数据。因此 UDP 没有 `listen()` 和 `accept()` 这两个步骤，可以直接使用 `sendto()` 和 `recvfrom()` 函数进行数据的发送和接收。`sendto()` 需要指定目标地址，而 `recvfrom()` 会返回发送方的地址信息。

UDP 与 TCP 的主要区别：
- **保留消息边界**：一次 `sendto()` 对应一次 `recvfrom()`，不会拆也不会粘。代价是单次数据报有大小上限（理论上 65507 字节，实际通常控制在 1400 以内）
- **不保证送达、不保证顺序**：没有握手、没有重传、没有拥塞控制。要可靠性就得自己在应用层实现
- **无状态**：服务端不需要维护连接，一个 socket 就能服务任意多的客户端，不需要为每个客户端分配 `confd`

## 3.1 UDP 服务端

### 3.1.1 创建 socket

使用 `socket()` 函数创建一个 UDP socket，返回一个文件描述符（`fd`），用于后续的网络通信。
- `AF_INET` 表示使用 IPv4 地址族
- `SOCK_DGRAM` 表示使用无连接的 UDP 协议（即数据报，而非 `SOCK_STREAM` 所表示的字节流）
- `IPPROTO_UDP` 表示使用 UDP 协议

```cpp
int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
```

### 3.1.2 绑定 socket

和 TCP 服务端一样，需要在固定的端口上 `bind()`：

```cpp
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in addr;
std::memset(&addr, 0, sizeof(addr));
addr.sin_family = AF_INET;
addr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
addr.sin_port = htons(port); // 端口号转大端序 host -> net (short)

if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
{
    printf("socket bind error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

不过上面绑定的是回环地址 `127.0.0.1`，只有本机进程能连上。如果希望局域网内的其他机器也能访问，应该改成 `INADDR_ANY`（`0.0.0.0`），表示监听本机所有网卡：

```cpp
std::string ip = "0.0.0.0";
int port = 8080;

struct sockaddr_in addr;
std::memset(&addr, 0, sizeof(addr));
addr.sin_family = AF_INET;
addr.sin_addr.s_addr = htonl(INADDR_ANY); // 监听本机所有网卡
addr.sin_port = htons(port);

if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
{
    printf("socket bind error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

`INADDR_ANY` 表示监听本机所有网卡，而不是只监听回环地址。TCP 服务端同理，前面第 1 节的例子写成 `127.0.0.1` 只是为了方便本地测试。

### 3.1.3 接收客户端的数据

`recvfrom()` 在 `recv()` 的基础上多两个参数，用来获取数据来源的地址。因为 UDP 没有“连接”的概念，服务端需要靠这个地址信息来知道数据是哪个客户端发来的。

```cpp
char buf[1024] = {0};

struct sockaddr_in client_addr; // 用于接收客户端的地址信息
socklen_t client_addr_len = sizeof(client_addr);

ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf) - 1, 0, (struct sockaddr*)&client_addr, &client_addr_len);
```

### 3.1.4 向客户端发送数据

使用 `sendto()` 函数向指定的客户端发送数据。

```cpp
std::string data = "test content";
ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&client_addr, client_addr_len);
```

### 3.1.5 关闭 socket

```cpp
close(sockfd);
```

### 3.1.6 完整的代码

```cpp
#include <cstdio>
#include <cerrno>

#include <sys/socket.h>
#include <netinet/in.h>

#include <cstring>
#include <string>

#include <arpa/inet.h>
#include <unistd.h>

int main()
{
    // 1. 创建 socket
    int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if(sockfd < 0)
    {
        printf("create socket error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("create socket successfully\n");
    }

    // 2. 绑定 socket
    std::string ip = "0.0.0.0";
    int port = 8080;

    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str()); // "0.0.0.0" 即 INADDR_ANY，监听本机所有网卡
    addr.sin_port = htons(port); // 端口号转大端序 host -> net (short)

    if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) < 0)
    {
        printf("socket bind error: %d %s\n", errno, strerror(errno));
        return 1;
    }

    while (true)
    {
        // 3. 接收客户端数据
        char buf[1024] = {0};
        struct sockaddr_in client_addr;
        socklen_t client_addr_len = sizeof(client_addr);
        ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf) - 1, 0, (struct sockaddr*)&client_addr, &client_addr_len);
        if (recv_len < 0)
        {
            // EINTR 表示被信号打断，重试即可；
            // 单个数据报出问题不该让整个服务器退出
            if (errno == EINTR)
            {
                continue;
            }
            printf("recvfrom error: %d %s\n", errno, strerror(errno));
            return 1;
        }
        else
        {
            printf("recv data from client: %s\n", buf);
        }

        // 4. 向客户端发送数据
        std::string data = "test content";
        ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&client_addr, client_addr_len);
        if (send_len < 0)
        {
            printf("sendto error: %d %s\n", errno, strerror(errno));
            return 1;
        }
    }

    // 5. 关闭 socket
    close(sockfd);
    return 0;
}
```

## 3.2 UDP 客户端

### 3.2.1 创建 socket

```cpp
int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
```

### 3.2.2 向服务端发送数据

先创建一个 `sockaddr_in` 结构体，设置目标（服务端）的 IP 地址和端口号，然后使用 `sendto()` 函数向服务端发送数据。

```cpp
// 设置目标服务端的地址与端口
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in addr;
std::memset(&addr, 0, sizeof(addr));
addr.sin_family = AF_INET;
addr.sin_addr.s_addr = inet_addr(ip.c_str());
addr.sin_port = htons(port);

// 发送数据
std::string data = "test content";
ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&addr, sizeof(addr));
```

### 3.2.3 接收服务端的数据

```cpp
char buf[1024] = {0};
struct sockaddr_in server_addr; // 用于接收服务端的地址信息
socklen_t server_addr_len = sizeof(server_addr);
ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf) - 1, 0, (struct sockaddr*)&server_addr, &server_addr_len);
```

客户端一般已经知道服务端地址，直接用 `recv()` 也可以；这里用 `recvfrom()` 是为了校验回包确实来自那个地址。

### 3.2.4 关闭 socket

```cpp
close(sockfd);
```

### 3.2.5 完整的代码

```cpp
#include <cstdio>
#include <cerrno>

#include <sys/socket.h>
#include <netinet/in.h>

#include <cstring>
#include <string>

#include <arpa/inet.h>
#include <unistd.h>

int main()
{
    // 1. 创建 socket
    int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if(sockfd < 0)
    {
        printf("create socket error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("create socket successfully\n");
    }

    // 2. 向服务端发送数据
    std::string ip = "127.0.0.1";
    int port = 8080;

    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str());
    addr.sin_port = htons(port);

    std::string data = "test content";
    ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&addr, sizeof(addr));
    if (send_len < 0)
    {
        printf("sendto error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("send data to server successfully\n");
    }

    // 3. 接收服务端数据
    char buf[1024] = {0};
    struct sockaddr_in server_addr;
    socklen_t server_addr_len = sizeof(server_addr);
    ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf) - 1, 0, (struct sockaddr*)&server_addr, &server_addr_len);
    if (recv_len < 0)
    {
        printf("recvfrom error: %d %s\n", errno, strerror(errno));
        return 1;
    }
    else
    {
        printf("recv data from server: %s\n", buf);
    }

    // 4. 关闭 socket
    close(sockfd);
    return 0;
}
```

# 4. 目前还存在的一些问题

目前的 TCP 服务端和客户端都是阻塞的，完全没有并发能力。

想要实现并发处理客户端请求，有两种方式：
1. **多线程**：每有一个新的客户端连接就创建一个独立线程去处理。优点是结构简单，低并发下能有效利用多核。但线程开销不小，几千个连接就是几千个线程，仅仅是上下文切换就会消耗大量 CPU 资源；
2. **非阻塞 + 多路复用**：使用 `select()`、`poll()` 或 `epoll()` 等多路复用技术。这是高并发服务器的主流做法，也是我们之后要实现的内容。

此外，目前的代码还比较散乱：错误处理各写各的、资源释放全靠人手保证，如果要写稍微复杂一点的逻辑很容易会出现资源泄漏。所以接下来我们要先对已有的代码进行封装，提高代码的可维护性和可扩展性。
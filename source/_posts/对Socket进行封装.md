---
title: 对 Socket 进行封装
date: 2025-04-18
updated: 2026-09-30
cover: /images/posts/对 Socket 进行封装/cover.png
categories: 网络编程
tags:
  - Socket
  - TCP
  - RAII
  - 封装
  - C++
  - 网络编程
---

在实际开发中，通常不会直接在业务代码中频繁调用底层的 Linux Socket API，而是对其进行**封装**。

封装的好处有：
- 统一接口，减少重复代码
- 更安全的资源管理（RAII 自动关闭 `socket`）
- 更好的代码可读性
- 更方便扩展（如支持 `epoll`、超时等）

---

# 1. Socket 封装

首先，我们需要对 `Socket` 进行封装，提供一个类来管理 `socket` 的生命周期，并提供常用的操作接口。

Socket 封装的基本思路是：
1. 封装 `socket` 的创建、绑定、监听、连接、发送、接收等操作
2. 使用 RAII 原则管理 `socket` 的生命周期，确保在对象销毁时自动关闭 `socket`
3. 提供异常安全的接口，避免资源泄漏

## 1.1 类定义

在 `socket.h` 中定义 `Socket` 类：

```cpp
class Socket {
private:
    int sockfd;

public:
    Socket();
    Socket(int fd);

    ~Socket();

    // 禁止拷贝，只允许移动
    Socket(const Socket&) = delete;
    Socket& operator=(const Socket&) = delete;
    Socket(Socket && other) noexcept;
    Socket& operator=(Socket&& other) noexcept;

    bool create(int domain, int type, int protocol);
    bool bind(const std::string &ip, int port);
    bool listen(int backlog);
    Socket accept();
    bool connect(const std::string &ip, int port);

    ssize_t send(const void* data, size_t len, int flags = 0);
    ssize_t send(const std::string& data, int flags = 0);
    ssize_t recv(void* buf, size_t len, int flags = 0);
    std::string recv(size_t max_len = 1024, int flags = 0);

    ssize_t sendTo(const void* data, size_t len, const std::string &ip, int port, int flags = 0);
    ssize_t sendTo(const std::string& data, const std::string &ip, int port, int flags = 0);
    ssize_t recvFrom(void* buf, size_t len, std::string &ip, int &port, int flags = 0);
    std::string recvFrom(size_t max_len, std::string &ip, int &port, int flags = 0);

    // 工具函数
    void close() {
        if (sockfd >= 0) {
            ::close(sockfd);
            sockfd = -1;
        }
    }

    bool isValid() const { return sockfd >= 0; }
    int getFd() const { return sockfd; }
};
```

## 1.2 类实现

在 `socket.cpp` 中实现 `Socket` 类的成员函数：

```cpp
#include "socket.h"

#include <cerrno>
#include <cstring>
#include <iostream>

#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>

Socket::Socket() : sockfd(-1) {}

Socket::Socket(int fd) : sockfd(fd) {}

Socket::~Socket() { close(); }

Socket::Socket(Socket&& other) noexcept : sockfd(other.sockfd) {
    other.sockfd = -1;
}

Socket& Socket::operator=(Socket&& other) noexcept {
    if (this != &other) {
        close();
        sockfd = other.sockfd;
        other.sockfd = -1;
    }
    return *this;
}

bool Socket::create(int domain, int type, int protocol)
{
    sockfd = ::socket(domain, type, protocol);
    if (sockfd < 0)
    {
        std::cerr << "socket() failed: " << std::strerror(errno) << std::endl;
        return false;
    }

    // 允许绑定处于 TIME_WAIT 的地址，避免服务器重启时 bind 失败
    int opt = 1;
    if (::setsockopt(sockfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0)
    {
        std::cerr << "setsockopt(SO_REUSEADDR) failed: " << std::strerror(errno) << std::endl;
        // 设置失败不致命，继续使用该套接字
    }
    return true;
}

bool Socket::bind(const std::string& ip, int port)
{
    struct sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str());
    addr.sin_port = htons(port);
    return ::bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) == 0;
}

bool Socket::listen(int backlog)
{
    return ::listen(sockfd, backlog) == 0;
}

Socket Socket::accept()
{
    struct sockaddr_in client_addr{};
    socklen_t client_len = sizeof(client_addr);
    int client_fd = ::accept(sockfd, (struct sockaddr*)&client_addr, &client_len);
    return Socket(client_fd);
}

bool Socket::connect(const std::string& ip, int port)
{
    struct sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str());
    addr.sin_port = htons(port);
    return ::connect(sockfd, (struct sockaddr*)&addr, sizeof(addr)) == 0;
}

ssize_t Socket::send(const void* data, size_t len, int flags)
{
    return ::send(sockfd, data, len, flags);
}

ssize_t Socket::send(const std::string& data, int flags)
{
    return send(data.c_str(), data.size(), flags);
}

ssize_t Socket::recv(void* buf, size_t len, int flags)
{
    return ::recv(sockfd, buf, len, flags);
}

std::string Socket::recv(size_t max_len, int flags)
{
    std::string buf(max_len, '\0');
    ssize_t n = recv(&buf[0], max_len, flags);
    if (n > 0) {
        buf.resize(n);
    } else {
        buf.clear();
    }
    return buf;
}

ssize_t Socket::sendTo(const void* data, size_t len, const std::string &ip, int port, int flags)
{
    struct sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(ip.c_str());
    addr.sin_port = htons(port);
    return ::sendto(sockfd, data, len, flags, (struct sockaddr*)&addr, sizeof(addr));
}

ssize_t Socket::sendTo(const std::string& data, const std::string &ip, int port, int flags)
{
    return sendTo(data.c_str(), data.size(), ip, port, flags);
}

ssize_t Socket::recvFrom(void* buf, size_t len, std::string &ip, int &port, int flags)
{
    struct sockaddr_in addr{};
    socklen_t addr_len = sizeof(addr);
    ssize_t n = ::recvfrom(sockfd, buf, len, flags, (struct sockaddr*)&addr, &addr_len);
    if (n >= 0) {
        ip = inet_ntoa(addr.sin_addr);
        port = ntohs(addr.sin_port);
    }
    return n;
}

std::string Socket::recvFrom(size_t max_len, std::string &ip, int &port, int flags)
{
    std::string buf(max_len, '\0');
    ssize_t n = recvFrom(&buf[0], max_len, ip, port, flags);
    if (n > 0) {
        buf.resize(n);
    } else {
        buf.clear();
    }
    return buf;
}
```

## 1.3 为什么必须是 ::bind 而不是 bind

可以发现，代码中的系统调用都带上了 `::` 前缀，比如 `::bind`、`::listen`、`::connect`、`::send`、`::recv`、`::close`、`::accept`。

这是因为**类里恰好有同名的成员函数**。在 `Socket` 的成员函数内部写一个不带限定的 `bind(...)`，编译器会先在类作用域里查找，找到 `Socket::bind` 这个成员。于是这行代码变成了递归调用自己，而不是调用系统的 `bind`。结果是栈溢出或者死循环，而且不会报任何编译错误。

`::bind` 表示从全局作用域中查找，明确指向 `<sys/socket.h>` 里的那个函数。

## 1.4 移动语义在这里做了什么

使用移动语义的主要目的是**避免不必要的拷贝**。

回头看 `accept()`：

```cpp
Socket Socket::accept()
{
    ...
    return Socket(fd);   // 返回一个临时 Socket
}
```

这个临时对象需要交给调用方。返回值优化（RVO）通常会直接把对象构造在调用方的栈上，一次构造、零次拷贝；即使编译器不做优化，也会走**移动构造**，同样不会发生拷贝。`fd` 的所有权从临时对象转移到调用方的对象，临时对象的 `fd` 被置为 `-1`（即无效），析构时不会关闭 `fd`，也就不会造成资源泄漏。

移动构造函数上的 `noexcept` 不是可选的装饰：

```cpp
Socket(Socket&& other) noexcept;
```

标准库用 `std::move_if_noexcept` 判断“该移动还是该拷贝”：**只有移动构造被标记为 `noexcept`，容器在扩容时才会放心地选择移动，否则会退化成拷贝**，`std::vector<Socket>` 就是典型场景。

这里拷贝构造已经被 `= delete`，所以即使漏掉 `noexcept` 也仍然能编译通过（`move_if_noexcept` 会退而使用移动），但那样就失去了 `noexcept` 才能提供的强异常安全保证——扩容过程中一旦抛出异常，容器无法回滚到原来的状态。所以移动构造/赋值一律加 `noexcept`。

移动赋值里那句 `close()` 也很关键：

```cpp
Socket& Socket::operator=(Socket&& other) noexcept
{
    if (this != &other)
    {
        close();   // 先释放自己原来持有的 fd
        ...
    }
}
```

如果这里没有 `close()`，`a = std::move(b)` 就会导致 `a` 原来的 `fd` 没有被关闭，造成资源泄漏。

# 2. TCP 封装

完成了 `Socket` 的封装后，我们可以进一步封装 TCP 服务端和客户端，提供更高层次的接口。只需要用 `Socket` 类的方法代替原来的 Socket API 调用即可，其他逻辑基本保持不变。

## 2.1 TcpServer

在 `tcpserver.h` 中定义：

```cpp
class TcpServer {
private:
    Socket server;

public:
    TcpServer() = default;
    ~TcpServer();

    bool start(const std::string& ip, int port);
    void run(std::function<void(Socket)> handler);
};
```

在 `tcpserver.cpp` 中实现：

```cpp
TcpServer::~TcpServer()
{
    server.close();
}

bool TcpServer::start(const std::string& ip, int port)
{
    if (!server.create(AF_INET, SOCK_STREAM, IPPROTO_TCP))
    {
        std::cerr << "Server create failed\n";
        return false;
    }
    if (!server.bind(ip, port))
    {
        std::cerr << "Server bind failed\n";
        return false;
    }
    if (!server.listen(128))
    {
        std::cerr << "Server listen failed\n";
        return false;
    }
    std::cout << "Server listening on " << ip << ":" << port << std::endl;
    return true;
}

void TcpServer::run(std::function<void(Socket)> handler)
{
    while (true)
    {
        Socket client = server.accept();
        if (!client.isValid())
        {
            // accept 失败时返回的是无效对象，不能交给业务处理
            if (errno == EINTR)
            {
                continue; // 被信号打断，重试即可
            }
            std::cerr << "accept failed: " << std::strerror(errno) << std::endl;
            continue;
        }
        handler(std::move(client));
    }
}
```

## 2.2 TcpClient

在 `tcpclient.h` 中定义：

```cpp
class TcpClient {
private:
    Socket client;

public:
    TcpClient() = default;
    ~TcpClient();

    bool connect(const std::string& ip, int port);
    ssize_t send(const std::string& data);
    std::string recv(size_t max_len = 1024);
};
```

在 `tcpclient.cpp` 中实现：

```cpp
TcpClient::~TcpClient()
{
    client.close();
}

bool TcpClient::connect(const std::string& ip, int port)
{
    if (!client.create(AF_INET, SOCK_STREAM, IPPROTO_TCP))
    {
        return false;
    }
    if (!client.connect(ip, port))
    {
        return false;
    }
    return true;
}

ssize_t TcpClient::send(const std::string& data)
{
    return client.send(data);
}

std::string TcpClient::recv(size_t max_len)
{
    return client.recv(max_len);
}
```

# 3. UDP 封装

同样地，我们可以封装 UDP 服务端和客户端，提供更高层次的接口。

## 3.1 UdpServer

在 `udpserver.h` 中定义：

```cpp
#include "socket.h"

class UdpServer {
private:
    Socket server;

public:
    UdpServer() = default;
    ~UdpServer();

    UdpServer(const UdpServer&) = delete;
    UdpServer& operator=(const UdpServer&) = delete;

    void start(const std::string &ip, int port);
    void run();
};
```

在 `udpserver.cpp` 中实现：

```cpp
#include "udpserver.h"
#include <iostream>

UdpServer::~UdpServer() {
    server.close();
}

void UdpServer::start(const std::string &ip, int port)
{
    if (!server.create(AF_INET, SOCK_DGRAM, IPPROTO_UDP))
    {
        std::cerr << "Server create failed\n";
        return;
    }

    if (!server.bind(ip, port))
    {
        std::cerr << "Server bind failed\n";
        return;
    }

    std::cout << "Server listening on " << ip << ":" << port << std::endl;
}

void UdpServer::run()
{
    while (true)
    {
        std::string client_ip;
        int client_port = 0;

        std::string data = server.recvFrom(1024, client_ip, client_port);
        if (!data.empty())
        {
            std::cout << "Received from " << client_ip << ":" << client_port << " - " << data << std::endl;

            // 回显数据
            server.sendTo(data, client_ip, client_port);
        }
    }
}
```

## 3.2 UdpClient

在 `udpclient.h` 中定义：

```cpp
#include "socket.h"

class UdpClient {
private:
    Socket client;

public:
    UdpClient() = default;
    ~UdpClient();

    UdpClient(const UdpClient&) = delete;
    UdpClient& operator=(const UdpClient&) = delete;

    void init();

    ssize_t sendTo(const std::string& data, const std::string &ip, int port);
    std::string recvFrom(size_t max_len, std::string &ip, int &port);
};
```

在 `udpclient.cpp` 中实现：

```cpp
#include "udpclient.h"
#include <iostream>

UdpClient::~UdpClient() {
    client.close();
}

void UdpClient::init()
{
    if (!client.create(AF_INET, SOCK_DGRAM, IPPROTO_UDP))
    {
        std::cerr << "Client create failed\n";
        return;
    }
}

ssize_t UdpClient::sendTo(const std::string& data, const std::string &ip, int port)
{
    return client.sendTo(data, ip, port);
}

std::string UdpClient::recvFrom(size_t max_len, std::string &ip, int &port)
{
    return client.recvFrom(max_len, ip, port);
}
```
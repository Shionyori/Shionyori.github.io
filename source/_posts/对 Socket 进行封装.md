---
title: 对 Socket 进行封装
date: 2025-04-18
updated: 2026-03-26
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

{% note info %}
封装的好处有：
- 统一接口，减少重复代码
- 更安全的资源管理（RAII 自动关闭 `socket`）
- 更好的代码可读性
- 更方便扩展（如支持 `epoll`、超时等）
{% endnote %}

---

# 1. `Socket`

`Socket` 类的定义：
```cpp
class Socket {
private:
    int sockfd;

public:
    Socket() : sockfd(-1) {}
    Socket(int fd) : sockfd(fd) {}

    // 禁止拷贝
    Socket(const Socket&) = delete;
    Socket& operator=(const Socket&) = delete;

    // 允许拷贝
    Socket(Socket && other) : sockfd(other.sockfd) { other.sockfd = -1; }
    Socket& operator=(Socket&& other) {
        if (this != &other) {
            close();
            sockfd = other.sockfd;
            other.sockfd = -1;
        }
        return *this;
    }

    ~Socket() { close(); }

    bool create(int domain, int type, int protocol);

    bool bind(const std::string &ip, int port);
    bool listen(int backlog);
    Socket accept();

    bool connect(const std::string &ip, int port);

    ssize_t send(const void* data, size_t len, int flags = 0);
    ssize_t send(const std::string& data, int flags = 0);

    ssize_t recv(void* buf, size_t len, int flags = 0);
    std::string recv(size_t max_len = 1024, int flags = 0);

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

具体的方法实现：
```cpp
bool Socket::create(int domain, int type, int protocol) 
{
    sockfd = socket(domain, type, protocol);
    return sockfd >= 0;
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
```

---

# 2. `TcpServer`

`TcpServer` 类的定义：
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

具体的方法实现：
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
    while(true)
    {
        Socket client = server.accept();
        handler(std::move(client));
    }
}
```

---

# 3. `TcpClient`

`TcpClient` 类的定义:
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

具体的方法实现：
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

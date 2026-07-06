---
title: Socket 编程
date: 2025-04-10
updated: 2026-07-06
cover: cover.png
categories: 网络编程
tags:
  - Socket
  - TCP
  - UDP
  - C++
  - 网络编程
---

{% note info %}
由于不同操作系统对网络的实现方式不同，**C++ 标准库并没有提供统一的网络接口**。因此在进行网络编程时，通常直接调用操作系统提供的 API。在 Linux 下最常见的方式是使用 **Socket API** 进行网络通信。
{% endnote %}

---

# TCP 服务端

## 1. 创建 socket

```cpp
int sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
```

## 2. 绑定 socket

```cpp
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in servaddr;
std::memset(&servaddr, 0, sizeof(servaddr));
servaddr.sin_family = AF_INET;
servaddr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
servaddr.sin_port = htons(port); // 端口号转大端序 host -> net (short)

if (bind(sockfd, (struct sockaddr*)&servaddr, sizeof(servaddr)) < 0)
{
    printf("socket bind error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

## 3. 监听 socket

```cpp
if (listen(sockfd, 1024) < 0)
{
    printf("socket listen error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

## 4. 接受客户端连接

```cpp
int confd = accept(sockfd, nullptr, nullptr); // 连接成功返回一个新的socket（用于与客户端通信）
if (confd < 0)
{
    printf("socket accept error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

## 5. 接收客户端的数据

```cpp
char buf[1024] = {0};
size_t len = recv(confd, buf, sizeof(buf), 0);
```

## 6. 向客户端发送数据

```cpp
send(confd, buf, strlen(buf), 0);
```

## 7. 关闭 socket

```cpp
close(sockfd);
```

## 8. 代码示例

```cpp
#include <iostream>

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

    struct sockaddr_in sockaddr;
    std::memset(&sockaddr, 0, sizeof(sockaddr));
    sockaddr.sin_family = AF_INET;
    sockaddr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
    sockaddr.sin_port = htons(port); // 端口号转大端序 host -> net (short)
    if (bind(sockfd, (struct sockaddr*)&sockaddr, sizeof(sockaddr)) < 0)
    {
        printf("socket bind error: %d %s\n", errno, strerror(errno));
        return 1;
    }

    // 3. 监听 socket
    if (listen(sockfd, 1024) < 0)
    {
        printf("socket listen error: %d %s\n", errno, strerror(errno));
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
            printf("socket accept error: %d %s\n", errno, strerror(errno));
            return 1;
        }

        char buf[1024] = {0};

        // 5. 接收客户端数据
        size_t len = recv(confd, buf, sizeof(buf), 0);
        printf("recived data from client: %s\n", buf);

        // 6. 向客户端发送数据
        strcat(buf, " [processed]");
        send(confd, buf, strlen(buf), 0);
    }

    // 7. 关闭 socket
    close(sockfd);
    return 0;
}
```

---

# TCP 客户端

## 1. 创建 socket

```cpp
int sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
```

## 2. 连接服务端

```cpp
// 设置目标服务端的地址与端口
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in sockaddr;
std::memset(&sockaddr, 0, sizeof(sockaddr));
sockaddr.sin_family = AF_INET;
sockaddr.sin_addr.s_addr = inet_addr(ip.c_str());
sockaddr.sin_port = htons(port);

// 尝试连接
if (connect(sockfd, (struct sockaddr*)&sockaddr, sizeof(sockaddr)) < 0)
{
    printf("connect server failed\n");
    return 1;
}
```

## 3. 向服务端发送数据

```cpp
std::string data = "test content";
send(sockfd, data.c_str(), data.size(), 0);
```

## 4. 接收服务端的数据

```cpp
char buf[1024] = {0};
recv(sockfd, buf, sizeof(buf), 0);
```

## 5. 关闭 socket

```cpp
close(sockfd);
```

## 6. 代码示例

```cpp
#include <iostream>

#include <sys/socket.h>
#include <netinet/in.h>

#include <string>
#include <cstring>

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

    struct sockaddr_in sockaddr;
    std::memset(&sockaddr, 0, sizeof(sockaddr));
    sockaddr.sin_family = AF_INET;
    sockaddr.sin_addr.s_addr = inet_addr(ip.c_str());
    sockaddr.sin_port = htons(port);
    if (connect(sockfd, (struct sockaddr*)&sockaddr, sizeof(sockaddr)) < 0)
    {
        printf("connect server failed\n");
        return 1;
    }
    else
    {
        printf("connect server successfully\n");
    }

    // 3. 向服务端发送数据
    std::string data = "test";
    send(sockfd, data.c_str(), data.size(), 0);
    
    // 4. 接收服务端的数据
    char buf[1024] = {0};
    recv(sockfd, buf, sizeof(buf), 0);
    printf("recived data from server: %s\n", buf);

    // 5. 关闭 socket
    close(sockfd);
    return 0;
}
```

---

# UDP 服务端

## 1. 创建 socket

```cpp
int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
```

## 2. 绑定 socket

```cpp
std::string ip = "127.0.0.1";
int port = 8080;
    
struct sockaddr_in sockaddr;
std::memset(&sockaddr, 0, sizeof(sockaddr));
sockaddr.sin_family = AF_INET;
sockaddr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
sockaddr.sin_port = htons(port); // 端口号转大端序 host -> net (short)
    
if (bind(sockfd, (struct sockaddr*)&sockaddr, sizeof(sockaddr)) < 0)
{
    printf("socket bind error: %d %s\n", errno, strerror(errno));
    return 1;
}
```

## 3. 接收客户端的数据

```cpp
char buf[1024] = {0};

struct sockaddr_in client_addr; // 用于接收客户端的地址信息
socklen_t client_addr_len = sizeof(client_addr);

ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf), 0, (struct sockaddr*)&client_addr, &client_addr_len);
```

## 4. 向客户端发送数据

```cpp
std::string data = "test content";
ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&client_addr, client_addr_len);
```

## 5. 关闭 socket

```cpp
close(sockfd);
```

## 6. 代码示例

```cpp
#include <iostream>

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
    std::string ip = "127.0.0.1";
    int port = 8080;
    
    struct sockaddr_in sockaddr;
    std::memset(&sockaddr, 0, sizeof(sockaddr));
    sockaddr.sin_family = AF_INET;
    sockaddr.sin_addr.s_addr = inet_addr(ip.c_str()); // ipv4十进制字符串->网络字节序二进制地址
    sockaddr.sin_port = htons(port); // 端口号转大端序 host -> net (short)
    
    if (bind(sockfd, (struct sockaddr*)&sockaddr, sizeof(sockaddr)) < 0)
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
        ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf), 0, (struct sockaddr*)&client_addr, &client_addr_len);
        if (recv_len < 0)
        {
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

---

# UDP 客户端

## 1. 创建 socket

```cpp
int sockfd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
```

## 2. 向服务端发送数据

```cpp
// 设置目标服务端的地址与端口
std::string ip = "127.0.0.1";
int port = 8080;

struct sockaddr_in sockaddr;
std::memset(&sockaddr, 0, sizeof(sockaddr));
sockaddr.sin_family = AF_INET;
sockaddr.sin_addr.s_addr = inet_addr(ip.c_str());
sockaddr.sin_port = htons(port);

// 发送数据
std::string data = "test content";
ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&sockaddr, sizeof(sockaddr));
```

## 3. 接收服务端的数据

```cpp
char buf[1024] = {0};
struct sockaddr_in server_addr; // 用于接收客户端的地址信息
socklen_t server_addr_len = sizeof(server_addr);
ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf), 0, (struct sockaddr*)&server_addr, &server_addr_len);
```

## 4. 关闭 socket

```cpp
close(sockfd);
```

## 5. 代码示例

```cpp
#include <iostream>

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

    struct sockaddr_in sockaddr;
    std::memset(&sockaddr, 0, sizeof(sockaddr));
    sockaddr.sin_family = AF_INET;
    sockaddr.sin_addr.s_addr = inet_addr(ip.c_str());
    sockaddr.sin_port = htons(port);

    std::string data = "test";
    ssize_t send_len = sendto(sockfd, data.c_str(), data.size(), 0, (struct sockaddr*)&sockaddr, sizeof(sockaddr));
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
    ssize_t recv_len = recvfrom(sockfd, buf, sizeof(buf), 0, (struct sockaddr*)&server_addr, &server_addr_len);
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

---
title: Reactor 网络模型
date: 2025-10-03
updated: 2026-10-05
cover: /images/posts/Reactor 网络模型/cover.png
categories: 网络编程
tags:
  - Reactor
  - epoll
  - EventLoop
  - C++
  - 网络编程
  - 多线程
---

IO 多路复用配合非阻塞能让一个线程同时管理大量连接，但直接调用原生接口写起来十分不方便，也不便于管理和扩展。于是就有了 Reactor 架构模型。它的核心思想是事件驱动，将 IO 事件的监听、分发和处理进行解耦。

---

# 1. Reactor 的组成

## 1.1 组件职责

Reactor 里有四个经典角色：

- `Poller`：负责统一监听所有 `fd` 的 IO 事件（本实现里就是 `Epoll` 类）
- `Channel`：对 `fd` 的抽象，封装了 `fd`、关注的事件以及对应的回调函数
- `EventLoop`：事件循环的核心组件，负责调用 `Poller` 等待事件、分发就绪事件，并执行相应的回调函数
- `Handler`：处理事件的具体逻辑，也就是上面提到的回调函数

`Handler` 在本实现里**没有单独抽象成一个类**，它直接以 `std::function<void()>` 的形式嵌在 `Channel` 里。这是有意为之，事件一到，`Channel::handleEvent` 就地判断类型、调用对应的回调，中间不需要再经过一层对象。

在这四个角色之外，还需要三个“业务层”组件才能构成一个能跑的服务器：

- `Buffer`：读写缓冲区，解决粘包 / 拆包和“写不完”
- `Connection`：一条已建立的连接，把 `Socket`、`Channel`、两个 `Buffer` 和几个回调组装在一起
- `TcpServer`：持有监听 socket，`accept` 出新连接后分配 `EventLoop`、创建 `Connection` 并管理它们的生命周期

## 1.2 事件流主线

整个程序的结构只有一条主线：

```
epoll_wait 返回就绪事件
      │
EventLoop 取出就绪的 Channel
      │
Channel::handleEvent() 判断事件类型
      │
调用注册好的回调（Handler）
      │
Connection 读写数据 / TcpServer 接受新连接
```

在这次实现中，暂时没有引入 `Acceptor` 这一概念，而是直接在 `TcpServer` 里持有监听 socket 并注册读回调。`Acceptor` 就是把监听 socket 和新连接的处理逻辑封装在一起，避免 `TcpServer` 里出现过多的细节。不过目前的实现已经足够清晰，后续如果需要，可以再考虑引入。

# 2. 事件底座

## 2.1 Epoll（多路复用器）

`Epoll` 类是对 Linux `epoll` API 的封装，用于管理所有 `fd` 的事件监听。

```cpp
#pragma once

#include <sys/epoll.h>
#include <vector>

#include "channel.h"

class Epoll {
private:
    int epfd;
    std::vector<epoll_event> events;

public:
    Epoll(int maxEvents = 1024);
    ~Epoll();

    Epoll(const Epoll&) = delete;
    Epoll& operator=(const Epoll&) = delete;

    bool add(Channel* channel);
    bool mod(Channel* channel);
    bool del(Channel* channel);

    int wait(int timeout = -1);

    epoll_event getEvent(int i) const;
    Channel* getChannel(int i) const;
};
```

```cpp
#include "epoll.h"

#include <unistd.h>

Epoll::Epoll(int maxEvents)
{
    epfd = epoll_create1(0);
    events.resize(maxEvents);
}

Epoll::~Epoll()
{
    close(epfd);
}

bool Epoll::add(Channel* channel)
{
    epoll_event ev{};
    ev.events = channel->getEvents();
    ev.data.ptr = channel;

    return epoll_ctl(epfd, EPOLL_CTL_ADD, channel->getFd(), &ev) == 0;
}

bool Epoll::mod(Channel* channel)
{
    epoll_event ev{};
    ev.events = channel->getEvents();
    ev.data.ptr = channel;

    return epoll_ctl(epfd, EPOLL_CTL_MOD, channel->getFd(), &ev) == 0;
}

bool Epoll::del(Channel* channel)
{
    return epoll_ctl(epfd, EPOLL_CTL_DEL, channel->getFd(), nullptr) == 0;
}

int Epoll::wait(int timeout)
{
    return epoll_wait(epfd, events.data(), events.size(), timeout);
}

epoll_event Epoll::getEvent(int i) const
{
    return events[i];
}

Channel* Epoll::getChannel(int i) const
{
    return static_cast<Channel*>(events[i].data.ptr);
}
```

`epoll_wait` 返回之后，程序需要知道这个 `fd` 属于哪个对象，才能找到对应的处理逻辑。如果直接把 `fd` 作为 `data.fd` 存进内核，程序还得自己维护一个 `fd` 到对象的映射表。所以正确的做法是把对象的指针存进 `data.ptr`，这样就能直接拿到对象了。

`add()` / `mod()` 里每次都要重新构造一个 `epoll_event`，而不是只改 `Channel` 里的 `events` 字段。因为注册时的事件是 `epoll_ctl` 那一刻拷贝进内核的，在 `Channel` 里更改 `events` 并不会影响内核里的状态，必须再调用一次 `epoll_ctl` 才会生效。

## 2.2 Channel（事件通道）

`Channel` 表示一个 `fd` 的事件对象，每个 socket 对应一个 `Channel`，它负责记录关注的事件、保存回调函数。

`Channel` 中储存了以下重要信息：
- `fd`：代表哪个描述符（socket）
- `events` / `revents`：
  - `events`：注册时关心的事件（会被 `Epoll::add / mod` 送进内核）
  - `revents`： 内核返回的就绪事件（由 `EventLoop` 从 `epoll_wait` 的结果里填进来）
- 两个回调：分别用于处理可读事件和可写事件

```cpp
#pragma once

#include <functional>
#include <sys/epoll.h>

#include "socket.h"

class Channel {
private:
    int fd;

    uint32_t events;
    uint32_t revents;

    Socket* socket;

    std::function<void()> readCallback;
    std::function<void()> writeCallback;

public:
    Channel(int fd, Socket* sock = nullptr)
        : fd(fd), socket(sock), events(0), revents(0) {}
    ~Channel() = default;

    // 禁止拷贝，允许移动
    Channel(const Channel&) = delete;
    Channel& operator=(const Channel&) = delete;
    Channel(Channel&&) = default;
    Channel& operator=(Channel&&) = default;

    int getFd() const { return fd; }
    Socket* getSocket() const { return socket; }

    uint32_t getEvents() const { return events; }
    uint32_t getRevents() const { return revents; }

    void setEvents(uint32_t ev) { events = ev; }
    void setRevents(uint32_t rev) { revents = rev; }

    void setReadCallback(const std::function<void()>& cb) { readCallback = cb; }
    void setWriteCallback(const std::function<void()>& cb) { writeCallback = cb; }

    void handleEvent()
    {
        // EPOLLERR / EPOLLHUP 即使没有注册也会被内核上报，必须优先处理
        if (revents & (EPOLLERR | EPOLLHUP))
        {
            // 交给读回调去发现并关闭，读到 EOF 或读出错都会走关闭流程
            if (readCallback)
            {
                readCallback();
            }
            return;
        }

        if ((revents & EPOLLIN) && readCallback)
        {
            readCallback();
        }
        if ((revents & EPOLLOUT) && writeCallback)
        {
            writeCallback();
        }
    }
};
```

事件循环和业务逻辑的**解耦**：`handleEvent()` 是整个 Reactor 里**唯一一处判断事件类型的地方**。`EventLoop` 只负责调用就绪的 `Channel` 的 `handleEvent()`，然后由 `Channel` 根据 `revents` 调用对应的回调函数。因此，业务逻辑只需要注册回调，而不用关心事件循环 / 分发的细节。

`handleEvent()` 开头部分的 `EPOLLERR | EPOLLHUP` 的判断不能省。这两个标志**不需要注册就会上报**，而且往往和 `EPOLLIN` 一起出现。如果不单独处理，一个已经挂断的连接可能走进读回调后因为 `revents` 里没有 `EPOLLIN` 而被跳过，于是永远不会走到关闭流程，`Channel` 和 `Connection` 就泄漏了。此外，这里直接复用 `readCallback` 是偷懒但有效的做法，当连接出错或对端挂断时，`read` 要么返回 0（对端关了），要么返回 -1 且 `errno` 不是 `EAGAIN`，两种情况都会走到 `handleClose()`。

## 2.3 EventLoop（事件循环）

`EventLoop` 是 Reactor 的核心组件，负责事件循环、事件分发、任务调度。

```cpp
#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "channel.h"
#include "epoll.h"

class EventLoop {
private:
    Epoll epoll;

    std::vector<Channel*> activeChannels;

    std::atomic<bool> looping;
    std::atomic<bool> isQuit;
    std::atomic<bool> callingPendingFunctors;

    std::thread::id threadId;

    int wakeupFd;
    std::unique_ptr<Channel> wakeupChannel;

    std::mutex pendingMutex;
    std::vector<std::function<void()>> pendingFunctors;

public:
    EventLoop(int maxEvents = 1024);
    ~EventLoop();

    EventLoop(const EventLoop&) = delete;
    EventLoop& operator=(const EventLoop&) = delete;

    void loop();
    void quit();

    void addChannel(Channel* channel);
    void updateChannel(Channel* channel);
    void removeChannel(Channel* channel);

    void runInLoop(const std::function<void()>& cb);
    void queueInLoop(const std::function<void()>& cb);

    bool isInLoopThread() const;

private:
    void wakeup();
    void handleWakeupRead();
    void doPendingFunctors();
};
```

```cpp
#include "eventloop.h"

#include <cerrno>
#include <cstdint>

#include <sys/eventfd.h>
#include <unistd.h>

EventLoop::EventLoop(int maxEvents)
    : epoll(maxEvents),
      looping(false),
      isQuit(false),
      callingPendingFunctors(false),
      threadId(std::this_thread::get_id()),
      wakeupFd(-1)
{
    wakeupFd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    if (wakeupFd >= 0)
    {
        wakeupChannel = std::make_unique<Channel>(wakeupFd);
        wakeupChannel->setEvents(EPOLLIN);
        wakeupChannel->setReadCallback([this]() { handleWakeupRead(); });
        epoll.add(wakeupChannel.get());
    }
}

EventLoop::~EventLoop()
{
    if (wakeupChannel)
    {
        epoll.del(wakeupChannel.get());
    }

    if (wakeupFd >= 0)
    {
        close(wakeupFd);
    }
}

void EventLoop::loop()
{
    looping = true;
    isQuit = false;

    while (!isQuit)
    {
        int n = epoll.wait(-1);   // 阻塞等待事件发生

        activeChannels.clear();

        // 把就绪事件对应的 Channel 收集起来
        for (int i = 0; i < n; i++)
        {
            Channel* channel = epoll.getChannel(i);
            if (channel)
            {
                channel->setRevents(epoll.getEvent(i).events);
                activeChannels.push_back(channel);
            }
        }

        // 逐个分发
        for (Channel* channel : activeChannels)
        {
            channel->handleEvent();
        }

        // 处理 pendingFunctors 中的任务
        doPendingFunctors();
    }

    looping = false;
}

void EventLoop::quit()
{
    isQuit = true;
    wakeup();
}

void EventLoop::addChannel(Channel* channel)
{
    if (!channel)
    {
        return;
    }
    epoll.add(channel);
}

void EventLoop::updateChannel(Channel* channel)
{
    if (!channel)
    {
        return;
    }
    epoll.mod(channel);
}

void EventLoop::removeChannel(Channel* channel)
{
    if (!channel)
    {
        return;
    }
    epoll.del(channel);
}

void EventLoop::runInLoop(const std::function<void()>& cb)
{
    if (!cb)
    {
        return;
    }

    if (isInLoopThread())
    {
        cb();
        return;
    }

    queueInLoop(cb);
}

void EventLoop::queueInLoop(const std::function<void()>& cb)
{
    if (!cb)
    {
        return;
    }

    {
        std::lock_guard<std::mutex> lock(pendingMutex);
        pendingFunctors.push_back(cb);
    }

    // 不在本线程，本线程可能正阻塞在 epoll_wait 上，必须叫醒它
    // 正在执行 pendingFunctors，新加入的任务要等下一轮，
    // 如果不唤醒，下一轮 epoll_wait 又会阻塞，任务就卡住了
    if (!isInLoopThread() || callingPendingFunctors.load())
    {
        wakeup();
    }
}

bool EventLoop::isInLoopThread() const
{
    return threadId == std::this_thread::get_id();
}

void EventLoop::wakeup()
{
    if (wakeupFd < 0)
    {
        return;
    }

    uint64_t one = 1;
    ssize_t n = write(wakeupFd, &one, sizeof(one));
    (void)n;
}

void EventLoop::handleWakeupRead()
{
    if (wakeupFd < 0)
    {
        return;
    }

    uint64_t value;
    while (true)
    {
        ssize_t n = read(wakeupFd, &value, sizeof(value));
        if (n == sizeof(value))
        {
            continue; // 还有计数没读完，继续
        }
        break; // EAGAIN 或出错，都退出
    }
}

void EventLoop::doPendingFunctors()
{
    std::vector<std::function<void()>> functors;
    callingPendingFunctors = true;

    {
        // 先把队列换出来再执行，这样跑任务期间不用持锁，
        // 其他线程投递任务才不会被阻塞
        std::lock_guard<std::mutex> lock(pendingMutex);
        functors.swap(pendingFunctors);
    }

    for (const auto& fn : functors)
    {
        fn();
    }

    callingPendingFunctors = false;
}
```

一个 `EventLoop` 只属于一个线程。`threadId` 在**构造函数**里记下当前线程，也就是说 `EventLoop` 是在哪个线程构造的，它就属于哪个线程，`isInLoopThread()` 判断的就是这个。之所以不给 `epoll` 加锁，是因为加锁会带来竞争和性能损耗，“每个线程一个 `EventLoop`”这个约束能从根上避免竞争，这也是后面 `EventLoopThreadPool` 存在的意义。

`wakeupFd` 为什么必须存在？

线程阻塞在 `epoll.wait(-1)` 上时收不到任何“用户态消息”，只对 `fd` 事件有反应，但跨线程的任务（比如主线程让 IO 线程关闭某条连接）必须被执行。`eventfd` 是内核提供的计数器 `fd`，往里面写 8 字节就会让它变为可读，`epoll_wait` 随即返回，这就是“叫醒一个睡在 `epoll_wait` 里的线程”的标准手段。它自己也是一个 `Channel`，注册进同一个 `Epoll`，回调 `handleWakeupRead` 负责把计数读掉，否则 `eventfd` 一直是可读的，会空转。

`activeChannels` 为什么要先收集再分发？

如果边等边分发的话，分发过程中新注册的 `Channel` 可能被本轮误处理，而且 `epoll.wait` 的结果数组在下一轮会被覆盖。先收到自己的 `vector` 里，分发阶段就和 `epoll` 的内部状态解耦了。

`doPendingFunctors` 为什么先 `swap` 再执行？

如果在持有锁的情况下执行任务的话，在任务里再调 `queueInLoop`（同一个 loop 线程）就会死锁。把队列换到一个局部变量、立刻放锁，执行期间别的线程照样可以投递。这也是 `queueInLoop` 里要判断 `callingPendingFunctors` 的原因，正在执行任务时新投递的任务只能等下一轮，而下一轮 `epoll_wait` 可能会阻塞，所以必须补一次 `wakeup()`。

# 3. 连接与数据

## 3.1 Buffer（缓冲区）

### 3.1.1 类定义

`Buffer` 内部维护一个 `std::vector<char>` 和两个下标（`readIndex`、`writeIndex`）：
- `readIndex` 之前是已经读走的数据
- `readIndex` 到 `writeIndex` 之间是可读数据
- `writeIndex` 之后是可写空间

```
   已读走   |    可读数据    |    可写空间
┌─────────┬───────────────┬──────────────┐
│         │               │              │
└─────────┴───────────────┴──────────────┘
0      readIndex      writeIndex    buffer.size()
```

```cpp
#pragma once

#include <cstddef>
#include <sys/types.h>
#include <vector>
#include <string>

class Buffer {
private:
    std::vector<char> buffer;
    size_t readIndex;
    size_t writeIndex;

public:
    explicit Buffer(size_t initSize = 1024);
    ~Buffer();

    Buffer(const Buffer&) = delete;
    Buffer& operator=(const Buffer&) = delete;
    Buffer(Buffer&& other) noexcept;
    Buffer& operator=(Buffer&& other) noexcept;

    ssize_t readFd(int fd, int* savedErrno);
    ssize_t writeFd(int fd, int* savedErrno);

    void append(const char* data, size_t len);
    void append(const std::string& data);
    void append(const Buffer& data);

    const char* peek() const { return buffer.data() + readIndex; }

    void retrieve(size_t len);
    void retrieveAll();

    size_t readableBytes() const { return writeIndex - readIndex; }
    size_t writableBytes() const { return buffer.size() - writeIndex; }
    size_t prependBytes() const { return readIndex; }

    // 查找 CRLF 的位置（回车+换行，\r\n，它是 HTTP 请求/响应头的分隔标记）
    const char* findCRLF(const char* start) const;
    const char* findCRLF() const;
    // 取出数据直到 end 指针所指的位置
    void retrieveUntil(const char* end);
    // 取出长度为 len 的数据并返回为字符串
    std::string retrieveAsString(size_t len);

private:
    void makeSpace(size_t len);
};
```

### 3.1.2 实现

```cpp
#include "buffer.h"

#include <algorithm>
#include <cerrno>

#include <sys/uio.h>
#include <unistd.h>

Buffer::Buffer(size_t initSize)
    : buffer(initSize), readIndex(0), writeIndex(0) {}

Buffer::~Buffer() {}

Buffer::Buffer(Buffer&& other) noexcept
    : buffer(std::move(other.buffer)),
      readIndex(other.readIndex),
      writeIndex(other.writeIndex)
{
    other.readIndex = 0;
    other.writeIndex = 0;
}

Buffer& Buffer::operator=(Buffer&& other) noexcept
{
    if (this != &other)
    {
        buffer = std::move(other.buffer);
        readIndex = other.readIndex;
        writeIndex = other.writeIndex;

        other.readIndex = 0;
        other.writeIndex = 0;
    }
    return *this;
}

ssize_t Buffer::readFd(int fd, int* savedErrno)
{
    // 栈上 50KB 临时缓冲，因为内核接收缓冲区可能有几十 KB 数据，
    // 只用 Buffer 自己的空间就得反复 read 好几次、多几次系统调用
    char temp_buffer[50000];

    struct iovec vec[2];
    const size_t writable = writableBytes();

    // 一个 iovec 指向 Buffer 自己的可写区，另一个指向栈上的临时缓冲
    vec[0].iov_base = buffer.data() + writeIndex;
    vec[0].iov_len = writable;
    vec[1].iov_base = temp_buffer;
    vec[1].iov_len = sizeof(temp_buffer);

    ssize_t n = ::readv(fd, vec, 2);
    if (n < 0)
    {
        if (savedErrno)
        {
            *savedErrno = errno;
        }
        return -1;
    }

    if (static_cast<size_t>(n) <= writable)
    {
        writeIndex += n;
    }
    else
    {
        // 数据超过了 Buffer 的可写区，多出来的部分在 temp_buffer 里，补进来
        writeIndex = buffer.size();
        append(temp_buffer, static_cast<size_t>(n) - writable);
    }
    return n;
}

ssize_t Buffer::writeFd(int fd, int* savedErrno)
{
    ssize_t n = ::write(fd, peek(), readableBytes());
    if (n < 0)
    {
        if (savedErrno)
        {
            *savedErrno = errno;
        }
        return -1;
    }
    retrieve(n);   // 写出去的部分直接从可读区消费掉
    return n;
}

void Buffer::append(const char* data, size_t len)
{
    if (len > writableBytes())
    {
        makeSpace(len);
    }
    std::copy(data, data + len, buffer.data() + writeIndex);
    writeIndex += len;
}

void Buffer::append(const std::string& data)
{
    append(data.c_str(), data.size());
}

void Buffer::append(const Buffer& data)
{
    append(data.peek(), data.readableBytes());
}

void Buffer::retrieve(size_t len)
{
    if (len >= readableBytes())
    {
        retrieveAll();
    }
    else
    {
        readIndex += len;
    }
}

void Buffer::retrieveAll()
{
    readIndex = 0;
    writeIndex = 0;
}

void Buffer::makeSpace(size_t len)
{
    if (writableBytes() + prependBytes() < len)
    {
        // 前面腾出来的空洞加尾部空闲还不够，只能真正扩容
        buffer.resize(writeIndex + len);
    }
    else
    {
        // 空间够，但被拆成了两段，把可读数据挪到最前面凑出一整块连续空间
        const size_t readable = readableBytes();
        std::copy(buffer.data() + readIndex, buffer.data() + writeIndex, buffer.data());
        readIndex = 0;
        writeIndex = readable;
    }
}

const char* Buffer::findCRLF(const char* start) const
{
    const char* crlf = std::search(start, buffer.data() + writeIndex, "\r\n", "\r\n" + 2);
    return crlf == buffer.data() + writeIndex ? nullptr : crlf;
}

const char* Buffer::findCRLF() const
{
    return findCRLF(peek());
}

void Buffer::retrieveUntil(const char* end)
{
    size_t len = end - peek();
    retrieve(len);
}

std::string Buffer::retrieveAsString(size_t len)
{
    std::string result(peek(), len);
    retrieve(len);
    return result;
}
```

在 `readFd` 里创建了一个 50KB 的数组（临时缓冲区），这是因为内核接收缓冲区可能有几十 KB 数据，如果只用 `Buffer` 自己的空间就得反复 `read` 好几次、多几次系统调用。但有了这个临时缓冲区，`readv` 就可以一次性把内核缓冲区的数据读到 `Buffer` 自己的可写区和栈上的临时缓冲区。相比之下 `writeFd` 写多少就消费掉多少，剩余的就留在 `Buffer` 里等下一轮再写，不需要额外的栈空间。

### 3.1.3 用 Buffer 解决粘包

划分消息边界有三种常见做法：定长消息、分隔符、长度字段。`Buffer` 本身不关心用哪种，它只提供“看”和“取”两类操作，`peek()` 只看数据但不消费，`retrieve()` / `retrieveUntil()` / `retrieveAsString()` 则会直接取走数据。

1. 长度字段（最通用）：每条消息的前 4 字节是一个 `uint32_t`，表示正文长度

```cpp
void onMessage(Connection* conn, Buffer* buf)
{
    // 只要缓冲区里还有“至少够一个长度字段”的数据就继续尝试解析
    while (buf->readableBytes() >= 4)
    {
        uint32_t len = 0;
        std::memcpy(&len, buf->peek(), 4);

        // 正文还没到齐，这正是“拆包”的情形，
        // 直接返回，等下次数据到达时再继续解析
        if (buf->readableBytes() < 4 + len)
        {
            break;
        }

        buf->retrieve(4);   // 消费掉长度字段
        std::string msg = buf->retrieveAsString(len);

        handleMessage(conn, msg);
    }
}
```

2. 分隔符（适合文本协议）：每条消息以 `\r\n` 结尾

```cpp
void onMessage(Connection* conn, Buffer* buf)
{
    const char* crlf = buf->findCRLF();
    if (crlf == nullptr)
    {
        return;   // 一行还没到齐，等下次
    }

    std::string line = buf->retrieveAsString(crlf - buf->peek());
    buf->retrieveUntil(crlf + 2);   // 连 \r\n 一起消费掉

    handleLine(conn, line);
}
```

以上两种做法都能解决粘包问题，区别在于长度字段适合二进制协议，分隔符适合文本协议（如 HTTP 协议）。

## 3.2 Connection（一条连接）

`Connection` 是一条已建立连接的全部状态：`Socket`、`Channel`、两个 `Buffer`、一个状态机，以及三个回调。

```cpp
#pragma once

#include <functional>
#include <memory>
#include <string>

#include "buffer.h"
#include "channel.h"
#include "eventloop.h"
#include "socket.h"

class Connection : public std::enable_shared_from_this<Connection> {
public:
    using ConnectionCallback = std::function<void(Connection*)>;
    using MessageCallback = std::function<void(Connection*, Buffer*)>;
    using CloseCallback = std::function<void(Connection*)>;

    Connection(EventLoop* loop, Socket&& socket);
    ~Connection();

    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    int fd() const { return socket.getFd(); }
    bool connected() const { return state == State::Connected; }

    void setConnectionCallback(const ConnectionCallback& cb) { connectionCallback = cb; }
    void setMessageCallback(const MessageCallback& cb) { messageCallback = cb; }
    void setCloseCallback(const CloseCallback& cb) { closeCallback = cb; }

    void connectEstablished();
    void connectDestroyed();

    void send(const std::string& data);
    void shutdown();

    Buffer* inputBufferPtr() { return &inputBuffer; }
    Buffer* outputBufferPtr() { return &outputBuffer; }

private:
    enum class State {
        Connecting,
        Connected,
        Disconnecting,
        Disconnected,
    };

    void setState(State s) { state = s; }

    void handleRead();
    void handleWrite();
    void handleClose();

    void sendInLoop(const char* data, size_t len);

private:
    EventLoop* loop;
    Socket socket;
    std::unique_ptr<Channel> channel;

    State state;
    Buffer inputBuffer;
    Buffer outputBuffer;

    ConnectionCallback connectionCallback;
    MessageCallback messageCallback;
    CloseCallback closeCallback;
};
```

```cpp
#include "connection.h"

#include <cerrno>

#include <sys/epoll.h>
#include <sys/socket.h>

Connection::Connection(EventLoop* loop_, Socket&& socket_)
    : loop(loop_),
      socket(std::move(socket_)),
      channel(std::make_unique<Channel>(socket.getFd(), &socket)),
      state(State::Connecting),
      inputBuffer(),
      outputBuffer()
{
    channel->setReadCallback([this]() { handleRead(); });
    channel->setWriteCallback([this]() { handleWrite(); });
}

Connection::~Connection()
{
    // 如果没走过 handleClose（比如 TcpServer 析构时），
    // 这里要保证 Channel 从 epoll 里摘除掉，否则会留下悬垂指针
    // epoll_ctl(DEL) 对没注册过的 fd 会返回错误，忽略即可
    if (channel)
    {
        loop->removeChannel(channel.get());
    }
}

void Connection::connectEstablished()
{
    setState(State::Connected);
    channel->setEvents(EPOLLIN);
    loop->addChannel(channel.get());

    if (connectionCallback)
    {
        connectionCallback(this);
    }
}

void Connection::connectDestroyed()
{
    if (state == State::Connected)
    {
        setState(State::Disconnected);
        loop->removeChannel(channel.get());
    }
}

void Connection::send(const std::string& data)
{
    if (state != State::Connected)
    {
        return;
    }

    if (loop->isInLoopThread())
    {
        sendInLoop(data.data(), data.size());
        return;
    }

    // 跨线程调用，把数据拷一份，投递到该连接所属的线程去执行
    loop->runInLoop([this, data]() { sendInLoop(data.data(), data.size()); });
}

void Connection::shutdown()
{
    if (state == State::Connected)
    {
        setState(State::Disconnecting);
        if (loop->isInLoopThread())
        {
            if (outputBuffer.readableBytes() == 0)
            {
                ::shutdown(socket.getFd(), SHUT_WR);
            }
        }
        else
        {
            loop->runInLoop([this]() {
                if (outputBuffer.readableBytes() == 0)
                {
                    ::shutdown(socket.getFd(), SHUT_WR);
                }
            });
        }
    }
}

void Connection::handleRead()
{
    auto self = shared_from_this();   // 回调执行期间保住自己不被销毁

    int savedErrno = 0;
    const ssize_t n = inputBuffer.readFd(socket.getFd(), &savedErrno);

    if (n > 0)
    {
        if (messageCallback)
        {
            messageCallback(this, &inputBuffer);
        }
        return;
    }

    if (n == 0)
    {
        handleClose();   // 对端关闭连接
        return;
    }

    if (savedErrno == EINTR)
    {
        return;   // 被信号打断，不是真错误，等下次事件重读
    }
    if (savedErrno != EAGAIN && savedErrno != EWOULDBLOCK)
    {
        handleClose();
    }
}

void Connection::handleWrite()
{
    if ((channel->getEvents() & EPOLLOUT) == 0)
    {
        return;   // 已经写完并摘掉了 EPOLLOUT，忽略残留通知
    }

    auto self = shared_from_this();

    int savedErrno = 0;
    const ssize_t n = outputBuffer.writeFd(socket.getFd(), &savedErrno);
    if (n < 0)
    {
        if (savedErrno != EAGAIN && savedErrno != EWOULDBLOCK && savedErrno != EINTR)
        {
            handleClose();
        }
        return;
    }

    if (outputBuffer.readableBytes() == 0)
    {
        // 全部发完了，把 EPOLLOUT 摘掉，
        // 不摘的话只要发送缓冲区有空位就会一直通知，事件循环会空转
        channel->setEvents(channel->getEvents() & ~EPOLLOUT);
        loop->updateChannel(channel.get());

        if (state == State::Disconnecting)
        {
            // 之前调用过 shutdown()，但那时还有数据没发完，
            // 现在发完了，可以真正关掉写方向了
            ::shutdown(socket.getFd(), SHUT_WR);
        }
    }
}

void Connection::handleClose()
{
    if (state == State::Disconnected)
    {
        return;   // 防止重复关闭
    }

    setState(State::Disconnected);
    loop->removeChannel(channel.get());

    if (closeCallback)
    {
        closeCallback(this);
    }
}

void Connection::sendInLoop(const char* data, size_t len)
{
    if (state == State::Disconnected)
    {
        return;
    }

    // 只有在“没有积压数据、也没注册过 EPOLLOUT”时才尝试直接写，
    // 否则新数据必须排到积压数据后面，不然顺序会乱
    if ((channel->getEvents() & EPOLLOUT) == 0 && outputBuffer.readableBytes() == 0)
    {
        const ssize_t n = socket.send(data, len, 0);
        if (n >= 0)
        {
            const size_t sent = static_cast<size_t>(n);
            if (sent == len)
            {
                return;   // 一次写完，最好的情况
            }
            outputBuffer.append(data + sent, len - sent);   // 只写了一部分
        }
        else
        {
            if (errno != EAGAIN && errno != EWOULDBLOCK)
            {
                handleClose();
                return;
            }
            outputBuffer.append(data, len);
        }
    }
    else
    {
        outputBuffer.append(data, len);
    }

    // 还有没写完的，注册 EPOLLOUT 等可写事件
    if ((channel->getEvents() & EPOLLOUT) == 0)
    {
        channel->setEvents(channel->getEvents() | EPOLLOUT);
        loop->updateChannel(channel.get());
    }
}
```

两个 `Buffer` 各司其职：
- `inputBuffer` 解决“收到的数据凑不成完整消息”（拆包、粘包）
- `outputBuffer` 解决“要发的数据一次发不完”（非阻塞写）

前者在 `handleRead` 里被填充、在消息回调里被消费，后者在 `sendInLoop` 里被填充、在 `handleWrite` 里被消费。

给 `self` 赋值 `shared_from_this()` 是必须的（`shared_from_this()` 返回当前对象的 shared_ptr），否则回调执行期间 `Connection` 对象可能被销毁，导致回调里访问成员变量时出现悬空指针。`shared_ptr` 的引用计数机制保证了回调执行期间 `Connection` 对象不会被销毁。

状态机的设计是为了处理两种特殊情况：
1. 重复关闭：`handleClose` 开头判断 `Disconnected` 就直接返回，因为 `EPOLLERR`、对端关闭、写错误都可能先后触发它
2. `shutdown()` 的延迟：调用 `shutdown()` 时如果 `outputBuffer` 里还有数据没发完，不能立刻 `::shutdown`，得等 `handleWrite` 把数据发干净，这也是 `state == Disconnecting` 那个分支存在的原因

## 3.3 TcpServer（组装）

将前面所有组件组装起来，实现一个完整的 TCP 服务器。

```cpp
// util.h
#pragma once

#include <fcntl.h>

inline int set_non_blocking(int fd)
{
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags == -1)
    {
        return -1;
    }
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}
```

这里事先实现了一个 `set_non_blocking()` 工具函数，用于给套接字启用非阻塞模式。

```cpp
#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <unordered_map>

#include "buffer.h"
#include "channel.h"
#include "connection.h"
#include "eventloop.h"
#include "eventloopthreadpool.h"
#include "socket.h"

class TcpServer {
private:
    Socket server;
    EventLoop mainloop;
    size_t numThreads;

    std::unique_ptr<Channel> serverChannel;
    std::unordered_map<int, std::shared_ptr<Connection>> connections;

    std::unique_ptr<EventLoopThreadPool> threadPool;

    Connection::ConnectionCallback connectionCallback;
    Connection::MessageCallback messageCallback;
    Connection::CloseCallback closeCallback;

public:
    explicit TcpServer(size_t numThreads = 0);
    ~TcpServer();

    TcpServer(const TcpServer&) = delete;
    TcpServer& operator=(const TcpServer&) = delete;

    bool start(const std::string& ip, int port);
    void run();

    void setConnectionCallback(const Connection::ConnectionCallback& cb) { connectionCallback = cb; }
    void setMessageCallback(const Connection::MessageCallback& cb) { messageCallback = cb; }
    void setCloseCallback(const Connection::CloseCallback& cb) { closeCallback = cb; }

private:
    void handleAccept();                               // accept 新连接
    void onConnection(Connection* conn);               // 连接建立/断开回调（转发给用户）
    void onMessage(Connection* conn, Buffer* buffer);  // 消息到达回调（转发给用户）
    void onClose(Connection* conn);                    // 连接关闭回调（清理资源）
};
```

```cpp
#include "tcpserver.h"

#include <cerrno>
#include <iostream>
#include <utility>

#include "util.h"

TcpServer::TcpServer(size_t numThreads)
    : mainloop(1024),
      numThreads(numThreads),
      serverChannel(nullptr),
      threadPool(std::make_unique<EventLoopThreadPool>(&mainloop, numThreads)) {}

TcpServer::~TcpServer() = default;   // Connection 的析构会自动清理资源，RAII 管理连接对象

bool TcpServer::start(const std::string& ip, int port)
{
    if (!server.create(AF_INET, SOCK_STREAM, IPPROTO_TCP))
    {
        std::cerr << "Server create failed\n";
        return false;
    }

    set_non_blocking(server.getFd());   // 设置服务器套接字为非阻塞模式

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

    serverChannel = std::make_unique<Channel>(server.getFd(), &server);
    serverChannel->setEvents(EPOLLIN);                                  // 监听可读事件（即有新连接到来）
    serverChannel->setReadCallback([this]() { this->handleAccept(); }); // 绑定回调

    // 启动 subLoop 线程池，后续新连接会按轮询分配到各个 subLoop
    threadPool->start();

    // epoll 添加服务器套接字
    mainloop.addChannel(serverChannel.get());

    std::cout << "Server listening on " << ip << ":" << port << std::endl;
    return true;
}

void TcpServer::run()
{
    mainloop.loop();
}

void TcpServer::handleAccept()
{
    while (true)
    {
        Socket client = server.accept();
        if (!client.isValid())
        {
            break;
        }

        set_non_blocking(client.getFd());   // 设置客户端套接字为非阻塞模式

        int clientFd = client.getFd();
        std::cout << "New client connected: " << clientFd << std::endl;

        EventLoop* ioLoop = threadPool->getNextLoop();
        auto connection = std::make_shared<Connection>(ioLoop, std::move(client));

        // 设置回调
        connection->setConnectionCallback([this](Connection* conn) { onConnection(conn); });
        connection->setMessageCallback([this](Connection* conn, Buffer* buffer) { onMessage(conn, buffer); });
        connection->setCloseCallback([this](Connection* conn) { onClose(conn); });

        // 先存储，再建立连接，避免回调期间查不到该连接
        Connection* connPtr = connection.get();
        connections[clientFd] = connection;

        // 在所属 ioLoop 线程中建立连接（注册事件，调用用户回调）
        ioLoop->runInLoop([connPtr]() { connPtr->connectEstablished(); });
    }
}

void TcpServer::onConnection(Connection* conn)
{
    if (connectionCallback)
    {
        connectionCallback(conn);
    }
}

void TcpServer::onMessage(Connection* conn, Buffer* buffer)
{
    if (messageCallback)
    {
        messageCallback(conn, buffer);
    }
}

void TcpServer::onClose(Connection* conn)
{
    int fd = conn->fd();

    if (closeCallback)
    {
        closeCallback(conn);
    }

    // 不能在这里直接 connections.erase(fd)
    // onClose 是在 Connection 自己的 ioLoop 线程里、从 handleRead 的调用栈上被调起来的，
    // 此刻 Connection 和它的 Channel 还在栈上，同步销毁的话，
    // 回到 Channel::handleEvent() 就会读到已经释放的成员
    // 所以要回到 mainloop 线程，推迟到本轮事件处理结束之后再删
    mainloop.queueInLoop([this, fd]() {
        connections.erase(fd);
    });
}
```

连接表只由 `mainloop` 线程访问。`connections` 在 `handleAccept` 里插入，而 `handleAccept` 是 `mainloop` 的 `serverChannel` 的回调，本来就在 `mainloop` 线程，删除则通过 `mainloop.queueInLoop(...)` 回到同一个线程。两端都在同一个线程，这张表就不需要加锁，这也是 `EventLoop::runInLoop` 最典型的用法。

`onClose` 为什么绕了一圈？因为这是 `Connection` 里 `shared_from_this()` 要解决的问题的另一半。`shared_from_this` 保证回调栈期间对象不死，`queueInLoop` 保证删除动作不在回调栈里发生，两者配合，连接的生命周期才是安全的。

`EventLoop mainloop` 是值成员而不是指针。`TcpServer` 自己拥有主循环，使用者不需要先建一个 `EventLoop` 再传进来；subLoop 则由 `threadPool` 持有，生命周期归线程池管。

`numThreads = 0` 时退化成单 Reactor。`threadPool` 里没有线程，`getNextLoop()` 会返回 `baseLoop`（也就是 `mainloop`），所有连接都在这一个循环里处理，适合调试和低并发场景。

消息回调里**必须消费掉 `Buffer` 里的数据**（`retrieve` / `retrieveAll` / `retrieveAsString` 都行）。否则，由于 `Buffer` 里还有数据，LT 模式下的 `epoll` 会一直通知可读事件，回调会被无限调用，导致循环空转。

# 4. 多线程服务器

传统的多线程服务器会给每个客户端连接分配一个线程，结构简单，低并发时也能有效利用 CPU，但线程开销大，连接一多，光是上下文切换就能把 CPU 吃光。更好的思路是和前面的 IO 多路复用结合起来，每个线程负责一个 `epoll`，同时管理多个客户端连接，用少量线程实现大量连接。

## 4.1 EventLoopThread

在 Reactor 模型里，每个 `Poller (epoll)` 都是由一个 `EventLoop` 实例所管理的。所以只要让每个线程各自持有一个 `EventLoop`，就可以让每个线程独立地管理自己的 `epoll`，从而实现多线程 Reactor。

```cpp
#pragma once

#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

#include "eventloop.h"

class EventLoopThread {
private:
    std::unique_ptr<EventLoop> loop;
    std::thread thread;
    std::mutex mutex;
    std::condition_variable cond;
    std::function<void(EventLoop*)> initCallback;

public:
    explicit EventLoopThread(std::function<void(EventLoop*)> initCallback = nullptr);
    ~EventLoopThread();

    EventLoopThread(const EventLoopThread&) = delete;
    EventLoopThread& operator=(const EventLoopThread&) = delete;

    EventLoop* startLoop();   // 启动事件循环线程
};
```

```cpp
#include "eventloopthread.h"

EventLoopThread::EventLoopThread(std::function<void(EventLoop*)> initCallback)
    : initCallback(std::move(initCallback)) {}

EventLoopThread::~EventLoopThread()
{
    if (loop)
    {
        loop->quit();
    }
    if (thread.joinable())
    {
        thread.join();
    }
}

EventLoop* EventLoopThread::startLoop()
{
    std::unique_lock<std::mutex> lock(mutex);

    thread = std::thread([this]() {
        // 在子线程内部创建 EventLoop，这样它记录的 threadId 才是这个子线程
        std::unique_ptr<EventLoop> localLoop = std::make_unique<EventLoop>();

        // 执行用户回调，进行线程特定的初始化
        if (initCallback)
        {
            initCallback(localLoop.get());
        }

        // 通知主线程，subLoop 已就绪
        {
            std::lock_guard<std::mutex> guard(mutex);
            loop = std::move(localLoop);
            cond.notify_one();
        }

        // 启动事件循环
        loop->loop();
    });

    // 等子线程把 EventLoop 建好再返回
    cond.wait(lock, [this]() { return loop != nullptr; });

    return loop.get();
}
```

`EventLoop` 必须在子线程内部构造，因为 `threadId` 是在构造函数里记下的，而 `isInLoopThread()` / `runInLoop()` 全靠它来判断自己是否在正确的线程上。如果换成主线程 `make_unique<EventLoop>()` 再传给子线程，这个判断就会出错。

`startLoop()` 里的锁和条件变量，是为了确保调用方拿到的是一个已经构造好的 `EventLoop`。子线程先创建对象，再执行 `initCallback()`，然后加锁把 `loop` 赋值给成员变量并调用 `notify_one()`，最后启动事件循环。调用方在 `cond.wait(...)` 里等，直到 `loop != nullptr` 才返回。

每个 `EventLoop` 只属于一个线程，且它只能在其所属线程中执行，这种约束可以避免多线程竞争 `epoll`（否则就需要加锁，但是这更麻烦且有性能损耗）。

## 4.2 EventLoopThreadPool

线程需要复用，不能每来一批连接就新建。我们可以把 `EventLoopThread` 放进一个线程池里，按轮询的方式把新连接分配给各个线程。

```cpp
#pragma once

#include <memory>
#include <vector>

#include "eventloop.h"
#include "eventloopthread.h"

class EventLoopThreadPool {
private:
    EventLoop* baseLoop;
    size_t numThreads;
    std::vector<std::unique_ptr<EventLoopThread>> threads;
    std::vector<EventLoop*> loops;
    size_t next;   // 轮询索引

public:
    EventLoopThreadPool(EventLoop* baseLoop, size_t numThreads);
    ~EventLoopThreadPool() = default;

    EventLoopThreadPool(const EventLoopThreadPool&) = delete;
    EventLoopThreadPool& operator=(const EventLoopThreadPool&) = delete;

    void start();

    EventLoop* getNextLoop();
    std::vector<EventLoop*> getAllLoops();
};
```

```cpp
#include "eventloopthreadpool.h"

EventLoopThreadPool::EventLoopThreadPool(EventLoop* baseLoop, size_t numThreads)
    : baseLoop(baseLoop), numThreads(numThreads), next(0)
{
    // 预先分配线程和事件循环的空间，避免在 start() 中频繁扩容
    threads.reserve(numThreads);
    loops.reserve(numThreads);
}

void EventLoopThreadPool::start()
{
    for (size_t i = 0; i < numThreads; ++i)
    {
        auto thread = std::make_unique<EventLoopThread>();
        EventLoop* loop = thread->startLoop();

        threads.push_back(std::move(thread));   // 保留线程对象，负责它的生命周期
        loops.push_back(loop);                  // 记录裸指针，只用于访问
    }
}

EventLoop* EventLoopThreadPool::getNextLoop()
{
    if (loops.empty())
    {
        return baseLoop;   // 不启用多线程，所有连接都由 baseLoop 处理
    }

    EventLoop* loop = loops[next];
    next = (next + 1) % loops.size();
    return loop;
}

std::vector<EventLoop*> EventLoopThreadPool::getAllLoops()
{
    if (loops.empty())
    {
        return { baseLoop };
    }
    return loops;
}
```

`threads` 存的是 `unique_ptr<EventLoopThread>`，`loops` 里只是裸指针，这是有意区分的所有权和访问权。销毁这个 `vector` 会依次析构每个 `EventLoopThread`，而它的析构函数会 `quit()` 并 `join()` 线程，所以直接让 `~EventLoopThreadPool() = default` 就行了。

# 5. 请求的完整事件流

前面每个组件都是分开讲的，这里把一次完整的请求处理流程串起来，方便理解。

阶段一：建立连接

1. 客户端三次握手完成，内核把新连接放进监听 socket 的**全连接队列**，并唤醒等待在它上面的进程。
2. `mainloop` 的 `epoll.wait` 返回，事件是 `EPOLLIN`，`data.ptr` 指向 `TcpServer::serverChannel`。
3. `EventLoop::loop` 把它放进 `activeChannels`，然后调用 `Channel::handleEvent()`。
4. `handleEvent` 发现 `revents & EPOLLIN`，调用 `readCallback` → `TcpServer::handleAccept()`。
5. `handleAccept` 循环 `server.accept()` 出新的 `Socket`，把它设为非阻塞。
6. `threadPool->getNextLoop()` 轮询挑一个 `ioLoop`，构造 `Connection`（构造时就把 `channel` 的回调绑好了），存入 `connections`。
7. `ioLoop->runInLoop(connectEstablished)`。因为当前在 `mainloop` 线程，这会把任务投递进 `ioLoop` 的队列并 `wakeup()`。
8. `ioLoop` 被 `eventfd` 唤醒，`doPendingFunctors()` 执行 `connectEstablished()`：`setEvents(EPOLLIN)` + `addChannel`，`connfd` 正式进入该线程的 `epoll`。触发 `connectionCallback`。

阶段二：收发数据

9. 客户端发来数据，`ioLoop` 的 `epoll.wait` 返回 `EPOLLIN`，`data.ptr` 指向 `Connection::channel`。
10. `Channel::handleEvent()` → `readCallback` → `Connection::handleRead()`（先 `shared_from_this()` 保活）。
11. `handleRead` 调用 `inputBuffer.readFd()`（内部是 `readv`），读到数据后调用 `messageCallback`。
12. 业务回调按 3.1.4 的方式解析出完整消息，然后 `conn->send(reply)`。
13. `send` 发现已在 `ioLoop` 线程，直接走 `sendInLoop`：
    - 没有积压、也没注册 `EPOLLOUT` → 直接 `send`。一次写完就结束。
    - 只写出去一部分 → 剩余部分 `append` 进 `outputBuffer`，`| EPOLLOUT` + `updateChannel`。
14. 稍后内核通知 `EPOLLOUT` → `handleWrite` 继续写。写完了就 `& ~EPOLLOUT` + `updateChannel`，`EPOLLOUT` 被摘掉，事件循环恢复安静。

阶段三：断开连接

15. 客户端关闭 → `connfd` 可读 → `handleRead` → `readFd` 返回 `0`。
16. `handleRead` 调用 `handleClose()`：状态改成 `Disconnected`，`removeChannel` 把它从 `epoll` 摘除，然后触发 `closeCallback`。
17. `closeCallback` 是 `TcpServer::onClose`：先转发给用户的关闭回调，然后 `mainloop.queueInLoop(...)` 把删除动作交给主线程。
18. `mainloop` 在下一轮事件处理结束后执行 `connections.erase(fd)`，`Connection` 的引用计数归零，析构。`~Connection` 里的 `removeChannel`（此刻 `epoll` 里已经没有它了，`epoll_ctl` 返回错误被忽略）和 `Socket` 的析构函数关闭 `connfd`。
19. 由于 `handleRead` 开头持有 `self`，即使第 18 步发生在回调还没返回的时候，对象也会等回调栈展开完毕才真正销毁。

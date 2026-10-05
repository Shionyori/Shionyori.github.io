---
title: Reactor 网络模型
date: 2025-10-03
updated: 2026-07-06
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

前面我们提到 I/O多路复用 + 非阻塞 可以实现服务器的一对多以及高并发性能，但是直接调用原生接口写起来十分不方便，且不便于管理和拓展，于是我们可以使用一种叫做 Reactor 架构模型。

Reactor 的核心思想是**事件驱动**，它将 I/O 事件的监听、分发和处理进行解耦：
- `Poller`：负责统一监听所有 `fd` 的 I/O 事件
- `Channel`：对 `fd` 的抽象，封装了 `fd`、关注的事件以及对应的回调函数
- `EventLoop`：事件循环的核心组件，负责调用 `Poller` 等待事件、分发就绪事件，并执行相应的回调函数
- `Handler`：处理事件的具体逻辑，也就是上面提到的回调函数

---

# 1. 核心组件的实现
## 1.1 Poller（多路复用器）

`Epoll` 类是对 Linux `epoll` API 的封装，用于管理所有 fd 的事件监听。

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

## 1.2 Channel（事件通道）

`Channel` 表示一个 fd 的事件对象，每个 socket 对应一个 Channel，它负责记录事件、保存回调函数。

```cpp
#pragma once

#include <functional>
#include <sys/epoll.h>
#include "socket.h"

using namespace nl;

class Channel {
private:
    int fd;

    uint32_t events;
    uint32_t revents;

    Socket* socket;

    std::function<void()> readCallback;
    std::function<void()> writeCallback;

public:
    Channel(int fd, Socket* sock = nullptr) : fd(fd), socket(sock), events(0), revents(0) {}
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
    

    void handleEvent() {
        if ((revents & EPOLLIN) && readCallback) {
            readCallback();
        }
        if ((revents & EPOLLOUT) && writeCallback) {
            writeCallback();
        }
    }
};
```

## 1.3 EventLoop（事件循环）

`EventLoop` 是 Reactor 的核心组件，负责事件循环、事件分发、任务调度。

```cpp
#pragma once

#include "epoll.h"
#include <vector>
#include "channel.h"
#include <atomic>
#include <thread>
#include <functional>
#include <memory>
#include <mutex>

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

#include <sys/eventfd.h>
#include <unistd.h>
#include <cerrno>
#include <cstdint>

EventLoop::EventLoop(int maxEvents)
    : epoll(maxEvents),
      looping(false),
      isQuit(false),
      callingPendingFunctors(false),
      threadId(),
      wakeupFd(-1)
{
    wakeupFd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    if (wakeupFd >= 0)
    {
        wakeupChannel = std::make_unique<Channel>(wakeupFd);
        wakeupChannel->setEvents(EPOLLIN);
        wakeupChannel->setReadCallback([this]()
                                       { handleWakeupRead(); });
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
    threadId = std::this_thread::get_id();
    looping = true;
    isQuit = false;

    while (!isQuit)
    {
        int n = epoll.wait(-1); // 阻塞等待事件发生
        activeChannels.clear();

        // 将就绪事件对应的 Channel 添加到 activeChannels 中
        for (int i = 0; i < n; i++)
        {
            Channel *channel = epoll.getChannel(i);
            if (channel)
            {
                channel->setRevents(epoll.getEvent(i).events);
                activeChannels.push_back(channel);
            }
        }
        // 处理所有就绪事件（分发事件到对应的 Channel）
        for (Channel *channel : activeChannels)
        {
            channel->handleEvent();
        }
        // 处理 pendingFunctors 中的任务
        doPendingFunctors();
    }
    looping = false;
}

void EventLoop::addChannel(Channel *channel)
{
    if (!channel)
    {
        return;
    }
    epoll.add(channel);
}

void EventLoop::updateChannel(Channel *channel)
{
    if (!channel)
    {
        return;
    }
    epoll.mod(channel);
}

void EventLoop::removeChannel(Channel *channel)
{
    if (!channel)
    {
        return;
    }
    epoll.del(channel);
}

void EventLoop::quit()
{
    isQuit = true;
    wakeup();
}

void EventLoop::runInLoop(const std::function<void()> &cb)
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

void EventLoop::queueInLoop(const std::function<void()> &cb)
{
    if (!cb)
    {
        return;
    }

    {
        std::lock_guard<std::mutex> lock(pendingMutex);
        pendingFunctors.push_back(cb);
    }

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
            continue;
        }
        if (n < 0 && errno == EAGAIN)
        {
            break;
        }
        break;
    }
}

void EventLoop::doPendingFunctors()
{
    std::vector<std::function<void()>> functors;
    callingPendingFunctors = true;

    {
        std::lock_guard<std::mutex> lock(pendingMutex);
        functors.swap(pendingFunctors);
    }

    for (const auto &fn : functors)
    {
        fn();
    }

    callingPendingFunctors = false;
}
```

## 1.4 Handler（事件处理器）

负责执行具体的任务，在该案例中并没有将其专门抽象出来，而是直接 **以回调函数（`std::function<void()>`）的形式嵌入在 `Channel` 类中**。

虽然代码中没有独立的 `Handler` 类，但回调函数承担了 Handler 的职责，例如在 `Channel` 类中有：

```cpp
std::function<void()> readCallback;
std::function<void()> writeCallback;
```

通过以下方法设置回调函数的具体逻辑：

```cpp
void setReadCallback(const std::function<void()>& cb) { readCallback = cb; }
void setWriteCallback(const std::function<void()>& cb) { writeCallback = cb; }
```

`Channel` 负责局部分发，调用具体的回调函数，事件触发的流程路线为 `EventLoop -> Channel::handleEvent() -> Callback()`。 

```cpp
void handleEvent() {
    if ((revents & EPOLLIN) && readCallback) {
        readCallback();
    }
    if ((revents & EPOLLOUT) && writeCallback) {
        writeCallback();
    }
}
```

---

# 2. 其他组件
## 2.1 Buffer

TCP是流式协议，无消息边界，因此可能会出现以下情况：
- 拆包：一个完整信息分多次 `read` 到达
- 粘包：多个消息在一次 `read` 中到达
- 非阻塞写：`write` 可能只发送部分数据，剩余部分需缓存

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
    Buffer(size_t initSize = 1024);
    ~Buffer();

    Buffer(const Buffer&) = delete;
    Buffer& operator=(const Buffer&) = delete;
    Buffer(Buffer&& other);
    Buffer& operator=(Buffer&& other);

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

    const char* findCRLF(const char* start) const; // 查找 CRLF 的位置（回车+换行，\r\n，它是 HTTP 请求/响应头的分隔标记）
    const char* findCRLF() const;
    void retrieveUntil(const char* end); // 取出数据直到 end 指针所指的位置
    std::string retrieveAsString(size_t len); // 取出长度为 len 的数据并返回为字符串

private:
    void makeSpace(size_t len);
};
```

```cpp
#include "buffer.h"

#include <algorithm>
#include <cerrno>
#include <sys/uio.h>
#include <unistd.h>

Buffer::Buffer(size_t initSize) : buffer(initSize), readIndex(0), writeIndex(0) {}

Buffer::~Buffer() {}

Buffer::Buffer(Buffer&& other) : buffer(std::move(other.buffer)), readIndex(other.readIndex), writeIndex(other.writeIndex) {
    other.readIndex = 0;
    other.writeIndex = 0;
}

Buffer& Buffer::operator=(Buffer&& other) {
    if (this != &other) {
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
    char temp_buffer[50000];
    struct iovec vec[2];
    const size_t writable = writableBytes();

    // 旧版本：&*buffer.begin() 解引用迭代器 -> char& -> &取地址 -> char*
    vec[0].iov_base = buffer.data() + writeIndex;
    vec[0].iov_len = writable;
    vec[1].iov_base = temp_buffer;
    vec[1].iov_len = sizeof(temp_buffer);

    // 读取数据（如果 buffer 空间不足则剩余数据读入 temp_buffer）
    ssize_t n = ::readv(fd, vec, 2);
    if(n < 0)
    {
        if(savedErrno) *savedErrno = errno;
        return -1;
    }

    if(static_cast<size_t>(n) <= writable)
    {
        writeIndex += n;
    }
    else
    {
        writeIndex = buffer.size();
        append(temp_buffer, static_cast<size_t>(n) - writable); // 将 temp_buffer 的数据追加到 buffer
    }
    return n;
}

ssize_t Buffer::writeFd(int fd, int* savedErrno)
{
    ssize_t n = ::write(fd, peek(), readableBytes());
    if(n < 0)
    {
        if(savedErrno) *savedErrno = errno;
        return -1;
    }
    retrieve(n);
    return n;
}

void Buffer::append(const char* data, size_t len)
{
    if(len > writableBytes())
    {
        makeSpace(len);
    }
    std::copy(data, data + len, buffer.data() + writeIndex);
    writeIndex += len;
}

void Buffer::append(const std::string& data) {
    append(data.c_str(), data.size());
}

void Buffer::append(const Buffer& data) {
    append(data.peek(), data.readableBytes());
}

void Buffer::retrieve(size_t len) 
{
    if(len >= readableBytes()) retrieveAll();
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
        buffer.resize(writeIndex + len);
    }
    else
    {
        const size_t readable = readableBytes();
        std::copy(buffer.data() + readIndex, buffer.data() + writeIndex, buffer.data());
        readIndex = 0;
        writeIndex = readable;
    }
}

const char* Buffer::findCRLF(const char* start) const {
    const char* crlf = std::search(start, buffer.data() + writeIndex, "\r\n", "\r\n" + 2);
    return crlf == buffer.data() + writeIndex ? nullptr : crlf;
}

const char* Buffer::findCRLF() const {
    return findCRLF(peek());
}

void Buffer::retrieveUntil(const char* end) {
    size_t len = end - peek();
    retrieve(len);
}

std::string Buffer::retrieveAsString(size_t len) {
    std::string result(peek(), len);
    retrieve(len);
    return result;
}
```


## 2.2 Connection

```cpp
#pragma once

#include <functional>
#include <memory>
#include <string>

#include "buffer.h"
#include "channel.h"
#include "eventloop.h"
#include "socket.h"

using namespace nl;

class Connection {
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

Connection::~Connection() = default;

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
        handleClose();
        return;
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
        return;
    }

    int savedErrno = 0;
    const ssize_t n = outputBuffer.writeFd(socket.getFd(), &savedErrno);
    if (n < 0)
    {
        if (savedErrno != EAGAIN && savedErrno != EWOULDBLOCK)
        {
            handleClose();
        }
        return;
    }

    if (outputBuffer.readableBytes() == 0)
    {
        channel->setEvents(channel->getEvents() & ~EPOLLOUT);
        loop->updateChannel(channel.get());

        if (state == State::Disconnecting)
        {
            ::shutdown(socket.getFd(), SHUT_WR);
        }
    }
}

void Connection::handleClose()
{
    if (state == State::Disconnected)
    {
        return;
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

    if ((channel->getEvents() & EPOLLOUT) == 0 && outputBuffer.readableBytes() == 0)
    {
        const ssize_t n = socket.send(data, len, 0);
        if (n >= 0)
        {
            const size_t sent = static_cast<size_t>(n);
            if (sent == len)
            {
                return;
            }
            outputBuffer.append(data + sent, len - sent);
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

    if ((channel->getEvents() & EPOLLOUT) == 0)
    {
        channel->setEvents(channel->getEvents() | EPOLLOUT);
        loop->updateChannel(channel.get());
    }
}
```

---

# 3. 多线程服务器

传统的多线程服务器的思路是给每个客户端请求都分配一个线程，这样的好处是结构简单，在低并发情况下可以有效利用CPU，但是由于会占用过多资源，所以并不适合高并发环境。更好的思路是与前面的I/O多路复用相结合，每个线程负责一个 `epoll`，同时管理多个客户端请求，这样就可以大大提高并发处理能力。

## 3.1 EventLoopThread
 
在Reactor模型中，`Poller (epoll)` 是由一个 `EventLoop` 实例所管理的。因此，我们可以让每个线程各自维护一个 `EventLoop` 实例，负责分别处理来自客户端的请求。为了方便使用，我们将线程这一概念封装为 `EventLoopThread`。

```cpp
#pragma once

#include "eventloop.h"
#include <thread>
#include <functional>
#include <memory>
#include <mutex>
#include <condition_variable>

class EventLoopThread {
private:
    std::unique_ptr<EventLoop> loop;
    std::thread thread;
    std::mutex mutex;
    std::condition_variable cond;
    std::function<void(EventLoop*)> initCallback;

public:
    EventLoopThread(std::function<void(EventLoop*)> initCallback = nullptr);
    ~EventLoopThread();

    EventLoopThread(const EventLoopThread&) = delete;
    EventLoopThread& operator=(const EventLoopThread&) = delete;

    EventLoop* startLoop(); // 启动事件循环线程
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
        std::unique_ptr<EventLoop> localLoop = std::make_unique<EventLoop>();

        // 执行用户回调，进行线程特定的初始化
        if (initCallback)
        {
            initCallback(localLoop.get());
        }

        // 通知主线程：subLoop 已就绪
        {
            std::lock_guard<std::mutex> guard(mutex);
            loop = std::move(localLoop);
            cond.notify_one();
        }

        // 启动事件循环
        loop->loop();
    });

    cond.wait(lock, [this]() { return loop != nullptr; });

    return loop.get();
}
```

{% note info %}
需要注意的是，每个 `EventLoop` 只属于一个线程，且它只能在其所属线程中执行，这种约束可以避免多线程竞争 `epoll`（否则就需要加锁，但是这更麻烦且有性能损耗）。
{% endnote %}

## 3.2 EventLoopThreadPool

为了更方便地调用线程并减少反复创建新线程导致的资源消耗，我们可以创建一个线程池 `EventLoopThreadPool`。

```cpp
#pragma once

#include "eventloop.h"
#include "eventloopthread.h"
#include <vector>
#include <memory>

class EventLoopThreadPool {
private:
    EventLoop* baseLoop;
    ssize_t numThreads;
    std::vector<std::unique_ptr<EventLoopThread>> threads;
    std::vector<EventLoop*> loops;
    size_t next; // 轮询索引

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

        threads.push_back(std::move(thread));
        loops.push_back(loop);
    }
}

EventLoop* EventLoopThreadPool::getNextLoop()
{
    if (loops.empty())
    {
        return baseLoop;
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

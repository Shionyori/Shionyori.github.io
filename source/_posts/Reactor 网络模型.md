---
title: Reactor 网络模型
date: 2025-10-03
updated: 2026-07-06
cover: cover.png
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
## 1.1 `Poller`（多路复用器）

`Epoll` 类是对 Linux `epoll` API 的封装，用于管理所有 fd 的事件监听。

```cpp
class Epoll {
private:
    int epfd;
    std::vector<epoll_event> events;

public:
    Epoll(int maxEvents = 1024);
    ~Epoll();

    bool add(Channel* channel);
    bool mod(Channel* channel);
    bool del(Channel* channel);

    int wait(int timeout = -1);

    epoll_event getEvent(int i) const;
    Channel* getChannel(int i) const;
};
```

## 1.2 `Channel`（事件通道）

`Channel` 表示一个 fd 的事件对象，每个 socket 对应一个 Channel，它负责记录事件、保存回调函数。

```cpp
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

## 1.3 `EventLoop`（事件循环）

`EventLoop` 是 Reactor 的核心组件，负责事件循环、事件分发、任务调度。

```cpp
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

## 1.4 `Handler`（事件处理器）

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
## 2.1 `Buffer`

TCP是流式协议，无消息边界，因此可能会出现以下情况：
- 拆包：一个完整信息分多次 `read` 到达
- 粘包：多个消息在一次 `read` 中到达
- 非阻塞写：`write` 可能只发送部分数据，剩余部分需缓存

```cpp
class Buffer {
private:
    std::vector<char> buffer;
    size_t readIndex;
    size_t writeIndex;

public:
    Buffer(size_t initSize = 1024);
    ~Buffer();

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

private:
    void makeSpace(size_t len);
};
```


## 2.2 `Connection`

```cpp
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

---

# 3. 多线程服务器

传统的多线程服务器的思路是给每个客户端请求都分配一个线程，这样的好处是结构简单，在低并发情况下可以有效利用CPU，但是由于会占用过多资源，所以并不适合高并发环境。更好的思路是与前面的I/O多路复用相结合，每个线程负责一个 `epoll`，同时管理多个客户端请求，这样就可以大大提高并发处理能力。

## 3.1 `EventLoopThread`
 
在Reactor模型中，`Poller (epoll)` 是由一个 `EventLoop` 实例所管理的。因此，我们可以让每个线程各自维护一个 `EventLoop` 实例，负责分别处理来自客户端的请求。为了方便使用，我们将线程这一概念封装为 `EventLoopThread`。

```cpp
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

{% note info %}
需要注意的是，每个 `EventLoop` 只属于一个线程，且它只能在其所属线程中执行，这种约束可以避免多线程竞争 `epoll`（否则就需要加锁，但是这更麻烦且有性能损耗）。
{% endnote %}

## 3.2 `EventLoopThreadPool`

为了更方便地调用线程并减少反复创建新线程导致的资源消耗，我们可以创建一个线程池 `EventLoopThreadPool`。

```cpp
class EventLoopThreadPool {
private:
    EventLoop* baseLoop;
    ssize_t numThreads;
    std::vector<std::unique_ptr<EventLoopThread>> threads;
    std::vector<EventLoop*> loops;
    size_t next; // 轮询索引（指向池中下一个线程）

public:
    EventLoopThreadPool(EventLoop* baseLoop, size_t numThreads);
    ~EventLoopThreadPool() = default;

    void start(); // 初始化线程池中的所有线程，同时启动它们的loop
    
    EventLoop* getNextLoop();
    std::vector<EventLoop*> getAllLoops();
};
```

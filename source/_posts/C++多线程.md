---
title: C++ 多线程
date: 2025-03-04
updated: 2026-07-20
cover: cover.png
categories: C++
tags:
  - C++
  - 多线程
  - 并发
  - 互斥锁
  - 条件变量
  - 原子操作
  - CAS
  - 线程池
---

多线程编程的核心在于两件事：创建线程去干活，协调它们不打架。从 `std::thread` 的启动与回收，到互斥量和条件变量的同步，再到原子操作与线程池。

---
# 1. 线程的创建与管理

## 1.1 创建线程

`std::thread` 是 C++ 标准库提供的线程管理类。它的构造函数接受一个可调用对象（Callable）和相应的参数，以此定义线程的执行入口。每个线程都需要一个入口点，例如主线程的入口就是 `main()`。

1. 函数指针
```cpp
void func(int x) {std::cout << x << std::endl}
std::thread t1(func, 42);
```

2. `Lambda` 表达式
```cpp
std::thread t2([](int x) { std::cout << x << std::endl; }, 42);
```

3. `std::bind`
```cpp
auto b = std::bind(func, std::placeholders::_1);
std::thread t3(b, 42);
```

4. 函数对象
```cpp
class Callable {
public:
	void operator()(int x) {
		std::cout << x << std::endl;
	}
}
std::thread t4(Callable(), 42)
```

## 1.2 生命周期管理

1. `join()`
- 阻塞主线程，等待目标线程结束
- 目标线程结束后，**主线程调用内核 API 回收线程资源**（栈空间、线程描述符等）
```cpp
int main() {
	thread t(foo);
	t.join(); // 主线程阻塞，等待线程 t 结束
	return 0;
}
```

2. `detach()`
- 分离目标线程，主线程不等待
- 目标线程结束后，**系统自动回收线程资源**
```cpp
int main() {
	thread t(foo);
	t.detach(); // 主线程分离线程 t ，主线程不等待，继续向下执行
	return 0;
}
```

# 2. std::mutex

互斥锁 `std::mutex` 是一种同步原语，用于防止多个线程同时访问共享资源。当一个线程需要访问共享资源时，它首先要对互斥锁进行锁定 `lock()` ；如果互斥锁已经被其他线程锁定，那么请求锁定的线程将被阻塞，直到互斥锁被解锁 `unlock()`。

**1. `std::mutex` + `lock()/unlock()`：手动释放**
```cpp
int count = 0;
std::mutex mtx;

void increment() {
    mtx.lock();    // 锁定互斥锁
    ++count;       // 修改共享变量
    mtx.unlock();  // 释放互斥锁
}

int main() {
    std::thread t1(increment);
    std::thread t2(increment);
    t1.join();
    t2.join();
    return 0;
}
```

C++ 还提供了 RAII 风格的锁管理类，在对象生命周期结束时会自动释放锁，省去了手动管理的麻烦与风险。

**2. `std::lock_guard<T>`：自动释放**

```cpp
void increment() {
    std::lock_guard<std::mutex> lock(mtx); // 自动锁定互斥锁
    ++count;                               // 修改共享变量
    // 互斥锁会在 lock 的析构函数中自动释放
}
```

**3. `std::unique_lock<T>`：自动/手动**

`std::unique_lock` 是一个更灵活的互斥锁管理类：
- 对象析构时会自动释放，但同时提供 `lock()` / `unlock()` 以允许手动控制生命周期（而这正是 `std::condition_variable` 所需要的）
- `std::unique_lock` 之间允许使用 `std::move` 来转移 `mutex` 的所有权
```cpp
void increment() {
	std::unique_lock<std::mutex> lock(mtx)
	lock.lock(); // 可随时手动锁定
	++count;
	// lock.unlock(); // 可随时手动释放
	// 最后若没有手动释放，析构函数会自动释放 
}
```

# 3. std::condition_variable

条件变量用于线程间的协调，允许一个或多个线程等待某个条件的发生。它通常与互斥锁一起使用，以实现线程间的同步。它**本质上是通知系统 + 条件判断，用于决定某个线程是否继续向下执行**；而互斥锁则是为了保证判断准确性的手段，防止 `bool` 值再判断过程中被更改。

1. 三个核心变量：
```cpp
std::condition_variable cv;
std::mutex mtx;     // 条件值的互斥锁
bool ready = false; // 条件值
```

2. 信号接收端（消费者）：
```cpp
std::unique_lock<std::mutex> lock(mtx);
cv.wait(lock, []{ return ready == true; }); // 立即进行一次条件检查，如果不满足就挂起
// 之后每当线程被唤醒时进行一次条件检查，条件满足后执行，若不满足则重新等待
```

3. 条件信号的发送端（生产者）：
```cpp
cv.notify_one(); // 随机唤醒一个对应条件的线程
cv.notify_all(); // 唤醒全部
```

使用示例：
```cpp
#include <mutex>
#include <condition_variable>

std::mutex mtx;
std::condition_variable cv;
bool ready = false;

void workerThread() {
    std::unique_lock<std::mutex> lk(mtx);
    cv.wait(lk, []{ return ready; }); // 等待条件
    // 当条件满足时执行工作
}

void mainThread() {
    {
        std::lock_guard<std::mutex> lk(mtx);
        // 准备数据
        ready = true;
    } // 离开作用域时解锁
    cv.notify_one(); // 通知一个等待的线程
}
```

# 4 std::shared_mutex

`std::mutex` 将所有线程一视同仁，这在写操作时是必须的，但在**大量读、少量写**的场景（如缓存服务、DNS 解析、配置加载），多个读线程串行执行会严重浪费 CPU 缓存和性能。因此 C++17 引入了 `std::shared_mutex`，它允许多个线程同时读取共享资源，但在写操作时是互斥的。

- 独占锁（`std::unique_lock<std::shared_mutex>`）：用于写操作，会阻塞所有其他读线程和写线程
- 共享锁（`std::shared_lock<std::shared_mutex>`）：用于读操作，仅当有线程持有独占锁时才阻塞；若只有共享锁，可并发进入

```cpp
class Cache {
private:
    std::unordered_map<int, int> data_;
    mutable std::shared_mutex rw_mutex_; // mutable 让 const 方法也能加锁

public:
    // 读操作：多个线程可以同时进入此函数，不会互相阻塞
    int get(int key) const {
        std::shared_lock<std::shared_mutex> lock(rw_mutex_);
        auto it = data_.find(key);
        return (it != data_.end()) ? it->second : -1;
    }

    // 写操作：唯一进入，进入时会阻塞所有正在读的线程
    void set(int key, int value) {
        std::unique_lock<std::shared_mutex> lock(rw_mutex_);
        data_[key] = value;
    }

    // 批量更新：为了性能，手动加锁一次，避免反复加解锁开销
    void batch_update(const std::vector<std::pair<int, int>>& updates) {
        std::unique_lock<std::shared_mutex> lock(rw_mutex_);
        for (auto& [k, v] : updates) {
            data_[k] = v;
        }
    }
};
```

`mutable` 关键字的作用是**允许变量在 `const` 成员函数中被修改**。在多线程编程中，`mutable` 常用于修饰共享资源的互斥锁，使得即使在 `const` 成员函数中，也可以对互斥锁进行加锁和解锁操作，从而保证线程安全。

# 5. std::atomic

## 5.1 原子操作

原子操作是指不可中断的一个或一系列操作。在多线程环境下，对原子变量的读写保证了数据竞争不会发生，无需配合互斥锁（`std::mutex`）即可实现线程安全，所以它是实现无锁编程的基础。在 C++ 中它是通过原子变量 `std::atomic<T>` 实现的，其中 `T` 必须是平凡可复制类型（例如 `int`、`bool`、指针等）。

原子变量的常用操作：
- `store()`：写入
- `load()`：读取
- `exchange()`：交换
- `compare_exchange_weak/strong(exp, des)`：CAS
    - 如果当前值符合预期（等于 `exp`）则将其替换为目标值 `des`，返回成功
    - 否则将预期值 `exp` 更新为当前值，返回失败
- `fetch_add / fetch_sub`：原子加减，返回旧值
- `++, --, +=, -=`：方便使用，本质调用 `fetch` 操作

## 5.2 CAS

CAS（Compare And Swap）是一条 CPU 指令（在 x86 架构中具体为 `LOCK CMPXCHG`），它是原子操作的基础，上面提到的 `store`、`load`、`exchange` `fetch_add`、`fetch_sub` 等原子操作都是基于 CAS 实现的。

CAS 的核心思想是比较并交换，如果记作 `CAS(V, E, N)` ：
1. 读取内存中的值 `V`
2. 比较 `V` 是否等于预期值 `E`
3. 如果相等，则将内存中的值更新为新值 `N`，否则不做任何操作，并返回当前值 `V`。

在 C++ 中，`compare_exchange_weak/strong()` 就是 CAS 的封装，其中 `weak` 和 `strong` 的区别如下：
- `compare_exchange_weak()`：
    - **允许出现伪失败**（硬件干扰导致的写入失败，预期值保持原样不变）
    - 适合在循环中使用，不断重试直到成功（如 `while (!atomic_var.compare_exchange_weak(...))`）
- `compare_exchange_strong()`：
    - 不会出现伪失败，但是**性能开销更大**
    - 适合只尝试一次的场景

互斥锁和 CAS 的关键区别：互斥锁是在读写操作之前做限制，保证同一时刻只有一个线程可以访问共享资源。而 CAS 是==在真正写入内存的那一瞬间做检查，判断自己之前读取到的旧值是否与内存中的当前值一致，如果不一致（说明中途被别人修改过），则直接放弃本次写入（内存纹丝未动），并重新读取新值计算后重试==。它们分别对应了悲观锁和乐观锁的概念。
- 悲观锁：假设会发生冲突，线程在访问共享资源前就先加锁，保证独占访问
- 乐观锁：假设不会发生冲突，线程在访问共享资源时不加锁，而是在尝试写入前检查是否发生冲突，如果发生冲突则放弃本次写入并重试

## 5.3 内存序

首先在这里需要纠正一个误区：**代码并不是严格按照书写顺序执行的**。造成这种现象的原因主要有：
- 编译器优化导致的代码重排
- CPU 指令的乱序执行
- 缓存延迟（即多核环境下，一个核心对共享变量的修改无法被其他核心立即看到）

代码的乱序执行天然存在，但这并不意味着程序的执行结果会出现问题：
- 在单线程中，不存在数据竞争，只要**可观测的最终结果与程序顺序一致**，就不影响正确性
- 在多线程中，由于可能存在数据竞争和不可预测行为，我们必须使用同步原语（如互斥锁、条件变量）来保证线程安全

而对于原子操作来说，C++ 提供了内存序（Memory Order）来控制其可见性和有序性。它在功能上一定程度对标非原子操作的互斥锁，但开销更小，适用于对性能要求较高的场景。在默认情况下，原子操作使用 `memory_order_seq_cst`，即最强顺序保证，不允许重排，但会带来更多性能开销。根据实际需求，我们可以选择不同的内存序来平衡性能和顺序保证。

| 内存顺序                   | 含义                                       | 开销   |
| ---------------------- | ---------------------------------------- | ---- |
| `memory_order_relaxed` | 只保证原子性，不提供任何顺序保证                         | 最低   |
| `memory_order_consume` | 依赖数据依赖，但现代编译器基本把它当作 `acquire` 处理，不建议使用   | —    |
| `memory_order_acquire` | 该操作之后的所有读/写不得被重排到该操作之前                   | 中等   |
| `memory_order_release` | 该操作之前的所有读/写不得被重排到该操作之后                   | 中等   |
| `memory_order_acq_rel` | 同时具备 `acquire` 和 `release` 语义（读-改-写操作常用） | 中等偏高 |
| `memory_order_seq_cst` | 所有线程看到相同的全局顺序（默认参数，也是最保险的选择）                 | 最高   |

## 5.4 自旋锁

所谓自旋锁，是指线程在等待锁的过程中不会被挂起，而是不断地循环检查锁是否可用。其优点在于可以避免线程切换的开销，而缺点是如果锁被其他线程长时间占用，该线程就会长期占用 CPU 资源，从而导致 CPU 空转。所以自旋锁只适用于锁持有时间非常短的场景（比如简单计数器）。

```cpp
class SpinLock {
    std::atomic_flag flag = ATOMIC_FLAG_INIT;
public:
    void lock() {
        // 自旋直到获取锁，使用 acquire 确保锁内操作不会提前到加锁前
        while (flag.test_and_set(std::memory_order_acquire)) {
            // 可插入 yield 或 pause 避免 CPU 空耗
#if defined(__x86_64__) || defined(_M_X64)
            __builtin_ia32_pause();
#endif
        }
    }
    void unlock() {
        // 使用 release 确保锁内所有写操作在解锁前可见
        flag.clear(std::memory_order_release);
    }
};
```

`std::atomic_flag` 是 C++11 提供的原子标志类型，它提供了以下方法：
- `test_and_set()`: 原子地将标志设置为 `true` 并返回之前的值
- `clear()`: 原子地将标志清除为 `false`

`ATOMIC_FLAG_INIT` 是一个宏，用于初始化 `std::atomic_flag` 对象为 `false`。其他原子类型也有这样的初始化宏（如 `ATOMIC_VAR_INIT(value)`），但从 C++20 开始，它们已经被逐渐弃用，现在更推荐的做法是使用构造函数（如 `std::atomic<int> a(0)`）。

## 5.5 无锁栈

通过 CAS 可以实现一个简单的无锁栈（Lock-Free Stack），它允许多个线程同时进行入栈和出栈操作，而不需要使用互斥锁。

```cpp
template<typename T>
class LockFreeStack {
    struct Node {
        T data;
        Node* next;
        Node(T d, Node* n) : data(std::move(d)), next(n) {}
    };
    std::atomic<Node*> head_{nullptr};
    std::atomic<size_t> size_{0};
public:
    void push(T val) {
        Node* new_node = new Node(std::move(val), nullptr);
        new_node->next = head_.load(std::memory_order_relaxed);

        // CAS：如果 head_ 还是 new_node->next，就替换为 new_node
        while (!head_.compare_exchange_weak(
            new_node->next, new_node,
            std::memory_order_release,
            std::memory_order_relaxed)) {
            // CAS 失败说明有竞争，new_node->next 已被更新为新的 head_
            // 不断重试
        }

        size_.fetch_add(1, std::memory_order_relaxed);
    }

    std::optional<T> pop() {
        Node* old_head = head_.load(std::memory_order_relaxed);
        
        // CAS：如果 head_ 还是 old_head，就替换为 old_head->next
        while (old_head && !head_.compare_exchange_weak(
            old_head, old_head->next,
            std::memory_order_acquire,
            std::memory_order_relaxed)) {
            // CAS 失败说明有竞争，old_head 已被更新为新的 head_
            // 不断重试
        }

        if (!old_head) return std::nullopt;
        T val = std::move(old_head->data);
        size_.fetch_sub(1, std::memory_order_relaxed);
        delete old_head;  // 注意：实际项目需要安全回收（hazard pointer/epoch）
        return val;
    }

    size_t size() const { return size_.load(std::memory_order_relaxed); }

    ~LockFreeStack() {
        while (pop()) {}
    }
};
```

# 6. 线程池

线程池是一种多线程处理形式，简单来说，就是预先创建好一组线程，放在池子里备用。当有新任务来时，直接从池子中拿一个空闲线程去执行。由于频繁地创建和销毁线程开销非常大，执行完成的线程不会销毁，而是回到池子中继续等待下一个任务。

一个标准的线程池通常包含以下组件：
1. 任务队列: 存储待执行的任务（通常是 `std::function` 或函数指针），需要线程安全（加锁）
2. 工作线程: 池子里常驻的线程，循环从队列取任务执行
3. 同步机制:
    - 互斥锁: 保护任务队列
    - 条件变量 (Condition Variable): 当队列为空时，工作线程休眠；当有新任务加入时，唤醒工作线程
4. 管理接口: `submit()` (提交任务), `stop()` (关闭池子)

简化版的代码逻辑：
```cpp
#include <vector>
#include <queue>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <functional>

class ThreadPool {
public:
    ThreadPool(size_t num_threads) {
        // 1. 创建指定数量的工作线程
        for (size_t i = 0; i < num_threads; ++i) {
            workers.emplace_back([this] {
                while (true) {
                    std::function<void()> task;
                    {
                        // 2. 加锁访问队列
                        std::unique_lock<std::mutex> lock(this->queue_mutex);
                        // 3. 如果队列空且未停止，则等待 (释放锁并挂起)
                        this->condition.wait(lock, [this] { 
                            return this->stop || !this->tasks.empty(); 
                        });
                        // 4. 如果停止且队列空，退出线程
                        if (this->stop && this->tasks.empty()) return;
                        
                        // 5. 取出任务
                        task = std::move(this->tasks.front());
                        this->tasks.pop();
                    }
                    // 6. 执行任务 (锁已释放)
                    task();
                }
            });
        }
    }

    template<class F>
    void submit(F&& f) {
        {
            std::unique_lock<std::mutex> lock(queue_mutex);
            tasks.emplace(std::forward<F>(f));
        }
        condition.notify_one(); // 唤醒一个线程
    }

    ~ThreadPool() {
        {
            std::unique_lock<std::mutex> lock(queue_mutex);
            stop = true;
        }
        condition.notify_all(); // 唤醒所有线程以便退出
        for (std::thread& worker : workers)
            worker.join(); // 等待所有线程结束
    }

private:
    std::vector<std::thread> workers;       // 工作线程集合
    std::queue<std::function<void()>> tasks;// 任务队列
    std::mutex queue_mutex;                 // 队列锁
    std::condition_variable condition;      // 条件变量
    bool stop = false;                      // 停止标志
};
```
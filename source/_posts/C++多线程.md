---
title: C++ 多线程
date: 2025-03-04
updated: 2026-07-05
cover: cover.png
categories: C++
tags:
  - C++
  - 多线程
  - 互斥量
  - 条件变量
  - 原子操作
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

原子操作是指不可中断的一个或一系列操作。在多线程环境下，对原子变量的读写保证了数据竞争不会发生，无需配合互斥锁（`std::mutex`）即可实现线程安全，所以它是实现无锁编程的基础。在 C++ 中它是通过原子变量 `std::atomic<T>` 实现的，其中 `T` 必须是平凡可复制类型（例如 `int`、`bool`、指针等）。

原子变量的常用操作：
- `store()`：写入
- `load()`：读取
- `exchange()`：交换
- `compare_exchange_weak/strong(exp, des)`：若当前值等于 `exp` 则更新为 `des`，否则更新 `exp` 为当前值
- `fetch_add / fetch_sub`：原子加减，返回旧值
- `++, --, +=, -=`：方便使用，本质调用 `fetch` 操作

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
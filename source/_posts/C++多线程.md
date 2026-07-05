---
title: C++ 多线程编程
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

多线程编程的核心在于两件事：创建线程去干活，协调它们不打架。从 std::thread 的启动与回收，到互斥量和条件变量的同步，再到原子操作与线程池。

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
阻塞当前线程，等待目标线程结束
```cpp
int main() {
	thread t(foo);
	t.join(); // 主线程阻塞，等待线程 t 结束
	return 0;
}
```

2. `detach()`
分离线程，后台独立运行
```cpp
int main() {
	thread t(foo);
	t.detach(); // 主线程分离线程 t ，主线程不等待，继续向下执行
	return 0;
}
```

# 2. 互斥量

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

**2. `std::lock_guard<T>`：自动释放**
```cpp
void increment() {
    std::lock_guard<std::mutex> lock(mtx); // 自动锁定互斥锁
    ++count;                               // 修改共享变量
    // 互斥锁会在 lock 的析构函数中自动释放
}
```

**3. `std::unique_lock<T>`：自动/手动**
核心特性：
- 可手动解锁：对象析构时会自动释放，但同时也提供了 `unlock()` 方法以手动释放
- 所有权转移：`unique_lock` 之间可以转移 `mutex` 的所有权
```cpp
void increment() {
	std::unique_lock<std::mutex> lock(mtx)
	lock.lock(); // 可随时手动锁定
	++count;
	// lock.unlock(); // 可随时手动释放
	// 最后若没有手动释放，析构函数会自动释放 
}
```

# 3. `std::condition_varibale`

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
cv.wait(lock, []{ return ready == true; }); // 等待条件满足，每当线程被唤醒时进行一次条件检查

// 条件满足后执行，若不满足则重新等待
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

# 4. `std::atomic`

原子操作是指不可中断的一个或一系列操作。在多线程环境下，对原子变量的读写保证了数据竞争不会发生，无需配合互斥锁（`std::mutex`）即可实现线程安全，所以它是实现无锁编程的基础。在 C++ 中它是通过原子变量 `std::atomic<T>` 实现的，其中 `T` 必须是平凡可复制类型（例如 `int`、`bool`、指针等）。

原子变量的常用操作：
- `store()`：写入
- `load()`：读取
- `exchange()`：交换
- `compare_exchange_weak/strong(exp, des)`：若当前值等于 `exp` 则更新为 `des`，否则更新 `exp` 为当前值
- `fetch_add / fetch_sub`：原子加减，返回旧值
- `++, --, +=, -=`：方便使用，本质调用 `fetch` 操作

# 5. 线程池

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
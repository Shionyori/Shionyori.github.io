---
title: C++ 异步编程
date: 2025-03-04
updated: 2026-07-25
cover: /images/posts/C++异步编程/cover.png
categories: C++
tags:
  - C++
  - 异步编程
  - future 
  - promise
  - packaged_task
  - async
---

C++ 的异步编程围绕一个核心展开：启动一个任务，在未来的某个时刻取回结果。其中 `std::future` 和 `std::promise` 构成了这条通道的两端，而 `std::async` 则把线程创建和结果传递打包在一起。

---

# 1. 异步编程的基础

主要涉及的头文件有：
```cpp
#include <future> // std::future, std::promise, std::packaged_task, std::async
#include <thread> // std::thread 底层线程支持
```

异步三要素：
1. **`std::future<T>`**：获取异步结果的“只读句柄”，一次性获取（`get()` 后失效）
2. **`std::promise<T>`**：手动设置异步结果的“写入端”，与 `future` 成对出现，通过 `get_future()` 关联
3. **任务载体**：执行逻辑的封装，具体为 `std::async`（自动调度）、`std::packaged_task`（手动调度）、`std::thread`（原始线程）

# 2. future/promise 同步机制

> 如何安全地将异步任务的结果（或异常）从工作线程传递到调用线程？

传统方案：全局变量 + 锁，易出错且难以处理异常。

C++ 标准库提供标准化解决方案：**共享状态（Shared State） + Future/Promise 双端接口**，`promise<T>` 是写入端，`future<T>` 是读取段。

- 线程安全：共享状态内部同步，用户无需手动加锁
- 异常透明传递：`get()` 时在**调用线程**重抛，堆栈清晰
- 一次性语义：`get()` 只能调用一次，防止数据竞争

##  2.1 std::promise

1. `get_future()`

- 返回与 `promise` **绑定**的 `future`（即共享同一共享状态）
- **只能调用一次**，调用后 `promise` 会变为无效（`valid() == false`），再次调用抛出 `std::future_error`

```cpp
std::future<T> get_future();
```

2. `set_value()`

- 设置共享状态的值，并唤醒等待的 `future`（如果有）
- 只能调用一次，同上

```cpp
void set_value(const T& value);
void set_value(T&& value);
```

3. `set_exception()`

- 设置共享状态的异常，并唤醒等待的 `future`（如果有）
- 只能调用一次，之后调用 `future.get()` 时会在调用线程重新抛出该异常

```cpp
void set_exception(std::exception_ptr p);
```

## 2.2 std::future

1. `get()`

- 如果共享状态已就绪，立即返回结果或抛出异常；否则，**阻塞**当前线程直到任务完成
- **只能调用一次**，调用后 `future` 会变为无效（`valid() == false`），再次调用抛出 `std::future_error`

```cpp
T get();
T& get();
void get();
```

2. `wait()` / `wait_for()` / `wait_until()`

等待共享状态就绪
- `wait()`：阻塞直到共享状态就绪
- `wait_for(duration)`：阻塞指定时间，超时返回
- `wait_until(time_point)`：阻塞直到指定时间点，超时返回

```cpp
fut.wait(); // deferred 策略下它会触发任务执行，以下两个则不会
fut.wait_for(100ms);
fut.wait_until(std::chrono::system_clock::now() + 1s)
```

其中 `wait_for()` 和 `wait_until()` 返回值为 `std::future_status`，表示共享状态的当前状态：
```cpp
enum class std::future_status {
    ready,      // 共享状态已就绪（有结果/异常）
    timeout,    // 超时
    deferred    // deferred 策略：任务尚未启动（特殊状态）
};
```

---

1. `future` / `promise` 手动通信
```cpp
int main() {
    std::promise<int> promise;
    std::future<int> future = promise.get_future();

    std::thread worker([&promise] {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        promise.set_value(42);  // 设置结果
        std::cout << "  [worker] value set\n";    
    });

    std::cout << "  [main] waiting for result...\n";
    int result = future.get();  // 阻塞直到 set_value
    std::cout << "  [main] got: " << result << "\n";
    worker.join();
}
```

2. `promise` 传递异常
```cpp
int main() {
    std::promise<int> promise;
    auto future = promise.get_future();
    
    std::thread worker([&promise] {
        try {
            throw std::runtime_error("something went wrong");
        } catch (...) {
            promise.set_exception(std::current_exception());
        }
    });

    try {
        future.get();  // 重新抛出异常
    } catch (const std::exception& e) {
        std::cout << "  caught: " << e.what() << "\n";
    }
    worker.join();
}
```

# 3. std::packaged_task

`std::packaged_task` 是手动调度的异步任务包装器，本质上就是**可调用对象 + 内置`promise<R>` + 自动绑定 `future<R>`**。
- 可通过 `get_future()` 获取与之绑定的 `future`，**只能调用一次**
- **只可移动**，不可拷贝：
    - 传递时必须显式地使用 `std::move()`
    - 无法直接存放到 `std::function` 中（要求可拷贝），需要使用 `shared_ptr` 作为中转

```cpp
template<class R, class... Args>
class packaged_task<R(Args...)> // 特化：包装返回 R 且接收 Args... 的可调用对象
```

具体的使用方法如下：
```cpp
// 创建任务
std::packaged_task<int(int)> task([](int x) { return x * 2; });

// 必须先获取 future（只能调用一次！）
std::future<int> result = task.get_future();  

// 执行任务（三种方式）
task(10);                                   // A. 当前线程同步执行
std::thread(std::move(task), 10).detach();  // B. 新线程异步执行
thread_pool.enqueue(std::move(task), 10);   // C. 线程池调度

// 获取结果（阻塞直到任务完成）
std::cout << result.get() << std::endl;
```

```cpp
// 大部分通用线程池为了接收任意类型的任务，内部通常存的是 std::function<void()>
// 由于 std::function 要求可拷贝，而 std::packaged_task 只可移动，所以需要使用 shared_ptr 作为中转
auto task_ptr = std::make_shared<std::packaged_task<int(int)>>([](int x) { return x * 2; });
auto result = task_ptr->get_future();
thread_pool.enqueue([task_ptr](int x) { (*task_ptr)(x); }, 10);
```

# 4. std::async

`std::async` 是自动调度的异步任务，本质上是 **`packaged_task` + 策略驱动的自动调度器**，也就是对 `packaged_task` 的**高层便利封装**。
- 自动返回一个 `std::future<R>`，用于获取异步任务的结果
- 任务执行的默认策略为 `async | deferred`（异步或延迟执行），实际使用时一般指定 `async` 策略

```cpp
template<class F, class... Args>
std::future<std::invoke_result_t<std::decay_t<F>, std::decay_t<Args>...>> async(
    std::launch policy, F&& f, Args&&... args);

template<class F, class... Args>
std::future<std::invoke_result_t<std::decay_t<F>, std::decay_t<Args>...>> async(F&& f, Args&&... args);
```

启动策略：
1. `std::launch::async`：立即创建新线程执行
2. `std::launch::deferred`：延迟到 `get()/wait()` 时在当前线程同步执行
3. `async | deferred`：默认策略

具体的使用方法如下：
```cpp
#include <future>
#include <iostream>
#include <chrono>

int heavy_computation(int x) {
    std::this_thread::sleep_for(std::chrono::seconds(1));
    return x * x;
}

int main() {
    // 强制异步执行
    auto fut = std::async(std::launch::async, heavy_computation, 10);
    
    // 主线程可以同时做其他工作
    std::cout << "Doing other work...\n";
    std::this_thread::sleep_for(std::chrono::milliseconds(200)); // 模拟耗时操作
    
    std::cout << "Result: " << fut.get() << std::endl;  // 阻塞获取结果
}
```

使用 `std::async` 可以轻松实现并行计算，以分块求和为例：
```cpp
template<typename Iterator>
double parallel_sum(Iterator begin, Iterator end) {
    auto len = std::distance(begin, end);
    if(len < 1000) {
        return std::accumulate(begin, end, 0.0);
    }

    auto mid = begin + len / 2;
    auto left = std::async(std::launch::async, parallel_sum<Iterator>, begin, mid);
    double right =  parallel_sum(mid, end);
    return left.get() + right;
};
```

# 5. deferred 策略的尴尬地位

理论上说 `deferred` 策略提供了以下几点价值：

1. 语法对齐，对应 `async` 策略的异步调用
2. 惰性求值，执行时机具有延迟性

但是实际上，由于 `deferred` 策略下任务的执行直到 `get()/wait()` 被调用时才开始，而且是同步调用，会阻塞主线程，这与普通函数的调用是一致的，而且还存在 `future` 对象的管理开销。而延迟性带来的好处是可以随时选择是否调用并获取结果，但这一点也完全可以通过简单的 `if` 加上普通函数实现。所以 `deferred` 策略并没有带来新的优势，它的语法价值大于实际工程价值，有点像是为了存在而存在。

# 6. std::shared_future

`std::shared_future` 是 `std::future` 的共享版本，允许多个线程同时访问同一个共享状态的结果。
- 由 `future` 调用 `share()` 方法获取，原来的 `future` 会变为无效 （允许隐式转换）
- `get()` **可以被多次调用**，内部使用引用计数管理共享状态
- 其余方法与 `std::future` 相同（如 `wait()`、`wait_for()`、`wait_until()`）

```cpp
auto shared = future.share();
auto shared = packaged_task.get_future().share();
auto shared = std::async(...).share();
```

使用 `std::shared_future` 可以让多个线程等待同一个结果：
```cpp
int main() {
    std::promise<int> promise;
    std::shared_future<int> shared = promise.get_future().share();

    // 多个线程等待同一个结果
    std::vector<std::thread> threads;
    for (int i = 0; i < 3; ++i) {
         threads.emplace_back([shared, i] {
            int val = shared.get();  // 可多次调用
            std::cout << "  thread " << i << " got: " << val << "\n";
        });
    }

    promise.set_value(999);
    for (auto& t : threads) t.join();
}
```
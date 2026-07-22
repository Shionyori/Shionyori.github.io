---
title: C++ 异步编程
date: 2025-03-04
updated: 2026-07-05
cover: cover.png
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

# 1. 异步编程基础
## 1.1 核心头文件

```cpp
#include <future> // std::future, std::promise, std::packaged_task, std::async
#include <thread> // std::thread 底层线程支持
```

## 1.2 异步三要素

1. **`std::future<T>`**：获取异步结果的“只读句柄”，一次性获取（`get()` 后失效）
2. **`std::promise<T>`**：手动设置异步结果的“写入端”，与 `future` 成对出现，通过 `get_future()` 关联
3. **任务载体**：执行逻辑的封装，具体为 `std::async`（自动调度）、`std::packaged_task`（手动调度）、`std::thread`（原始线程）

## 1.3 Future-Promise 机制

> **如何安全地将异步任务的结果（或异常）从工作线程传递到调用线程？**

传统方案（全局变量+锁）易出错且难以处理异常。C++ 标准库提供标准化解决方案：**共享状态（Shared State） + Future/Promise 双端接口**，`promise<T>` 是写入端，`future<T>` 是读取段。

- 线程安全：共享状态内部同步，用户无需手动加锁
- 异常透明传递：`get()` 时在**调用线程**重抛，堆栈清晰
- 一次性语义：`get()` 只能调用一次，防止数据竞争

## 1.4 关键方法

`std::promise<T>`：
```cpp
std::future<T> get_future();
```
- 返回与 `promise` **绑定**的 `future`（即共享同一共享状态）
- **只能调用一次**，重复调用抛出 `std::future_error`

`std::future<T>`：
```cpp
T get();
T& get();
void get();
```
- **阻塞**：若共享状态未就绪，阻塞当前线程直到任务完成
- **一次性**：调用后 `future` 会变为无效（`valid() == false`），再次调用抛出 `std::future_error`

```cpp
fut.wait(); // deferred 策略下它会触发任务执行，以下两个则不会
fut.wait_for(100ms);
fut.wait_until(std::chrono::system_clock::now() + 1s)
```

时间结束后会返回其中一个状态值：
```cpp
enum class std::future_status {
    ready,      // 共享状态已就绪（有结果/异常）
    timeout,    // 超时
    deferred    // deferred 策略：任务尚未启动（特殊状态）
};
```



# 2. `std::packaged_task`：手动调度的异步任务包装器
## 2.1 定义

`std::packaged_task` 本质上是**可调用对象 + 内置`promise<R>` + 自动绑定 `future<R>`**

```cpp
template<class R, class... Args>
class packaged_task<R(Args...)> // 特化：包装返回 R 且接收 Args... 的可调用对象
```

## 2.2 使用示例
```cpp
#include <future>
#include <iostream>

// 创建任务
std::packaged_task<int(int)> task([](int x) { return x * 2; });

// 必须先获取 future（只能调用一次！）
std::future<int> result = task.get_future();  

// 执行任务（三种方式）
task(10);                          // A. 当前线程同步执行
// 或
std::thread(std::move(task), 20).detach();  // B. 新线程异步执行
// 或
thread_pool.enqueue(std::move(task), 30);   // C. 线程池调度

// 获取结果（阻塞直到任务完成）
std::cout << result.get() << std::endl;
```

# 3. `std::async`：自动调度的异步任务
## 3.1 定义

`std::async`本质上是 **`packaged_task` + 策略驱动的自动调度器**，是对 `packaged_task` 的**高层便利封装**

```cpp
template<class F, class... Args>
std::future<std::invoke_result_t<std::decay_t<F>, std::decay_t<Args>...>> async(std::launch policy, F&& f, Args&&... args);

template<class F, class... Args>
std::future<std::invoke_result_t<std::decay_t<F>, std::decay_t<Args>...>> async(F&& f, Args&&... args);
```

## 3.2 启动策略

1. `std::launch::async`：立即创建新线程执行
2. `std::launch::deferred`：延迟到 `get()/wait()` 时在当前线程同步执行
3. `async | deferred`：默认策略

## 3.3 使用示例

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

# 4. 其他问题
## 4.1 `deferred`策略的尴尬地位

理论上说 `deferred` 策略提供了以下几点价值：

1. 语法对齐，对应 `async` 策略的异步调用
2. 惰性求值，执行时机具有延迟性

但是实际上，由于 `deferred` 策略下任务的执行直到 `get()/wait()` 被调用时才开始，而且是同步调用，会阻塞主线程，这与普通函数的调用是一致的，而且还存在 `future` 对象的管理开销。而延迟性带来的好处是可以随时选择是否调用并获取结果，但这一点也完全可以通过简单的 `if` 加上普通函数实现。所以 `deferred` 策略并没有带来新的优势，它的语法价值大于实际工程价值，有点像是为了存在而存在。
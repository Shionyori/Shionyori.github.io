---
title: C++ 协程
date: 2025-6-03
update: 2026-7-10
cover: cover.png
categories: C++
tags:
  - C++
  - 协程
  - 异步编程
---

C++20 引入了协程（coroutine），从此我们可以用同步的方式编写异步代码，而不需要关心回调函数、状态机等复杂的控制流。

---

# 什么是协程

简单来说，==协程就是一个可以暂停与恢复执行的函数==。

协程允许在执行过程中暂停，并在需要时恢复，从而实现非阻塞的异步操作。

协程与函数的区别：
- 我们知道函数是在栈上运行的，函数状态（包括局部变量、指令指针等）全部被保存在在栈帧中，会随着函数的返回而销毁。
- 而协程的状态则会被保存在堆上的一块内存中，我们称之为协程帧（coroutine frame）。当协程被挂起时，协程的状态会被写入协程帧中；当协程恢复执行时，再从协程帧中读取状态，回到之前挂起的位置继续执行。


# 如何创建一个协程

我们先来看一个简单的协程示例，代码如下：

```cpp
#include <iostream>
#include <coroutine>

struct Task {
    struct promise_type {
        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }
        std::suspend_always initial_suspend() { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }
        void return_void() {}
        void unhandled_exception() {}
    };
    std::coroutine_handle<promise_type> handle;
};

Task my_coroutine() {
    std::cout << "execute phase 1" << std::endl;
    co_await std::suspend_always{};
    std::cout << "execute phase 2" << std::endl;
    co_return;
}

int main() {
    Task t = my_coroutine();    // 创建协程对象
    t.handle.resume();          // 执行 phase 1
    t.handle.resume();          // 执行 phase 2
    return 0;
}
```

# 协程的核心组件

## 三个关键字

在 C++20 中，一个函数体内只要出现了以下三个关键字，它就会被编译器识别并编译为协程：
- `co_await` <expr>：挂起当前协程
- `co_yield` <expr>：挂起当前协程并产生一个值（常用于生成器 Generator）
- `co_return` <expr>：从协程返回，并标志着协程体执行结束

## 协程状态（协程帧）

协程状态，或者说协程帧（coroutine frame），是协程在执行过程中保存其状态的堆内存区域。

它包含了以下内容：
- 协程的局部变量
- 协程的参数
- 协程的返回地址（指令指针）
- 协程的状态字，用于标识协程当前执行到哪一个挂起点

## 协程句柄

协程句柄的类型为 `std::coroutine_handle<promise_type>`，本质上是一个指向协程帧首地址的 8 字节指针，它被存放在协程对象（如 Task）中，作为外部控制协程的唯一接口。

通过协程句柄，我们可以做以下操作：
- `resume()`：恢复协程执行
- `done()`：检查协程是否已经执行到了最终挂起点（`final_suspend`）
- `handle.destroy()`：手动销毁协程帧（如果在 `final_suspend` 时选择了挂起，必须手动调用此方法防内存泄漏）
- `promise()`：获取对应的 `promise_type` 对象

在上述代码中，`Task` 结构体中包含了一个 `std::coroutine_handle<promise_type>` 类型的成员 `handle`，它指向协程帧。我们可以通过调用 `handle.resume()` 来恢复协程的执行。

## 承诺类型（promise_type）

`promise_type` 是一个约定名称（而非关键字），用于定义协程的生命周期策略和返回值行为。编译器会在协程的返回类型中查找名为 `promise_type` 的嵌套类型，或通过 `std::coroutine_traits` 特化来获取。每个协程的协程帧内部都嵌入了一个 `promise_type` 对象，由编译器在帧构造时自动初始化，在帧销毁时自动析构。

它提供了以下几个关键接口（称为“钩子函数”，由编译器在相应时机嵌入代码块）：

| 方法                                  | 调用时机                         | 作用                      |
| ----------------------------------- | ---------------------------- | ----------------------- |
| `get_return_object()`               | 协程创建时最先调用                    | 构造并返回协程的对外返回值（如 `Task`） |
| `initial_suspend()`                 | `get_return_object()` 之后立即调用 | 决定协程是否一启动就挂起            |
| `final_suspend()`                   | `co_return` 执行完毕后调用          | 决定协程结束后是否挂起（影响是否自动销毁帧）  |
| `return_void()` / `return_value(T)` | 执行到 `co_return` 时调用          | 处理协程的返回值                |
| `yield_value(T)`                    | 执行到 `co_yield` 时调用           | 处理生成器的产出值               |
| `unhandled_exception()`             | 协程体抛出未被捕获的异常时调用              | 处理异常                    |

承诺类型的实现方式是一个内部类，我们可以通过重写上述接口来定制协程的行为。

`promise_type` 提供了巨大的自定义空间：
1. 方法内部逻辑：可以在钩子函数中写任意 C++ 代码（日志、计时、信号量通知等）
2. 返回值类型：`initial_suspend` 和 `final_suspend` 可以返回任意满足 Awaitable 概念的类型
3. 成员变量：可以在 `promise_type` 中添加成员变量，它们会存活在协程帧中，贯穿协程的整个生命周期
4. 内存分配：可以重载 `operator new` / `operator delete` 来控制协程帧的内存分配策略


## awaitable 对象

awaitable 对象是 `co_await` 表达式的操作数，它定义了单次挂起的行为契约。
与 `promise_type`（管理协程的整体生命周期）不同，awaitable 负责管理协程执行过程中的每一个具体的暂停点。

符合 awaitable 的类就是一个没有任何成员变量的类，但它必须实现以下三个方法：
| 方法                                       | 调用时机                             | 返回值含义                                             |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `await_ready()`                          | `co_await` 执行时首先调用               | `true`不挂起；`false`需要挂起                      |
| `await_suspend(handle)` | 当 `await_ready()` 返回 `false` 时调用 | `void` / `bool` / 另一个 `coroutine_handle`，决定挂起后的行为 |
| `await_resume()`                         | 协程恢复执行后调用                        | 返回 `co_await` 表达式的值                               |

C++20 标准库提供了两个预设的 awaitable 类：
- `std::suspend_always`：总是挂起
- `std::suspend_never`：从不挂起

它们一般用作 `initial_suspend()`、`final_suspend()`、`co_await` 表达式的操作数：

```cpp
std::suspend_always initial_suspend() { return {}; }    // 协程创建后立即挂起
std::suspend_never initial_suspend() { return {}; }     // 协程创建后立即执行
```

```cpp
std::suspend_always final_suspend() noexcept { return {}; }     // 协程结束后挂起，等待手动销毁
std::suspend_never final_suspend() noexcept { return {}; }      // 协程结束后自动销毁
```

```cpp
co_await std::suspend_always{};     // 协程挂起
co_await std::suspend_never{};      // 协程不挂起
```


# 从汇编角度看协程的实现

```
main:
    sub rsp, 8
    call my_coroutine
    mov [rsp], rax
    mov rdi, [rsp]
    call Task::resume
    mov rdi, [rsp]
    call Task::resume
    xor eax, eax
    add rsp, 8
    ret
```

当主函数调用 `my_coroutine()` 时，并不会直接执行业务逻辑，而是先初始化协程帧；然后依次调用 `promise_type` 的构造函数、`get_return_object()`、`initial_suspend()`，最后挂起协程，返回协程对象给主函数。
```
my_coroutine:
    mov edi, 48                           ; 申请 48 字节空间用于存放「协程帧」
    call operator new                     ; 包括 promise、状态字、寄存器上下文等
    mov rbx, rax                          ; rbx 指向协程帧首地址
    
    mov rdi, rbx
    call Task::promise_type::promise_type()      ; 在协程帧内构造 promise_type
    
    mov rdi, rbx
    call Task::promise_type::get_return_object() ; 创建传给外部的 Task 对象
    
    mov rdi, rbx
    call Task::promise_type::initial_suspend()   ; 调用初始挂起检查
    
    mov qword [rbx + 0], 0                 ; [rbx + 0] 是当前状态字（State ID = 0）
    mov qword [rbx + 8], .L_resume_point_1 ; [rbx + 8] 存储下一次恢复时的跳转目标（IP）
    mov qword [rbx + 16], rsp              ; [rbx + 16] 保存调用者的栈指针
    mov qword [rbx + 24], rbp              ; [rbx + 24] 保存调用者的基址指针
    
    lea rdi, [rbx]
    call std::suspend_always::await_suspend()  ; 挂起，保存上下文

    ret
```

随后主函数调用 `Task::resume()`，恢复协程的执行，需要注意的是 `Task::resume()` 只是一个中转函数，用于检查协程的状态字是否合法，而真正的状态机路由函数是后面的 `my_coroutine_resume`：
```
Task::resume:
    mov rbx, [rdi]                        ; 从 Task 结构体中读取指向协程帧的指针
    cmp rbx, 0                            ; 空指针检查
    je .L_skip_resume
    cmp qword [rbx + 0], 2                ; 检查状态字是否为 2（2 代表协程已结束）
    je .L_skip_resume
    jmp my_coroutine_resume               ; 跳转到真正的状态机路由函数
.L_skip_resume:
    ret
```

跳转到 `my_coroutine_resume` 后，协程会根据状态字跳转到对应的恢复点继续执行：
```
my_coroutine_resume:
    mov eax, [rbx + 0]              ; 读取当前状态字
    cmp eax, 0                      ; 检查状态字是否为 0（0 代表协程刚开始执行）
    je .L_state_0
    cmp eax, 1
    je .L_state_1
    jmp .L_end

.L_state_0:                         ; 状态字为 0，表示协程刚开始执行
    mov rsp, [rbx + 16]
    mov rbp, [rbx + 24]
    jmp [rbx + 8]

.L_resume_point_1:
    mov edi, 1
    call std::cout::operator<<
    mov qword [rbx + 0], 1
    mov qword [rbx + 8], .L_resume_point_2
    mov qword [rbx + 16], rsp
    mov qword [rbx + 24], rbp
    lea rdi, [rbx]
    call std::suspend_always::await_suspend()
    ret

.L_state_1:                         ; 状态字为 1，表示协程已经执行到第一个挂起点
    mov rsp, [rbx + 16]
    mov rbp, [rbx + 24]
    jmp [rbx + 8]

.L_resume_point_2:
    mov edi, 2
    call std::cout::operator<<
    mov rdi, rbx
    call Task::promise_type::return_void()
    mov rdi, rbx
    call Task::promise_type::final_suspend()
    mov qword [rbx + 0], 2
    ret

.L_end:
    ret
```
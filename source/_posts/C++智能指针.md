---
title: C++ 智能指针
date: 2025-03-09
updated: 2026-07-05
cover: cover.png
categories: C++
tags:
  - C++
  - 智能指针
  - 内存管理
---

手动管理内存容易出错，忘记释放、重复释放、悬空指针，每一个都可能让程序崩溃，智能指针把所有权规则编码到类型系统里，让编译器替你把关。

---

# 1. `std::unique_ptr`
## 1.1 定义

任何对象一旦绑定了 `unique_ptr` 之后，就不能再被其他指针同时绑定；不允许拷贝，只能被移动。

核心特点：
- **独占所有权**：确保资源在一个所有者下
- **轻量级**：没有引用计数，开销小
- **自动释放**：在指针销毁时自动释放资源，支持自定义删除器

## 1.2 使用方法

`unique_ptr` 的创建与转移：
```cpp
// 使用 make_unique （仅适用于管理堆内存资源）
auto p1 = std::make_unique<int>(42);

// 直接 new
std::unique_ptr<int> p2(new int(42));

auto p3 = std::move(p1); // 所有权转移
```

自定义删除器：
- `unique_ptr` 的删除器是**类型的一部分**（模板参数），在编译期确定，零运行时开销
```cpp
// 1. 使用自定义类作为删除器
struct FileDeleter {
    void operator()(FILE* f) const {
        if (f) fclose(f);
    }
};

std::unique_ptr<FILE, FileDeleter> file(fopen("test.txt", "r"));

// 2. 使用 lambda 作为删除器（需用 decltype 推导类型）
auto deleter = [](FILE* f) { if (f) fclose(f); };
std::unique_ptr<FILE, decltype(deleter)> file2(fopen("test.txt", "r"), deleter);
```


---

# 2. `std::shared_ptr`

## 2.1 定义

允许多个 `shared_ptr` 实例共享对同一个对象的所有权；通过引用计数机制，管理资源的生命周期。

核心特点：
- **共享所有权**：多个 `shared_ptr` 可以指向同一个对象
- **控制块机制**：额外内存开销（通常 2-3 个指针大小），存储引用计数、弱引用计数、删除器等
- **线程安全**：引用计数操作是原子性的，但对象本身的访问需用户加锁
- **自动释放**：==当强引用计数归零时，自动销毁对象并释放控制块==

## 2.2 引用计数与控制块

`shared_ptr` 背后依赖**控制块（Control Block）**，主要用于管理引用计数和实际对象的指针。

控制块的主要内容包括：
- **强引用计数（**`use_count`**）**：表示有多少个 `shared_ptr` 指向对象
- **弱引用计数（**`weak_count`**）**：表示有多少个 `weak_ptr` 指向对象（不增加强引用计数）
- 实际对象指针：指向堆上的 T 对象
- 自定义删除器：可选，用于特殊释放逻辑

关键机制：
- `use_count == 0` → 销毁对象，执行删除器
- `use_count == 0 && weak_count == 0` → 销毁控制块本身

代码示例：
```cpp
template <typename T>
class control_block
{
public:
    T *ptr;
    size_t strong_count;
    size_t weak_count;
    deleter_base *deleter;

    // constructor: default
    control_block(T *p) : ptr(p), strong_count(1), weak_count(0), 
                          deleter(new deleter_wrapper<T, default_deleter<T>>(default_deleter<T>{})) {}

    // constructor: with custom deleter
    template <typename Deleter>
    control_block(T *p, Deleter d) : ptr(p), strong_count(1), weak_count(0), 
                                     deleter(new deleter_wrapper<T, Deleter>(std::move(d))) {}

    // destructor
    ~control_block()
    {
        delete deleter;
    }
};
```

## 2.3 使用方法

`shared_ptr` 的创建：
```cpp
// 使用 make_shared （仅适用于管理堆内存资源）
auto p1 = std::make_shared<int>(42);

// 直接 new 
std::shared_ptr<T> p2 (new int(42));
```

自定义删除器：
- `shared_ptr` 的删除器存储在**控制块**中（类成员），运行时多态，不影响指针的类型（类型擦除）
```cpp
// 使用 lambda 作为删除器（最常用）
auto file = std::shared_ptr<FILE>(
    fopen("test.txt", "r"),
    [](FILE* f) { if (f) fclose(f); } // lambda 表达式
);

// 特殊情况：
// 1. 管理数组（shared_ptr 不直接支持 T[]，需自定义删除器）
auto arr = std::shared_ptr<int>(
    new int[10],
    [](int* p) { delete[] p; }  // 必须用 delete[]
);

// 2. 状态捕获的删除器
int* counter = new int(0);
auto ptr = std::shared_ptr<Resource>(
    new Resource,
    [counter](Resource* r) {
        delete r;
        (*counter)++;  // 捕获外部状态
        delete counter;
    }
);
```


---

# 3. `std::weak_ptr`

## 3.1 定义

`shared_ptr` 的辅助类，不拥有对象所有权，用于解决 `shared_ptr` 之间的循环引用问题。

核心特点：
- **非拥有所有权**：不增加强引用计数，不阻止对象销毁
- **安全访问**“：`std::weak_ptr` 可以通过 `lock()` 尝试提升为 `shared_ptr`
- **避免循环引用**：解决 `shared_ptr` 双向引用的内存泄漏问题
- **过期检查**：`expired()` 快速判断对象是否已销毁

## 3.2 解决循环引用
在双向关联（如父子关系）时，使用多个 `shared_ptr` 可能导致循环引用，使得 `use_count` 永远无法归零，`shared_ptr` 无法自动销毁，从而导致内存泄漏。此时，可以使用 `weak_ptr` 来打破循环。

具体示例如下：
```cpp
#include <iostream>
#include <memory>

class B; // 前向声明

class A {
public:
    std::shared_ptr<B> ptrB;

    A() { std::cout << "A Constructor" << std::endl; }
    ~A() { std::cout << "A Destructor" << std::endl; }
};

class B {
public:
    std::weak_ptr<A> ptrA; // 使用 weak_ptr 打破循环

    B() { std::cout << "B Constructor" << std::endl; }
    ~B() { std::cout << "B Destructor" << std::endl; }
};

int main() {
    {
	    auto a = std::make_shared<A>();
        auto b = std::make_shared<B>();
        a->ptrB = b;
        b->ptrA = a; // weak_ptr 不增加 use_count
    }
    return 0;
}
```

## 3.3 访问 `weak_ptr` 指向的对象

`weak_ptr` 不能直接解引用，需要通过 `lock()` 方法转换为 `shared_ptr`，并检查对象是否仍然存在。

具体示例如下：
```cpp
#include <iostream>
#include <memory>

int main() {
    std::shared_ptr<int> sp = std::make_shared<int>(42);
    std::weak_ptr<int> wp = sp;

    if (auto locked = wp.lock()) { // 尝试获取 shared_ptr
        std::cout << "Value: " << *locked << std::endl;
    } else {
        std::cout << "Object no longer exists." << std::endl;
    }

    sp.reset(); // 释放资源，此时 use_count = 0

    if (auto locked = wp.lock()) { // 再次尝试获取 shared_ptr
        std::cout << "Value: " << *locked << std::endl;
    } else {
        std::cout << "Object no longer exists." << std::endl;
    }

    return 0;
}
```


---

# 4. `enable_shared_from_this`

`enable_shared_from_this` 是一个模板类，可以被任意类型继承，使得可以安全获取指向自身的智能指针。

何时要用到 `enable_shared_from_this`：
1. 将对象传递给另一个函数（如异步回调、容器存储）
2. 且该函数需要 **长期持有** 对象所有权，不受当前作用域结束的影响
3. 保留智能指针自动释放资源的便利性

如何使用：
1. 让该对象的类公有继承 `std::enable_shared_from_this<T>`
2. 在成员函数中调用 `shared_from_this()` 获取自身智能指针
```cpp
class Person : public std::enable_shared_from_this<Person> {
public:
    void doSomething() {
        // 安全获取指向自身的 shared_ptr
        std::shared_ptr<Person> self = shared_from_this();
        asyncTask([self]() { self->work(); }); // 捕获 self 保证存活
    }
};
```

底层原理：
1. `enable_shared_from_this<T>` 类内部隐藏了一个 `std::weak_ptr<T>`
2. 当第一个管理该对象的 `std::shared_ptr` 被创建时（如 `make_shared`），会自动初始化这个内部的 `weak_ptr`
3. 成员函数调用 `shared_from_this()` 时，会将内部的 `weak_ptr` 提升( `lock()` )为 **`shared_ptr`** 并返回
4. 这个新的 `shared_ptr` 与原 `shared_ptr` **共享控制块和引用计数**，从而安全地延长对象生命周期。

需要注意的是：
1. 对象必须 **已经由 `shared_ptr` 管理**（不能是栈对象或裸指针管理）
2. **严禁在构造函数中调用** `shared_from_this()`（此时内部 `weak_ptr` 尚未初始化）
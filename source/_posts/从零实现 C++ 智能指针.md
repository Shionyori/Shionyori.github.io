---
title: 从零实现 C++ 智能指针
date: 2026-02-25
updated: 2026-02-25
cover: /images/posts/从零实现 C++ 智能指针/cover.png
categories: C++
tags:
  - 智能指针
  - RAII
  - 模板
  - C++
---

# 1. 实现基本的 `unique_ptr` 和 `shared_ptr`

智能指针的本质是 裸指针 + RAII 对象封装，我们通过将裸指针封装成一个类对象，利用对象的 RAII 机制实现资源的自动释放。

为了实现智能指针的资源自动管理，即 RAII 机制，我们需要严格按照 三五零法则 设计模板类，具体而言就是除了基本的构造函数以外，还需要自定义以下特殊成员函数：
- 析构函数 `~T()`
- 拷贝构造函数 `T(const T&)`
- 拷贝赋值运算符 `T& operator=(const T&)`
- 移动构造函数 `T(T&&)`
- 移动赋值运算符 `T& operator=(T&&)`

`unique_ptr` 的设计原则是一份资源的所有权只能同时被一个指针所拥有，所以需要禁用所有的拷贝操作，只允许移动操作。

此外我们还需要提供智能指针的一些基本操作的函数：
- 解引用
- 返回指针
- 释放智能指针
- 重置所有权

`unique_ptr` 代码示例：
```cpp
#pragma once
#include <cstddef>

template <typename T>
class unique_ptr
{
public:
    explicit unique_ptr(T *ptr = nullptr) : ptr(ptr) {}

    ~unique_ptr()
    {
        delete ptr;
    }

    // copying is banned (unique ownership)
    unique_ptr(const unique_ptr &) = delete;
    unique_ptr &operator=(const unique_ptr &) = delete;

    // moving is allowed
    unique_ptr(unique_ptr &&other) : ptr(other.ptr)
    {
        other.ptr = nullptr;
    }
    unique_ptr &operator=(unique_ptr &&other)
    {
        if (this != &other)
        {
            delete ptr;
            ptr = other.ptr;
            other.ptr = nullptr;
        }
        return *this;
    }

    // pointer operation
    T &operator*() const { return *ptr; }
    T *operator->() const { return ptr; }
    T *get() const { return ptr; }

    T *release()
    {
        T *temp = ptr;
        ptr = nullptr;
        return temp;
    }

    void reset(T *new_ptr = nullptr)
    {
        delete ptr;
        ptr = new_ptr;
    }

    explicit operator bool() const
    {
        return ptr != nullptr;
    }

private:
    T *ptr;
};
```

{% note info %}
其中，显式布尔运算符 `operator bool()` 是一种特殊的成员函数，用于将类对象显示转换为布尔值。
```cpp
    explicit operator bool() const
    {
        return ptr != nullptr;
    }
```
有了它，我们才能正常使用类似于 `if(ptr)`、`!ptr` 的表达式。加上 `explicit` 禁止隐式转换，避免预料之外对象被转换为布尔值的情况。
{% endnote %}


`shared_ptr` 的设计原则是一份资源的所有权可以被多个指针共享。

为了实现共享的功能，我们需要创建一个公共的引用计数，用于统计资源被引用的次数，决定何时释放资源。我们为 `shared_ptr` 添加一个 `count` 成员变量，需要注意的是，`count` 需要设为指针类型，而非普通的值类型。因为这样每次 `shared_ptr` 在执行拷贝操作时，都只会将地址拷贝，而不会创建新的值对象，保证从始至终只有一个公共的 `count`。

当初始指针被创建时将引用计数设为1，每当初始指针被拷贝给新的指针时，就将引用计数（`count`）+1。当某一个指针调用 `release()` 试图释放资源时，`release()` 会将引用计数-1，直到计数为0时，才会执行 `delete` 释放资源。

`shared_ptr` 其余内容与 `unique_ptr` 类似，实现相应的函数即可。

`shared_ptr` 代码示例：
```cpp
template <typename T>
class shared_ptr
{
public:
    explicit shared_ptr(T *ptr = nullptr) : ptr(ptr), count(new size_t(1)) {}

    ~shared_ptr()
    {
        release();
    }

    // copying (shared ownership)
    shared_ptr(const shared_ptr &other) : ptr(other.ptr), count(other.count)
    {
        if (count)
        {
            ++(*count); // reference count +1
        }
    }
    shared_ptr &operator=(const shared_ptr &other)
    {
        if (this != &other)
        {
            release();
            ptr = other.ptr;
            count = other.count;
            ++(*count); // reference count +1
        }
        return *this;
    }

    // moving
    shared_ptr(shared_ptr &&other) : ptr(other.ptr), count(other.count)
    {
        other.ptr = nullptr;
        other.count = nullptr;
    }
    shared_ptr &operator=(shared_ptr &&other)
    {
        if (this != &other)
        {
            release();
            ptr = other.ptr;
            count = other.count;
            other.ptr = nullptr;
            other.count = nullptr;
        }
        return *this;
    }

    // pointer operation
    T &operator*() const { return *ptr; }
    T *operator->() const { return ptr; }
    T *get() const { return ptr; }

    size_t use_count() const { return count ? *count : 0; }
    bool unique() const { return use_count() == 1; }

    void reset(T *new_ptr = nullptr)
    {
        release();
        ptr = new_ptr;
        if (ptr)
            count = new size_t(1);
        else
            count = nullptr;
    }

    explicit operator bool() const
    {
        return ptr != nullptr;
    }

private:
    T *ptr;
    size_t *count;

    void release()
    {
        if (count && --(*count) == 0)
        {
            delete ptr;
            delete count;
        }
    }
};
```

---

# 2. 添加 `weak_ptr` 并完善 `shared_ptr`

之前实现的 `shared_ptr` 并不完美，其中一个问题是，当两个 `shared_ptr` 相互引用彼此时会导致引用计数永远无法归零，导致资源无法被释放。

为了进一步完善 `shared_ptr`，我们需要引入 控制块 和 `weak_ptr`。

`weak_ptr` 是 `shared_ptr` 的辅助类，专门用于解决循环引用的问题。

我们将之前在 `shared_ptr` 定义的引用计数重新命名为强引用计数 `strong_count`，此外再添加一个属于 `weak_ptr` 的弱引用计数 `weak_count`。当弱引用计数归零时不会释放资源，只有当强引用计数归零时才会释放资源。弱引用计数的主要作用是决定控制块自身的生命周期。

`strong_count == 0` -> 释放资源
`strong_count == 0 && weak_count == 0` -> 释放控制块的内存

引用计数以及内部指针统一由控制块 `control_block` 管理，共享同一份资源的 `shared_ptr` 通过保留 `control_block` 的指针，访问公共的控制块内容。所有公共内容都应该由控制块管理，这时引用计数就没必要像之前一样存指针，这里直接保留值类型即可。

```cpp
template <typename T>
class control_block
{
public:
    T* ptr;
    size_t strong_count;
    size_t weak_count;

    explicit control_block(T* p) : ptr(p), strong_count(1), weak_count(0) {}
};
```

接下来我们实现 `weak_ptr` ，由于加入了控制块，我们需要适当修改之前使用引用计数的方式。

`weak_ptr` 的设计理念是在某些可能导致循环引用的情况下代替 `shared_ptr` 而使用，但是 `weak_ptr` 并不能决定资源的生命周期，在必要时我们需要将其提升为 `shared_ptr`，反过来也是同理。所以我们需要提供二者相互转化的方法，即为 `shared_ptr` 和 `weak_ptr` 都加上使用彼此为参数的构造函数和赋值函数。 需要注意的是，在构造时它们需要访问彼此私有的 控制块指针，所以需要将它们设置互为友元。

此外，再提供一些外部接口：
`lock()` 用于将 `weak_ptr` 提升为 `shared_ptr`。
`use_count()` 返回 强引用计数
`expired()` 判断资源是否被释放

`weak_ptr` 代码示例：
```cpp
template <typename T>
class weak_ptr
{
private:
    control_block<T>* cb;
    T* ptr;

    void release()
    {
        if (cb)
        {
            --cb->weak_count;
            if (cb->strong_count == 0 && cb->weak_count == 0)
            {
                delete cb;
            }
        }
    }

public:
    weak_ptr() : cb(nullptr), ptr(nullptr) {}

    ~weak_ptr()
    {
        release();
    }

    // construct from shared_ptr
    weak_ptr(const shared_ptr<T>& sp) : cb(sp.cb), ptr(sp.ptr)
    {
        if (cb)
        {
            ++cb->weak_count;
        }
    }

    weak_ptr(const weak_ptr& other) : cb(other.cb), ptr(other.ptr)
    {
        if (cb)
        {
            ++cb->weak_count;
        }
    }

    weak_ptr& operator=(const weak_ptr& other)
    {
        if (this != &other)
        {
            release();
            cb = other.cb;
            ptr = other.ptr;
            if (cb)
            {
                ++cb->weak_count;
            }
        }
        return *this;
    }

    // assign from shared_ptr
    weak_ptr& operator=(const shared_ptr<T>& sp)
    {
        release();
        cb = sp.cb;
        ptr = sp.ptr;
        if (cb)
        {
            ++cb->weak_count;
        }
        return *this;
    }

    // moving
    weak_ptr(weak_ptr&& other) noexcept : cb(other.cb), ptr(other.ptr)
    {
        other.cb = nullptr;
        other.ptr = nullptr;
    }

    weak_ptr& operator=(weak_ptr&& other) noexcept
    {
        if (this != &other)
        {
            release();
            cb = other.cb;
            ptr = other.ptr;
            other.cb = nullptr;
            other.ptr = nullptr;
        }
        return *this;
    }

    template <typename U>
    friend class shared_ptr;

    shared_ptr<T> lock() const
    {
        if (cb && cb->strong_count > 0)
        {
            return shared_ptr<T>(*this);
        }
        return shared_ptr<T>();
    }

    size_t use_count() const { return cb ? cb->strong_count : 0; }
    bool expired() const { return use_count() == 0; }

    void reset()
    {
        release();
        cb = nullptr;
        ptr = nullptr;
    }
};
```

`shared_ptr` 修改后的代码示例：
```cpp
template <typename T>
class shared_ptr
{
private:
    control_block<T>* cb;
    T* ptr;

    void release()
    {
        if (cb)
        {
            --cb->strong_count;
            if (cb->strong_count == 0)
            {
                delete cb->ptr;
                if (cb->weak_count == 0)
                {
                    delete cb;
                }
            }
        }
    }

public:
    explicit shared_ptr(T* p = nullptr) : cb(p ? new control_block<T>(p) : nullptr), ptr(p) {}

    template <typename U>
    explicit shared_ptr(const weak_ptr<U>& other) : cb(other.cb), ptr(other.ptr)
    {
        if (cb)
        {
            ++cb->strong_count;
        }
    }

    ~shared_ptr()
    {
        release();
    }

    shared_ptr(const shared_ptr& other) : cb(other.cb), ptr(other.ptr)
    {
        if (cb)
        {
            ++cb->strong_count;
        }
    }

    shared_ptr& operator=(const shared_ptr& other)
    {
        if (this != &other)
        {
            release();
            cb = other.cb;
            ptr = other.ptr;
            if (cb)
            {
                ++cb->strong_count;
            }
        }
        return *this;
    }

    shared_ptr(shared_ptr&& other) noexcept : cb(other.cb), ptr(other.ptr)
    {
        other.cb = nullptr;
        other.ptr = nullptr;
    }

    shared_ptr& operator=(shared_ptr&& other) noexcept
    {
        if (this != &other)
        {
            release();
            cb = other.cb;
            ptr = other.ptr;
            other.cb = nullptr;
            other.ptr = nullptr;
        }
        return *this;
    }

    template <typename U>
    friend class weak_ptr;

    T& operator*() const { return *ptr; }
    T* operator->() const { return ptr; }
    T* get() const { return ptr; }

    size_t use_count() const { return cb ? cb->strong_count : 0; }
    bool unique() const { return use_count() == 1; }

    void reset(T* p = nullptr)
    {
        release();
        if (p)
        {
            cb = new control_block<T>(p);
            ptr = p;
        }
        else
        {
            cb = nullptr;
            ptr = nullptr;
        }
    }

    explicit operator bool() const { return ptr != nullptr; }
};
```
---

# 3. 为 `unique_ptr` 和 `shared_ptr` 添加数组支持

目前我们的智能指针只能接受类对象，无法像这样 `unique_ptr<int[]>(new int[3]{1, 2, 4})` 来创建新的智能指针。关键在于我们需要提供 `operator[]` 而非 `operator*`，析构时调用 `delete[]` 而非 `delete`。

我们可以添加一个偏特化的模板，从而同时实现不同的解析运算符和析构函数。代码实现上基本与原模板一致，只需要对几个关键函数进行修改。

`unique_ptr` 数组支持特化的代码示例：
```cpp
template <typename T>
class unique_ptr<T[]>
{
private:
    T *ptr;

public:
    explicit unique_ptr(T *ptr = nullptr) : ptr(ptr) {}

    ~unique_ptr()
    {
        delete[] ptr;
    }

    // copying is banned
    unique_ptr(const unique_ptr &) = delete;
    unique_ptr &operator=(const unique_ptr &) = delete;

    // moving is allowed
    unique_ptr(unique_ptr &&other) : ptr(other.ptr)
    {
        other.ptr = nullptr;
    }
    unique_ptr &operator=(unique_ptr &&other)
    {
        if (this != &other)
        {
            delete[] ptr;
            ptr = other.ptr;
            other.ptr = nullptr;
        }
        return *this;
    }

    // getter
    T &operator[](size_t index) const { return ptr[index]; }
    T *get() const { return ptr; }

    T *release()
    {
        T *temp = ptr;
        ptr = nullptr;
        return temp;
    }

    void reset(T *new_ptr = nullptr)
    {
        delete[] ptr;
        ptr = new_ptr;
    }

    explicit operator bool() const
    {
        return ptr != nullptr;
    }
};
```

`shared_ptr` 数组支持特化的代码示例：
```cpp
template <typename T>
class shared_ptr<T[]>
{
private:
    control_block<T> *cb;
    T *ptr;

    void release()
    {
        if (cb)
        {
            --cb->strong_count;
            if (cb->strong_count == 0)
            {
                delete[] cb->ptr;
                if (cb->weak_count == 0)
                {
                    delete cb;
                }
            }
        }
    }

public:
    explicit shared_ptr(T *p = nullptr) : cb(p ? new control_block<T>(p) : nullptr), ptr(p) {}

    ~shared_ptr()
    {
        release();
    }

    shared_ptr(const shared_ptr &other) : cb(other.cb), ptr(other.ptr)
    {
        if (cb)
        {
            ++cb->strong_count;
        }
    }

    shared_ptr &operator=(const shared_ptr &other)
    {
        if (this != &other)
        {
            release();
            cb = other.cb;
            ptr = other.ptr;
            if (cb)
            {
                ++cb->strong_count;
            }
        }
        return *this;
    }

    shared_ptr(shared_ptr &&other) noexcept : cb(other.cb), ptr(other.ptr)
    {
        other.cb = nullptr;
        other.ptr = nullptr;
    }

    shared_ptr &operator=(shared_ptr &&other) noexcept
    {
        if (this != &other)
        {
            release();
            cb = other.cb;
            ptr = other.ptr;
            other.cb = nullptr;
            other.ptr = nullptr;
        }
        return *this;
    }

    // getter
    T &operator[](size_t index) const { return ptr[index]; }
    T *get() const { return ptr; }

    size_t use_count() const { return cb ? cb->strong_count : 0; }
    bool unique() const { return use_count() == 1; }

    void reset(T *p = nullptr)
    {
        release();
        if (p)
        {
            cb = new control_block<T>(p);
            ptr = p;
        }
        else
        {
            cb = nullptr;
            ptr = nullptr;
        }
    }

    explicit operator bool() const { return ptr != nullptr; }
};
```
---

# 4. 添加 `make_unique` 和 `make_shared` 方法

直接使用 `new` 来构造智能指针，一旦发生异常，容易导致内存泄漏。
```cpp
    std::unique_ptr<A>(new A())
```
默认编译器从右向左执行，如果在 `new A()` 执行后发生异常，此时 `A` 对应内存已经被分配，但是`unique_ptr` 尚未被创建，从而导致这块内存无人负责释放。

而 `make_unique` 将这一过程封装在一个函数内，只要函数内部发生异常，整个函数过程都会被回滚，从而避免了上述问题。

对照之前添加的 `unique_ptr` 和 `shared_ptr` 的数组支持版本的特化模板，那么 `make_unique` 和 `make_shared` 方法也需要分为是否为数组两种情况进行实现。此外，我们还需要根据传入的模板参数 `T` 是否为数组类型，选择对应的模板函数。

但是由于 `make_unique<T[]>()` 可以同时匹配模板参数为 `template <typename T, typename... Args>` 和 `template <typename T>` 的同一个函数的两个特化版本，为了实现编译器对函数特化版本的正确选择，我们不得不使用 `std::enable_if` 并借助模板的 SFINAE 机制。

{% note info %}
SFINAE 机制在这里简单来说就是，当编译器尝试推导模板函数的类型参数时，若发现某个参数不存在，编译器并不会报错，而是直接将该模板函数从候选列表中移除。
{% endnote %}

`std::enable_if` 是一个类模板，可以传入一个条件表达式，它会根据这个表达式的布尔值决定类内是否存在 `type` 这个成员变量（具体原理就是当表达式值为真就选择包含 `type` 成员的特化版本的类模板）。我们可以将 `std::enable_if<std::is_array<T>::value, int>::type` 作为 `make_unique` 函数模板的类型参数之一，这样它就会根据条件 `std::is_array<T>` 决定 `type` 是否存在，进而因 SFINAE 机制影响编译器对模板函数的选择。 

借助以上特性和方法，我们就可以做到自动选择模板函数的正确版本，且不会因为出现编译错误。

`make_unique` 代码示例：
```cpp
// make_unique - object
template <typename T, typename... Args,
          typename std::enable_if<!std::is_array<T>::value, int>::type = 0>
unique_ptr<T> make_unique(Args &&...args)
{
    return unique_ptr<T>(new T(std::forward<Args>(args)...));
}

// make_unique - array
template <typename T,
          typename std::enable_if<std::is_array<T>::value, int>::type = 0>
unique_ptr<T> make_unique(size_t size)
{
    using ElementType = typename std::remove_extent<T>::type;
    return unique_ptr<T>(new ElementType[size]());
}
```

`make_shared` 代码示例：
```cpp
// make_shared - object
template <typename T, typename... Args,
          typename std::enable_if<!std::is_array<T>::value, int>::type = 0>
shared_ptr<T> make_shared(Args &&...args)
{
    return shared_ptr<T>(new T(std::forward<Args>(args)...));
}

// make_shared - array
template <typename T,
          typename std::enable_if<std::is_array<T>::value, int>::type = 0>
shared_ptr<T> make_shared(size_t size)
{
    using ElementType = typename std::remove_extent<T>::type;
    return shared_ptr<T>(new ElementType[size]());
}
```
---

# 5. 添加默认删除器和自定义删除器

智能指针的基本功能已经初具雏形，但是我们前面只考虑了 需要管理的资源为堆内存 这一种情况，实际上的资源还可能是 文件句柄、互斥量、套接字等其他需要显示管理生命周期的东西。

不同资源的释放逻辑不同，例如 `fclose()` 、`unlock()`，因此之前全部使用 `delete/delete[]` 是不全面的。

为了能够统一管理资源的释放逻辑，我们可以实现删除器。

首先我们可以先实现统一的默认删除器，相当于是把之前的 `delete/delete[]` 释放逻辑重新封装起来。默认删除器被定义为可调用对象，可以像函数指针一样直接调用并执行对应逻辑。

默认删除器代码示例：
```cpp
// default deleter - object
template <typename T>
struct default_deleter
{
    void operator()(T *ptr) const
    {
        delete ptr;
    }
};

// default deleter - array
template <typename T>
struct default_deleter<T[]>
{
    void operator()(T *ptr) const
    {
        delete[] ptr;
    }
};
```

然后为 `unique_ptr` 添加自定义删除器的接口，允许传入自定义删除器作为参数。修改构造函数，同时记得将之前的资源释放逻辑全部替换为调用删除器 `deleter(ptr)`。
```cpp
template <typename T, typename Deleter = default_deleter<T>>
class unique_ptr
{
private:
    T *ptr;
    Deleter deleter;
    
public:
    // constructor: default
    explicit unique_ptr(T *ptr = nullptr) : ptr(ptr), deleter(Deleter()) {}

    // constructor: with custom deleter
    unique_ptr(T *ptr, Deleter d) : ptr(ptr), deleter(std::move(d)) {}
    
	// other things...
}
```

`unique_ptr` 的删除器实例由智能指针自身管理，每一份资源对应一个 `unique_ptr`， 对应一个删除器。
`shared_ptr` 的删除器由控制块管理，同一份资源只会有一个删除器。

可以发现，`unique_ptr` 的删除器与类型紧密绑定，每次创建 `unique_ptr` 时，会因为传入的删除器不同而导致本质上的类型不同。对于独享资源的情况并没有影响，但是对于共享资源的 `shared_ptr` 这种模式会造成不必要的麻烦。

{% note info %}
因此我们需要用另一种方式实现，它被称为类型擦除。

首先定义一个 `deleter_base` 纯虚类，以它为基类再定义一个 `deleter_wrapper` 类模板。我们在控制块中存放 基类（`deleter_base`） 的指针，而在构造时传入的是 派生类（`deleter_wrapper`） 的指针，通过向上转型，使得本质上类型不同的 `deleter_wrapper` 指针统一为了 `deleter_base` 指针。
{% endnote %}

这样一来我们在调用删除器时，直接通过 `deleter_base` 调用，而完全不用关心类型的问题。

`deleter_base/deleter_wrapper` 类型擦除代码示例：
```cpp
// base class for custom deleters ( type-erased )
class deleter_base
{
public:
    virtual ~deleter_base() = default;
    virtual void call(void *ptr) const = 0;
};

template <typename T, typename Deleter>
class deleter_wrapper : public deleter_base
{
private:
    Deleter deleter;
public:
    deleter_wrapper(Deleter d) : deleter(std::move(d)) {}
    void call(void *ptr) const override
    {
        deleter(static_cast<T *>(ptr));
    }
};
```
>更符合标准库的做法是作为 `control_block` 的内部类

修改后的 `control_block` 代码示例：
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

最后再修改 `shared_ptr` 中的构造函数以及资源释放逻辑的相关代码即可。
```cpp    
	// constructor: default
    explicit shared_ptr(T *p = nullptr) : cb(p ? new control_block<T>(p) : nullptr), ptr(p) {}

    // constructor: with custom deleter
    template <typename Deleter>
    shared_ptr(T *p, Deleter d) : cb(p ? new control_block<T>(p, d) : nullptr), ptr(p) {}
```


---
title: C++ 模板
date: 2025-02-24
updated: 2026-07-12
cover: cover.png
categories: C++
tags:
  - C++
  - 模板
  - 泛型编程
  - 编译期计算
---

模板将计算从运行时搬到编译期，是 C++ 泛型编程的核心。从基础的参数推导到复杂的特化与变参展开，掌握模板意味着能写出更通用、更高效的代码。

---

- 核心思想：将计算从运行时转移到编译期
- 惰性：模板只有被调用，才会被编译
- 多次编译：只要模板参数改变，就会进行一次编译

# 1. 模板参数

## 1.1 类型参数

```cpp
template <typename T = int> // 默认模板参数为 int
T add(T a, T b) {
    return a + b;
}
```

## 1.2 非类型参数

```cpp
template <int N = 0> // 默认模板参数为 0
int arrSum(int (&arr)[N]) {
    int sum = 0;
    for (int i = 0; i < N; ++i)
        sum += arr[i];
    return sum;
}
```

## 1.3 模板模板参数

```cpp
template <template <typename, typename> class Container, typename T>
class ContainerPrinter {
public:
void print(const Container<T, std::allocator<T>>& container) {
    for(const auto& elem : container)
        std::cout << elem << " ";
    std::cout << std::endl;
}
};
```

# 2. 模板特化

```cpp
// 原本的模板
template<typename T, typename U>
class Myclass {
public:
    void Print() {
        std::cout << "genral template" << std::endl;
    }
};
```

## 2.1 全特化

```cpp
template<>
class Myclass<int, int> {
public:
    void Print() {
        std::cout << "full specialization" << std::endl;
    }
};
```

## 2.2 偏特化

```cpp
template<typename T>
class Myclass<T, int> { 
public:
    void Print() {
        std::cout << "partial specialization" << std::endl;
    }
};
```


## 2.3 函数模板的全特化

```cpp
// 原函数模板
template <typename T, typename U>
void printValue(const T& value, U letter) {
    std::cout << "General print" << std::endl;
}
```

函数模板全特化：
```cpp
// 函数模板全特化（不推荐）
template <>
void printValue<std::string, int>(const std::string& value, int letter) {
    std::cout << "Specialized print" << std::endl;
}
```

建议使用函数重载而非函数模板的全特化：
```cpp
// 函数重载（调用优先级高于模板）
void printValue(const std::string& value, int letter) {
    std::cout << "Overload print 1" << std::endl;
}
```

函数模板没有偏特化，但是可以对模板函数重载，相当于新建了一个模板：
```cpp
template <typename T>
void printValue(const T& value, double letter) {
    std::cout << "Overload print 2" << std::endl;
}
```

# 3. 变参模板

## 3.1 参数包

```cpp
template <typename... Args>
class MyClass {};

// 参数包必须放在参数表的最后
template <typename T, typename U, typename... Args>
class MyClass<T, U, Args...> {};
```

可以通过递归方式展开参数包，也可以使用折叠表达式

```cpp
template <typename T, typename... Args>
// 利用函数参数的匹配特性来递归地展开参数包
void printAll(const T& first, const Args&... rest) {
    std::cout << first << " ";
    printAll(rest...); // 递归调用
}
```
## 3.2 折叠表达式

左折叠和右折叠的区别在于操作符的结合顺序不同，但对于大多数操作符来说，结果是相同的

```cpp
// 一元右折叠：((expr with pack) op ...)
template <typename... Args>
void printAll(const Args&... args) {
    ((std::cout << args << " "), ...); 
    std::cout << std::endl;
}

// 一元左折叠：(... op (expr with pack))
template <typename... Args>
void printAll(const Args&... args) {
    (... , (std::cout << args << " ")); 
    std::cout << std::endl;
}
```

二元折叠可以指定初始值来处理空包情况

```cpp
// 二元右折叠：((expr with pack) op ... op init)
template <typename... Args>
void printAll(const Args&... args) {
    ((std::cout << args << " "), ... , std::cout << std::endl); 
}

// 二元左折叠：(init op ... op (expr with pack))
template <typename... Args>
void printAll(const Args&... args) {
    (std::cout << ... << args) << std::endl; 
}
```

# 4. 奇异递归模板模式

CRTP（Curiously Recurring Template Pattern，奇异递归模板模式）是一种在 C++ 中常用的模板编程技巧，它通过模板继承实现代码复用和静态多态。CRTP 的核心思想是==让派生类继承自一个模板基类，并将派生类自身作为模板参数传递给基类==。

**子类调用父类的方法（通用接口），父类的方法又根据子类的类型，再调用子类的方法（具体实现）**

绕了一圈本质上还是子类调用了自己的方法，但是这样实现了代码复用和静态多态，将多个类串联在一起，在同一个框架下允许灵活扩展，同时避免了动态多态的虚函数调用开销。

## CRTP 的特点

- 优点：省去动态绑定、查询虚函数表带来的开销；通过 CRTP，基类可以获得到派生类的类型，提供各种操作，比普通的继承更加灵活；但 CRTP 基类并不会单独使用，只是作为一个模板的功能。
- 缺点：模板的通病，即影响代码的可读性。

## 使用 static_cast 转换安全吗？

我们知道，当 `static_cast` 用于类层次结构中基类（父类）和派生类（子类）之间指针或引用的转换，在进行上行转换（把派生类的指针或引用转换成基类表示）是安全的；而下行转换（把基类指针或引用转换为派生类表示）由于没有动态类型检查，所以不一定安全。

但是，==CRTP 的设计原则就是假设 Derived 会继承于 Base==。

CRTP 要求所有的派生类都应有如下形式的定义：
```cpp
class Derived1 : public Base<Derived1> {};
class Derived2 : public Base<Derived2> {};
```

而在实际使用时，我们只使用`Derived1`，`Derived2`的对象，不会直接使用`Base<Derived1>`，`Base<Derived2>`类型定义对象。这就保证了当`static_cast`被执行的时候，基类`Base<DerivedX>`的指针一定指向一个子类DerivedX的对象，因此转换是安全的。

代码示例：
```cpp
#include <iostream>
// 基类模板
template <typename T>
class Base {
public:
    void interface() {
        // 调用派生类的实现
        static_cast<T*>(this)->implementation();
    }
};

// 派生类 1
class Derived1 : public Base<Derived1> {
public:
    void implementation() {
        std::cout << "Derived1 implementation" << std::endl;
    }
};

// 派生类 2
class Derived2 : public Base<Derived2> {
public:
    void implementation() {
        std::cout << "Derived2 implementation" << std::endl;
    }
};

int main() {
    Derived1 d1;
    d1.interface(); // 输出 "Derived1 implementation"

    Derived2 d2;
    d2.interface(); // 输出 "Derived2 implementation"

    return 0;
}
```

# 5. SFINAE 机制

有时会遇到某个输入可同时匹配多个模板，从而导致编译失败的情况，这时可以利用 SFINAE 机制来解决。

==核心理念：替换失败不是错误==

编译器在尝试推导模板参数时，发现某个参数不存在，就会发生“替换失败”：
- 如果发生在**函数体内**，会导致编译失败（硬错误）
- 如果发生在**函数签名/模板参数列表**，编译器会静默移除该候选函数（SFINAE 生效）

## `enable_if`

`enable_if` 本身是一个类模板，它的定义大致如下：
```cpp
// enable_if 主模板（当第一个模板参数为 false 时，没有定义 type 成员）
template<bool B, typename T = void>
struct enable_if {};

// enable_if 偏特化模板（当第一个模板参数参数为 true 时，定义 type 成员）
template<typename T>
struct enable_if<true, T> {
    using type = T;
};
```

我们可以用条件表达式替换 `enable_if` 的第一个模板参数 `bool B`，从而决定 `type` 成员是否存在，是否触发 SFINAE 机制。

具体使用示例如下：
```cpp
// make_unique - object
template <typename T, typename... Args,
          typename std::enable_if<!std::is_array<T>::value, int>::type = 0>
unique_ptr<T> make_unique(Args &&...args) {
    return unique_ptr<T>(new T(std::forward<Args>(args)...));
}

// make_unique - array
template <typename T,
          typename std::enable_if<std::is_array<T>::value, int>::type = 0>
unique_ptr<T> make_unique(size_t size) {
    return unique_ptr<T>(new T[size]());
}
```

其中 `std::is_array` 是一个类型特征模板，它用于判断给定的类型是否为数组类型。

`std::is_array<T>::value` 会在编译期返回一个布尔值：
- 如果 `T` 是数组类型，则返回 `true`
- 如果 `T` 不是数组类型，则返回 `false`

加上 `::type = 0` 是给这个模板参数一个默认值，让调用者在使用 `make_unique` 时不需要显式传递这个参数。

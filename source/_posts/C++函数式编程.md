---
title: C++ 函数式编程
date: 2025-03-09
updated: 2026-07-05
cover: cover.png
categories: C++
tags:
  - C++
  - 函数式编程
  - 回调函数
---

函数不再只是一段代码，也可以是一个对象、一个参数、一个返回值。C++ 为函数式风格提供了完整的工具箱：从重载 operator() 的仿函数，到灵活捕获上下文的 Lambda，再到通用的 std::function 包装器。

---
# 1. 仿函数（函数对象/函数类）

一个重载了括号运算符()的类，大概就是这样 operator()(参数列表){函数体...}
其对象可以像正常函数一样被调用，例如 object(2)
它的对象也可以被叫做仿函数
# 2. `Lambda` 表达式

也可以叫做**匿名函数**，形如 `[捕获区间](参数列表)->{函数体...}`

# 3. `std::function`

函数包装器，用于储存函数，从而避免直接使用函数指针

使用 `function` 模板时需要函数签名的一部分，即函数类型（形如 `int(int, int)`）
```cpp
#include <functional>

function<int(int, int)> f1 = add; // 存储普通函数
function<int(int, int)> f2 = Multiply(); // 存储仿函数
function<int(int, int)> f3 = [](int a, int b) { return a - b; }; // 存储Lambda表达式
```

# 4. `bind()`
用于固定一个可调用对象的部分参数，从而创建一个新的可调用对象
对于一般函数而言：
```cpp
auto addFive = bind(add, 5, placeholder::_1) // 固定add函数的第一个参数为5
```

成员函数有一个**隐含参数**：`this` 指针
因此，当绑定成员函数时，**第一个参数必须是指向对象的指针（或引用）**

```cpp
std::bind(&ProgramA::FunA2, &PA)
```

# 5. 回调函数

在C++中，回调函数（callback）就是可以被其他函数作为参数进行传递的函数。

回调函数可以是普通函数、静态成员函数或非静态成员函数。

回调函数的用处：
1. 代码解耦：通过改变传入的回调函数，让通用的代码能够处理特定的逻辑
2. 异步任务：回调函数作为异步任务的入口点
3. 事件响应机制：当事件触发时，自动调用回调函数处理相关逻辑
## 5.1 普通函数作为回调函数

```cpp
#include <iostream>

void programA_FunA1() {
	printf("I'am ProgramA_FunA1 and be called..\n");
}

void programA_FunA2() {
	printf("I'am ProgramA_FunA2 and be called..\n");
}

void programB_FunB1(void (*callback)()) { // 直接传入函数指针
	printf("I'am programB_FunB1 and be called..\n");
	callback();
}

int main(int argc, char **argv) {
	programA_FunA1();
	programB_FunB1(programA_FunA2);
}
```

在这个例子中，`programB_FunB1` 函数接受一个函数指针作为参数，并在其内部调用该回调函数
## 5.2 类的静态成员函数作为回调函数

```cpp
#include <iostream>

class ProgramA {
public:
	void FunA1() {
		printf("I'am ProgramA.FunA1() and be called..\n");
	}
	static void FunA2() {
		printf("I'am ProgramA.FunA2() and be called..\n");
	}
};

class ProgramB {
public:
	void FunB1(void (*callback)()) { // 直接传入函数指针
		printf("I'am ProgramB.FunB1() and be called..\n");
		callback();
	}
};

int main(int argc, char **argv) {
	ProgramA PA;
	PA.FunA1();
	
	ProgramB PB;
	PB.FunB1(ProgramA::FunA2);
}
```

静态成员函数的一个限制是它们**不能访问非静态成员变量或函数**

## 5.3 类的非静态成员函数作为回调函数

非静态成员函数作为回调函数需要一些额外的处理，因为它们**需要一个对象实例来调用**
```cpp
#include <iostream>

class ProgramA {
public:
	void FunA1() {
		printf("I'am ProgramA.FunA1() and be called..\n");
	}
	void FunA2() {
		printf("I'am ProgramA.FunA2() and be called..\n");
	}
};

class ProgramB {
public:
	void FunB1(void (ProgramA::*callback)(), void *context) { // 同时传入函数指针和类对象
		printf("I'am ProgramB.FunB1() and be called..\n");
		((ProgramA *)context->*callback)();
	}
};

int main(int argc, char **argv) {
	ProgramA PA;
	PA.FunA1();
	
	ProgramB PB;
	PB.FunB1(&ProgramA::FunA2, &PA);
}
```

这种方法虽然有效，但在某些情况下可能不够灵活
使用`std::function`和`std::bind`

为了更灵活地使用回调函数，可以使用`std::function`和`std::bind`：

```cpp
#include <iostream>
#include <functional>

class ProgramA {
public:
	void FunA1() {
		printf("I'am ProgramA.FunA1() and be called..\n");
	}
	void FunA2() {
		printf("I'am ProgramA.FunA2() and be called..\n");
	}
	static void FunA3() {
		printf("I'am ProgramA.FunA3() and be called..\n");
	}
};

class ProgramB {
	typedef std::function<void()> CallbackFun;
public:
	void FunB1(CallbackFun callback) { // 然后直接传可调用对象名即可
		printf("I'am ProgramB.FunB2() and be called..\n");
		callback();
	}
};

void normFun() {
	printf("I'am normFun() and be called..\n");
}

int main(int argc, char **argv) {
	ProgramA PA;
	PA.FunA1();
	
	ProgramB PB;
	PB.FunB1(normFun);
	PB.FunB1(ProgramA::FunA3);
	PB.FunB1(std::bind(&ProgramA::FunA2, &PA)); // 先经过bind获取一个处理过的可调用对象
}
```


# 6. 注意事项
## 6.1 函数名退化为指针

我们用函数名调用函数，实际上函数名会先隐式转换为指针；
以及当我们用函数名作为参数传参时，函数名会自动退化为指针。

## 6.2 类的非静态成员不可省略取地址符

非静态成员函数指针的类型和普通函数指针完全不同：

- 普通函数指针：`void (*)(int)`
- 成员函数指针：`void (MyClass::*)(int)`

成员函数指针需要额外的信息来处理 `this` 指针和可能的虚函数调用机制，所以C++标准规定必须显式使用 `&` 来获取。
**只有非静态成员函数**在取地址时必须显式使用 `&`，而静态成员函数和普通函数可以省略 `&`

```cpp
void (MyClass::*ptr1)(int) = &MyClass::func; // 非静态成员函数，不可省略 &
void (*ptr2)(int) = MyClass::staticFunc; // 静态成员函数，可省略 &
void (*ptr3)(int) = normalFunc; // 普通函数，可省略 &
```
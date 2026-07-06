---
title: C++ 继承与多态
date: 2025-02-03
updated: 2026-07-05
cover: cover.png
categories: C++
tags:
  - C++
  - 继承
  - 多态
  - 虚函数
  - 面向对象
---

继承与多态是 C++ 面向对象编程的基石，从三种继承方式的访问控制，到虚函数表与运行时类型识别，这些机制共同支撑起代码复用与动态派发。

---

# C++继承

派生类继承基类的全部或部分特征，实现代码复用，减少冗余

---

## 三种继承方式

- public 继承：基类的 `public` 仍为 `public`，`protected` 仍为 `protected`，`private` 不可访问。
- protected 继承：基类的 `public` 和 `protected` 成员在派生类中都变为 `protected`。
- private 继承：基类的 `public` 和 `protected` 成员在派生类中都变为 `private`。
  
继承的一些特点：

- 派生类继承自基类，拥有基类的所有的成员；所以在构造派生类前，要先构造基类
- 子类不能直接访问父类的私有成员，但这些私有成员在子类对象中仍然是存在的。这些私有成员在父类的构造函数中被初始化，并在子类对象中占据一定的内存空间

```C++
#include <iostream>

class Base {
public:
    int i;
protected:
    int j;
private:
    int k;
};

class Derived1 : public Base {
    int getI() { return i; }
    int getJ() { return j; }
    // int getK() { return k; } // 错误，Derived1不能访问Base的private成员
};

class Derived2 : protected Base {
    int getI() { return i; }
    int getJ() { return j; }
    // int getK() { return k; } // 错误，Derived1不能访问Base的private成员
};

class Derived3 : private Base {
    int getI() { return i; }
    int getJ() { return j; }
    // int getK() { return k; } // 错误，Derived1不能访问Base的private成员
};

int main() {
    Derived1 d1;
    d1.i = 10;
    // d1.j = 20; // 错误，j是protected成员，不能通过Derived1的对象访问
    // d1.k = 30; // 错误，k是private成员，不能通过Derived1的对象访问

    Derived2 d2;
    // d2.i = 10; // 错误，i是protected成员，不能通过Derived2的对象访问
    // d2.j = 20; // 错误，j是protected成员，不能通过Derived2的对象访问
    // d2.k = 30; // 错误，k是private成员，不能通过Derived2的对象访问

    Derived3 d3;
    // d3.i = 10; // 错误，i是private成员，不能通过Derived3的对象访问
    // d3.j = 20; // 错误，j是private成员，不能通过Derived3的对象访问
    // d3.k = 30; // 错误，k是private成员，不能通过Derived3的对象访问
}
```

---

## 向上转型

将子类类型的指针或引用转换成基类类型的指针或引用

- 向上转型**不会丢失已有属性和方法**，但**只能访问基类中定义的成员**
    - 类型信息决定了访问权限，出于类型安全，编译器只允许你访问基类中定义的成员
- 向上转型是**安全的**、**隐式进行的**
- 如果要调用子类中特有的成员，需要再进行**向下转型**（可能导致未定义行为，需要自行甄别）

**向上转型基本示例**

```C++
#include <iostream>

class Base {
public:
    void function_b() { std::cout << "function_b is called.\n"; }
};

class Derived : public Base {
public:
    void function_d() { std::cout << "function_d is called.\n"; }
};

int main() {
    Derived d;
    
    // 向上转型：子类对象 → 基类指针
    Base* b = &d;
    b->function_b();        // ✅ 可以访问基类成员
    // b->function_d();     // ❌ 错误：编译器在基类中没有找到 function_d()

    return 0;
}
```

**向上转型+虚函数（多态）**

```C++
#include <iostream>

class Base {
public:
    virtual void function() { std::cout << "function in Base is called.\n"; }
};

class Derived1 : public Base {
public:
    void function() { std::cout << "function in Derived1 is called.\n"; }
};

class Derived2 : public Base {
public:
    void function() { std::cout << "function in Derived2 is called.\n"; }
};

int main() {
    Derived1 d1;
    Derived2 d2;
    
    // 向上转型：子类对象 → 基类指针
    Base* b = &d1;
    b->function();        // ✅ 调用子类 Derived 的 function()（多态）
    
    //若运行时 b 的实际类型变为 Derived2
    b = &d2;
    b->function();        // ✅ 调用子类 Derived2 的 function()（具体调用取决于运行时）

    return 0;
}
```

为什么加上虚函数之后，向上转型的基类指针就可以调用子类的方法了呢？

这就涉及到了虚函数的实现原理：只要声明了虚函数，这个类就会创建一个虚函数表（vtable）；子类继承了基类的虚函数，所以也会对应创建一个虚函数表；虚函数表中存放的是虚函数地址；当我们创建子类对象时，会隐式创建一个虚指针（vptr）；当程序运行时，通过这个指针，就可以根据实际类型（即Derived）从表中找到对应的虚函数地址（&Derived::function），从而实现对子类方法的调用。

父类调用子类的方法依赖的是虚函数表和虚指针，而子类调用父类方法依靠的是继承机制，子类是直接拥有父类的方法的

---

## 隐藏

- 在派生类中定义一个与基类中的成员函数同名的函数，它不会进行**重载**，而是会直接将基类的同名函数**隐藏**。
    

```C++
#include <iostream>

class Base {
public:
    void function() { printf("function in Base is called.\n"); }
    void Print(int a) { printf("%d\n", a); }
};

class Derived : public Base {
public:
    void function() { printf("function in Derived is called.\n"); }
    void Print(double a) { printf("%0.2f\n", a); }
};

int main() {
    Derived d;
    d.function(); // fucntion in Derived is called. 调用的是 Derived 的 function
    d.Print(1.0); // 1.00 调用的是 Derived 的 Print
    d.Print(1);   // 1.00 调用的是 Derived 的 Print，说明 Base 的 Print 没有构成重载而是被隐藏

    d.Base::function(); // fucntion in Base is called. 调用的是 Base 的 function
    d.Base::Print(1);   // 1 调用的是 Base 的 Print
}
```

### 作用域

- 每个类、命名空间、函数等都会定义**一个新的作用域（scope）**
- 在 C++ 中，名称查找是 **逐层向外查找的**（从当前作用域往上）， 一旦在某一层找到了**同名标识符**，查找就**停止**，不会再去上层作用域，这就是所谓的隐藏
- 如果需要**访问被隐藏的成员**，可以通过加上**作用域限定符（ 类名::）** 进行限定

```C++
Global scope
 ├── Base::scope
 │     ├── function()
 │     └── Print(int)
 └── Derived::scope
       ├── function()
       └── Print(double)
```

- 如果想要实现重载也不是不行，只要在继承类中使用 `using` 引入基类的作用域即可

```C++
#include <iostream>

class Base {
public:
    void function() { printf("function in Base is called.\n"); }
    void Print(int a) { printf("%d\n", a); }
};

class Derived : public Base {
public:
    using Base::Print; // 引入 Base 作用域 中的 Print
    void function() { printf("function in Derived is called.\n"); }
    void Print(double a) { printf("%0.2f\n", a); }
};

int main() {
    Derived d;
    d.Print(1.0); // 1.00 调用的是 Derived 的 Print
    d.Print(1);   // 1 调用的是 Base 的 Print，说明函数成功进行了重载
}
```

---

## 多继承问题

C++允许**一个类继承多个基类**，这使得类可以更加复杂多样，但同时也可能带来问题。

```C++
#include <iostream>

class Base1 {
public:
    int i;
};

class Base2 {
public:
    int j;
};

class Derived : public Base1, public Base2 {
};

int main() {
    Derived d;
    d.i = 10; // 访问 Base1 的成员
    d.j = 20; // 访问 Base2 的成员
}
```

### **多继承导致的重名问题**

- 如果继承的多个基类存在同名的成员
- 而且子类中也没有同名成员对基类成员进行隐藏
- 那么直接访问就会导致目标不明确的报错

```C++
#include <iostream>

class Base1 {
public:
    int i;
};

class Base2 {
public:
    int i;
};

class Derived : public Base1, public Base2 {
};

int main() {
    Derived d;
    // d.i = 10;        // ❌ 错误：目标不明确
    
    d.Base1::i = 10;    // ✅ 解决方案：添加作用域限定符
    d.Base2::i = 20;
}
```

### **菱形继承问题**

```C++
形如：

   A  
  / \  
 B   C 
  \ /   
   D 
   
D 继承 B 和 C，而 B 和 C 又同时继承 A
```

```C++
#include <iostream>

class A {
public:
    int value;
};

class B : public A { 
};

class C : public A {
};

class D : public B, public C {
};

int main() {
    D d;

    // d.value = 3; // 错误：二义性/目标不明确，D 中有两份来自 A 的 value
    d.B::value = 1;
    d.C::value = 2;
    
    // 可见 d 中存在两份 value，它们可以彼此独立赋值
    std::cout << d.B::value << std::endl; // 输出 1
    std::cout << d.C::value << std::endl; // 输出 2
}
```

- 数据成员的二义性：如果基类A有一个数据成员，那么在最终的派生类D中，这个数据成员会有多个潜在的访问路径；这会导致编译错误，因为编译器不知道应该使用哪个路径
- 由于最终派生类通过多条路径继承了同一个基类，因此基类的数据成员在最终派生类中会有**多个拷贝**；这不仅增加了内存使用，还可能导致数据不一致的问题

---

## 虚继承

为了解决多继承问题，C++引入了虚继承这一概念，它的主要目的是在多继承中避免数据冗余和二义性问题。

```C++
#include <iostream>

class A {
public:
    int value;
};

class B : virtual public A { 
};

class C : virtual public A {
};

class D : public B, public C {
};

int main() {
    D d;
    
    d.value = 1; // 成功，现在只有一份 value
}
```

---

## 虚基类的实现原理

> 不同编译器对虚继承与虚函数的实现有所差别，但原理类似。

C++规定，当使用虚继承时，将基类的构造交给最派生类（最后一个派生类）负责，由最派生类的构造函数调用基类的构造函数。

**构造顺序**：

- 首先由D的构造函数直接调用A的构造函数，唯一构造虚基类A；
- 再按照声明顺序依次构造 B、C
- 最后构造D自身

**普通继承时构造函数的调用顺序**

```TypeScript
class A {
public:
    A() { std::cout << "A "; }
};

class B : public A {
public:
    B() { std::cout << "B "; }
};

class C : public A {
public:
    C() { std::cout << "C "; }
};

class D : public B, public C {
public:
    D() { std::cout << "D "; }
};

int main() { D d; } // 调用顺序为 A B A C D
```

**虚继承时构造函数的调用顺序**

```TypeScript
class A {
public:
    A() { std::cout << "A "; }
};

class B : virtual public A {
public:
    B() { std::cout << "B "; }
};

class C : virtual public A {
public:
    C() { std::cout << "C "; }
};

class D : public B, public C {
public:
    D() { std::cout << "D "; }
};

int main() { D d; } // 调用顺序为 A B C D
```

> 不同编译器对于虚继承的实现差别在于**运行时如何找到虚基类的位置**？

### 虚基类表（MSVC）

- 每个包含虚继承的类（即使自身没有虚函数）的对象中，额外插入一个指针（称为 `vbptr`，virtual base pointer）。
- `vbptr` 指向一个静态常量数组，即 虚基类表（`vbtable`）。
- `vbtable` 本质上是一个 偏移量表（offset table），其中每一项表示 从当前**子对象**（包含 `vbptr` 的对象）到某个虚基类子对象的字节偏移（以当前对象地址为基准）。

✅ 优点：访问速度快（一次查表）
❌ 缺点：每个对象多一个指针，内存开销大

|   |   |   |
|---|---|---|
|0x00|vbptr(8 字节)|指向D的vbtable（包含到A的偏移）|
|0x08|b(4 字节)|B的成员|
|0x0C|（填充 4 字节）|对齐|
|0x10|c(4 字节)|C的成员|
|0x14|（填充 4 字节）|对齐|
|0x18|d(4 字节)|D的成员|
|0x1C|（填充 4 字节）|对齐|
|0x20|a (4 字节)|共享的虚基类 A 子对象|
|0x24|（填充 4 字节）|总大小对齐到 8 的倍数|

什么是子对象？

子对象指的是一个对象内部所包含的、属于其基类或非静态数据成员的组成部分。换句话说，任何对象都可以由多个“子对象”构成，这些子对象在内存中是该对象的一部分
  

### 运行时偏移运算（GCC/Clang）

- 不引入额外指针（无 vbptr）；
    
- 虚基类的位置通过 编译期计算 + 构造时修正 确定；
    - 关键数据，如虚基类**偏移量**`vbase offset`，嵌入在虚表中（仅当类有虚函数时，如果没有虚函数就没有虚表）；且`Vbase offset` 只会保存在最派生类（如 `D`）的 vtable 中
    
    > 因为虚基类 `A` 的实际位置由最派生类决定（构造），只有最派生类知道“共享 `A` 到底在哪”
    - 若 没有虚函数，则通过 固定的对象布局偏移 访问虚基类（偏移在编译期确定）。

> “固定的对象布局偏移” 不是变量，也不是运行时存储的数据，而是编译期确定、直接硬编码在机器指令中的常量

✅ 优点：无额外指针
❌ 缺点：访问虚基类可能需更多计算（尤其在无虚函数时）

  

1. 无虚函数的情况

|   |   |   |
|---|---|---|
|0x00|`b`(4)|`B`的成员|
|0x04|`c`(4)|`C`的成员|
|0x08|`d`(4)|`D`的成员|
|0x0C|（填充 4）|为`A`对齐到 8 字节边界|
|0x10|`a` (4)|共享的 `A` 子对象|
|0x14|（填充 4）|总大小 = 24 字节（0x18）→ 对齐到 8 的倍数|

2. 有虚函数的情况

|   |   |   |
|---|---|---|
|0x00|`vptr`(8)|指向`D` 的 vtable（包含`A`的 vbase offset）|
|0x08|`b`(4)|`B`的成员|
|0x0C|`c`(4)|`C`的成员|
|0x10|`d`(4)|`D`的成员|
|0x14|（填充 4）|对齐到 8 字节边界|
|0x18|`a` (4)|共享的虚基类 `A` 子对象|
|0x1C|（填充 4）|总大小对齐|

---

# C++多态

所谓多态就是让相同类型的对象在不同情况下表现出不同的行为。

可分为编译时多态和运行时多态，本部分主要讨论的是通过虚函数实现的**运行时多态**。

  

静态绑定：在**编译时**就确定要调用的方法或属性

动态绑定：在**运行时**才根据对象的实际类型决定要调用的方法

  

编译时多态：函数重载，模板

运行时多态：虚函数

---

## 虚函数

为了实现运行时多态，C++引入了虚函数。

- 在基类中使用virtual关键字声明成员函数，这样它就会允许派生类对该函数进行重写（而非隐藏）。
- 虚函数的调用是动态绑定的，这意味着虚函数的调用是在运行时决定，而不是在编译时确定。
- 为了实现多态，往往需要搭配基类引用/指针和向上转型。

```C++
#include <iostream>

class Base {
public:
    virtual void function() { std::cout << "function in Base is called"; }  
};

class Derived : public Base {
public:
    void function() { std::cout << "function in Derived is called"; }
};

int main() {
    Derived d;
    d.function(); // 调用 Derived 的 function
    d.Base::function(); // 调用 Base 的 function
    
    // 体现多态
    Base* bPtr = &d;
    bPtr->function(); // 调用 Derived 的 function
}
```

重载与重写有什么区别？

**重载（Overload）** 是静态绑定，函数调用在编译时根据参数类型决定； **重写（Override）** 是动态绑定，函数调用在运行时根据对象的实际类型决定。

---

## 纯虚函数与抽象类

只需要在函数声明时，在形参列表后面加上"=0"即可将一个虚函数声明为纯虚函数。

- 只要一个类中含有纯虚函数，那么这个类就会被定义为抽象类（abstract class）
- 如果一个类中只有纯虚函数，那么这个类也可以被叫做纯抽象类（pure abstract class）

> 纯抽象类和抽象类没有本质区别，只是在分类上给这种特殊情况特地取了一个名字
  
- 抽象类不能用来实例化对象，它只用于提供一个标准化的接口给派生类
- 如果一个类继承自一个抽象类,但是本身依然没有实现那个纯虚函数,则这个派生类依然是一个抽象类
- 所以纯虚函数一旦被定义就必须在最终子类中被实现

```C++
#include <iostream>

class Base {
public:
    virtual void function() = 0; // 纯虚函数最终必须被实现
};

class Derived1 : public Base {
public:
    void function()  { std::cout << ("function in Derived1 is called.\n"); }
};

class Derived2 : public Base {
public:
    void function()  { std::cout << ("function in Derived2 is called.\n"); }
};

int main() {
    Derived1 d1;
    d1.function(); // 调用 Derived1 的 function
    Derived2 d2;
    d2.function(); // 调用 Derived2 的 function
}
```

- 纯虚函数只能作为**接口**使用，并不能用于创建对象。
- 在具体使用中，我们经常通过定义纯虚函数来构建抽象类/接口，以此来定义接口规范，也就是告诉所有派生类必须要实现哪些功能。

---

## 虚函数表（虚函数的实现原理）

虚函数的实现原理主要依赖于**虚函数表（vtable）**和**虚指针（vptr）**

- 当编译器看到一个类中定义了虚函数时，它会：
    - 为该类生成一张 虚函数表（vtable）
    - 为该类的对象添加一个隐藏的 虚指针（vptr）
    - 记录所有虚函数的地址到 vtable 中
- 当子类继承基类：
    - 子类的虚表会**复制基类虚表的布局**
    - 如果子类重写了某个虚函数，则该条目在表中被替换为子类函数地址
    - 没有重写的条目保持基类的函数指针


**每个类有自己的一份 vtable**，子类会在基类 vtable 的基础上进行“复制 + 修改 + 扩展”

  如果有三个类的继承关系是A->B->C，我在B中新定义了一个虚函数（A中没有相关定义），那么A的虚指针会找不到该虚函数，因为A的 vtable 中并没有该虚函数的地址。

**一个对象可能不止有一个 vptr**，包含虚函数的每个类的构造函数都会构造出一个对应部分的 vptr

调用时使用哪个 `vptr`，取决于当前指针或引用的静态类型（也就是“声明类型”）； 而每个 `vptr` 在对象构造期间，都会被初始化为指向“实际动态类型”的对应虚函数表区域。

---

## 虚析构

构造函数不能定义为虚函数，但是析构函数可以，且十分必要。

- 简单来说，就是编译器只会根据声明类型来调用相应的析构函数，这会导致实际的内存空间没有被完全释放；而通过给析构函数加上virtual关键字，**让析构函数也实现多态**，就可以按照实际类型调用相应的析构函数了。
- 析构函数在虚函数表中**被视为“同名的可覆盖函数”**

```C++
class Base {
public:
    // virtual Base(); // 不允许
    virtual ~Base();
    virtual void function() { std::cout << "function in Base is called"; } 
};

class Derived : public Base {
public:
    ~Derived // 继承基类，自动成为虚函数；如果没有需要手动释放的资源，也可以直接省略
    void function() { std::cout << "function in Derived is called"; }
};
```

为什么构造函数不能定义为虚函数？

虚指针的初始化依赖于构造函数，而虚函数的实现又依赖虚指针；左脚踩右脚了属于是，简单来说就是先得有构造函数，才会有虚函数。

---

# 其他问题

## static_cast与dynamic_cast（了解）

- `satic_cast`：在编译时进行类型转换，可用于基本类型和类层次结构中父类和子类之间的指针或引用转换
    
    - 但在从父类到子类的转换时（下行转换），由于没有运行时检查，若父类对象从未调用过子类对应的构造函数，由于缺少子类中相应内容的定义，从而造成未定义行为。
    - 为了解决这一问题，我们可以自己设置一个 `flag` 变量，用于标记某个对象是否调用了子类的构造函数。
    - 但实际上，解决上述问题还有更方便的方法，即利用多态类（即有虚函数的类）自动定义的 `std::type_info` 标签，通过这个标签可以得知某个对象是由哪些构造函数构造的，从而判断是否可以进行类型转换。
    
- `dynamic_cast`：由于上述的这个操作十分常用，官方索性帮我们封装了起来。`dynamic_cast`如果转换失败，会返回 `nullptr`（指针）或抛出异常（引用）

- `static_cast`：
    
    - 是 C++ 风格的显式类型转换操作符之一。
    - 在编译期进行类型检查，只允许相关类型之间的合理转换（如数值类型之间、继承层次间的向上/向下转换等）。
    - 不允许去除 `const`/`volatile`，也不能将无关指针类型互转（例如 `int*` 转 `char*`）。
    
- C 风格强转 (int)value ：
    
    - 等价于尝试按顺序使用 `static_cast`、`const_cast`、`reinterpret_cast`，直到某一个成功为止。
    - 绕过类型系统，几乎可以强制转换任意类型，非常危险。
    - 编译器检查极弱，容易引入未定义行为（UB）。
---
title: 在 C++ 中实现委托与事件
date: 2026-01-18
updated: 2026-07-07
cover: cover.png
categories: C++
tags:
  - C++
  - 委托
  - 事件
  - 观察者模式
  - 发布订阅模式
---

C++ 并没有提供委托与事件的官方实现，但借助已有的特性，我们可以仿照 C# 的委托与事件来实现类似的功能。

---

# 0. 前置知识
## 函数签名

```
返回类型 函数名(参数类型1, 参数类型2, ...)
```
例如以下 `add` 函数：
```cpp
int add(int a, int b);
```
他的函数签名是 `int(int, int)`。

## 函数指针

函数指针的定义与普通指针类似，但需要指定函数的返回类型和参数列表，也就是函数签名。
设计一个指针指向 `add`，然后可以通过它调用函数：
```cpp
int (*fp)(int, int) = add;
fp(10, 20);
```

在C++中我们可以使用 `using` 简化函数指针的定义：
```cpp
using FuncPtr = int(*)(double, double);
FuncPtr fp;
```

## `std::function`

`std::function` 是一个模板类，其模板参数是函数签名。
例如，存储一个返回 `int` 的无参函数，可以这样定义：
```cpp
std::function<int()> myFunction;
```

`std::function` 用于封装一个可调用对象，以一种通用的方式来存储和调用这些对象。
可封装的可调用对象包括：
- 普通函数
- Lambda 表达式
- 函数指针
- 函数对象（仿函数）

## `std::bind`

`std::bind` 用于将一个可调用对象与一些参数进行绑定，并返回一个新的可调用对象。
```cpp
std::bind(Callable&& f, Args&&... args)
```
例如可以将 `printSum` 函数的第二个参数绑定为 10：
```cpp
void printSum(int a, int b) { 
	std::cout << "Sum: " << a + b << std::endl; 
}

auto bf = std::bind(printSum, std::placeholders::_1, 10)
```
`printSum` 的参数 b 被绑定为10，相当于 `bf` 只有一个参数 a。
绑定后新的可调用对象 `bf` 的类型用 `std::function` 表示的话就是：
```cpp
std::funtion<void(int)> 
```

## 回调机制

在 C++ 中回调机制允许将一个函数作为参数传递给另一个函数。这样当某个事件发生时，可以通过回调函数来处理它。回调函数通常用于异步操作、事件驱动、处理完成后的动作等场景，例如：
```cpp
using Callback = void(*)(int);

// 接受回调函数作为参数的函数
void processData(int value, Callback callback) {
	cout << value << endl;
	callback(value);
}

// 实际的回调函数
void onDataProcessed(int value) { cout << "This is a callback" << endl;}

int main() {
	processData(10, onDataProcessed);
}
```

# 1. 委托与事件

## 1.1 委托 Delegate

委托其实就是一种类型安全的函数指针，用于封装一个或多个方法。
可以将其理解为一个装有方法的盒子，当需要时可以直接调用这个盒子，从而实现方法创建者和调用者的解耦。
在 C++ 中并没有原生的委托机制，需要我们自己通过 `std::function` 来实现。

>单播 / 多播解决的是“调用数量问题”
### 1.1.1 单播委托

```cpp
class Enemy {
public:
    void taunt() {
        std::cout << "Enemy roars!\n";
        if (onTaunt) onTaunt();
    }
    
    // 单播委托
    std::function<void()> onTaunt;
};

void callback() {
    std::cout << "Enemy taunt handled\n";
}

int main() {
    Enemy e;
    e.onTaunt = callback;
    e.taunt();
    return 0;
}
```

### 1.1.2 多播委托

```cpp
// 多播委托
class TauntDelegate {
public:
    using Callback = std::function<void()>;
    
    void add(Callback cb) {
        callbacks.push_back(cb);
    }
    
    void invoke() {
        for (auto& cb : callbacks) {
	        cb();
	    }
    }
private:
    std::vector<Callback> callbacks;
};

void callback1() {
	std::cout << "1 handled\n";
}

void callback2() {
	std::cout << "2 handled\n";
}

class Enemy {
public:
	void taunt() {
		std::cout << "Enemy roars!\n";
		onTaunt.invoke();
	}
	
	// 多播委托
	TauntDelegate onTaunt;
};

int main() {
	Enemy e;
	e.onTaunt.add(callback1);
	e.onTaunt.add(callback2);
	e.taunt();
	// e.onTaunt.invoke() 可以直接被外部调用，存在风险
	return 0;
}

```
## 1.2 事件 Event

事件是一个特殊化的委托，它限制了如何使用委托。
一个对象的委托往往是直接暴露在外部的，这就导致我们可以在对象外直接调用它的委托。举个例子：一个Enemy对象调用战吼函数，进而调用用于处理战吼之后各种变化的委托，这是正常的。但是我们实际上可以在任何地方调用该委托，即使没有“调用战吼函数”这一前提，这就导致不规范的问题。

>委托 / 事件解决的是“调用权限与语义问题”
```cpp
// 事件
class TauntEvent {
public:
    using Callback = std::function<void()>;
    
	// 外部只能订阅
    void addListener(Callback cb) {
        listeners.push_back(cb);
    }
private:
	// 只有 Enemy 可以触发
    void broadcast() {
        for (auto& cb : listeners) {
            cb();
        }
    }
    
    std::vector<Callback> listeners;
    friend class Enemy; // 授权 Enemy
};

class Enemy {
public:
	void addTauntListener(TauntEvent::Callback cb) {
        onTaunt.addListener(cb);
    }

    void taunt() {
        std::cout << "Enemy roars!\n";
        onTaunt.broadcast();
    }
private:
	// 事件
	TauntEvent onTaunt;
};

void callback1() {
	std::cout << "1 handled\n";
}

void callback2() {
	std::cout << "2 handled\n";
}

int main() {
    Enemy e;
    e.addTauntListener(callback1);
    e.addTauntListener(callback2);
    e.taunt();
    return 0;
}
```

以上的 `callback` 完全可以是其他类对象的接口函数，从而实现其他对象对该事件的监听与更新。

# 2. 观察者模式

一个对象状态变化时，自动通知所有依赖它的对象。
观察者模式是一种行为模式，他没有固定的实现方式，只要是能够实现一对一或一对多的状态更新与同步，就可以算是一种观察者模式的实现。
观察者模式的一个特点是==**被观察者**直接持有**观察者**的实例/回调（如 `std::function`、函数指针、接口指针等）==，也就是被观察者“知道有谁在观察自己”。

1. 最经典的实现方式当属**接口+多态**，这种实现方式的问题是接口继承导致的**强耦合**：
```cpp
// 1. 定义观察者接口
class ITauntObserver {
public:
    virtual ~ITauntObserver() = default;
    virtual void onEnemyTaunt() = 0;
};

// 2. 被观察者
class Enemy {
    std::vector<ITauntObserver*> observers;
public:
    void addObserver(ITauntObserver* obs) {
        observers.push_back(obs);
    }

    void taunt() {
        std::cout << "Enemy roars!\n";
        for (auto* obs : observers) {
            obs->onEnemyTaunt(); // 直接调用虚函数
        }
    }
};

// 3. 具体观察者
class SoundSystem : public ITauntObserver {
public:
    void onEnemyTaunt() override {
        std::cout << "Play roar sound\n";
    }
};

class UISystem {
public:
    void showTauntMessage() {
        std::cout << "[UI] Enemy is taunting!\n";
    }
};
```

2. 另一种实现自然就是基于**委托/事件**：
```cpp
class TauntEvent {
public:
    using Callback = std::function<void()>;

    void addListener(Callback cb) {
        listeners.push_back(std::move(cb));
    }

private:
    void notify() {
        for (auto& cb : listeners) {
            if (cb) cb(); // 直接调用
        }
    }

    std::vector<Callback> listeners;
    friend class Enemy; // 只允许 Enemy 触发
};

// 1. 被观察者
class Enemy {
    TauntEvent onTaunt;

public:
    void addTauntListener(TauntEvent::Callback cb) {
        onTaunt.addListener(cb);
    }

    void taunt() {
        std::cout << "[Enemy] Roars fiercely!\n";
        onTaunt.notify(); // 直接通知所有已知监听者
    }
};

// 2. 观察者
class SoundSystem {
public:
    void playTauntSound() {
        std::cout << "[Sound] Playing enemy roar sound\n";
    }
};

class UISystem {
public:
    void showTauntMessage() {
        std::cout << "[UI] Enemy is taunting!\n";
    }
};

int main() {
    Enemy enemy;
    SoundSystem sound;
    UISystem ui;

    // 注册监听
    enemy.addTauntListener([&sound]() { sound.playTauntSound(); });
    enemy.addTauntListener([&ui]() { ui.showTauntMessage(); });

    enemy.taunt();
    return 0;
}
```

# 3. 发布订阅模式

引入中间层，使得发布者与订阅者彻底解耦
```cpp
// 1. 全局事件总线
class EventBus {
public:
    using Callback = std::function<void()>;

    static void subscribe(const std::string& topic, Callback cb) {
        instance().subscribers[topic].push_back(std::move(cb));
    }

	static void unsubscribe

    static void publish(const std::string& topic) {
        auto& subs = instance().subscribers[topic];
        for (auto& cb : subs) {
            if (cb) cb();
        }
    }

private:
    std::unordered_map<std::string, std::vector<Callback>> subscribers;

    static EventBus& instance() {
        static EventBus bus;
        return bus;
    }
};

// 2. 发布者
class Enemy {
public:
    void taunt() {
        std::cout << "[Enemy] Roars fiercely!\n";
        EventBus::publish("enemy.taunt"); // 只发消息，不关心谁听
    }
};

// 3. 订阅者
class SoundSystem {
public:
    SoundSystem() {
        EventBus::subscribe("enemy.taunt", [this]() {
            playTauntSound();
        });
    }

    void playTauntSound() {
        std::cout << "[Sound] Playing enemy roar sound\n";
    }
};

class UISystem {
public:
    UISystem() {
        EventBus::subscribe("enemy.taunt", [this]() {
            showTauntMessage();
        });
    }

    void showTauntMessage() {
        std::cout << "[UI] Enemy is taunting!\n";
    }
};

int main() {
    // Enemy 完全不知道 SoundSystem 和 UISystem 的存在！
    Enemy enemy;
    SoundSystem sound;   // 构造时自动订阅
    UISystem ui;         // 构造时自动订阅
    enemy.taunt();
    return 0;
}
```

# 4. 其他问题
## 4.1 存回调还是存对象？

以上示例中，委托与事件的实现通常存储的是回调函数（如 `std::function`）。  
另一种做法是存储观察者对象本身（如接口指针或对象指针）。

两种方式各有取舍：
- **存回调**：更加灵活、解耦性更强，但对象生命周期难以管理，容易产生悬空引用。
- **存对象**：便于识别订阅者身份和取消订阅，但会引入接口依赖或对象耦合。

是否存对象，并不存在绝对优劣，取决于系统对**解耦性**与**生命周期可控性**的侧重。
## 4.2 如何管理一个对象的多个事件？

对于可能存在多个事件的对象，有两种常见做法：

1. **直接在对象内部定义多个事件成员**  
    适用于事件数量固定、语义明确的情况，代码直观、类型安全。
2. **引入统一的事件管理器**  
    适用于事件种类较多、需要动态扩展或按名称/ID 分发的场景，但会牺牲一定的类型安全性。

选择哪种方式，取决于系统规模和事件的稳定性。

## 4.3 如何实现订阅的取消？

- 当某个对象被销毁时，它的回调函数指针依旧存放在Enemy的列表中，可能导致悬空引用。
- 为了解决这一问题，必须让回调函数在对象销毁前被清除出列表。
在 C++ 中，如果使用 `std::function` 和 lambda 实现**委托或事件**：
- 回调对象本身没有身份
- `std::function` 不可比较
- lambda 表达式类型匿名
因此，语言层面**并不存在“取消订阅”的概念**。

实现手动“unsubscribe”：
1. 给每个加入的回调函数都加上标签/ ID（最简单）
2. 保存迭代器，让每个函数都返回迭代器，通过迭代器定位需要删除的回调函数
3. 存对象而非回调（但正如上面所说，存对象会导致耦合加强）

实现自动“unsubscribe”： 想要做到对象在销毁时自动“退订”，需要自己实现RAII机制
---
title: LangChain
date: 2026-08-18
updated: 2026-08-28
cover: /images/posts/LangChain/cover.png
categories: Tutorial
tags:
  - LangChain
  - LLM
  - LCEL
  - RAG
  - Agent
  - MCP
---

LangChain 是一个开源 agent 框架，它提供了统一的接口和工具，用于快速构建基于 LLM 的应用。

---

# 1. 模型（Model）

LangChain 封装了各厂商的 LLM 接口，同时也提供了统一的调用方式，并且支持多种调用模式（同步、异步、流式、批量）。

## 1.1 init_chat_model

`init_chat_model` 是统一入口，按 `model_provider` 适配各厂商，切换只需要改参数。

```python
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

load_dotenv(encoding='utf-8')

llm = init_chat_model(
    model="deepseek-v4-flash",
    model_provider="openai",             # 适配 OpenAI 兼容接口
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
    temperature=0.7,                      # 0~1，越高输出越随机
)
```

## 1.2 专用入口

LangChain 还提供了各厂商的专用入口（如 `OpenAIChat` / `QwenChat` / `DashscopeChat`），可直接使用厂商特有参数。

```python
from langchain.chat_models import OpenAIChat
llm = OpenAIChat(
    model="gpt-4o",
    api_key=os.getenv("OPENAI_API_KEY"),
)
```

```python
from langchain.deepseek import DeepSeekChat
llm = DeepSeekChat(
    model="deepseek-v4-flash",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)
```


## 1.3 invoke / stream / batch

`init_chat_model` 返回的是一个 `Runnable` 对象，所有 `Runnable` 对象都支持三种调用模式：

- `invoke`：等完整结果（测试/批处理）
- `stream`：逐块输出（交互场景，首字延迟低）
- `batch`：一次性处理多条输入

它们还有对应的异步版本：`ainvoke` / `astream` / `abatch`，这里暂时不做展开。

```python
# 一次性
response = llm.invoke("Who are you?")
print(response.content)
```

```python
# 流式（配合 flush=True 实时打印）
for chunk in llm.stream("请介绍一下你自己，500字以内?"):
    print(chunk.content, end="", flush=True)
```

```python
# 批量
responses = llm.batch(["你好", "hello"])
```

# 2. 提示词（Prompt）

`Prompt` 是 LLM 的输入，LangChain 提供了统一的 `Prompt` 接口，支持多种模板和格式化方式。

## 2.1 消息类型

当我们使用 `Chat` 模型时，输入的 `Prompt` 是一组消息（`Message`），消息主要分为以下三种类型：
- `SystemMessage`：系统消息，通常用于设定角色、行为规范等
- `HumanMessage`：人类消息，通常用于用户输入
- `AIMessage`：AI 消息，通常用于模型输出（多轮对话的上下文）

```python
from langchain_core.messages import SystemMessage, HumanMessage
messages = [
    SystemMessage(content="You are a helpful assistant."),
    HumanMessage(content="请介绍一下你自己，500字以内?"),
]
model.invoke(messages)
```

`ChatMessage` 是 `SystemMessage` / `HumanMessage` / `AIMessage` 的父类，使用 `role` 字段区分消息类型。
- `system`：系统消息
- `human`：人类消息
- `assistant`：AI 消息
- `tool`：工具消息（用于工具调用场景）
- `custom`：自定义消息（用于扩展场景）

```python
from langchain_core.messages import ChatMessage
messages = [
    ChatMessage(role="system", content="You are a helpful assistant."),
    ChatMessage(role="human", content="请介绍一下你自己，500字以内?"),
]
model.invoke(messages)
```

## 2.2 Prompt 模板

LangChain 提供了三种 `Prompt` 模板：

1. `PromptTemplate`

`PromptTemplate` 是最基础的 `Prompt` 模板， 它可以将一个字符串模板和一组输入变量组合成一个 `Prompt`。
- 适用于单条消息的场景
- 使用 `from_template` 方法创建 `PromptTemplate` 对象
- 使用 `format` 方法填充模板得到一个字符串，或者使用 `format_messages` 方法得到一个消息列表

```python
from langchain_core.prompts import PromptTemplate

prompt_template = PromptTemplate(
    template="请介绍一下你自己，500字以内? {user_input}",
    input_variables=["user_input"],
)

model.invoke(prompt_template.format(user_input="我想了解你的背景和能力。"))
```

2. `ChatPromptTemplate`

`ChatPromptTemplate` 的不同之处在于它可以处理多条消息，它可以将多条消息组合成一个 `Prompt`。
- 适用于多轮对话的场景
- 使用 `from_messages` 方法创建 `ChatPromptTemplate` 对象
- 使用 `format_messages` 方法填充模板得到一个消息列表，或者使用 `format` 方法得到一个字符串

```python
# ChatPromptTemplate 和 PromptTemplate 的区别：前者用于处理消息，后者用于处理文本
# 消息指的是一组有角色的文本内容，通常用于对话场景；而文本指的是单一的字符串内容，通常用于非对话场景

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate 

# from_messages 方法用于从一组消息中创建一个 ChatPromptTemplate 对象
# 相比 from_template 方法，from_messages 方法更适合处理多轮对话场景，因为它可以处理多条消息，而 from_template 方法只能处理单条消息
prompt_template = ChatPromptTemplate.from_messages([
    SystemMessage(content="You are a helpful assistant."),
    HumanMessage(content="{user_input}"),
])

# format 和 format_messages 的区别：前者返回一个字符串，后者返回一个消息列表
# 使用场景分别是：
# - format: 当你需要将模板填充为一个单一的字符串时使用
# - format_messages: 当你需要将模板填充为一组消息时使用
# 这里我们使用 format_messages，因为我们希望将模板填充为一组消息，以便传递给模型进行处理
prompt = prompt_template.format_messages(user_input="请介绍一下你自己，500字以内?")

model.invoke(prompt)
```

3. `FewShotPromptTemplate`

`FewShotPromptTemplate` 在 `PromptTemplate` 的基础上增加了示例（`examples`），你可以通过添加示例来引导模型的输出风格和内容。

```python
from langchain_core.prompts import FewShotPromptTemplate

examples = [
    {"input": "你好", "output": "你好，我是AI助手。"},
    {"input": "hello", "output": "Hello, I am an AI assistant."},
]

few_shot_prompt = FewShotPromptTemplate(
    examples=examples, # 传入示例列表
    template="根据以下示例，回答用户的问题：{input}", # 传入模板字符串
    input_variables=["input"],
)

model.invoke(few_shot_prompt.format(input="请介绍一下你自己，500字以内?"))
```

## 2.3 MessagePlaceholder

`MessagePlaceholder` 是一个特殊的 `Prompt` 模板，它可以用来表示一组消息的占位符。在实际使用中，你可以将 `MessagePlaceholder` 插入到 `ChatPromptTemplate` 中，以表示需要动态填充的消息。一般用于多轮对话的场景中，表示历史消息的占位符。

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

prompt_template = ChatPromptTemplate.from_messages([
    SystemMessage(content="You are a helpful assistant."),
    MessagesPlaceholder(variable_name="history"), # 占位符，用于在多轮对话中插入历史消息
    HumanMessage(content="{user_input}"),
])

prompt = prompt_template.format_messages(
    history=[
        HumanMessage(content="请介绍一下你自己，500字以内?"),
        SystemMessage(content="我是一个人工智能助手，专门为用户提供各种信息和帮助。"),
    ],
    user_input="你能告诉我你的功能吗？"
)

model.invoke(prompt)
```

## 2.4 序列化保存与加载

在实际应用中，有时需要将创建的 `Prompt` 模板保存下来，以便在后续使用中重复利用。LangChain 提供了序列化和反序列化功能，可以将 `Prompt` 模板保存为文件或数据库中，并在需要时加载使用。

```python
from langchain_core.prompts import save_prompt, load_prompt

save_prompt(prompt_template, "prompt_template.json") # 保存
loaded_prompt_template = load_prompt("prompt_template.json") # 加载
```

# 3. 解析器（Parser）

## 3.1 输出解析器

输出解析器用于将模型的输出解析为特定的格式，例如将文本输出解析为 JSON、Python 对象或自定义数据结构。LangChain 提供了多种内置的输出解析器，同时也支持自定义解析器。

常用的输出解析器包括：
- `StrOutputParser`：将模型输出解析为字符串
- `JsonOutputParser`：将模型输出解析为 JSON 对象
- `PythonOutputParser`：将模型输出解析为 Python 对象
- `TypedDictOutputParser`：将模型输出解析为指定类型的字典
- `PydanticOutputParser`：将模型输出解析为 `Pydantic` 模型实例

## 3.2 结构化输出

通过结构化输出，将模型的输出解析为具有特定结构的数据，可以方便地对模型的输出进行验证、处理和存储。常见的结构化输出方式有：`JSON Schema`、`TypedDict`、`Pydantic` 等。

1. `JSON Schema`

```python
from langchain_core.output_parsers import JsonOutputParser

parser = JsonOutputParser()
```

2. `TypedDict` + `Annotated`

`TypedDict` 无法进行严格的类型检查和数据验证（比如限制数据的范围之类的），但可以作为一种轻量级的结构化输出方式。

```python
from typing import TypedDict
from typing_extensions import Annotated
from langchain_core.output_parsers import TypedDictOutputParser

# Annotated 用于为 TypedDict 的字段添加说明，便于模型理解输出的结构和含义
class MyOutput(TypedDict):
    name: Annotated[str, "姓名"]
    age: Annotated[int, "年龄"]
    gender: Annotated[str, "性别"]
    introduction: Annotated[str, "自我介绍"]

parser = TypedDictOutputParser(typed_dict=MyOutput) # 初始化 TypedDict 输出解析器
```

3. `Pydantic`

`Pydantic` 相较于 `TypedDict` 可以进行更加严格的类型检查和数据验证。

```python
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser

class MyOutputModel(BaseModel):
    name: str = Field(..., description="姓名") # ... 表示该字段是必填的
    age: int = Field(..., description="年龄")
    gender: str = Field(..., description="性别")
    introduction: str = Field(..., description="自我介绍")

# 也可以和 Annotated 一起使用，两种写法是等价的
from typing_extensions import Annotated

class MyOutputModelAnnotated(BaseModel):
    name: Annotated[str, Field(..., description="姓名")]
    age: Annotated[int, Field(..., ge=0, le=150, description="年龄")] # ge=0, le=150 表示年龄必须在 0-150 之间，否则会报错
    gender: Annotated[str, Field(..., description="性别")]
    introduction: Annotated[str, Field(..., description="自我介绍")]

parser = PydanticOutputParser(pydantic_object=MyOutputModel)
```

# 4. LCEL

LCEL（LangChain Expression Language）是 LangChain 提供的一种表达式语言，用于构建和组合各种链式操作。它允许用户以声明式的方式定义复杂的处理流程，从而简化了链式操作的编写和维护。

## 4.1 顺序链

顺序链是 LCEL 中最基础的链式操作，它将多个步骤按顺序执行，每个步骤的输出作为下一个步骤的输入。

```python
from langchain_core.lcel import SequentialChain
chain1 = SequentialChain(
    steps=[
        prompt,
        model,
        parser
    ],
    input_variables=["user_input"],
    output_variables=["parsed_output"]
)

result = chain1.invoke({"user_input": "请介绍一下你自己，500字以内?"})
```

不过，我们一般不会直接使用 `SequentialChain`，而是使用 “|” 操作符来组合链式操作，这样可以更直观地表示数据流向。

```python
chain1 = prompt | model | parser
```

## 4.2 分支链

分支链允许根据不同的条件选择不同的执行路径。

```python
from langchain_core.runnables import RunnableBranch

def determine_language(inputs):
    query = inputs["user_input"]
    if "日语" in query:
        return "japanese"
    elif "韩语" in query:
        return "korean"
    else:
        return "english"

chain2 = RunnableBranch(
    lambda x : determine_language(x) == "japanese", japanese_prompt | model | parser,
    lambda x : determine_language(x) == "korean", korean_prompt | model | parser,
    english_prompt | model | parser,
)

result = chain2.invoke(user_input="请将这句话翻译成日语：我爱编程。")
```

## 4.3 多步串行链

多步串行链是指将多个链式操作串联起来，形成一个更复杂的处理流程。

```python
# chain1 的输出是纯文本，需要进行处理，匹配 chain2 的输入格式
# (lambda x: {"user_input": x}) 是一个匿名函数，将 chain1 的输出包装为一个字典，作为 chain2 的输入
full_chain = chain1 | (lambda x: {"user_input": x}) | chain2  # 不加小括号会报错，因为 lambda 表达式的优先级低于 | 运算符
result = full_chain.invoke(user_input="请将这句话翻译成英语：我爱编程。")
```

## 4.4 并行链

并行链允许同时执行多个操作，并将它们的输出合并在一起。

```python
from langchain_core.runnables import RunnableParallel

parallel_chain = RunnableParallel(
    english_prompt | model | parser,
    japanese_prompt | model | parser,
    korean_prompt | model | parser
)

# 同一个输入会被喂给多个子链，结果按照键的顺序汇总为一个字典 dict 返回
result = parallel_chain.invoke(user_input="请将这句话翻译成英语、日语和韩语：我爱编程。")
```

# 5. 上下文记忆（History / Memory）

# 6. 工具调用（Tool）

# 7. 检索增强生成（RAG）

# 8. 智能代理（Agent）

# 9. 远程工具调用（MCP）
---
title: LangChain
date: 2026-08-18
updated: 2026-08-29
cover: /images/posts/LangChain/cover.png
categories: 
  - LangChain
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

# 5. 上下文记忆（History）

## 5.1 InMemoryChatMessageHistory

`InMemoryChatMessageHistory` 是 LangChain 提供的一个简单的内存中的聊天消息历史记录类。它用于存储和管理聊天过程中的消息历史。

```python
from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

from dotenv import load_dotenv
import os

load_dotenv(encoding='utf-8')

prompt = ChatPromptTemplate.from_messages(
    [
        MessagesPlaceholder(variable_name="history"),
        {"role": "human", "content": "{user_input}"},
    ]
)

model = init_chat_model(
    model="deepseek-v4-flash",
    model_provider="openai",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

parser = StrOutputParser()

chain = prompt | model | parser

store = {}

def get_session_history(session_id):
    if session_id not in store:
        store[session_id] = InMemoryChatMessageHistory()
    return store[session_id]

# history = InMemoryChatMessageHistory()

with_history = RunnableWithMessageHistory(
    chain,
    get_session_history, # 必须是函数 / lambda表达式
    # lambda x: history,
    input_messages_key="user_input",
    history_messages_key="history",
)

# RunnableWithMessageHistory 要求调用时传入 config 字典，其中必须包含 session_id
print(with_history.invoke({"user_input": "我是李华"}, {"configurable": {"session_id": "user-001"}}))
print(with_history.invoke({"user_input": "你还记得我是谁吗？"}, {"configurable": {"session_id": "user-001"}}))
```

## 5.2 RedisChatMessageHistory

`RedisChatMessageHistory` 是 LangChain 提供的一个基于 Redis 的聊天消息历史记录类。它用于在 Redis 中存储和管理聊天过程中的消息历史。

```python
from langchain_redis.chat_message_history import RedisChatMessageHistory
from langchain_core.runnables import RunnableWithMessageHistory

from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser

from dotenv import load_dotenv
import os

import redis

load_dotenv(encoding='utf-8')

# 默认储存在 Redis 的 0 号数据库中，如果需要使用其他数据库，可以在 REDIS_URL 中指定，比如：redis://localhost:6379/1 表示使用 1 号数据库
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379") # 没有配置 REDIS_URL 环境变量时，默认使用本地 Redis 服务


def check_redis():
    try:
        r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        r.ping()
        r.close()
    except(redis.ConnectionError, redis.ResponseError) as e:
        print("Redis 连接失败")
        raise SystemExit(1) from e

check_redis()

model = init_chat_model(
    model="deepseek-v4-flash",
    model_provider="openai",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

prompt = ChatPromptTemplate(
    [
        MessagesPlaceholder("history"),
        {"role": "human", "content": "{user_input}"},
    ]
)

parser = StrOutputParser()

chain = prompt | model | parser

# decode_responses 把 bytes 解码为 str
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)

def get_session_history(session_id):
    # 为每个 session 创建/返回对应的 redis 历史实例
    return RedisChatMessageHistory(
        session_id=session_id,
        redis_url=REDIS_URL,
    )

with_history = RunnableWithMessageHistory(
    chain,
    get_session_history,
    input_messages_key="user_input",
    history_messages_key="history",
)

# print(with_history.invoke({"user_input": "我是李华"}, {"configurable": {"session_id": "user-001"}}))
print(with_history.invoke({"user_input": "你还记得我是谁吗？"}, {"configurable": {"session_id": "user-001"}}))

redis_client.close() # 一次性脚本结束后会自动关闭，但还是建议加上手动关闭
```

# 6. 工具调用（Tool）

## 6.1 创建工具函数

LangChain 提供了 `@tool` 装饰器，用于将普通的 Python 函数包装为工具函数。工具函数可以被模型调用，从而实现模型与外部系统的交互。

```python
class FieldInfo(BaseModel):
    a: int = Field(description="第1个参数")
    b: int = Field(description="第2个参数")

# @tool 装饰器
@tool(args_schema=FieldInfo) # 使用 Pydantic 可提供更多信息（参数类型/格式，参数校验规则等）
def spec_compute(a:int, b:int) -> int:
    """自定义的 Spec 运算，形式为 ( a spec b = c )""" # 至关重要，模型依赖它来理解工具用途
    return (a + b)**2 + (a - b)**(-2)

result = spec_compute.invoke({"a": 3, "b": 6}) # 可通过 invoke 直接调用
print(result)

# 查看元信息
print(f"{spec_compute.name=}\n{spec_compute.description=}\n{spec_compute.args=}\n{spec_compute.return_direct}")
```

## 6.2 将工具绑定到模型上

使用 `bind_tools` 方法将工具函数绑定到模型上，这样模型就可以直接调用工具函数了。

```python
model = init_chat_model(
    model="deepseek-v4-flash",
    model_provider="openai",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

model_with_tool = model.bind_tools([spec_compute])
```

## 6.3 调用工具函数

由于模型输出是文本，无法直接传给工具函数，因此需要一个解析器来提取工具参数。

```python
# 从模型输出中提取工具参数，得到可直接传给 spec_compute 的入参（dict）
parser = JsonOutputKeyToolsParser(key_name=spec_compute.name, first_tool_only=True)
compute_chain = model_with_tool | parser | spec_compute
```

然后将计算结果传给模型，模型再输出最终结果。

```python
# 模型接收调用结果，然后输出
output_prompt = PromptTemplate.from_template(
    """
    你会收到一个计算结果：{result} ，如果是小数就最多保留小数点后4位，然后再直接输出。
    """
)
output_parser = StrOutputParser()
output_chain = output_prompt | model | output_parser

full_chain = compute_chain | (lambda x: {"result" : x}) | output_chain # 需要把 str 先转成 dict
print(full_chain.invoke("请计算 12 spec 5 = ?"))
```

# 7. 检索增强生成（RAG）

## 7.1 Embedding

Embedding 模型由于缺少像 Chat 模型那样的统一接口，很多模型的支持不够完善。因此为了方便使用，我们一般需要自己封装一个 Embeddings 类，继承自 LangChain 的 Embeddings 基类。

```python
from langchain_core.embeddings import Embeddings
from typing  import List
import dashscope

class QwenTextEmbeddings(Embeddings):
    def __init__(self, model: str = "qwen3.7-text-embedding", api_key: str = None):
        self.model = model
        dashscope.api_key = api_key or os.getenv("QWEN_API_KEY")
    
    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        resp = dashscope.TextEmbedding.call(model=self.model, input=texts)
        if resp.status_code == 200:
            return [item["embedding"] for item in resp.output["embeddings"]]
        raise Exception(f"Embedding 调用失败: {resp.message}")
    
    def embed_query(self, text: str) -> List[float]:
        return self.embed_documents([text])[0]

embeddings = QwenTextEmbeddings()
```

## 7.2 文本加载器

因为 Embedding 模型只能处理文本数据，所以我们需要先将文档加载为文本格式。

```python
from langchain_community.document_loaders import TextLoader
loader = TextLoader("test.txt", encoding="utf-8")
documents = loader.load()
```

## 7.3 文本分割器

将加载的文档进一步分割成更小的文本块，以便更好地进行 Embedding。

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
)

chunks = text_splitter.split_documents(documents)
```

## 7.4 向量存储

这里我们使用 Redis 作为向量存储，将 Embedding 结果存储在 Redis 中，以便后续检索。

```python
from langchain_redis import RedisConfig, RedisVectorStore

config = RedisConfig(
    index_name="new",
    redis_url="redis://localhost:6379",
)

vector_store = RedisVectorStore.from_documents(
    documents=chunks,
    embedding=embeddings,
    config=config,
    overwrite=True,
)
```

## 7.5 检索器

将向量存储中的文档转换为可检索的对象。

```python
retriever = vector_store.as_retriever(search_kwargs={"k": 3})
```

## 7.6 RAG 链

最后将检索器、提示词、模型和输出解析器组合成一个 RAG 链。

```python
from langchain_core.runnables import RunnablePassthrough

# RunnablePassthrough 会将接收的字符串直接作为结果给到 "question"
# "context" 则是 retriever 的调用结果
rag_chain = {"context": retriever, "question": RunnablePassthrough()} | prompt | model | output_parser

print(rag_chain.invoke("光合作用分为哪两个阶段？"))
print(rag_chain.invoke("太阳与地球的距离？"))
```

# 8. 智能代理（Agent）

Agent 是 LangChain 提供的一种高级功能，内部封装了模型、工具、记忆和决策逻辑，我们可以直接使用 Agent 来处理复杂的任务，而不需要关心底层的实现细节。

```python
from langchain.chat_models import init_chat_model
from langchain_core.tools import tool
from langchain.agents import create_agent

from dotenv import load_dotenv
import os

load_dotenv(encoding='utf-8')

llm = init_chat_model(
    model="deepseek-v4-flash",
    model_provider="openai",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)

SYSTEM_PROMPT = """你是一个数学计算专家，擅长使用自定义的 Spec 运算工具进行计算。

可用的工具：
1. spec_add(a, b) → a sa b = (a * b) + (a // b)
2. spec_mul(a, b) → a sm b = (a + b) * (a - b)
3. spec_square(x) → x sq = (x sa x) sm (x sa x)

请根据用户的问题，选择合适的工具进行计算。
如果问题涉及复合运算，请分步执行并说明每一步。
"""

def create_tools():
    @tool
    def spec_add(a: int, b: int) -> int:
        """
        计算两个数的 Spec 和，记作 a sa b
        公式：a sa b = (a * b) + (a // b)
        """
        return (a * b) + (a // b)

    @tool
    def spec_mul(a: int, b: int) -> int:
        """
        计算两个数的 Spec 积，记作 a sm b
        公式：a sm b = (a + b) * (a - b)
        """
        return (a + b) * (a - b)

    @tool
    def spec_square(x: int) -> int:
        """
        计算一个数的 Spec 平方，记作 x sq
        公式：x sq = (x sa x) sm (x sa x)
        """
        xsax = spec_add.invoke({"a": x, "b": x})
        return spec_mul.invoke({"a": xsax, "b": xsax})

    return [spec_add, spec_mul, spec_square]

tools = create_tools()

agent = create_agent(
    model=llm,
    tools=tools,
    system_prompt=SYSTEM_PROMPT,
)

def main():
    response = agent.invoke({"messages": [{"role": "user", "content": "请计算 3 sq"}]})
    print(response["messages"][-1].content)

if __name__ == "__main__":
    main()
```

# 9. 远程工具调用（MCP）

## 9.1 MCP Server

负责接收模型的请求，调用本地工具函数，并将结果返回给模型。我们可以使用 `FastMCP` 来快速搭建一个 MCP Server。

```python
from mcp.server import FastMCP

from pydantic import Field
from typing import Annotated

import logging

logging.basicConfig(level=logging.INFO)
logging.info("Starting the custom math service...")
server = FastMCP("custom-math-service")

@server.tool()
def add(
    a: Annotated[int, Field(description="第一个数")],
    b: Annotated[int, Field(description="第二个数")]
) -> int:
    """
    （定义新运算）计算两个数的 Spec 和，记作 a spec b
    
    Args:
        a: 第一个数
        b: 第二个数
    
    Returns:
        两数的 Spec 和
    """
    return (2 * a) + (b // 2)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("waiting for requests...")
    server.run(transport="stdio")
```

## 9.2 MCP Client

也就是向 MCP Server 发送请求的客户端，通常是模型所在的环境。

```python
import asyncio
import os

from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_mcp_adapters.client import MultiServerMCPClient

load_dotenv(encoding='utf-8')

class MyMCPClient:
    def __init__(self):
        self.llm = init_chat_model(
            model="deepseek-v4-flash",
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com",
        )
        self.tools = [] # MCP 工具列表
        self.tool_map = {} # 工具名称到工具对象的映射
        self.messages = [] # 历史消息记录（包括用户消息、模型消息和工具调用结果）

    async def load_mcp_server(self, server_path):
        # 初始化 MCP 客户端并加载工具
        # 使用 MultiServerMCPClient 来管理多个 MCP 工具服务器
        # 此处为本地启动的自定义工具服务器，可以根据路径启动，也可以使用远程服务器的 URL 连接
        client = MultiServerMCPClient({
            "demo": {
                "transport": "stdio",
                "command": "python",
                "args": [server_path]
            }
        })

        # 如果是远程服务器，可以直接使用 URL 连接
        # client = MultiServerMCPClient({
        #     "remote_service": {
        #         "transport": "http",  # 1. 关键：指定为 http 传输
        #         "url": "https://your-mcp-server.example.com/mcp",  # 2. 远程地址
        #         "headers": {  # 3. 添加认证信息
        #             "Authorization": f"Bearer {os.getenv('MCP_API_TOKEN')}",
        #             "Content-Type": "application/json"
        #         }
        #     }
        # })

        self.tools = await client.get_tools()
        self.tool_map = {t.name: t for t in self.tools}

    async def chat(self, text: str) -> str:
        # 记录用户消息
        self.messages.append({"role": "user", "content": text})

        # 调用 MCP 工具（最多尝试 5 次，防止无限循环）
        for _ in range(5):
            resp = self.llm.invoke(
                self.messages, # 历史消息
                tools=self._build_schemas(), # 工具列表
                tool_choice="auto" # 模型自行选择是否使用工具
            )

            # a.如果没有使用工具，直接返回 LLM 的回答
            if not resp.tool_calls:
                # 记录模型消息
                self.messages.append(resp)
                return resp.content

            # b.如果使用了工具，调用工具并将结果加入消息
            self.messages.append(resp) # 记录调用工具的消息
            for tc in resp.tool_calls:
                args = tc["args"] # 解析工具调用参数
                result = await self.tool_map[tc["name"]].ainvoke(args) # 调用工具
                # 记录工具调用结果
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": str(result)
                })

        # 超过 5 轮强制返回
        return self.llm.invoke(self.messages).content

    # 工具函数：将工具列表转换为模型可识别的 schema
    def _build_schemas(self):
        schemas = []
        for tool in self.tools:
            # 如果已经是 dict，直接使用；否则调用 model_json_schema
            if hasattr(tool.args_schema, "model_json_schema"):
                parameters = tool.args_schema.model_json_schema()
            else:
                parameters = tool.args_schema  # 已经是 dict
            
            schemas.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": parameters
                }
            })
        return schemas

async def main():
    agent = MyMCPClient()
    await agent.load_mcp_server("mcp_server.py") # 加载自定义工具服务器
    response = await agent.chat("请计算 3 spec 5")
    print("Response:", response)

if __name__ == "__main__":
    asyncio.run(main())
```
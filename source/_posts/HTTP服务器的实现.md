---
title: HTTP 服务器的实现
date: 2026-10-06
updated: 2026-10-06
cover: /images/posts/HTTP服务器的实现/cover.png
categories: 网络编程
tags:
  - HTTP
  - 序列化
  - 反序列化
  - C++
  - 网络编程
---

在此之前，我们实现的 TCP 服务器只会把收到的字节原样发回去，并不需要理解这些字节的含义。HTTP 服务器则必须先读懂请求：从字节流里拆出方法、路径、请求头和请求体，再根据这些内容生成一段结构化的响应发回去。

HTTP 本身是纯文本协议，单看一段报文的格式并不复杂，真正麻烦的是它不会一次性完整地到达。TCP 只提供字节流，不保留消息边界，所以第一次 `read` 可能只读到半行请求行，第二次才把请求头补齐，第三次又可能一口气读到三条完整的请求。这样一来，难点就不在解析文本本身，而在于如何从不断到来的字节里准确判断每条请求从哪里开始、到哪里结束。

整个实现被拆成四个类。`HttpRequest` 和 `HttpResponse` 分别用来存放请求和响应，它们只是数据结构，不涉及 IO；`HttpContext` 负责保存解析进度，并真正从 `Buffer` 里把一条请求切出来；`HttpServer` 则把解析器接到 TCP 连接上，处理路由、keep-alive 和 pipelining。

当一条请求到达时，`TcpServer` 先把从 socket 读到的字节放进 `Buffer`，然后由 `HttpContext::parseRequest` 解析成 `HttpRequest`；路由找到对应的业务回调后，业务代码往 `HttpResponse` 里填写内容，最后序列化成字节发送回去。

---

# 1. HttpRequest 请求

在动手写代码之前，先看看一条 HTTP 请求长什么样。

```text
POST /echo?from=cli HTTP/1.1\r\n      1. 请求行
Host: example.com\r\n                 2. 请求头，若干行
Content-Type: text/plain\r\n
Content-Length: 11\r\n
\r\n                                  3. 空行
hello world                           4. 请求体
```

- 请求行：由三部分用空格隔开。
    - 方法（`GET` / `POST` / `PUT` / `DELETE` / `HEAD` 等）
    - 路径（请求的资源路径，路径里如果带 `?` 就把它后面的部分叫查询串）
    - 协议版本（`HTTP/1.0`、`HTTP/1.1` 等）
- 请求头：一行一个 `键: 值`，字段名大小写不敏感，`Content-Length` 和 `content-length` 是同一个东西。
- 空行：单独的一个 `\r\n`，标记头部的结束。只有 CRLF 落在行首才算空行。
- 请求体：可选，`GET` 一般没有，`POST` 用来携带表单或 JSON。

需要注意的是，每一行都以 `\r\n` 结尾，而不是单独的 `\n`。

`HttpRequest` 的作用很单纯，就是把一条已经解析好的请求存下来。`HttpContext` 在解析过程中会一边解析一边把字段填进去，等请求交给业务层时，业务代码直接从这个对象里读取需要的内容。解析和网络 IO 都不在这个类里完成，所以以后即使换掉解析器的实现，只要保持这几个字段的读写方式不变就可以了。

类定义如下：

```cpp
#pragma once

#include <cstddef>
#include <map>
#include <string>

class HttpRequest {
public:
    enum class Method {
        Invalid,
        GET,
        POST,
        PUT,
        DELETE,
        HEAD,
    };

    enum class Version {
        Unknown,
        HTTP_1_0,
        HTTP_1_1,
    };

    // 单个请求体的最大字节数，用于防御超大 Content-Length，避免 OOM 或长时间等待
    static constexpr size_t kMaxBodySize = 64 * 1024 * 1024; // 64 MiB

private:
    // 成员一律显式初始化，避免默认构造时出现未定义行为
    Method method_ = Method::Invalid;
    Version version_ = Version::Unknown;
    std::string path_;
    std::string query_;
    std::map<std::string, std::string> headers_; // key 统一转小写存储，实现大小写不敏感
    std::string body_;

public:
    void setMethod(Method method) { method_ = method; }
    void setVersion(Version version) { version_ = version; }
    void setPath(const std::string& path) { path_ = path; }
    void setQuery(const std::string& query) { query_ = query; }

    // 用指针区间表示 field/value，避免为整行构造临时 std::string
    // 内部会把 field 去尾空白并转小写、value 去首尾空白
    void addHeader(const char* start, const char* colon, const char* end);

    void setBody(const std::string& body) { body_ = body; }

    Method method() const { return method_; }
    Version version() const { return version_; }
    const std::string& path() const { return path_; }
    const std::string& query() const { return query_; }
    const std::string& body() const { return body_; }

    // 取不到时返回空串而不是抛异常，HTTP 头都是可选的，缺失是常态
    std::string header(const std::string& field) const;

    // 解析 Content-Length，绝不抛异常，非法值返回 0，超过上限返回 kMaxBodySize + 1
    size_t contentLength() const;

    bool isKeepAlive() const;

    void swap(HttpRequest& other);
    void reset();
};
```

具体实现如下：

```cpp
#include "httprequest.h"

#include <cctype>

namespace {

// HTTP 头字段名大小写不敏感，统一转小写
std::string toLower(const std::string& s) {
    std::string result = s;
    for (char& c : result) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return result;
}

bool isSpace(char c) {
    return c == ' ' || c == '\t';
}

} // namespace

void HttpRequest::addHeader(const char* start, const char* colon, const char* end) {
    // field 是 [start, colon)，去掉尾部空白后统一转小写
    const char* fieldEnd = colon;
    while (fieldEnd > start && isSpace(fieldEnd[-1])) {
        --fieldEnd;
    }
    std::string field = toLower(std::string(start, fieldEnd));

    // value 是 colon 之后到行尾，跳过前导空白，再去掉尾部空白
    const char* valueBegin = colon + 1;
    while (valueBegin < end && isSpace(*valueBegin)) {
        ++valueBegin;
    }
    const char* valueEnd = end;
    while (valueEnd > valueBegin && isSpace(valueEnd[-1])) {
        --valueEnd;
    }
    std::string value(valueBegin, valueEnd);

    if (field.empty()) {
        return;
    }

    // 同名头在请求里是合法的，Accept、Cookie 都可能出现多次
    // 按 RFC 7230，它们等价于把这些值用逗号连接之后的单个头
    auto it = headers_.find(field);
    if (it == headers_.end()) {
        headers_[field] = value;
    } else {
        it->second += ", " + value;
    }
}

std::string HttpRequest::header(const std::string& field) const {
    auto it = headers_.find(toLower(field));
    return it == headers_.end() ? std::string() : it->second;
}

size_t HttpRequest::contentLength() const {
    // 手动解析，绝不抛异常，非法值一律视为 0（没有 body）
    auto it = headers_.find("content-length");
    if (it == headers_.end()) {
        return 0;
    }
    const std::string& value = it->second;
    if (value.empty()) {
        return 0;
    }

    size_t n = 0;
    for (char c : value) {
        if (c < '0' || c > '9') {
            return 0;
        }
        n = n * 10 + static_cast<size_t>(c - '0');
        if (n > kMaxBodySize) {
            // 返回一个必定大于上限的值，交给解析器判为非法请求
            return kMaxBodySize + 1;
        }
    }
    return n;
}

bool HttpRequest::isKeepAlive() const {
    auto it = headers_.find("connection");
    if (it != headers_.end()) {
        const std::string value = toLower(it->second);
        if (value.find("close") != std::string::npos) {
            return false;
        }
        if (value.find("keep-alive") != std::string::npos) {
            return true;
        }
    }
    // HTTP/1.1 默认长连接，HTTP/1.0 默认短连接
    return version_ == Version::HTTP_1_1;
}

void HttpRequest::swap(HttpRequest& other) {
    std::swap(method_, other.method_);
    std::swap(version_, other.version_);
    std::swap(path_, other.path_);
    std::swap(query_, other.query_);
    std::swap(headers_, other.headers_);
    std::swap(body_, other.body_);
}

void HttpRequest::reset() {
    method_ = Method::Invalid;
    version_ = Version::Unknown;
    path_.clear();
    query_.clear();
    headers_.clear();
    body_.clear();
}
```

方法和协议版本都用 `enum class` 表示，而不是保存成字符串。它们的取值本来就只有固定的几种，用枚举可以在编译期发现拼写错误；解析时也只有识别出的方法或版本才会被设成有效值，其他情况会落到 `Invalid` 或 `Unknown`，调用方很容易判断这条请求是否还能继续处理。

路径和查询串分成两个字段保存。路径主要用于路由匹配，查询串则是业务参数。如果把它们放在同一个字符串里，每个需要读取查询参数的地方都得自己再找一次 `?` 并手动切分；不如在解析请求行时就拆开，后面用起来会方便很多。

请求头用 `std::map` 保存，并且在存入之前把字段名统一转成小写。HTTP 规定字段名不区分大小写，如果每次查询都做一次忽略大小写的比较，代码会变得很啰嗦；不如在存储时就统一格式，这样 `map` 默认的比较规则就足够用了。`header()` 在查询时也会把传入的字段名转成小写，所以调用方写成 `Content-Length` 还是 `content-length` 都可以。

`addHeader` 的参数不是 `std::string`，而是一段指针区间。这样做是为了避免每解析一行请求头就构造一个临时字符串。另外，在转小写之前会先把 `char` 转成 `unsigned char`，因为 `char` 在多数平台上是有符号的，直接把负值传给 `tolower` 属于未定义行为，而 HTTP 头里确实可能出现非 ASCII 字节。

如果同一个请求头出现多次，代码会把它们的值用逗号连接起来，而不是让后面的值覆盖前面的值。像 `Accept`、`Cookie` 这样的头在一条请求里出现多次是合法的，RFC 7230 规定这种写法等价于把多个值用逗号连接成一个头。如果直接覆盖，前面那些值就会在没有任何提示的情况下丢失。

请求体前面没有专门的分隔符，它后面接着的要么是下一条请求，要么是连接关闭。所以服务器没法靠某个特殊字符判断请求体在哪里结束，只能按照 `Content-Length` 给出的字节数，一直读到足够多的字节为止。

这个长度必须算准确。在 keep-alive 连接上，如果第一条请求的 body 长度算错了，第二条请求的前半截就会被误当成第一条的 body，之后整个连接上的解析都会错位。

`contentLength()` 里的数字是手动解析的，没有使用 `std::stoul`。原因在于这个值完全由客户端控制，只要发来一行 `Content-Length: abc`，`std::stoul` 就会抛出异常，而网络库不应该因为对端发了脏数据就产生异常。这个函数的约定是任何情况下都返回 `size_t`：遇到非法字符时返回 0，当作没有 body；超过上限时返回 `kMaxBodySize + 1` 这个哨兵值。

超限时之所以不直接返回 0，是因为 0 的含义是“没有 body”。如果把一个超长的长度悄悄当成 0，服务器就会把一条大请求解析成没有 body 的请求，表面上没有报错，实际内容却全错了。至于 64 MiB 这个上限，是为了防止客户端只发一行超长的 `Content-Length`，就让服务器一直等待 body，从而长期占用连接和内存。

连接是否复用由 `Connection` 头协商：值为 `close` 表示这个请求处理完就断开，值为 `keep-alive` 表示希望继续复用。如果请求里没有这个头，就要看协议版本：HTTP/1.1 默认复用，HTTP/1.0 默认断开。所以，一个没有写 `Connection` 头的 HTTP/1.0 请求，处理完之后就应该关闭连接。`isKeepAlive()` 会先检查请求头里有没有显式指定，只有在没有指定时才回落到版本的默认行为。

`swap()` 和 `reset()` 是为了复用而准备的。一条请求解析完之后，需要把上下文重置回初始状态，才能继续解析同一条连接上的下一条请求；`swap()` 则可以在不需要拷贝的情况下，把已经解析好的请求整个转移出去。

---

# 2. HttpResponse 响应

`HttpResponse` 和 `HttpRequest` 在结构上是对称的，都是用来保存报文内容的数据对象。不同的是，请求只需要被读取，而响应最终要写到连接上，所以 `HttpResponse` 还多了一项职责：把自己序列化成字节。这件事交给它自己来做比较合适，因为状态行怎么写、哪些头必须存在、`Content-Length` 和 body 之间是什么关系，只有响应对象自己最清楚。

响应报文的结构和请求基本相同，只是第一行从请求行变成了状态行：

```text
HTTP/1.1 200 OK\r\n
Content-Type: text/plain\r\n
Content-Length: 12\r\n
\r\n
hello world
```

类定义如下：

```cpp
#pragma once

#include <map>
#include <string>

#include "buffer.h"

class HttpResponse {
public:
    enum class HttpStatusCode {
        Unknown,
        OK = 200,
        MovedPermanently = 301,
        BadRequest = 400,
        NotFound = 404,
    };

private:
    bool closeConnection_;
    HttpStatusCode statusCode_;
    std::string statusMessage_;
    std::map<std::string, std::string> headers_;
    std::string contentType_;
    std::string body_;

public:
    explicit HttpResponse(bool close)
        : closeConnection_(close), statusCode_(HttpStatusCode::Unknown) {}

    void setStatusCode(HttpStatusCode code) { statusCode_ = code; }
    void setStatusMessage(const std::string& message) { statusMessage_ = message; }
    void setCloseConnection(bool on) { closeConnection_ = on; }
    void setContentType(const std::string& contentType) { contentType_ = contentType; }
    void setBody(const std::string& body) { body_ = body; }

    bool closeConnection() const { return closeConnection_; }
    std::string statusMessage() const { return statusMessage_; }
    HttpStatusCode statusCode() const { return statusCode_; }
    const std::string& body() const { return body_; }

    void addHeader(const std::string& field, const std::string& value) {
        headers_[field] = value;
    }

    // 把 response 写进输出缓冲区，isHead 为 true 时只发头部
    // 但 Content-Length 仍然按 body 的真实长度给，这是 HEAD 的语义
    void appendToBuffer(Buffer* output, bool isHead = false) const;

private:
    std::string reasonPhrase() const;
};
```

具体实现如下：

```cpp
#include "httpresponse.h"

#include <cctype>

namespace {

// HTTP 头字段名大小写不敏感，统一转小写
std::string toLower(const std::string& s) {
    std::string result = s;
    for (char& c : result) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return result;
}

// Content-Length 由 appendToBuffer 按 body_ 自动计算
// 用户手动设置的会被忽略，避免出现两个 Content-Length
bool isContentLength(const std::string& field) {
    return toLower(field) == "content-length";
}

} // namespace

std::string HttpResponse::reasonPhrase() const {
    if (!statusMessage_.empty()) {
        return statusMessage_;
    }
    switch (statusCode_) {
        case HttpStatusCode::OK:                return "OK";
        case HttpStatusCode::MovedPermanently:  return "Moved Permanently";
        case HttpStatusCode::BadRequest:        return "Bad Request";
        case HttpStatusCode::NotFound:          return "Not Found";
        default:                                return "Unknown";
    }
}

void HttpResponse::appendToBuffer(Buffer* output, bool isHead) const {
    output->append("HTTP/1.1 " + std::to_string(static_cast<int>(statusCode_)) +
                   " " + reasonPhrase() + "\r\n");

    for (const auto& header : headers_) {
        if (isContentLength(header.first)) {
            continue;
        }
        output->append(header.first + ": " + header.second + "\r\n");
    }

    if (!contentType_.empty()) {
        output->append("Content-Type: " + contentType_ + "\r\n");
    }

    // Content-Length 必须按字节数输出，keep-alive 下客户端靠它判断 body 何时结束
    output->append("Content-Length: " + std::to_string(body_.size()) + "\r\n");

    output->append(std::string("Connection: ") +
                   (closeConnection_ ? "close" : "keep-alive") + "\r\n");

    output->append("\r\n");

    // HEAD 请求的响应不带 body，但上面的 Content-Length 照给
    if (!isHead) {
        output->append(body_);
    }
}
```

状态码用枚举表示，同时另外保留了一个可选的 `statusMessage_`。原因短语在 HTTP 里本来就可以自定义，所以 `reasonPhrase()` 会先看用户有没有设置；如果没有设置，才根据状态码去查一个默认值。

序列化时，`Content-Length` 和 `Connection` 这两个头会由框架自动补上，用户在 `headers_` 里设置的同名头会被跳过。这样做是因为这两个值都有唯一正确的来源：`Content-Length` 必须等于 `body_` 的实际字节数，在 keep-alive 场景下如果写错，客户端就会按错误的长度去切分下一条响应；`Connection` 的值则由 `closeConnection_` 决定，不应该让业务代码随意填写。

各部分的写入顺序是固定的：状态行、用户自定义头、`Content-Type`、`Content-Length`、`Connection`、空行，最后是 body。`Content-Length` 必须出现在空行之前，否则客户端会把后面的字节也当成 body 的一部分。

`isHead` 参数用于处理 HEAD 请求。按照规范，HEAD 的响应不能携带 body，但 `Content-Length` 仍然要按 GET 请求会返回的长度来填写。所以这里会跳过 body 的输出，但长度照常计算。

---

# 3. HttpContext 请求上下文

在前面几个类里，数据对象本身不保存任何解析进度；真正有状态的是 `HttpContext`。它从 `Buffer` 里读取字节，判断目前收到的数据是否已经足够组成一条完整请求；如果够了，就把 `HttpRequest` 填好并交给上层处理。每条连接都会拥有一个独立的 `HttpContext` 实例。

解析器很难一次就拿到完整的一条请求。TCP 提供的字节流不保留消息边界，一次发送的数据可能被拆成任意大小的片段，所以第一次 `read` 可能只读到半行请求行。解析到一半时，解析器只能先停下来，等下一次数据到达后再从上次停下的地方继续。

有人可能会想到记录一个下标，表示已经解析到缓冲区里的第几个字节。但这样做行不通：请求头的行数并不固定，而且已经解析过的字节会从缓冲区里被移除，缓冲区本身不断向前移动，固定的下标很快就会失去意义。真正需要记住的不是偏移量，而是当前解析到了报文的哪一段。于是这里设计了四个状态：`ExpectRequestLine`、`ExpectHeaders`、`ExpectBody`、`GotAll`。

整个解析过程就是一个由状态驱动的循环。每一轮只处理当前状态对应的一小段工作，完成后要么进入下一个状态，要么退出循环等待更多数据。没有消费掉的字节会原样留在缓冲区里，已经解析出来的字段则保存在 `HttpRequest` 中，这样就不会出现重复扫描的问题。

状态和请求对象放在一起：

```cpp
#pragma once

#include "buffer.h"
#include "httprequest.h"

class HttpContext {
public:
    enum class HttpRequestParseState {
        ExpectRequestLine,
        ExpectHeaders,
        ExpectBody,
        GotAll,
    };

private:
    // 必须显式初始化，栈上默认构造时成员是未定义的
    // HttpServer 里用 make_shared 只是碰巧把它 value-initialize 成 0，不能依赖
    HttpRequestParseState state_ = HttpRequestParseState::ExpectRequestLine;
    HttpRequest request_;

public:
    bool parseRequest(Buffer* buf);

    bool getAll() const { return state_ == HttpRequestParseState::GotAll; }
    const HttpRequest& request() const { return request_; }
    HttpRequest& request() { return request_; }

    void reset();

private:
    bool processHeadersEnd();   // 空行之后的收尾，决定进 body 还是直接完成
    bool processRequestLine(const char* begin, const char* end);
    void processHeaders(const char* begin, const char* end);
    void processBody(const char* begin, const char* end);
};
```

驱动循环和重置逻辑如下：

```cpp
bool HttpContext::parseRequest(Buffer* buf) {
    bool ok = true;
    bool hasMore = true;

    // 状态驱动，而不是 buf 里有 CRLF 就整体解析
    // body 阶段跟 CRLF 完全无关，必须能在没有 CRLF 的情况下把请求解析完
    // 每次循环只前进一步，收到半包时通过 !crlf 或数据不够来退出等待
    while (hasMore) {
        switch (state_) {
            case HttpRequestParseState::ExpectRequestLine: {
                const char* crlf = buf->findCRLF();
                if (!crlf) {
                    hasMore = false; // 请求行还没收全，等下次数据
                    break;
                }
                ok = processRequestLine(buf->peek(), crlf);
                if (ok) {
                    buf->retrieveUntil(crlf + 2); // 消费掉请求行和它的 CRLF
                    state_ = HttpRequestParseState::ExpectHeaders;
                } else {
                    hasMore = false;
                }
                break;
            }

            case HttpRequestParseState::ExpectHeaders: {
                const char* crlf = buf->findCRLF();
                if (!crlf) {
                    hasMore = false; // 头部行没收全
                    break;
                }
                if (crlf == buf->peek()) {
                    // CRLF 落在行首，说明这是个空行，头部结束了
                    buf->retrieveUntil(crlf + 2);
                    ok = processHeadersEnd();
                    hasMore = false;
                } else {
                    processHeaders(buf->peek(), crlf);
                    buf->retrieveUntil(crlf + 2);
                }
                break;
            }

            case HttpRequestParseState::ExpectBody: {
                const size_t len = request_.contentLength();
                if (buf->readableBytes() >= len) {
                    processBody(buf->peek(), buf->peek() + len);
                    buf->retrieve(len);
                    state_ = HttpRequestParseState::GotAll;
                }
                // 两种情况都退出内层循环，数据不够就等下一次数据
                // body 解析完了则交给外层去处理这个已经完整的请求
                hasMore = false;
                break;
            }

            case HttpRequestParseState::GotAll:
                hasMore = false;
                break;
        }
    }
    return ok;
}

void HttpContext::reset() {
    state_ = HttpRequestParseState::ExpectRequestLine;
    request_.reset();
}
```

`hasMore` 被置为 `false` 并不代表解析出错，它只是说明这一轮没有更多事情可做了：可能是数据还不够，也可能是整条请求已经解析完成。遇到半包时直接退出循环即可，已经解析出来的字段不会丢失。

`parseRequest` 的返回值是 `bool`，但实际可能出现三种结果：还没有收全、已经收全、报文格式错误。前两种都属于正常情况，用 `true` 表示，再通过 `getAll()` 区分；只有报文格式错误时才返回 `false`。这里没有使用异常，因为报文是否畸形完全由客户端决定，用异常来表达既不方便调用方处理，也会把“数据还不够”和“数据是错的”这两种情况混在一起。

`state_` 必须在声明时显式初始化。对象在栈上默认构造时，成员变量并不会自动清零；`HttpServer` 里使用 `make_shared` 时恰好会做值初始化，但这只是巧合，不能依赖。

## 3.1 请求行

请求行只有一行，用两个空格就能把它分成方法、目标和协议版本三段。

```cpp
bool HttpContext::processRequestLine(const char* begin, const char* end) {
    const char* space1 = std::find(begin, end, ' ');
    if (space1 == end) return false;
    const char* space2 = std::find(space1 + 1, end, ' ');
    if (space2 == end) return false;

    std::string methodStr(begin, space1);
    if (methodStr == "GET") {
        request_.setMethod(HttpRequest::Method::GET);
    } else if (methodStr == "POST") {
        request_.setMethod(HttpRequest::Method::POST);
    } else if (methodStr == "PUT") {
        request_.setMethod(HttpRequest::Method::PUT);
    } else if (methodStr == "DELETE") {
        request_.setMethod(HttpRequest::Method::DELETE);
    } else if (methodStr == "HEAD") {
        request_.setMethod(HttpRequest::Method::HEAD);
    } else {
        request_.setMethod(HttpRequest::Method::Invalid);
        return false;
    }

    std::string pathAndQuery(space1 + 1, space2);
    size_t queryPos = pathAndQuery.find('?');
    if (queryPos != std::string::npos) {
        request_.setPath(pathAndQuery.substr(0, queryPos));
        request_.setQuery(pathAndQuery.substr(queryPos + 1));
    } else {
        request_.setPath(pathAndQuery);
        request_.setQuery("");
    }

    std::string versionStr(space2 + 1, end);
    if (versionStr == "HTTP/1.0") {
        request_.setVersion(HttpRequest::Version::HTTP_1_0);
    } else if (versionStr == "HTTP/1.1") {
        request_.setVersion(HttpRequest::Version::HTTP_1_1);
    } else {
        request_.setVersion(HttpRequest::Version::Unknown);
        return false;
    }

    return true;
}
```

如果找不到第二个空格，说明这一行根本不是合法的请求行，直接返回 `false`。方法或协议版本不认识时也返回 `false`，因为后续逻辑无法处理。路径和查询串按第一个 `?` 拆分；如果没有 `?`，就把整段内容当作路径，查询串留空。

## 3.2 头部

请求头是逐行处理的，每一行是一个键值对，遇到空行就表示头部结束。

```cpp
void HttpContext::processHeaders(const char* begin, const char* end) {
    const char* colon = std::find(begin, end, ':');
    if (colon != end) {
        request_.addHeader(begin, colon, end);
    }
}

bool HttpContext::processHeadersEnd() {
    const size_t len = request_.contentLength();

    if (!request_.header("transfer-encoding").empty()) {
        // 只支持 Content-Length，遇到 chunked 明确判为非法请求
        // 否则它会被当成没有 body，静默地解析出一个错误的请求
        return false;
    }
    if (len > HttpRequest::kMaxBodySize) {
        return false; // 超大或非法的 Content-Length
    }
    if (len > 0) {
        state_ = HttpRequestParseState::ExpectBody;
    } else {
        state_ = HttpRequestParseState::GotAll;
    }
    return true;
}
```

处理每一行时只需要找到冒号：如果找到了，就交给 `addHeader` 去拆分字段名和值；如果找不到，就跳过这一行。缺少冒号的头确实不合法，但它只影响自己这一行，不值得因此终止整个请求。

头部结束的判断放在 `parseRequest` 里：当 CRLF 落在行首时，说明遇到了空行，头部到此结束。这个空行本身也要从缓冲区里消费掉，否则下一次进入这个分支时还会看到它。消费完空行后调用 `processHeadersEnd`，由它根据 `Content-Length` 决定接下来是读取 body，还是直接完成解析。

这里还额外检查了 `transfer-encoding`，因为本实现没有支持 chunked 分块传输。如果不做这个检查、只是忽略这个头，那么一个 chunked 请求会被当成没有 body 的请求来处理，解析结果看起来正常，实际内容却是错的。与其静默地出错，不如明确判定为非法请求。

## 3.3 请求体

请求体本身没有任何分隔符，只能按照长度来读取。

```cpp
void HttpContext::processBody(const char* begin, const char* end) {
    request_.setBody(std::string(begin, end));
}
```

`processBody` 本身只是把这段字节拷贝到 `HttpRequest` 里。真正关键的是进入这个分支之前的判断：只有当缓冲区里的可读字节数不少于 `len` 时，才会读取 body。如果数据还不够，就什么都不做，状态继续停在 `ExpectBody`，等下一次数据到达后再接着数。这里刻意没有使用 `findCRLF`，因为 body 里完全可能包含 `\r\n`，比如上传二进制文件时几乎一定会出现；如果按行去找结束位置，解析就会提前结束。

## 3.4 错误处理

解析器对不同错误的容忍程度并不一样。像方法或协议版本不认识、`Content-Length` 非法或超过上限、使用了不支持的 `transfer-encoding` 这类问题，会让后续解析彻底失去意义，所以必须返回 `false`。而单个请求头缺少冒号只影响它自己那一行，跳过即可。`parseRequest` 返回 `false` 之后，`HttpServer` 会回复一个 400 响应并关闭连接，因为此时报文已经乱了，缓冲区里剩下的字节无法再被信任。

---

# 4. HttpServer 服务器

`HttpServer` 负责把前面几个部分组装起来。它持有 `TcpServer`，把连接建立、收到数据和连接关闭这三个回调转发进来；同时维护一张从连接指向 `HttpContext` 的映射表，并在 `onMessage` 里驱动解析、路由和响应生成。

`HttpServer` 没有继承 `TcpServer`，而是把后者作为一个成员对象持有，再把自己的处理函数接到它的回调上。这样做复用了 `TcpServer` 的监听、接受连接和事件循环能力，同时保持了 HTTP 层和 TCP 层之间的边界。

解析状态必须跟随连接保存。每次 `onMessage` 被调用时，传入的只有连接指针和缓冲区，如果不根据连接去找回上次的 `HttpContext`，解析器就不知道这次应该从哪里继续。

类定义如下：

```cpp
#pragma once

#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#include "httpcontext.h"
#include "httprequest.h"
#include "httpresponse.h"
#include "tcpserver.h"

class HttpServer {
public:
    using HttpCallback = std::function<void(const HttpRequest&, HttpResponse&)>;

private:
    TcpServer server_;
    HttpCallback httpCallback_;
    std::unordered_map<std::string, HttpCallback> routeCallbacks_; // 路由回调，key 为路径

    // 连接上下文映射，key 为连接指针，value 为该连接对应的解析状态
    std::unordered_map<Connection*, std::shared_ptr<HttpContext>> connectionContexts_;
    // 不同连接跑在各自的 ioLoop 线程，会并发访问上面这张 map，必须加锁
    std::mutex contextMutex_;

public:
    HttpServer(size_t threadNum = 0);
    ~HttpServer();

    void setHttpCallback(const HttpCallback& cb) {
        httpCallback_ = cb;
    }

    // 约定在 start() 之前注册路由，避免运行时并发修改
    void addRouteCallback(const std::string& route, const HttpCallback& cb) {
        routeCallbacks_[route] = cb;
    }

    bool start(const std::string& ip, int port);
    void run();

private:
    void onConnection(Connection* conn);
    void onMessage(Connection* conn, Buffer* buf);
    void onClose(Connection* conn);

    // 处理一个连接上缓冲区里所有已完整的请求，支持 pipelining
    void handleRequest(Connection* conn, const std::shared_ptr<HttpContext>& context, Buffer* buffer);
};
```

具体实现如下：

```cpp
#include "httpserver.h"

HttpServer::HttpServer(size_t threadNum) : server_(threadNum) {
    server_.setConnectionCallback([this](Connection* conn) { onConnection(conn); });
    server_.setMessageCallback([this](Connection* conn, Buffer* buf) { onMessage(conn, buf); });
    server_.setCloseCallback([this](Connection* conn) { onClose(conn); });
}

HttpServer::~HttpServer() {
    std::lock_guard<std::mutex> lock(contextMutex_);
    connectionContexts_.clear();
}

bool HttpServer::start(const std::string& ip, int port) {
    return server_.start(ip, port);
}

void HttpServer::run() {
    server_.run();
}

void HttpServer::onConnection(Connection* conn) {
    // 连接建立时创建一个新的 HttpContext，断开时在 onClose 里清理
    if (conn->connected()) {
        std::lock_guard<std::mutex> lock(contextMutex_);
        connectionContexts_[conn] = std::make_shared<HttpContext>();
    }
}

void HttpServer::onMessage(Connection* conn, Buffer* buf) {
    // 只在锁内取 shared_ptr，解析和业务处理放到锁外，避免长时间持锁
    std::shared_ptr<HttpContext> context;
    {
        std::lock_guard<std::mutex> lock(contextMutex_);
        auto it = connectionContexts_.find(conn);
        if (it == connectionContexts_.end()) {
            return;
        }
        context = it->second;
    }

    handleRequest(conn, context, buf);
}

void HttpServer::onClose(Connection* conn) {
    std::lock_guard<std::mutex> lock(contextMutex_);
    connectionContexts_.erase(conn); // 必须清理，否则内存泄漏
}
```

`HttpContext` 的创建和销毁应该与连接的生命周期保持一致。连接建立时在 `onConnection` 里创建一个上下文并放进映射表，连接关闭时在 `onClose` 里把它删除。如果忘记删除就会造成内存泄漏：这张表的键是 `Connection*` 裸指针，连接对象销毁之后，这个键会一直留在表里，对应的上下文也不会再被任何人使用。

`connectionContexts_` 是整套实现里唯一会被多个线程同时修改的数据结构。连接会被分配到不同的 ioLoop 上，每条连接在自己的线程里执行回调，多个线程可能同时查询、插入或删除这张表里的条目，必须用 `contextMutex_` 来保护。

加锁的范围被刻意限制得很小：`onConnection` 和 `onClose` 各加一次锁，`onMessage` 则只在锁内把 `shared_ptr` 复制出来。真正的解析和业务处理都放在锁外，因为这些操作比较耗时，如果一直持锁，所有连接都会被迫串行执行。

这里用 `shared_ptr` 保存上下文，是为了保证在锁外拿到的那份引用在解析期间始终有效。即使其他线程此时把映射表里的条目删除了，手里的 `shared_ptr` 仍然能让对象保持存活。`HttpContext` 本身不需要额外加锁，因为每条连接的上下文只会被它所属的 ioLoop 线程访问，天然就是单线程使用的。

路由表同样会被多个线程读取，但接口约定在调用 `start()` 之前完成注册，之后只读不写，所以也不需要加锁。

## 4.1 请求处理循环

一次 `read` 有可能读到多条完整的请求，这就是常说的 pipelining，所以 `handleRequest` 里需要一个循环，把缓冲区中所有已经完整的请求依次处理掉。

```cpp
void HttpServer::handleRequest(Connection* conn, const std::shared_ptr<HttpContext>& context, Buffer* buffer) {
    // 整条连接上的响应复用一个输出缓冲，避免每个请求都新建一个
    Buffer output;

    // 一次 read 可能包含多个请求（pipelining），循环处理到缓冲区里没有完整请求为止
    while (true) {
        if (!context->parseRequest(buffer)) {
            // 解析失败，发送 400 并关闭连接
            HttpResponse response(true);
            response.setStatusCode(HttpResponse::HttpStatusCode::BadRequest);
            response.setStatusMessage("Bad Request");
            response.setContentType("text/plain; charset=utf-8");
            response.setBody("400 Bad Request\n");

            response.appendToBuffer(&output);
            conn->send(output.retrieveAsString(output.readableBytes()));
            conn->shutdown();
            return;
        }

        if (!context->getAll()) {
            return; // 请求还不完整，等下一次数据到来
        }

        const HttpRequest& request = context->request();
        // 默认是否关闭由请求的 keep-alive 语义决定，handler 可以通过 setCloseConnection 覆盖
        HttpResponse response(!request.isKeepAlive());

        // 先找精确匹配的路由，找不到再退回到全局回调
        auto routeIt = routeCallbacks_.find(request.path());
        if (routeIt != routeCallbacks_.end()) {
            routeIt->second(request, response);
        } else if (httpCallback_) {
            httpCallback_(request, response);
        } else {
            response.setStatusCode(HttpResponse::HttpStatusCode::NotFound);
            response.setStatusMessage("Not Found");
            response.setContentType("text/plain; charset=utf-8");
            response.setBody("404 Not Found\n");
            response.setCloseConnection(true);
        }

        // 是否关闭连接统一以 response 为准，而不是再看一次 request.isKeepAlive()
        const bool close = response.closeConnection();

        // HEAD 请求只回头部，Content-Length 仍然按 body 的真实长度给
        response.appendToBuffer(&output, request.method() == HttpRequest::Method::HEAD);
        conn->send(output.retrieveAsString(output.readableBytes()));

        context->reset(); // 重置上下文，准备解析下一个请求

        if (close) {
            conn->shutdown();
            return;
        }
        // 不关闭就继续循环，处理缓冲区里可能残留的下一个请求
    }
}
```

为什么不能处理完一条就返回？假设两个 GET 请求前后脚到达，如果只处理第一个就退出，第二个请求的数据其实已经躺在应用层的 `Buffer` 里了。内核不会再为它触发一次可读事件，因为可读事件的条件是 socket 上出现了新数据，而这些字节早就被读出来了。结果就是第二条请求一直卡在缓冲区里，直到连接超时。

这个循环有三个出口：解析失败时回复 400 并关闭连接；请求还不完整时直接返回，等待下一次数据，此时不能调用 `reset`，否则解析进度会丢失；响应要求关闭连接时，发送完成后执行 `shutdown`。

`context->reset()` 放在每一轮循环的末尾，这样下一轮开始时上下文已经回到干净状态，可以继续解析下一条请求。输出用的 `Buffer` 声明在循环之外，让这一批请求共用一个缓冲区；每次 `retrieveAsString` 都会把里面的内容取走，所以进入下一轮时它又是空的。

是否关闭连接，最终统一以 `response.closeConnection()` 为准。这个值的默认来自请求的 keep-alive 语义，但业务代码可以在回调里修改它。如果这里再根据请求判断一次，业务代码的选择就会被覆盖。

## 4.2 路由与错误响应

路由查找就是对 `unordered_map` 做一次精确匹配，注册了 `/hello` 的路径只会命中 `/hello`。如果没有找到精确匹配，就先退回到全局回调 `httpCallback_`；只有全局回调也没有设置时，才返回 404。这样一来，一个设置了全局回调的服务器就不会仅仅因为某个路径没有注册路由而返回 404。

400 和 404 这两条路径默认都会关闭连接，但原因并不相同。400 是因为报文已经乱了，无法继续解析；404 则只是因为这个路径没有人处理，继续保留连接也没有意义。不过，如果业务代码在回调里显式把 `closeConnection` 改回 `false`，最终仍然以业务的选择为准。

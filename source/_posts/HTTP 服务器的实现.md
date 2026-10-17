---
title: HTTP 服务器的实现
date: 2026-10-06
updated: 2026-10-06
cover: /images/posts/HTTP 服务器的实现/cover.png
categories: 网络编程
tags:
  - HTTP
  - 序列化
  - 反序列化
  - C++
  - 网络编程
---

前面我们已经实现了一个 TCP 服务器，它能接收客户端发来的数据包，并把它们原封不动地返回给客户端。现在我们要在这个基础上实现一个 HTTP 服务器，它能解析客户端发来的 HTTP 请求，提取请求行、请求头和请求体，并根据请求的内容返回相应的 HTTP 响应。

---

# 1. HttpRequest

要表示一条请求，先看它长什么样。

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
    - 协议版本（`HTTP/1.0`、`HTTP/1.1`等）
- 请求头：是一行一个的键值对，键和值之间用冒号分隔。字段名大小写不敏感，`Content-Length` 和 `content-length` 是同一个东西
- 空行：是一个单独的 `\r\n`，它标记头部到此结束。注意别把它和普通的换行搞混，只有读到行首就是 CRLF 才算空行
- 请求体：是可选的一段，`GET` 一般没有，`POST` 用来携带表单或 JSON

每一行都以 `\r\n` 结尾，不是 `\n`，这两个字符是协议规定的。

`HttpRequest` 这个类要做的就是把上面这四段存下来，供业务代码读取。它不碰 IO，也不关心数据是怎么解析出来的。

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

`HttpRequest` 是一个纯数据容器，方法全是 getter 和 setter，没有什么逻辑。有几处设计值得说一下。

方法和版本用的是 `enum class`，不是字符串。它们的取值固定就那么几种，用枚举能在编译期挡掉拼写错误，解析时也只有认识的方法和版本才会被设成有效值，其他一律落到 `Invalid` 和 `Unknown`。

路径和查询串是分开存的。因为查询串里可能有 `?` 和 `&` 需要单独处理，把它们混在一条字符串里，业务代码每次用都要自己切一遍。解析请求行的时候一次切好，后面就省事了。

头字段存在 `std::map` 里，键统一转小写。HTTP 规定字段名大小写不敏感，与其每次查询都做一次大小写无关的比较，不如存的时候就转成小写，查的时候也转一次，这样 `map` 的默认比较规则就够了。`addHeader` 收到的是一段指针区间而不是 `std::string`，是为了避免为整行构造临时对象。

同名头是按逗号合并的，不是后者覆盖前者。`Accept`、`Cookie` 这些头在请求里出现多次是合法的，RFC 7230 规定它们等价于把这些值用逗号连接之后的单个头。直接覆盖会丢掉前面的值。

请求体前面那三段都有明确的分隔符，请求行和头部行靠 `\r\n` 断行，头部结束靠空行。但请求体本身没有任何分隔符，它后面直接就是下一个请求的开始，或者连接关闭。

所以服务器不可能靠读到某个字符就停来判断 body 到哪结束，只能用 `Content-Length` 给出的字节数，读满这么多字节，body 就完了。`contentLength()` 读的就是这个数。

它是手写解析的，用的不是 `std::stoul`。因为 `std::stoul` 遇到非法输入会抛异常，而这个值完全由客户端控制，一个 `Content-Length: abc` 就能让服务器抛异常。这个函数的约定是任何情况下都返回 `size_t`，非法值返回 0 当成没有 body，超过上限的返回一个必定大于上限的哨兵值，由调用方去判断合法性。

`kMaxBodySize` 定在 64 MiB。没有这个上限的话，客户端只要发一行 `Content-Length: 99999999999`，服务器就会一直等着收 body，连接和内存都被它占着。

HTTP 允许在一个连接上连续发多个请求，也就是常说的 keep-alive。这对服务器提出了一个硬要求，必须能准确切出每一条请求。假如第一条请求的 body 长度算错了，第二条请求的前半截就会被当成第一条的 body，整个连接上后续的解析都会错位。这也是上面那个用字节数定边界必须做对的原因。

客户端用 `Connection` 头来协商，`Connection: close` 表示这个请求处理完就断开，`Connection: keep-alive` 表示希望复用。默认值取决于版本，HTTP/1.1 默认复用，HTTP/1.0 默认断开，所以一个不写任何 `Connection` 头的 HTTP/1.0 请求，处理完就该关连接。

`isKeepAlive()` 就是读这个头，优先看它有没有被显式设置，没有时才按版本给出默认值。

---

# 2. HttpResponse

响应报文的结构和请求一样，只是第一行换成了状态行。

```text
HTTP/1.1 200 OK\r\n
Content-Type: text/plain\r\n
Content-Length: 12\r\n
\r\n
hello world
```

`HttpResponse` 和 `HttpRequest` 对称，存一条响应的内容，另外多一个职责，把自己序列化成字节。

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

`Content-Length` 和 `Connection` 这两个头是自动补齐的，用户在 `headers_` 里设置的会被忽略。

`Content-Length` 必须由框架算，因为它是按 `body_` 的字节数定出来的。用户如果自己写了一个对不上的值，在 keep-alive 场景下客户端就会按错误的长度去切分下一条响应，连接直接乱掉。所以 `appendToBuffer` 遇到用户设置的 `Content-Length` 会跳过。

`Connection` 也是同样的道理，它的值由 `closeConnection_` 决定，而这个标志的默认值来自请求的 keep-alive 语义，不是随便填的。

状态码用一个 enum 加一个可选的 `statusMessage_`。原因短语在 HTTP 里本来就可以自定义，所以先看用户有没有设置，没设置才按状态码查一个默认值。

`appendToBuffer` 的写入顺序是定死的，状态行、用户自定义头、`Content-Type`、`Content-Length`、`Connection`、空行、body。其中 `Content-Length` 的位置不能随便改，它必须在空行之前。

`isHead` 参数是为了 HEAD 请求。按规范，HEAD 的响应不能带 body，但 `Content-Length` 要按 GET 时会返回的长度给。所以这里跳过 `body_` 的输出，但长度照算。

---

# 3. HttpContext

前面两个类是纯数据，真正有状态的是这个类。它负责从 `Buffer` 里把一条请求解析出来。

## 3.1 解析状态

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

为什么要有一个状态位，是因为解析器不可能一次就把请求拿到手。

客户端发来的字节是被 TCP 切开的，服务器这边第一次 `read` 到的可能只有 `POST /echo HTTP/1.1\r\nContent-Len`，连请求行都没收全。下一次 `read` 补上一截，再下一次可能一次来三条完整请求。所以解析器必须能记住上次读到哪了，这次接着往下走。

最直接的想法是记住一个下标，表示已经解析到缓冲区里的第几个字节。但这样不够，因为头部是逐行处理的，行数不定，而且已经被解析掉的部分会从缓冲区里消费掉，下标就失去意义了。真正要记的不是下标，而是当前处在报文的哪一段。

所以状态位有四个。请求行、头部、请求体是报文的三段，`GotAll` 表示这一条已经完整了。

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

这个循环的形状值得说一下。每一轮只处理一个状态，处理完要么改变状态、要么退出循环。收到半包时把 `hasMore` 置为 `false` 就退出了，`Buffer` 里剩下的数据原样留着，等下一次 `read` 追加进来再继续。已经解析出来的字段都留在 `HttpRequest` 里，不会因为退出循环而丢掉。

这么做还避免了重复劳动。如果每收到一批数据就把整个 `Buffer` 从头扫一遍，那么一个分成十次到达的请求，每次都要重新找请求行、重新解析已经解析过的头部。状态机只处理新到的那部分。

`parseRequest` 返回 `bool` 而不是抛异常，是因为它有三种结果。解析成功但还没收全、解析成功且收全了、解析失败。前两种是正常情况，用返回值 `true` 加 `getAll()` 区分，只有第三种报文畸形才返回 `false`。报文畸形完全由客户端控制，用异常处理会很难看。

## 3.2 请求行

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

请求行靠两个空格切成三段，所以找两个空格就够了。

找不到第二个空格说明这一行根本不是请求行，返回 `false`。方法或者版本不认识也返回 `false`，因为后面没法处理。路径和查询串按第一个 `?` 拆开，没有 `?` 就把整段当路径，查询串设成空串。

## 3.3 头部

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

每一行头就是一次 `processHeaders`。它只在行里找冒号，找到就交给 `addHeader` 去切字段名和值，找不到就跳过这一行。畸形头属于能容忍的一类，不值得为它终止整个请求。

头部什么时候结束，是靠 CRLF 落在行首来判定的，这个判断在 `parseRequest` 的 `ExpectHeaders` 分支里。空行本身要从缓冲区里消费掉，然后进入 `processHeadersEnd`。

`processHeadersEnd` 决定这条请求有没有 body。正常情况下看 `Content-Length`，大于 0 就进 `ExpectBody`，否则直接进 `GotAll`。

这里有一个额外检查，`transfer-encoding` 存在就直接返回 `false`。HTTP 还有另一种定 body 长度的方法叫分块传输，它不用 `Content-Length`，而是每段前面写十六进制长度。本实现没有做这个，如果只是单纯地忽略这个头，那么一个 chunked 请求会被当成没有 body 来处理，解析出来的请求内容是错的，而且不会报错。所以这里选择明确地判为非法请求，宁可给客户端一个 400，也不要静默地出错。

## 3.4 请求体

```cpp
void HttpContext::processBody(const char* begin, const char* end) {
    request_.setBody(std::string(begin, end));
}
```

请求体的处理是整个解析器里最简单的一段，它只做一次拷贝。

关键在于它前面的判断条件，`buf->readableBytes() >= len`。数据不够就什么都不做，`state_` 保持不变，等下一次数据到了重新进这个分支。因为状态位还停在 `ExpectBody`，下次会接着数，不会跑偏。

这一段里没有出现 `findCRLF`。请求体没有分隔符，只能靠字数。如果这里也去找 CRLF，那么当 body 里恰好包含 `\r\n`（比如上传一个二进制文件）时，解析就会跑偏。

## 3.5 错误处理

解析器对错误的容忍度是分级的。

**必须返回 `false` 的**，是那些会让后续无法继续的错误。方法不认识、版本不认识、`Content-Length` 非法或超限、用了不支持的 `transfer-encoding`。这些情况下就算硬着头皮往下解析，解析出来的东西也没有意义。

**可以跳过的**，是单个头字段里没有冒号这种。它只影响这一个头，不影响整条请求的结构。

`parseRequest` 返回 `false` 之后，`HttpServer` 会发一个 400 然后关掉连接。之所以要关连接，是因为报文已经乱了，缓冲区里剩下的字节是什么完全不可知，继续解析只会越错越离谱。

---

# 4. HttpServer

最后一个类负责把所有东西接起来。

## 4.1 连接上下文

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

`HttpServer` 本身不继承也不包装 `TcpServer`，只是持有一个作为成员，然后把三个回调转发进来。这个是组装的关系，服务器该有的能力还是 `TcpServer` 提供的。

`onConnection` 里只处理 `connected()` 为真的一侧。连接建立时创建一个 `HttpContext` 挂上去，连接关闭时由 `onClose` 擦除。这里必须有个地方做清理，忘了擦除就是内存泄漏，因为 map 的 key 是一个裸指针，连接对象销毁之后那个 key 就永远悬在那里了。

解析状态必须挂在连接上，而不是跟着某一批数据走。`onMessage` 每次收到数据时，要能找回这条连接上次解析到哪了。

`connectionContexts_` 这张表是所有连接共用的，而连接被轮询分配到不同的 ioLoop 上，每条连接跑在自己的线程里，所以多个线程会同时查它、插入它、删除它。这就是 `contextMutex_` 存在的理由。

加锁的位置只有三处，都在 `onConnection`、`onMessage`、`onClose` 里，每次都是查一下或改一下就出来。真正耗时的解析和业务处理放在锁外，`onMessage` 先把 `shared_ptr` 拷出来再放开锁，就是为了这个。

用 `shared_ptr` 而不是直接存 `HttpContext` 对象，也是同一个考虑。即使在锁外拿到了 `shared_ptr`，也能保证这个对象在解析期间不会被别的线程删掉。

`HttpContext` 自己不需要额外加锁。虽然多个连接的 `HttpContext` 存在同一张 map 里，但每条连接的 `HttpContext` 只会被它自己那条连接的 ioLoop 线程使用，天然是单线程访问的。需要保护的只是那张共享的 map。

## 4.2 请求处理循环

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

这个 `while (true)` 是整层里唯一一个循环，它的存在是为了处理一次 `read` 里有多个请求的情况。

假设一次 `read` 收到了两个完整的 GET 请求，这里应该把它们都处理掉，而不是处理完第一个就返回、等下一次可读事件再来处理第二个。因为第二个请求的数据已经在缓冲区里了，内核不会再为它触发一次可读事件，如果这里不处理，它就永远卡在缓冲区里。

循环的出口有三个。解析失败，发 400 后返回。请求不完整，直接返回等下次数据。响应要求关闭连接，发完就 `shutdown`。

`context->reset()` 放在循环末尾而不是开头，这样每次循环开始时 `HttpContext` 都是干净的状态，可以解析下一个请求。

输出缓冲提到循环外面声明，是为了让整条连接复用一个 `Buffer`。每次 `retrieveAsString` 都会把内容取走，所以下一轮开始时它是空的。

## 4.3 路由与错误响应

路由查找是一个 `unordered_map` 的直接命中，注册了 `/hello` 就只能命中 `/hello`。

找不到精确匹配时，先退到全局回调 `httpCallback_`。只有它也没设置，才返回 404。所以一个设置了全局回调的服务器，即使某个路径没有注册路由，也不会返回 404，而是会落到全局回调里由业务自己决定。

本来这个全局回调是给用户设置默认处理逻辑用的，实际用起来更常见的是直接在路由回调里处理所有路径。

400 和 404 这两条路径都默认关闭连接，但原因不同。400 是因为报文已经乱了，没法继续解析。404 是因为这条路径没人管，继续留着连接也没有意义，不过如果业务代码在回调里显式改了 `closeConnection`，还是以业务为准。

响应是否关闭连接，统一以 `HttpResponse::closeConnection()` 为准，代码里没有再看一次 `request.isKeepAlive()`。这样业务代码才有机会覆盖默认值。
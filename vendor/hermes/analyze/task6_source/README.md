# Bottle 框架功能扩展任务

你面前是 [Bottle](https://bottlepy.org/) Web 微框架的完整源码（`bottle.py`，约 4500 行）。
这是一个真实的开源项目，当前版本功能完整，所有现有测试均可通过。

你的任务是 **为 Bottle 框架添加 4 个新的 Plugin**，实现以下功能：

---

## 功能 1：Session 插件（SessionPlugin）

基于签名 Cookie 的服务端无状态会话管理。

### 接口规范

```python
from bottle import Bottle, request, response
from bottle_plugins import SessionPlugin

app = Bottle()
app.install(SessionPlugin(secret='my-secret-key', cookie_name='bottle.session', max_age=3600))

@app.route('/set')
def set_session():
    request.session['user'] = 'alice'       # 写入 session
    request.session['role'] = 'admin'
    return 'ok'

@app.route('/get')
def get_session():
    user = request.session.get('user', '')  # 读取 session
    return f'hello {user}'

@app.route('/delete')
def delete_session():
    del request.session['user']             # 删除单个 key
    return 'ok'

@app.route('/clear')
def clear_session():
    request.session.clear()                 # 清空 session
    return 'ok'
```

### 详细要求
- 在 `bottle_plugins.py` 中实现 `SessionPlugin` 类
- Session 数据通过签名 Cookie 存储（无需服务端存储）
- Cookie 值格式：`base64(json_data).base64(hmac_sha256_signature)`
- 签名使用 HMAC-SHA256，密钥为 `secret` 参数
- `request.session` 是一个 dict-like 对象，支持 `get`/`set`/`del`/`clear`/`in`/`len`
- 只有在 session 数据发生变化时才设置响应 Cookie
- 签名验证失败时返回空 session（不报错）
- Cookie 被篡改时返回空 session（不报错）
- `max_age` 控制 Cookie 过期时间（秒），传递给 `response.set_cookie`
- `cookie_name` 默认为 `"bottle.session"`
- Plugin 的 `name` 属性为 `"session"`，`api = 2`

---

## 功能 2：CORS 插件（CORSPlugin）

处理跨域资源共享（Cross-Origin Resource Sharing）。

### 接口规范

```python
from bottle_plugins import CORSPlugin

app = Bottle()
app.install(CORSPlugin(
    allow_origins=['http://example.com', 'http://localhost:3000'],
    allow_methods=['GET', 'POST', 'PUT', 'DELETE'],
    allow_headers=['Content-Type', 'Authorization'],
    expose_headers=['X-Custom-Header'],
    max_age=86400,
    allow_credentials=True
))

# 普通请求自动添加 CORS 头
@app.route('/api/data')
def get_data():
    return {'msg': 'hello'}

# OPTIONS 预检请求自动处理
# 无需手动定义 OPTIONS 路由
```

### 详细要求
- 在 `bottle_plugins.py` 中实现 `CORSPlugin` 类
- Plugin 的 `name` 属性为 `"cors"`，`api = 2`
- `allow_origins`：允许的源列表，`['*']` 表示允许所有源
- `allow_methods`：允许的 HTTP 方法列表，默认 `['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']`
- `allow_headers`：允许的请求头列表，默认 `['Content-Type', 'Authorization']`
- `expose_headers`：浏览器可访问的响应头列表，默认 `[]`
- `max_age`：预检缓存时间（秒），默认 `None`（不设置）
- `allow_credentials`：是否允许携带凭证，默认 `False`
- **普通请求**：在响应中添加 `Access-Control-Allow-Origin` 头
  - 如果 `allow_origins` 包含 `'*'` 且 `allow_credentials` 为 `False`，设为 `'*'`
  - 否则检查请求的 `Origin` 头是否在允许列表中，是则回显该 Origin
  - Origin 不在列表中时不添加 CORS 头
- **预检请求**（OPTIONS 且有 `Access-Control-Request-Method`）：
  - 返回 204 状态码，空 body
  - 添加 `Access-Control-Allow-Methods`、`Access-Control-Allow-Headers`
  - 如果设置了 `max_age`，添加 `Access-Control-Max-Age`
- `allow_credentials` 为 `True` 时添加 `Access-Control-Allow-Credentials: true`
- `expose_headers` 非空时添加 `Access-Control-Expose-Headers`
- 在 `setup(app)` 中为 app 添加全局 OPTIONS 路由处理器

---

## 功能 3：限流插件（RateLimitPlugin）

基于内存的请求限流，按客户端 IP 限制请求速率。

### 接口规范

```python
from bottle_plugins import RateLimitPlugin

app = Bottle()
app.install(RateLimitPlugin(
    limit=100,           # 每个窗口最大请求数
    window=60,           # 窗口大小（秒）
    key_func=None        # 自定义限流 key 函数，默认按 IP
))

@app.route('/api/data')
def get_data():
    return {'msg': 'ok'}

# 超过限制时自动返回 429 Too Many Requests
# 响应头包含限流信息：
#   X-RateLimit-Limit: 100
#   X-RateLimit-Remaining: 99
#   X-RateLimit-Reset: <window_end_timestamp>
```

### 详细要求
- 在 `bottle_plugins.py` 中实现 `RateLimitPlugin` 类
- Plugin 的 `name` 属性为 `"ratelimit"`，`api = 2`
- 使用固定窗口算法（Fixed Window）
- 默认按 `request.remote_addr` 作为限流 key
- `key_func` 是一个可选的 callable，接收无参数，返回字符串作为限流 key
  - 例如：`key_func=lambda: request.remote_addr + ':' + request.path` 可实现按 IP+路径 限流
- 每次请求添加以下响应头：
  - `X-RateLimit-Limit`：窗口内最大请求数
  - `X-RateLimit-Remaining`：窗口内剩余请求数（最小为 0）
  - `X-RateLimit-Reset`：当前窗口结束的 Unix 时间戳（整数）
- 超过限制时：
  - 返回 HTTP 429 状态码
  - 响应 body 为 `"Rate limit exceeded"`
  - 添加 `Retry-After` 头，值为当前窗口剩余秒数（整数）
- 限流数据存储在内存中（dict），不需要持久化
- 窗口过期后自动重置计数

---

## 功能 4：ETag 缓存插件（ETagPlugin）

自动为响应生成 ETag，支持条件请求（304 Not Modified）。

### 接口规范

```python
from bottle_plugins import ETagPlugin

app = Bottle()
app.install(ETagPlugin(hash_func='md5'))

@app.route('/page')
def page():
    return '<h1>Hello World</h1>'

# 首次请求：正常返回 200 + ETag 头
# 后续请求带 If-None-Match：匹配则返回 304，不匹配返回 200
```

### 详细要求
- 在 `bottle_plugins.py` 中实现 `ETagPlugin` 类
- Plugin 的 `name` 属性为 `"etag"`，`api = 2`
- `hash_func`：哈希算法名称，默认 `'md5'`，也支持 `'sha1'`、`'sha256'`
- 响应 body 的处理：
  - 收集完整响应 body 后计算 hash
  - 生成格式为 `'"hash_hex"'`（带双引号）的 ETag 值
  - 设置响应头 `ETag`
- 条件请求处理：
  - 检查请求头 `If-None-Match`
  - 如果 `If-None-Match` 的值与生成的 ETag 匹配，返回 304 Not Modified（空 body）
  - `If-None-Match` 可能包含多个 ETag（逗号分隔），任一匹配即可
  - `If-None-Match: *` 匹配任何 ETag
- 只对 GET 和 HEAD 请求生效
- 只对 200 状态码的响应生效
- 对非字符串/bytes 响应体（如文件迭代器）不处理，直接跳过
- 空 body 不生成 ETag

---

## 文件结构

请在项目根目录创建 `bottle_plugins.py` 文件：

```
bottle.py              # 已有，不要修改
bottle_plugins.py      # 你需要创建这个文件
```

**重要**：
- 不要修改 `bottle.py`
- 所有 4 个 Plugin 都在 `bottle_plugins.py` 中实现
- 可以 `import bottle` 使用 Bottle 的内部 API
- 只使用 Python 标准库，不要引入第三方依赖

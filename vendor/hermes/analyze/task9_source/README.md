# Jinja2 自定义扩展开发

你需要创建 `jinja2_extensions.py`（位于工作区根目录），实现以下两个 Jinja2 模板扩展。

## 扩展 1: SpacelessExtension

移除 HTML 标签之间的空白字符。

### 语法

```jinja
{% spaceless %}
    <p>
        <a href="foo/">Foo</a>
    </p>
{% endspaceless %}
```

### 输出

```html
<p><a>Foo</a></p>
```

### 规则

- 移除 HTML 标签 `>` 和 `<` 之间的所有空白（包括空格、换行、制表符）
- 保留标签内部的文本内容（如 `<p>  Hello  </p>` 中的空格不变）
- 对块的前后空白也进行 strip
- 支持与 Jinja2 模板标签（`{{ }}`, `{% %}` 等）混用

### 实现要点

- 继承 `jinja2.ext.Extension`
- 设置 `tags = {"spaceless"}`
- 实现 `parse()` 方法，解析 `{% spaceless %}...{% endspaceless %}` 块
- 使用 `nodes.CallBlock` 将渲染后的内容传递给 Python 回调函数进行后处理


## 扩展 2: SwitchExtension

实现类似编程语言中 switch/case 的控制结构。

### 语法

```jinja
{% switch variable %}
    {% case "value1" %}
        This is shown for value1.
    {% case "value2" %}
        This is shown for value2.
    {% default %}
        This is the default.
{% endswitch %}
```

### 规则

- `{% switch expr %}` 中的表达式只求值一次
- 依次与每个 `{% case value %}` 的值进行比较（等值比较）
- 渲染第一个匹配的 case 块
- 如果没有匹配且存在 `{% default %}` 块，则渲染 default 块
- 如果没有匹配也没有 default，则不输出任何内容
- `{% default %}` 是可选的，如果存在，必须在所有 case 之后
- case 值可以是整数、字符串、布尔值、None 等 Jinja2 表达式
- case 块内可以包含任意 Jinja2 模板内容（变量、for 循环、if 语句等）

### 实现要点

- 继承 `jinja2.ext.Extension`
- 设置 `tags = {"switch"}`
- 实现 `parse()` 方法：
  1. 解析 switch 表达式
  2. 用 `parser.parse_statements()` 配合 `drop_needle=False` 解析各 case/default/endswitch 子块
  3. 将 case 分支编译为 `nodes.If` / elif / else 链（使用 `nodes.Compare` + `nodes.Operand("eq", ...)` 进行等值比较）


## 导入和使用方式

```python
from jinja2 import Environment
from jinja2_extensions import SpacelessExtension, SwitchExtension

env = Environment(extensions=[SpacelessExtension, SwitchExtension])
```

## 技术参考

- Jinja2 Extension API: `jinja2.ext.Extension`
- 关键类: `jinja2.nodes.CallBlock`, `jinja2.nodes.If`, `jinja2.nodes.Compare`, `jinja2.nodes.Operand`
- 解析方法: `parser.parse_statements()`, `parser.parse_expression()`

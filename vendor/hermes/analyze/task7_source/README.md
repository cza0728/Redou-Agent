# Markdown 解析器实现任务

请从零实现一个 Markdown 到 HTML 的转换器。

## 接口要求

在 `markdown_parser.py` 文件中实现以下函数：

```python
def parse(text: str) -> str:
    """将 Markdown 文本转换为 HTML 字符串。

    Args:
        text: Markdown 格式的文本

    Returns:
        对应的 HTML 字符串
    """
```

## 支持的语法

### 一、块级元素

#### 1. 标题（ATX 风格）

`#` 到 `######` 表示 1-6 级标题。`#` 后必须有空格。

```
输入: "# Hello"
输出: "<h1>Hello</h1>"

输入: "## Sub title"
输出: "<h2>Sub title</h2>"

输入: "###### Level 6"
输出: "<h6>Level 6</h6>"
```

- `#` 后没有空格时不视为标题（如 `"#NoSpace"` → `"<p>#NoSpace</p>"`）
- 标题文本首尾空白应去除
- 标题末尾的 `#` 号应去除（如 `"# Hello ##"` → `"<h1>Hello</h1>"`）

#### 2. 段落

连续的非空文本行组成一个段落，用 `<p>` 包裹。段落之间用空行分隔。

```
输入: "Hello\nWorld"
输出: "<p>Hello\nWorld</p>"

输入: "Para 1\n\nPara 2"
输出: "<p>Para 1</p>\n<p>Para 2</p>"
```

- 段落内的换行保留为 `\n`
- 多个连续空行等同于一个空行

#### 3. 代码块（围栏式）

三个或更多反引号开始和结束，可指定语言。

````
输入: "```python\nprint('hi')\n```"
输出: "<pre><code class=\"language-python\">print('hi')\n</code></pre>"

输入: "```\nplain code\n```"
输出: "<pre><code>plain code\n</code></pre>"
````

- 代码块内的内容不做任何 Markdown 解析
- 代码块内的 HTML 特殊字符需要转义（`<` → `&lt;`，`>` → `&gt;`，`&` → `&amp;`）
- 代码块内容末尾保留一个 `\n`

#### 4. 引用块

以 `>` 开头的行组成引用块。支持嵌套。

```
输入: "> Hello"
输出: "<blockquote><p>Hello</p></blockquote>"

输入: "> Line 1\n> Line 2"
输出: "<blockquote><p>Line 1\nLine 2</p></blockquote>"

输入: "> > Nested"
输出: "<blockquote><blockquote><p>Nested</p></blockquote></blockquote>"
```

- 引用块内可以包含段落、标题等其他 Markdown 元素
- `>` 后的空格是可选的

#### 5. 无序列表

以 `-`、`*` 或 `+` 开头（后跟空格）的行组成无序列表。

```
输入: "- item 1\n- item 2"
输出: "<ul>\n<li>item 1</li>\n<li>item 2</li>\n</ul>"
```

- 缩进 2 个或更多空格表示嵌套列表

```
输入: "- a\n  - b\n  - c\n- d"
输出: "<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul>\n</li>\n<li>d</li>\n</ul>"
```

#### 6. 有序列表

以 `数字.` 开头（后跟空格）的行组成有序列表。

```
输入: "1. first\n2. second"
输出: "<ol>\n<li>first</li>\n<li>second</li>\n</ol>"
```

- 输出的 `<ol>` 不需要 `start` 属性
- 支持与无序列表相同的嵌套规则

#### 7. 水平线

三个或更多 `-`、`*` 或 `_`（中间可有空格）单独成行。

```
输入: "---"
输出: "<hr />"

输入: "* * *"
输出: "<hr />"
```

### 二、行内元素

#### 1. 粗体

用 `**` 或 `__` 包裹。

```
输入: "**bold**"
输出（在段落中）: "<p><strong>bold</strong></p>"
```

#### 2. 斜体

用 `*` 或 `_` 包裹。

```
输入: "*italic*"
输出（在段落中）: "<p><em>italic</em></p>"
```

#### 3. 粗斜体

用 `***` 或 `___` 包裹。

```
输入: "***bold italic***"
输出（在段落中）: "<p><em><strong>bold italic</strong></em></p>"
```

#### 4. 行内代码

用反引号包裹。

```
输入: "Use `print()` here"
输出（在段落中）: "<p>Use <code>print()</code> here</p>"
```

- 行内代码中的 HTML 特殊字符需要转义

#### 5. 链接

```
输入: "[click here](https://example.com)"
输出（在段落中）: "<p><a href=\"https://example.com\">click here</a></p>"
```

#### 6. 图片

```
输入: "![alt text](image.png)"
输出（在段落中）: "<p><img src=\"image.png\" alt=\"alt text\" /></p>"
```

#### 7. 删除线

用 `~~` 包裹。

```
输入: "~~deleted~~"
输出（在段落中）: "<p><del>deleted</del></p>"
```

### 三、HTML 转义

在非代码上下文中，以下字符如果出现在 HTML 标签之外，**不需要**自动转义。
但在代码块和行内代码中，必须转义：

- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`

### 四、转义字符

反斜杠 `\` 可以转义以下 Markdown 特殊字符，使其按字面量显示：

```
\*  \#  \[  \]  \(  \)  \`  \\  \-  \_  \~  \!  \>
```

例如：`"\*not bold\*"` → `"<p>*not bold*</p>"`

---

## 文件结构

请在项目根目录创建 `markdown_parser.py` 文件：

```
README.md              # 本规范文档
markdown_parser.py     # 你需要创建这个文件
```

## 约束

- 只使用 Python 标准库，不要引入第三方依赖
- 不要使用 `re` 以外的解析库
- 输出的 HTML 不需要缩进美化，但结构必须正确
- 空输入返回空字符串

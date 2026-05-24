# -*- coding: utf-8 -*-
"""Intermediate level tests: lists, links, images, code blocks."""
import sys, os, unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
from markdown_parser import parse


class TestUnorderedList(unittest.TestCase):
    def test_simple_list(self):
        result = parse("- item 1\n- item 2")
        self.assertIn("<ul>", result)
        self.assertIn("<li>item 1</li>", result)
        self.assertIn("<li>item 2</li>", result)
        self.assertIn("</ul>", result)

    def test_asterisk_list(self):
        result = parse("* a\n* b")
        self.assertIn("<ul>", result)
        self.assertIn("<li>a</li>", result)

    def test_plus_list(self):
        result = parse("+ x\n+ y")
        self.assertIn("<ul>", result)
        self.assertIn("<li>x</li>", result)

    def test_single_item(self):
        result = parse("- only")
        self.assertIn("<ul>", result)
        self.assertIn("<li>only</li>", result)

    def test_nested_list(self):
        result = parse("- a\n  - b\n  - c\n- d")
        self.assertIn("<ul>", result)
        self.assertIn("<li>a", result)
        self.assertIn("<li>b</li>", result)
        self.assertIn("<li>c</li>", result)
        self.assertIn("<li>d</li>", result)
        # Should have nested ul
        self.assertTrue(result.count("<ul>") >= 2)

    def test_list_with_inline_formatting(self):
        result = parse("- **bold item**\n- *italic item*")
        self.assertIn("<strong>bold item</strong>", result)
        self.assertIn("<em>italic item</em>", result)


class TestOrderedList(unittest.TestCase):
    def test_simple_ordered(self):
        result = parse("1. first\n2. second\n3. third")
        self.assertIn("<ol>", result)
        self.assertIn("<li>first</li>", result)
        self.assertIn("<li>second</li>", result)
        self.assertIn("<li>third</li>", result)
        self.assertIn("</ol>", result)

    def test_single_ordered_item(self):
        result = parse("1. only")
        self.assertIn("<ol>", result)
        self.assertIn("<li>only</li>", result)

    def test_nested_ordered(self):
        result = parse("1. a\n  1. b\n2. c")
        self.assertTrue(result.count("<ol>") >= 2 or result.count("<li>") >= 3)

    def test_ordered_with_inline(self):
        result = parse("1. **bold**\n2. `code`")
        self.assertIn("<strong>bold</strong>", result)
        self.assertIn("<code>code</code>", result)


class TestLinks(unittest.TestCase):
    def test_simple_link(self):
        result = parse("[click](https://example.com)")
        self.assertIn('<a href="https://example.com">click</a>', result)

    def test_link_in_text(self):
        result = parse("Visit [Google](https://google.com) today")
        self.assertIn('<a href="https://google.com">Google</a>', result)
        self.assertIn("Visit ", result)

    def test_multiple_links(self):
        result = parse("[a](1) and [b](2)")
        self.assertIn('<a href="1">a</a>', result)
        self.assertIn('<a href="2">b</a>', result)

    def test_link_with_special_chars_in_text(self):
        result = parse("[bold **link**](url)")
        self.assertIn("href=", result)


class TestImages(unittest.TestCase):
    def test_simple_image(self):
        result = parse("![alt](image.png)")
        self.assertIn('<img src="image.png" alt="alt"', result)

    def test_image_in_text(self):
        result = parse("See ![photo](pic.jpg) here")
        self.assertIn('<img src="pic.jpg" alt="photo"', result)

    def test_image_empty_alt(self):
        result = parse("![](image.png)")
        self.assertIn('<img src="image.png" alt=""', result)


class TestCodeBlock(unittest.TestCase):
    def test_code_block_with_language(self):
        md = "```python\nprint('hi')\n```"
        result = parse(md)
        self.assertIn('<pre><code class="language-python">', result)
        self.assertIn("print('hi')", result)
        self.assertIn("</code></pre>", result)

    def test_code_block_no_language(self):
        md = "```\nhello\n```"
        result = parse(md)
        self.assertIn("<pre><code>", result)
        self.assertIn("hello", result)

    def test_code_block_escapes_html(self):
        md = "```\n<div>&amp;</div>\n```"
        result = parse(md)
        self.assertIn("&lt;div&gt;", result)
        self.assertIn("&amp;amp;", result)

    def test_code_block_no_markdown_parsing(self):
        md = "```\n**not bold**\n```"
        result = parse(md)
        self.assertNotIn("<strong>", result)
        self.assertIn("**not bold**", result)

    def test_code_block_preserves_whitespace(self):
        md = "```\n  indented\n    more\n```"
        result = parse(md)
        self.assertIn("  indented", result)
        self.assertIn("    more", result)

    def test_code_block_multiline(self):
        md = "```\nline1\nline2\nline3\n```"
        result = parse(md)
        self.assertIn("line1\nline2\nline3", result)

    def test_code_block_between_paragraphs(self):
        md = "Before\n\n```\ncode\n```\n\nAfter"
        result = parse(md)
        self.assertIn("<p>Before</p>", result)
        self.assertIn("<pre><code>", result)
        self.assertIn("<p>After</p>", result)


class TestBlockquote(unittest.TestCase):
    def test_simple_quote(self):
        result = parse("> Hello")
        self.assertIn("<blockquote>", result)
        self.assertIn("Hello", result)
        self.assertIn("</blockquote>", result)

    def test_multiline_quote(self):
        result = parse("> Line 1\n> Line 2")
        self.assertIn("<blockquote>", result)
        self.assertIn("Line 1", result)
        self.assertIn("Line 2", result)

    def test_nested_quote(self):
        result = parse("> > Nested")
        self.assertTrue(result.count("<blockquote>") >= 2)
        self.assertIn("Nested", result)

    def test_quote_with_heading(self):
        result = parse("> # Title")
        self.assertIn("<blockquote>", result)
        self.assertIn("<h1>Title</h1>", result)

    def test_quote_no_space_after_gt(self):
        result = parse(">Hello")
        self.assertIn("<blockquote>", result)
        self.assertIn("Hello", result)


class TestHeadingAfterParagraph(unittest.TestCase):
    def test_heading_then_paragraph(self):
        result = parse("# Title\n\nContent here")
        self.assertIn("<h1>Title</h1>", result)
        self.assertIn("<p>Content here</p>", result)

    def test_paragraph_then_heading(self):
        result = parse("Content\n\n## Heading")
        self.assertIn("<p>Content</p>", result)
        self.assertIn("<h2>Heading</h2>", result)


class TestListAfterParagraph(unittest.TestCase):
    def test_paragraph_then_list(self):
        result = parse("Text\n\n- item 1\n- item 2")
        self.assertIn("<p>Text</p>", result)
        self.assertIn("<ul>", result)
        self.assertIn("<li>item 1</li>", result)

    def test_list_then_paragraph(self):
        result = parse("- item\n\nText")
        self.assertIn("<ul>", result)
        self.assertIn("<p>Text</p>", result)


if __name__ == '__main__':
    unittest.main()

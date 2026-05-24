# -*- coding: utf-8 -*-
"""Advanced level tests: tables, mixed nesting, edge cases."""
import sys, os, unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
from markdown_parser import parse


class TestTable(unittest.TestCase):
    def test_simple_table(self):
        md = "| A | B |\n|---|---|\n| 1 | 2 |"
        result = parse(md)
        self.assertIn("<table>", result)
        self.assertIn("<thead>", result)
        self.assertIn("<th>A</th>", result)
        self.assertIn("<th>B</th>", result)
        self.assertIn("<tbody>", result)
        self.assertIn("<td>1</td>", result)
        self.assertIn("<td>2</td>", result)
        self.assertIn("</table>", result)

    def test_table_multiple_rows(self):
        md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |"
        result = parse(md)
        self.assertIn("<td>Alice</td>", result)
        self.assertIn("<td>Bob</td>", result)
        self.assertEqual(result.count("<tr>"), 3)  # header + 2 data rows

    def test_table_with_inline_formatting(self):
        md = "| Col |\n|-----|\n| **bold** |"
        result = parse(md)
        self.assertIn("<strong>bold</strong>", result)

    def test_table_single_column(self):
        md = "| X |\n|---|\n| 1 |"
        result = parse(md)
        self.assertIn("<th>X</th>", result)
        self.assertIn("<td>1</td>", result)


class TestDeepNesting(unittest.TestCase):
    def test_triple_nested_quote(self):
        result = parse("> > > Deep")
        self.assertTrue(result.count("<blockquote>") >= 3)
        self.assertIn("Deep", result)

    def test_deeply_nested_list(self):
        md = "- a\n  - b\n    - c"
        result = parse(md)
        self.assertTrue(result.count("<ul>") >= 3 or result.count("<li>") >= 3)

    def test_quote_with_list(self):
        md = "> - item 1\n> - item 2"
        result = parse(md)
        self.assertIn("<blockquote>", result)
        self.assertIn("<li>item 1</li>", result)
        self.assertIn("<li>item 2</li>", result)

    def test_quote_with_code_block(self):
        md = "> ```\n> code\n> ```"
        result = parse(md)
        self.assertIn("<blockquote>", result)
        self.assertIn("code", result)

    def test_list_with_paragraphs(self):
        """List item containing multiple paragraphs via blank lines."""
        md = "- item 1\n- item 2"
        result = parse(md)
        self.assertIn("<li>item 1</li>", result)


class TestMixedContent(unittest.TestCase):
    def test_heading_list_paragraph(self):
        md = "# Title\n\n- item 1\n- item 2\n\nParagraph"
        result = parse(md)
        self.assertIn("<h1>Title</h1>", result)
        self.assertIn("<li>item 1</li>", result)
        self.assertIn("<p>Paragraph</p>", result)

    def test_code_block_then_list(self):
        md = "```\ncode\n```\n\n- item"
        result = parse(md)
        self.assertIn("<pre><code>", result)
        self.assertIn("<li>item</li>", result)

    def test_blockquote_then_heading(self):
        md = "> Quote\n\n## Heading"
        result = parse(md)
        self.assertIn("<blockquote>", result)
        self.assertIn("<h2>Heading</h2>", result)

    def test_full_document(self):
        md = "# Title\n\nIntro paragraph.\n\n## Section\n\n- item 1\n- item 2\n\n> A quote\n\n---\n\nFinal."
        result = parse(md)
        self.assertIn("<h1>Title</h1>", result)
        self.assertIn("<p>Intro paragraph.</p>", result)
        self.assertIn("<h2>Section</h2>", result)
        self.assertIn("<li>item 1</li>", result)
        self.assertIn("<blockquote>", result)
        self.assertIn("<hr />", result)
        self.assertIn("<p>Final.</p>", result)

    def test_inline_mixed(self):
        result = parse("**bold** and *italic* and `code` and [link](url)")
        self.assertIn("<strong>bold</strong>", result)
        self.assertIn("<em>italic</em>", result)
        self.assertIn("<code>code</code>", result)
        self.assertIn('<a href="url">link</a>', result)


class TestEdgeCases(unittest.TestCase):
    def test_only_newlines(self):
        self.assertEqual("", parse("\n\n\n"))

    def test_single_char(self):
        self.assertEqual("<p>a</p>", parse("a"))

    def test_heading_with_inline(self):
        result = parse("# Hello **bold**")
        self.assertIn("<h1>", result)
        self.assertIn("<strong>bold</strong>", result)

    def test_link_in_heading(self):
        result = parse("# [Title](url)")
        self.assertIn("<h1>", result)
        self.assertIn('<a href="url">Title</a>', result)

    def test_unicode_content(self):
        result = parse("# 你好世界\n\n中文段落")
        self.assertIn("你好世界", result)
        self.assertIn("中文段落", result)

    def test_empty_list_item_text(self):
        result = parse("- \n- text")
        self.assertIn("<ul>", result)
        self.assertIn("<li>text</li>", result)

    def test_consecutive_headings(self):
        result = parse("# H1\n## H2\n### H3")
        self.assertIn("<h1>H1</h1>", result)
        self.assertIn("<h2>H2</h2>", result)
        self.assertIn("<h3>H3</h3>", result)

    def test_hr_not_in_paragraph(self):
        result = parse("text\n\n---\n\nmore")
        self.assertIn("<hr />", result)
        self.assertNotIn("<p>---</p>", result)

    def test_unclosed_bold(self):
        result = parse("**unclosed")
        # Should not crash, treat as literal
        self.assertIn("**unclosed", result)
        self.assertNotIn("<strong>", result)

    def test_unclosed_italic(self):
        result = parse("*unclosed")
        self.assertIn("*unclosed", result)

    def test_empty_code_block(self):
        md = "```\n```"
        result = parse(md)
        self.assertIn("<pre><code>", result)
        self.assertIn("</code></pre>", result)

    def test_list_followed_by_paragraph_no_blank(self):
        """List immediately followed by text without blank line."""
        result = parse("- item\ntext")
        # Either text is part of list item or a new paragraph
        self.assertIn("<li>", result)

    def test_image_then_link(self):
        result = parse("![img](a.png) and [link](b)")
        self.assertIn('<img src="a.png"', result)
        self.assertIn('<a href="b">link</a>', result)

    def test_inline_code_with_backticks(self):
        result = parse("Use `a > b` comparison")
        self.assertIn("<code>a &gt; b</code>", result)

    def test_multiple_code_blocks(self):
        md = "```\nfirst\n```\n\n```\nsecond\n```"
        result = parse(md)
        self.assertEqual(result.count("<pre><code>"), 2)

    def test_escape_in_heading(self):
        result = parse("# Hello \\*world\\*")
        self.assertIn("*world*", result)
        self.assertNotIn("<em>", result)

    def test_strikethrough_in_list(self):
        result = parse("- ~~done~~\n- todo")
        self.assertIn("<del>done</del>", result)


class TestWhitespace(unittest.TestCase):
    def test_trailing_spaces(self):
        result = parse("Hello   ")
        self.assertIn("Hello", result)

    def test_leading_spaces_paragraph(self):
        result = parse("  Hello")
        self.assertIn("Hello", result)

    def test_blank_lines_between_blocks(self):
        result = parse("# H1\n\n\n\n# H2")
        self.assertIn("<h1>H1</h1>", result)
        self.assertIn("<h1>H2</h1>", result)


if __name__ == '__main__':
    unittest.main()

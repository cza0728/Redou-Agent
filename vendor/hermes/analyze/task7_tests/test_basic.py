# -*- coding: utf-8 -*-
"""Basic level tests: headings, paragraphs, horizontal rules, inline basics."""
import sys, os, unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
from markdown_parser import parse


class TestHeadings(unittest.TestCase):
    def test_h1(self):
        self.assertEqual("<h1>Hello</h1>", parse("# Hello"))

    def test_h2(self):
        self.assertEqual("<h2>World</h2>", parse("## World"))

    def test_h3(self):
        self.assertEqual("<h3>Title</h3>", parse("### Title"))

    def test_h4(self):
        self.assertEqual("<h4>Sub</h4>", parse("#### Sub"))

    def test_h5(self):
        self.assertEqual("<h5>Deep</h5>", parse("##### Deep"))

    def test_h6(self):
        self.assertEqual("<h6>Deepest</h6>", parse("###### Deepest"))

    def test_h1_no_space_not_heading(self):
        self.assertEqual("<p>#NoSpace</p>", parse("#NoSpace"))

    def test_heading_trailing_hashes(self):
        self.assertEqual("<h1>Hello</h1>", parse("# Hello ##"))

    def test_heading_strip_whitespace(self):
        self.assertEqual("<h1>Hello</h1>", parse("#   Hello   "))

    def test_seven_hashes_not_heading(self):
        self.assertEqual("<p>####### too many</p>", parse("####### too many"))


class TestParagraphs(unittest.TestCase):
    def test_simple_paragraph(self):
        self.assertEqual("<p>Hello</p>", parse("Hello"))

    def test_multiline_paragraph(self):
        self.assertEqual("<p>Hello\nWorld</p>", parse("Hello\nWorld"))

    def test_two_paragraphs(self):
        self.assertEqual("<p>Para 1</p>\n<p>Para 2</p>", parse("Para 1\n\nPara 2"))

    def test_multiple_blank_lines(self):
        self.assertEqual("<p>A</p>\n<p>B</p>", parse("A\n\n\n\nB"))

    def test_empty_input(self):
        self.assertEqual("", parse(""))

    def test_only_whitespace(self):
        self.assertEqual("", parse("   \n  \n   "))

    def test_three_paragraphs(self):
        result = parse("A\n\nB\n\nC")
        self.assertEqual("<p>A</p>\n<p>B</p>\n<p>C</p>", result)


class TestHorizontalRule(unittest.TestCase):
    def test_three_dashes(self):
        self.assertEqual("<hr />", parse("---"))

    def test_three_asterisks(self):
        self.assertEqual("<hr />", parse("***"))

    def test_three_underscores(self):
        self.assertEqual("<hr />", parse("___"))

    def test_spaced_asterisks(self):
        self.assertEqual("<hr />", parse("* * *"))

    def test_many_dashes(self):
        self.assertEqual("<hr />", parse("----------"))

    def test_hr_between_paragraphs(self):
        result = parse("Above\n\n---\n\nBelow")
        self.assertIn("<hr />", result)
        self.assertIn("<p>Above</p>", result)
        self.assertIn("<p>Below</p>", result)


class TestInlineBold(unittest.TestCase):
    def test_double_asterisk(self):
        self.assertEqual("<p><strong>bold</strong></p>", parse("**bold**"))

    def test_double_underscore(self):
        self.assertEqual("<p><strong>bold</strong></p>", parse("__bold__"))

    def test_bold_in_text(self):
        result = parse("Hello **world** end")
        self.assertIn("<strong>world</strong>", result)
        self.assertIn("Hello ", result)

    def test_multiple_bold(self):
        result = parse("**a** and **b**")
        self.assertEqual(result.count("<strong>"), 2)


class TestInlineItalic(unittest.TestCase):
    def test_single_asterisk(self):
        self.assertEqual("<p><em>italic</em></p>", parse("*italic*"))

    def test_single_underscore(self):
        self.assertEqual("<p><em>italic</em></p>", parse("_italic_"))

    def test_italic_in_text(self):
        result = parse("Hello *world* end")
        self.assertIn("<em>world</em>", result)


class TestInlineCode(unittest.TestCase):
    def test_inline_code(self):
        result = parse("Use `print()` here")
        self.assertIn("<code>print()</code>", result)

    def test_inline_code_escapes_html(self):
        result = parse("Use `<div>` tag")
        self.assertIn("<code>&lt;div&gt;</code>", result)

    def test_inline_code_no_markdown(self):
        result = parse("`**not bold**`")
        self.assertIn("<code>**not bold**</code>", result)


class TestBoldItalic(unittest.TestCase):
    def test_triple_asterisk(self):
        result = parse("***bold italic***")
        self.assertIn("<strong>", result)
        self.assertIn("<em>", result)
        self.assertIn("bold italic", result)

    def test_bold_and_italic_nested(self):
        result = parse("**bold and *italic* inside**")
        self.assertIn("<strong>", result)
        self.assertIn("<em>italic</em>", result)


class TestStrikethrough(unittest.TestCase):
    def test_strikethrough(self):
        self.assertEqual("<p><del>deleted</del></p>", parse("~~deleted~~"))

    def test_strikethrough_in_text(self):
        result = parse("Hello ~~old~~ world")
        self.assertIn("<del>old</del>", result)


class TestEscape(unittest.TestCase):
    def test_escape_asterisk(self):
        result = parse("\\*not bold\\*")
        self.assertIn("*not bold*", result)
        self.assertNotIn("<em>", result)
        self.assertNotIn("<strong>", result)

    def test_escape_hash(self):
        result = parse("\\# not a heading")
        self.assertNotIn("<h1>", result)
        self.assertIn("# not a heading", result)

    def test_escape_backslash(self):
        result = parse("\\\\")
        self.assertIn("\\", result)

    def test_escape_backtick(self):
        result = parse("\\`not code\\`")
        self.assertNotIn("<code>", result)


if __name__ == '__main__':
    unittest.main()

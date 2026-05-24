"""Tests for the custom Jinja2 extensions: SpacelessExtension and SwitchExtension.

These extensions should be implemented in jinja2_extensions.py at the workspace root.
"""
import pytest
from jinja2 import Environment


# ---------------------------------------------------------------------------
# Helper: create environments with extensions
# ---------------------------------------------------------------------------

def _make_spaceless_env(**kwargs):
    from jinja2_extensions import SpacelessExtension
    return Environment(extensions=[SpacelessExtension], **kwargs)


def _make_switch_env(**kwargs):
    from jinja2_extensions import SwitchExtension
    return Environment(extensions=[SwitchExtension], **kwargs)


def _make_both_env(**kwargs):
    from jinja2_extensions import SpacelessExtension, SwitchExtension
    return Environment(extensions=[SpacelessExtension, SwitchExtension], **kwargs)


# ===========================================================================
# SpacelessExtension Tests
# ===========================================================================

class TestSpacelessBasic:
    """Basic functionality of {% spaceless %}."""

    def test_simple_whitespace_removal(self):
        env = _make_spaceless_env()
        t = env.from_string("{% spaceless %}  <p>  <a>foo</a>  </p>  {% endspaceless %}")
        assert t.render() == "<p><a>foo</a></p>"

    def test_newlines_between_tags(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}\n<p>\n    <a>foo</a>\n</p>\n{% endspaceless %}"
        )
        assert t.render() == "<p><a>foo</a></p>"

    def test_preserves_text_content(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<p>  Hello   World  </p>{% endspaceless %}"
        )
        assert t.render() == "<p>  Hello   World  </p>"

    def test_preserves_text_between_inline_tags(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<span>hello</span> <span>world</span>{% endspaceless %}"
        )
        # Whitespace between tags that also contains text is kept
        # Actually > < with only whitespace between = removed
        assert t.render() == "<span>hello</span><span>world</span>"

    def test_empty_content(self):
        env = _make_spaceless_env()
        t = env.from_string("{% spaceless %}{% endspaceless %}")
        assert t.render() == ""

    def test_only_whitespace(self):
        env = _make_spaceless_env()
        t = env.from_string("{% spaceless %}   \n   \n   {% endspaceless %}")
        assert t.render() == ""

    def test_no_html_tags(self):
        env = _make_spaceless_env()
        t = env.from_string("{% spaceless %}Hello World{% endspaceless %}")
        assert t.render() == "Hello World"

    def test_single_tag(self):
        env = _make_spaceless_env()
        t = env.from_string("{% spaceless %}  <br>  {% endspaceless %}")
        assert t.render() == "<br>"


class TestSpacelessNested:
    """Nested HTML and template constructs within spaceless blocks."""

    def test_deeply_nested_tags(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}"
            "<div>\n  <ul>\n    <li>  item  </li>\n  </ul>\n</div>"
            "{% endspaceless %}"
        )
        assert t.render() == "<div><ul><li>  item  </li></ul></div>"

    def test_with_jinja_variables(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<p>  {{ name }}  </p>{% endspaceless %}"
        )
        assert t.render(name="Alice") == "<p>  Alice  </p>"

    def test_with_jinja_for_loop(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<ul>"
            "{% for item in items %}\n  <li>{{ item }}</li>\n{% endfor %}"
            "</ul>{% endspaceless %}"
        )
        result = t.render(items=["a", "b", "c"])
        assert result == "<ul><li>a</li><li>b</li><li>c</li></ul>"

    def test_with_jinja_if(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<div>  {% if show %}<p>visible</p>{% endif %}  </div>{% endspaceless %}"
        )
        assert t.render(show=True) == "<div><p>visible</p></div>"
        assert t.render(show=False) == "<div></div>"

    def test_multiple_blocks(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "before {% spaceless %}<p>  <a>1</a>  </p>{% endspaceless %}"
            " middle "
            "{% spaceless %}<p>  <a>2</a>  </p>{% endspaceless %} after"
        )
        assert t.render() == "before <p><a>1</a></p> middle <p><a>2</a></p> after"


class TestSpacelessEdgeCases:
    """Edge cases for spaceless extension."""

    def test_self_closing_tags(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<p>  <br/>  <img src='x'/>  </p>{% endspaceless %}"
        )
        assert t.render() == "<p><br/><img src='x'/></p>"

    def test_attributes_preserved(self):
        env = _make_spaceless_env()
        t = env.from_string(
            '{% spaceless %}<div class="foo bar">  <span id="baz">text</span>  </div>{% endspaceless %}'
        )
        assert t.render() == '<div class="foo bar"><span id="baz">text</span></div>'

    def test_mixed_content(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<td>\n    Hello\n</td>  <td>\n    World\n</td>{% endspaceless %}"
        )
        result = t.render()
        # Whitespace between </td> and <td> is removed
        assert "></td><td>" in result or result == "<td>\n    Hello\n</td><td>\n    World\n</td>"

    def test_tabs_and_spaces(self):
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<p>\t\t<span>x</span>\t\t</p>{% endspaceless %}"
        )
        assert t.render() == "<p><span>x</span></p>"

    def test_preserves_inner_whitespace_text(self):
        """Whitespace that is part of text content (not between tags) should be preserved."""
        env = _make_spaceless_env()
        t = env.from_string(
            "{% spaceless %}<pre>  code  here  </pre>{% endspaceless %}"
        )
        assert t.render() == "<pre>  code  here  </pre>"


# ===========================================================================
# SwitchExtension Tests
# ===========================================================================

class TestSwitchBasic:
    """Basic functionality of {% switch %}."""

    def test_simple_match(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}"
            "{% case 1 %}one"
            "{% case 2 %}two"
            "{% endswitch %}"
        )
        assert t.render(x=1).strip() == "one"
        assert t.render(x=2).strip() == "two"

    def test_string_match(self):
        env = _make_switch_env()
        t = env.from_string(
            '{% switch color %}'
            '{% case "red" %}RED'
            '{% case "blue" %}BLUE'
            '{% endswitch %}'
        )
        assert t.render(color="red").strip() == "RED"
        assert t.render(color="blue").strip() == "BLUE"

    def test_no_match(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}"
            "{% case 1 %}one"
            "{% case 2 %}two"
            "{% endswitch %}"
        )
        assert t.render(x=3).strip() == ""

    def test_default_case(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}"
            "{% case 1 %}one"
            "{% default %}other"
            "{% endswitch %}"
        )
        assert t.render(x=1).strip() == "one"
        assert t.render(x=99).strip() == "other"

    def test_default_only(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}"
            "{% default %}always"
            "{% endswitch %}"
        )
        assert t.render(x=42).strip() == "always"

    def test_first_match_wins(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}"
            "{% case 1 %}first"
            "{% case 1 %}second"
            "{% endswitch %}"
        )
        assert t.render(x=1).strip() == "first"


class TestSwitchWithExpressions:
    """Switch with various expression types."""

    def test_switch_on_variable(self):
        env = _make_switch_env()
        t = env.from_string(
            '{% switch name|lower %}'
            '{% case "alice" %}A'
            '{% case "bob" %}B'
            '{% endswitch %}'
        )
        assert t.render(name="Alice").strip() == "A"
        assert t.render(name="Bob").strip() == "B"

    def test_switch_on_attribute(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch items|length %}"
            "{% case 0 %}empty"
            "{% case 1 %}single"
            "{% default %}many"
            "{% endswitch %}"
        )
        assert t.render(items=[]).strip() == "empty"
        assert t.render(items=[1]).strip() == "single"
        assert t.render(items=[1, 2]).strip() == "many"

    def test_boolean_cases(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch flag %}"
            "{% case true %}yes"
            "{% case false %}no"
            "{% endswitch %}"
        )
        assert t.render(flag=True).strip() == "yes"
        assert t.render(flag=False).strip() == "no"

    def test_none_case(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch val %}"
            "{% case none %}null"
            "{% default %}not null"
            "{% endswitch %}"
        )
        assert t.render(val=None).strip() == "null"
        assert t.render(val=42).strip() == "not null"


class TestSwitchWithTemplateContent:
    """Switch blocks containing template features."""

    def test_html_in_cases(self):
        env = _make_switch_env()
        t = env.from_string(
            '{% switch level %}'
            '{% case 1 %}<h1>Title</h1>'
            '{% case 2 %}<h2>Subtitle</h2>'
            '{% default %}<p>Text</p>'
            '{% endswitch %}'
        )
        assert t.render(level=1).strip() == "<h1>Title</h1>"
        assert t.render(level=2).strip() == "<h2>Subtitle</h2>"
        assert t.render(level=3).strip() == "<p>Text</p>"

    def test_variables_in_case_body(self):
        env = _make_switch_env()
        t = env.from_string(
            '{% switch mode %}'
            '{% case "greet" %}Hello, {{ name }}!'
            '{% case "farewell" %}Goodbye, {{ name }}!'
            '{% endswitch %}'
        )
        assert t.render(mode="greet", name="World").strip() == "Hello, World!"
        assert t.render(mode="farewell", name="World").strip() == "Goodbye, World!"

    def test_for_loop_in_case(self):
        env = _make_switch_env()
        t = env.from_string(
            '{% switch display %}'
            '{% case "list" %}<ul>{% for i in items %}<li>{{ i }}</li>{% endfor %}</ul>'
            '{% case "csv" %}{{ items|join(", ") }}'
            '{% endswitch %}'
        )
        assert t.render(display="list", items=["a", "b"]).strip() == "<ul><li>a</li><li>b</li></ul>"
        assert t.render(display="csv", items=["a", "b"]).strip() == "a, b"

    def test_if_in_case(self):
        env = _make_switch_env()
        t = env.from_string(
            '{% switch x %}'
            '{% case 1 %}{% if show %}visible{% else %}hidden{% endif %}'
            '{% endswitch %}'
        )
        assert t.render(x=1, show=True).strip() == "visible"
        assert t.render(x=1, show=False).strip() == "hidden"

    def test_switch_outside_content(self):
        """Content before and after switch is preserved."""
        env = _make_switch_env()
        t = env.from_string(
            'before '
            '{% switch x %}{% case 1 %}middle{% endswitch %}'
            ' after'
        )
        assert t.render(x=1) == "before middle after"


class TestSwitchEdgeCases:
    """Edge cases for switch extension."""

    def test_many_cases(self):
        env = _make_switch_env()
        cases = "".join(f'{{% case {i} %}}{i}' for i in range(10))
        t = env.from_string(f"{{% switch x %}}{cases}{{% endswitch %}}")
        for i in range(10):
            assert t.render(x=i).strip() == str(i)

    def test_empty_case_body(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}"
            "{% case 1 %}"
            "{% case 2 %}two"
            "{% endswitch %}"
        )
        assert t.render(x=1).strip() == ""
        assert t.render(x=2).strip() == "two"

    def test_whitespace_handling(self):
        env = _make_switch_env()
        t = env.from_string(
            "{% switch x %}\n"
            "    {% case 1 %}\n"
            "        result\n"
            "    {% endswitch %}"
        )
        assert "result" in t.render(x=1)


# ===========================================================================
# Combined Tests: both extensions together
# ===========================================================================

class TestCombinedExtensions:
    """Tests using both extensions simultaneously."""

    def test_switch_inside_spaceless(self):
        env = _make_both_env()
        t = env.from_string(
            "{% spaceless %}"
            "<div>  "
            "{% switch x %}{% case 1 %}<p>one</p>{% case 2 %}<p>two</p>{% endswitch %}"
            "  </div>"
            "{% endspaceless %}"
        )
        assert t.render(x=1).strip() == "<div><p>one</p></div>"

    def test_spaceless_inside_switch(self):
        env = _make_both_env()
        t = env.from_string(
            '{% switch mode %}'
            '{% case "compact" %}{% spaceless %}<p>  <a>link</a>  </p>{% endspaceless %}'
            '{% case "normal" %}<p>  <a>link</a>  </p>'
            '{% endswitch %}'
        )
        assert t.render(mode="compact").strip() == "<p><a>link</a></p>"
        assert "  " in t.render(mode="normal")

    def test_both_extensions_loaded(self):
        """Verify both extensions can be loaded simultaneously."""
        env = _make_both_env()
        t = env.from_string(
            "{% spaceless %}<p>  <span>ok</span>  </p>{% endspaceless %}"
            "{% switch 1 %}{% case 1 %}yes{% endswitch %}"
        )
        assert t.render() == "<p><span>ok</span></p>yes"

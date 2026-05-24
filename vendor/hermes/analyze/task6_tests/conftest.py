import sys, os, platform
import pytest

# In the benchmark workspace layout, source files (bottle.py, bottle_plugins.py)
# are at the workspace root, and this conftest lives in .judge/tests/.
# We add the workspace root to sys.path so imports work.
_ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _ws_root not in sys.path:
    sys.path.insert(0, _ws_root)

# Also add tests dir itself so tools.py is importable
_tests_dir = os.path.dirname(os.path.abspath(__file__))
if _tests_dir not in sys.path:
    sys.path.insert(0, _tests_dir)


# Skip known platform-specific failures on Windows
_WIN_SKIP = {
    # stpl template \r\n vs \n differences
    ("test_stpl.py", "test_file"),
    ("test_stpl.py", "test_include"),
    ("test_stpl.py", "test_name"),
    ("test_stpl.py", "test_rebase"),
    ("test_stpl.py", "test_unicode_code"),
    # drive letter mismatch
    ("test_resources.py", "test_path_order"),
    # gzip fd issue
    ("test_sendfile.py", "test_mime_gzip"),
    # stpl in view decorator
    ("test_wsgi.py", "test_view"),
    # needs example_settings module on path
    ("test_config.py", "test_load_module"),
}


def pytest_collection_modifyitems(config, items):
    if platform.system() != 'Windows':
        return
    skip_win = pytest.mark.skip(reason="Windows platform incompatibility")
    for item in items:
        filename = os.path.basename(item.fspath)
        testname = item.name
        if (filename, testname) in _WIN_SKIP:
            item.add_marker(skip_win)

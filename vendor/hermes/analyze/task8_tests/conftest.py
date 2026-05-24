import sys
import os

# In benchmark workspace layout, source files (click/) are at workspace root,
# and this conftest lives in .judge/tests/. Add workspace root to sys.path
# so `import click` resolves to the local (buggy) version.
_ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _ws_root not in sys.path:
    sys.path.insert(0, _ws_root)

# Remove any cached click module to guarantee the local version
for _mod in list(sys.modules):
    if _mod == "click" or _mod.startswith("click."):
        del sys.modules[_mod]

import pytest

from click.testing import CliRunner


@pytest.fixture(scope="function")
def runner(request):
    return CliRunner()

import sys, os

# In the benchmark workspace layout, source files (peewee.py, playhouse/)
# are at the workspace root, and this conftest lives in .judge/tests/.
# We add the workspace root to sys.path so `import peewee` works.
_ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _ws_root not in sys.path:
    sys.path.insert(0, _ws_root)

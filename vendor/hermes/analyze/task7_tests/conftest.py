import sys, os

_ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _ws_root not in sys.path:
    sys.path.insert(0, _ws_root)

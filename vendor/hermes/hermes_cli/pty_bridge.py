"""PTY bridge for the dashboard chat tab.

The browser chat surface renders ANSI output with xterm.js. This module
puts the real Hermes TUI behind an OS pseudo-terminal and forwards bytes
between the child process and the WebSocket endpoint.

Backends:
* POSIX: ptyprocess + fcntl/termios.
* Windows: pywinpty, which wraps the native ConPTY/winpty runtime.
"""

from __future__ import annotations

import errno
import os
import queue
import sys
import threading
import time
from typing import Any, Optional, Sequence

_IS_WINDOWS = sys.platform.startswith("win")

if _IS_WINDOWS:
    try:
        from winpty import PtyProcess as _WinPtyProcess  # type: ignore

        _WINPTY_IMPORT_ERROR: Optional[BaseException] = None
    except ImportError as exc:  # pragma: no cover - depends on Windows deps
        _WinPtyProcess = None  # type: ignore
        _WINPTY_IMPORT_ERROR = exc

    ptyprocess = None  # type: ignore
    fcntl = None  # type: ignore
    select = None  # type: ignore
    signal = None  # type: ignore
    struct = None  # type: ignore
    termios = None  # type: ignore
else:
    try:
        import fcntl
        import select
        import signal
        import struct
        import termios

        import ptyprocess  # type: ignore

        _POSIX_IMPORT_ERROR: Optional[BaseException] = None
    except ImportError as exc:  # pragma: no cover - dev env without ptyprocess
        fcntl = None  # type: ignore
        select = None  # type: ignore
        signal = None  # type: ignore
        struct = None  # type: ignore
        termios = None  # type: ignore
        ptyprocess = None  # type: ignore
        _POSIX_IMPORT_ERROR = exc

    _WinPtyProcess = None  # type: ignore
    _WINPTY_IMPORT_ERROR = None


__all__ = ["PtyBridge", "PtyUnavailableError"]


class PtyUnavailableError(RuntimeError):
    """Raised when a PTY cannot be created on this platform."""


class PtyBridge:
    """Byte-oriented pseudo-terminal bridge for one child process."""

    def __init__(
        self,
        proc: Any,
        *,
        backend: str,
        fd: Optional[int] = None,
    ) -> None:
        self._proc = proc
        self._backend = backend
        self._fd = fd
        self._closed = False
        self._win_queue: Optional[queue.Queue[Optional[bytes]]] = None
        self._win_reader: Optional[threading.Thread] = None

        if backend == "winpty":
            self._win_queue = queue.Queue()
            self._win_reader = threading.Thread(
                target=self._read_winpty_forever,
                name="hermes-winpty-reader",
                daemon=True,
            )
            self._win_reader.start()

    # -- lifecycle --------------------------------------------------------

    @classmethod
    def is_available(cls) -> bool:
        """True if a PTY backend is importable on this platform."""
        if _IS_WINDOWS:
            return _WinPtyProcess is not None
        return ptyprocess is not None

    @classmethod
    def spawn(
        cls,
        argv: Sequence[str],
        *,
        cwd: Optional[str] = None,
        env: Optional[dict] = None,
        cols: int = 80,
        rows: int = 24,
    ) -> "PtyBridge":
        """Spawn ``argv`` behind a new PTY and return a bridge."""
        if _IS_WINDOWS:
            return cls._spawn_winpty(argv, cwd=cwd, env=env, cols=cols, rows=rows)
        return cls._spawn_posix(argv, cwd=cwd, env=env, cols=cols, rows=rows)

    @classmethod
    def _spawn_posix(
        cls,
        argv: Sequence[str],
        *,
        cwd: Optional[str],
        env: Optional[dict],
        cols: int,
        rows: int,
    ) -> "PtyBridge":
        if ptyprocess is None:
            detail = f" ({_POSIX_IMPORT_ERROR})" if "_POSIX_IMPORT_ERROR" in globals() else ""
            raise PtyUnavailableError(
                "The `ptyprocess` package is missing. Install with: "
                "pip install -e '.[pty]'." + detail
            )

        spawn_env = (os.environ.copy() if env is None else env.copy())
        if not spawn_env.get("TERM"):
            spawn_env["TERM"] = "xterm-256color"
        proc = ptyprocess.PtyProcess.spawn(  # type: ignore[union-attr]
            list(argv),
            cwd=cwd,
            env=spawn_env,
            dimensions=(rows, cols),
        )
        return cls(proc, backend="posix", fd=int(proc.fd))

    @classmethod
    def _spawn_winpty(
        cls,
        argv: Sequence[str],
        *,
        cwd: Optional[str],
        env: Optional[dict],
        cols: int,
        rows: int,
    ) -> "PtyBridge":
        if _WinPtyProcess is None:
            detail = f" ({_WINPTY_IMPORT_ERROR})" if _WINPTY_IMPORT_ERROR else ""
            raise PtyUnavailableError(
                "The `pywinpty` package is missing. Install with: "
                "pip install -e '.[pty]'." + detail
            )

        spawn_env = (os.environ.copy() if env is None else env.copy())
        if not spawn_env.get("TERM"):
            spawn_env["TERM"] = "xterm-256color"
        command = [str(part) for part in argv]

        try:
            proc = _WinPtyProcess.spawn(  # type: ignore[union-attr]
                command,
                cwd=cwd,
                env=spawn_env,
                dimensions=(max(1, rows), max(1, cols)),
            )
        except TypeError:
            proc = _WinPtyProcess.spawn(  # type: ignore[union-attr]
                command,
                cwd=cwd,
                env=spawn_env,
            )
        bridge = cls(proc, backend="winpty")
        bridge.resize(cols=cols, rows=rows)
        return bridge

    @property
    def pid(self) -> int:
        try:
            return int(getattr(self._proc, "pid"))
        except Exception:
            return -1

    def is_alive(self) -> bool:
        if self._closed:
            return False
        for name in ("isalive", "is_alive"):
            method = getattr(self._proc, name, None)
            if callable(method):
                try:
                    return bool(method())
                except Exception:
                    return False
        return True

    # -- I/O --------------------------------------------------------------

    def read(self, timeout: float = 0.2) -> Optional[bytes]:
        """Read child output.

        Returns bytes for output, ``b""`` when no output arrives within
        ``timeout``, and ``None`` when the child has exited or the PTY closed.
        """
        if self._closed:
            return None
        if self._backend == "winpty":
            return self._read_winpty(timeout=timeout)
        return self._read_posix(timeout=timeout)

    def _read_posix(self, timeout: float) -> Optional[bytes]:
        if self._fd is None:
            return None
        try:
            readable, _, _ = select.select([self._fd], [], [], timeout)  # type: ignore[union-attr]
        except (OSError, ValueError):
            return None
        if not readable:
            return b""
        try:
            data = os.read(self._fd, 65536)
        except OSError as exc:
            if exc.errno in (errno.EIO, errno.EBADF):
                return None
            raise
        return data or None

    def _read_winpty(self, timeout: float) -> Optional[bytes]:
        if self._win_queue is None:
            return None
        try:
            item = self._win_queue.get(timeout=max(0.0, timeout))
        except queue.Empty:
            return b""
        return item

    def _read_winpty_forever(self) -> None:
        assert self._win_queue is not None
        while not self._closed:
            try:
                try:
                    chunk = self._proc.read()
                except TypeError:
                    chunk = self._proc.read(65536)
            except Exception:
                break

            if chunk is None:
                if not self.is_alive():
                    break
                continue

            if isinstance(chunk, bytes):
                data = chunk
            else:
                data = str(chunk).encode("utf-8", errors="replace")

            if data:
                self._win_queue.put(data)
            elif not self.is_alive():
                break

        self._win_queue.put(None)

    def write(self, data: bytes) -> None:
        """Write raw bytes to the PTY child."""
        if self._closed or not data:
            return
        if self._backend == "winpty":
            text = data.decode("utf-8", errors="replace")
            try:
                self._proc.write(text)
            except TypeError:
                self._proc.write(data)
            except Exception:
                return
            return

        if self._fd is None:
            return
        view = memoryview(data)
        while view:
            try:
                n = os.write(self._fd, view)
            except OSError as exc:
                if exc.errno in (errno.EIO, errno.EBADF, errno.EPIPE):
                    return
                raise
            if n <= 0:
                return
            view = view[n:]

    def resize(self, cols: int, rows: int) -> None:
        """Forward terminal resize to the child."""
        if self._closed:
            return
        cols = max(1, int(cols))
        rows = max(1, int(rows))

        if self._backend == "winpty":
            for method_name, args in (
                ("setwinsize", (rows, cols)),
                ("set_winsize", (rows, cols)),
                ("set_size", (cols, rows)),
                ("resize", (cols, rows)),
            ):
                method = getattr(self._proc, method_name, None)
                if callable(method):
                    try:
                        method(*args)
                    except Exception:
                        pass
                    return
            return

        if self._fd is None:
            return
        winsize = struct.pack("HHHH", rows, cols, 0, 0)  # type: ignore[union-attr]
        try:
            fcntl.ioctl(self._fd, termios.TIOCSWINSZ, winsize)  # type: ignore[union-attr]
        except OSError:
            pass

    # -- teardown ---------------------------------------------------------

    def close(self) -> None:
        """Terminate the child and close the PTY."""
        if self._closed:
            return
        self._closed = True

        if self._backend == "winpty":
            for method_name in ("terminate", "kill", "close"):
                method = getattr(self._proc, method_name, None)
                if callable(method):
                    try:
                        if method_name == "close":
                            method()
                        else:
                            method()
                    except TypeError:
                        try:
                            method(force=True)
                        except Exception:
                            pass
                    except Exception:
                        pass
            if self._win_queue is not None:
                self._win_queue.put(None)
            return

        for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGKILL):  # type: ignore[union-attr]
            if not self._proc.isalive():
                break
            try:
                self._proc.kill(sig)
            except Exception:
                pass
            deadline = time.monotonic() + 0.5
            while self._proc.isalive() and time.monotonic() < deadline:
                time.sleep(0.02)

        try:
            self._proc.close(force=True)
        except Exception:
            pass

    def __enter__(self) -> "PtyBridge":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

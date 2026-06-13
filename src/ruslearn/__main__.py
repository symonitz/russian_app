"""Entry point: `python -m ruslearn` launches the local server.

By default it binds all interfaces so you can use it from your phone on the
same Wi-Fi. Override with RUSLEARN_HOST / RUSLEARN_PORT (e.g. set
RUSLEARN_HOST=127.0.0.1 to keep it Mac-only).
"""
from __future__ import annotations

import os
import socket

import uvicorn


def _lan_ip() -> str:
    """Best-effort local network IP (no traffic actually sent)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def main() -> None:
    host = os.environ.get("RUSLEARN_HOST", "0.0.0.0")
    port = int(os.environ.get("RUSLEARN_PORT", "8000"))
    if host == "0.0.0.0":
        print(f"  ruslearn  ·  on this Mac:   http://127.0.0.1:{port}")
        print(f"  ruslearn  ·  on your phone: http://{_lan_ip()}:{port}  (same Wi-Fi)")
    uvicorn.run("ruslearn.api:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()

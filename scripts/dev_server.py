#!/usr/bin/env python3
"""Tiny static dev server with cache disabled (for iterating on ES modules).

Usage: python3 scripts/dev_server.py [port] [directory] [host]
       host defaults to 0.0.0.0 so other devices on the LAN can connect.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    directory = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    host = sys.argv[3] if len(sys.argv) > 3 else "0.0.0.0"
    handler = partial(Handler, directory=directory)
    ThreadingHTTPServer((host, port), handler).serve_forever()

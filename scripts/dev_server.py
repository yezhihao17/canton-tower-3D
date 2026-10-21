#!/usr/bin/env python3
"""Tiny static dev server with cache disabled (for iterating on ES modules).

Usage: python3 scripts/dev_server.py [port] [directory]
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
    handler = partial(Handler, directory=directory)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()

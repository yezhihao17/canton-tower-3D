#!/usr/bin/env python3
"""Local helper: receive a base64 PNG from the browser and write it to disk.

Usage: python3 scripts/capture_server.py 8124
POST /<name>  body = data:image/png;base64,....
"""
import base64
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = os.path.join(os.path.dirname(__file__), "..", "captures")
os.makedirs(OUT, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "replace")
        name = (self.path.strip("/") or "shot").split("?")[0]
        if "," in body:
            body = body.split(",", 1)[1]
        try:
            data = base64.b64decode(body)
        except Exception as exc:  # noqa: BLE001
            self.send_response(400)
            self.end_headers()
            self.wfile.write(str(exc).encode())
            return
        path = os.path.join(OUT, name + ".png")
        with open(path, "wb") as fh:
            fh.write(data)
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(path.encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()

"""Serve the buildless light tester with Python's standard library."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import ssl


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bind", "--host", dest="host", default="127.0.0.1",
        help="Address to bind to (default: 127.0.0.1; use :: for IPv6)",
    )
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--cert", help="TLS certificate trusted by your iPhone")
    parser.add_argument("--key", help="TLS private key")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert and --key must be supplied together")
    handler = partial(SimpleHTTPRequestHandler, directory=Path(__file__).parent / "static")
    family, _, _, _, address = socket.getaddrinfo(
        args.host, args.port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE
    )[0]

    class Server(ThreadingHTTPServer):
        address_family = family

    server = Server(address, handler)
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    scheme = "https" if args.cert else "http"
    url_host = f"[{args.host}]" if ":" in args.host else args.host
    print(f"Light tester: {scheme}://{url_host}:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

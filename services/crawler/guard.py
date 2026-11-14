"""Network guard for the crawler: it may only ever reach the public internet.

Customers give us a web address to read. Without a guard, an address like http://10.0.0.5/ or a public name that
resolves to an internal address could make the crawler read our own private services (server-side request forgery).
Every address is resolved and checked before the first request, and again for every request the browser makes
(redirects, scripts, frames), so a page can't steer the crawler inward.
"""

from __future__ import annotations

import ipaddress
import socket
from functools import lru_cache
from urllib.parse import urlsplit


class BlockedAddress(ValueError):
    """The address is not a public web address the crawler may visit."""


ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_PORTS = {None, 80, 443}


def _is_public(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.is_site_local:
        return False
    return ip.is_global


@lru_cache(maxsize=512)
def _resolve(host: str) -> tuple[str, ...]:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise BlockedAddress(f"{host} could not be found") from e
    return tuple(sorted({info[4][0] for info in infos}))


def check_url(url: str, *, allow_private: bool = False) -> str:
    """Returns the host if the URL is a public http(s) address; raises BlockedAddress otherwise."""
    parts = urlsplit(url)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise BlockedAddress("only http and https addresses can be imported")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise BlockedAddress("the address has no host")
    if parts.username or parts.password:
        raise BlockedAddress("addresses with a user name or password are not allowed")
    try:
        port = parts.port
    except ValueError as e:
        raise BlockedAddress("the address has an invalid port") from e
    if allow_private:
        return host
    if port not in ALLOWED_PORTS:
        raise BlockedAddress("only the standard web ports (80 and 443) are allowed")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home.arpa")):
        raise BlockedAddress("private addresses can't be imported")
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    addresses = (str(literal),) if literal else _resolve(host)
    for a in addresses:
        if not _is_public(ipaddress.ip_address(a.split("%")[0])):
            raise BlockedAddress("private addresses can't be imported")
    return host


def is_allowed(url: str, *, allow_private: bool = False) -> bool:
    """For the browser's request filter: data:, blob: and about: stay inside the page; anything else must be public."""
    scheme = urlsplit(url).scheme
    if scheme in {"data", "blob", "about"}:
        return True
    try:
        check_url(url, allow_private=allow_private)
        return True
    except BlockedAddress:
        return False

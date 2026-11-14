"""Make Your App AI website reader.

A small private service that reads a customer's existing website so the AI can rebuild it with their real content.
It uses Crawl4AI (Apache-2.0, https://github.com/unclecode/crawl4ai) to drive a headless Chromium browser.

It runs apart from the main API on purpose: the platform never runs a browser or third-party page code in its API
process. Only the API calls it, with a shared token, and it only ever reaches public web addresses (see guard.py).

    POST /crawl   {"url": "https://example.com", "maxPages": 6}   header x-crawler-token
    GET  /health
"""

from __future__ import annotations

import asyncio
import hmac
import os
import re
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from guard import BlockedAddress, check_url, is_allowed

TOKEN = os.environ.get("CRAWLER_TOKEN", "")
ALLOW_PRIVATE = os.environ.get("CRAWLER_ALLOW_PRIVATE_NETWORKS") == "1"  # local tests only
CDP_URL = os.environ.get("CRAWLER_CDP_URL") or None  # optional: attach to an already running Chrome
USER_AGENT = os.environ.get(
    "CRAWLER_USER_AGENT",
    "Mozilla/5.0 (compatible; MakeYourAppAI-SiteImport/1.0; reads a site at its owner's request)",
)
MAX_PAGES = 10
PAGE_TIMEOUT_MS = 20_000
CRAWL_TIMEOUT_S = 90
MAX_MARKDOWN_CHARS = 20_000
MAX_IMAGES = 24
SKIP_RESOURCES = {"image", "media", "font"}
IMAGE_MD = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)")

if len(TOKEN) < 24:
    raise SystemExit("CRAWLER_TOKEN must be set to a random value of at least 24 characters.")

app = FastAPI(title="Make Your App AI website reader", docs_url=None, redoc_url=None, openapi_url=None)
busy = asyncio.Semaphore(1)  # one browser crawl at a time keeps memory predictable on small instances
waiting = 0


class CrawlRequest(BaseModel):
    url: str = Field(min_length=4, max_length=2048)
    maxPages: int = Field(default=6, ge=1, le=MAX_PAGES)


def _normal(url: str) -> str:
    """One entry per page: ignore the fragment, a trailing slash and index.html."""
    p = urlsplit(url)
    path = p.path or "/"
    for suffix in ("index.html", "index.htm"):
        if path.endswith("/" + suffix):
            path = path[: -len(suffix)]
    return f"{p.scheme}://{p.netloc.lower()}{path.rstrip('/') or '/'}" + (f"?{p.query}" if p.query else "")


def _authorised(token: str | None) -> None:
    if not token or not hmac.compare_digest(token, TOKEN):
        raise HTTPException(status_code=401, detail="unauthorised")


def _page(result) -> dict:
    md = getattr(result, "markdown", None)
    text = ""
    if md is not None:
        text = (getattr(md, "fit_markdown", None) or getattr(md, "raw_markdown", None) or str(md) or "").strip()
    meta = result.metadata or {}
    # Image addresses come from the page markup (the browser never downloads images, to save memory).
    images, seen = [], set()
    candidates = [(i.get("src") or "", i.get("alt") or "") for i in (result.media or {}).get("images", [])]
    candidates += [(m.group(2), m.group(1)) for m in IMAGE_MD.finditer(text)]
    for src, alt in candidates:
        if src.startswith(("http://", "https://")) and src not in seen and len(images) < MAX_IMAGES:
            seen.add(src)
            images.append({"src": src[:500], "alt": alt[:200]})
    links = [l.get("href") for l in (result.links or {}).get("internal", []) if l.get("href")][:50]
    return {
        "url": result.url,
        "status": result.status_code,
        "title": (meta.get("title") or "")[:300],
        "description": (meta.get("description") or "")[:500],
        "markdown": text[:MAX_MARKDOWN_CHARS],
        "truncated": len(text) > MAX_MARKDOWN_CHARS,
        "images": images,
        "links": links,
    }


async def _guard_requests(page, context=None, **_):
    """Every request the browser makes is checked; private addresses and heavy media are never fetched."""
    loop = asyncio.get_running_loop()

    async def route(r):
        req = r.request
        if req.resource_type in SKIP_RESOURCES:
            await r.abort()
            return
        ok = await loop.run_in_executor(None, lambda: is_allowed(req.url, allow_private=ALLOW_PRIVATE))
        await (r.continue_() if ok else r.abort())

    target = context or page.context
    await target.route("**/*", route)
    return page


async def _crawl(url: str, host: str, max_pages: int) -> list:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
    from crawl4ai.deep_crawling import BFSDeepCrawlStrategy
    from crawl4ai.deep_crawling.filters import DomainFilter, FilterChain

    browser = BrowserConfig(
        headless=True, user_agent=USER_AGENT, light_mode=True, verbose=False,
        **({"browser_mode": "cdp", "cdp_url": CDP_URL} if CDP_URL else {}),
    )
    strategy = BFSDeepCrawlStrategy(
        max_depth=2, include_external=False, max_pages=max_pages,
        filter_chain=FilterChain([DomainFilter(allowed_domains=[host])]),
    )
    run = CrawlerRunConfig(
        deep_crawl_strategy=strategy if max_pages > 1 else None,
        check_robots_txt=True, cache_mode=CacheMode.BYPASS, page_timeout=PAGE_TIMEOUT_MS,
        exclude_social_media_links=True, verbose=False, stream=False,
    )
    async with AsyncWebCrawler(config=browser) as crawler:
        crawler.crawler_strategy.set_hook("on_page_context_created", _guard_requests)
        out = await crawler.arun(url, config=run)
    return out if isinstance(out, list) else [out]


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/crawl")
async def crawl(body: CrawlRequest, x_crawler_token: str | None = Header(default=None)):
    global waiting
    _authorised(x_crawler_token)
    try:
        host = check_url(body.url, allow_private=ALLOW_PRIVATE)
    except BlockedAddress as e:
        raise HTTPException(status_code=400, detail=str(e))
    if waiting >= 3:
        raise HTTPException(status_code=429, detail="The website reader is busy. Try again in a minute.")
    waiting += 1
    started = time.monotonic()
    try:
        async with busy:
            results = await asyncio.wait_for(_crawl(body.url, host, body.maxPages), timeout=CRAWL_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="The website took too long to read.")
    finally:
        waiting -= 1
    pages, skipped, seen = [], [], set()
    for r in results:
        key = _normal(r.url)
        if key in seen:
            continue
        seen.add(key)
        if r.success and is_allowed(r.url, allow_private=ALLOW_PRIVATE):
            pages.append(_page(r))
        else:
            reason = (r.error_message or f"status {r.status_code}")[:200]
            skipped.append({"url": r.url, "reason": "robots.txt does not allow it" if "robots" in reason.lower() else reason})
    if not pages:
        detail = skipped[0]["reason"] if skipped else "nothing could be read"
        raise HTTPException(status_code=422, detail=f"Couldn't read {urlsplit(body.url).hostname}: {detail}")
    return {"url": body.url, "host": host, "pages": pages[: body.maxPages], "skipped": skipped[:20], "seconds": round(time.monotonic() - started, 1)}

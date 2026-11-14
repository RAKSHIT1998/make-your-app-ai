# Website reader (services/crawler)

Reads a customer's current website for **Start from your current website** on the Create page. It uses
[Crawl4AI](https://github.com/unclecode/crawl4ai) (Apache-2.0) to drive headless Chromium, and returns each page's
title, description, text as Markdown, and image addresses. The API turns that into a build brief the customer edits
before anything is built. No AI runs here.

It runs as its own private service, never inside the API process. Only the API calls it.

## Safety

- **Shared token.** Every request needs `x-crawler-token` equal to `CRAWLER_TOKEN`, which must be at least 24 random characters.
- **Public addresses only** (`guard.py`):
  - The address is resolved before crawling, and every request the browser makes (redirects, scripts, frames) is checked again.
  - Private, loopback, link-local and metadata addresses are refused. So are other ports, credentials in the address, and non-web schemes.
  - The API applies the same check before calling the service.
  - A DNS answer that changes between the check and the browser's own lookup is still a theoretical gap. Run the
    service where it holds no secrets and can't reach internal services that lack authentication; on Render it's a
    private service with only `CRAWLER_TOKEN`.
- **Polite crawling.** robots.txt is respected, only the starting site's own pages are read, and a crawl stops at 10
  pages, depth 2 and 90 seconds. Images, video and fonts are never downloaded.
- **One crawl at a time.** At most 3 requests wait; any more get `429`.
- **Ownership.** Customers must confirm the site is theirs, or that they may reuse its content, before importing.

## API

```
POST /crawl    {"url": "https://example.com", "maxPages": 6}       header x-crawler-token
  200 {"url","host","pages":[{url,status,title,description,markdown,truncated,images,links}],"skipped":[{url,reason}],"seconds"}
  400 address not allowed · 401 bad token · 422 nothing readable (reason given) · 429 busy · 504 too slow
GET  /health
```

## Run locally

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m playwright install chromium
CRAWLER_TOKEN=$(openssl rand -hex 24) .venv/bin/uvicorn app:app --port 8790
```

**Options:**
- `CRAWLER_CDP_URL=http://localhost:9222` attaches to a Chrome that's already running, instead of Playwright's Chromium.
- `CRAWLER_ALLOW_PRIVATE_NETWORKS=1` lets it read `localhost` sites. For tests only; never set it in production.

Then set `CRAWLER_URL` and the same `CRAWLER_TOKEN` on the API.

**Tests:** `python3 -m unittest test_guard`. This needs only the Python standard library.

## Deploy

`infra/render.yaml` declares `mya-crawler` as a private service and wires `CRAWLER_URL` and `CRAWLER_TOKEN` into the
API. Chromium needs memory: the starter plan (512 MB) handles typical small-business sites one at a time. Use the
standard plan if heavy sites fail.

The licence asks web applications to credit Crawl4AI in a prominent place; this is on the public `/credits` page and
in `THIRD_PARTY_NOTICES.md`.

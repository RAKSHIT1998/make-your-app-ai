# Third-party notices

## anthropics/skills (Apache License 2.0)

Source: https://github.com/anthropics/skills (commit 2c5958ecac7cee2b583967a2c4981d0f4a75c579). Copyright Anthropic, PBC. Licensed under the
Apache License, Version 2.0; full text in `licenses/anthropic-skills-LICENSE.txt`.

Adapted material:

| From | Used in | Changes made |
|---|---|---|
| `skills/frontend-design/SKILL.md` | `packages/agents/src/design-guide.ts` (designer and frontend agent instructions) | Condensed and rewritten as agent rules; typography adapted to system font stacks (generated apps run sandboxed without web-font downloads); combined with this platform's own accessibility and honesty rules |
| `skills/theme-factory/themes/*.md` | `packages/shared/src/color-themes.ts` (Colour theme picker on Create) | Kept theme names, palettes and suggested uses; dropped document fonts; colours may be adjusted by the designer agent to meet WCAG AA contrast |

No code or scripts from the repository are included or executed.

## Crawl4AI (Apache License 2.0, with an attribution requirement)

Source: https://github.com/unclecode/crawl4ai (version 0.9.5; reviewed at commit cae74b203a33994f7e13b9052c3b0d5c93daa0e6).
Licensed under the Apache License, Version 2.0, plus the project's attribution requirement; full text in
`licenses/crawl4ai-LICENSE.txt`.

This product includes software developed by UncleCode (https://x.com/unclecode) as part of the Crawl4AI project
(https://github.com/unclecode/crawl4ai).

Used: installed unmodified from PyPI (`services/crawler/requirements.txt`) as a library in the separate website-reader
service (`services/crawler`), which powers "Start from your current website". The service code around it is our own.
The attribution above is also shown on the public Credits page (`/credits`), as the licence asks for web applications.

## awesome-freellm-apis (MIT License)

Source: https://github.com/open-free-llm-api/awesome-freellm-apis (commit a43c20821c8e9b8359083cce52e2778489d0c6c0).
Copyright (c) 2026 open-free-llm-api. Licensed under the MIT License; full text in `licenses/awesome-freellm-apis-LICENSE.txt`.

Used as a reference list only: we checked each listed provider's own terms before adding any (see "Free AI providers
reviewed" below). No text or data from the list is included; provider details in `packages/ai/src/free-catalog.ts`
come from the providers' own pages, and free models are discovered live from each provider.

## open-hotel-pms (MIT License)

Source: https://github.com/peeraseepat-cell/open-hotel-pms (commit 3f6956a54aa9faef44311f9e943ce7d44b6934e3). Copyright (c) 2026 Peerasee.
Licensed under the MIT License; full text in `licenses/open-hotel-pms-LICENSE.txt`.

Used: its data model and operational workflow (rooms with sellable and housekeeping state, per-night room occupancy to prevent
double-booking, reservations with source and OTA reference, guest folio of charges and payments, housekeeping log, shift
logbook, night audit for no-shows) informed the "Hotel front desk (PMS)" business kit in
`packages/shared/src/business-kits.ts`. The kit brief is our own wording; no code, SQL or text is included.

## Reviewed and not used

- **AyishikD/shopify** (GPL-3.0, commit c870b2495c96156a1639b85422af784758b3d98b): reviewed as a reference for an
  e-commerce site builder. No code, schema or text was copied, because GPL-3.0 code would impose its terms on the platform
  and on generated shops. Our Online Store generator is built on our own commerce engine.
- **frappe/crm** (AGPL-3.0, commit 73ec05a1712909ea2ad0e631e088baa5fa3ea4a5): its public feature list (separate leads and deals, stage
  probability, tasks, call logs, notes, lost reasons) was compared with our CRM kit; no code, schema or text was copied,
  because AGPL-3.0 code would impose its terms on the platform and on generated apps.
- **ahmedali5530/restaurant-pos** (POSR Source Available License 1.0): its licence forbids offering it or derivatives as a
  hosted service and using its code or architecture for a competing product, so nothing from it was read beyond the licence
  or used. Our Restaurant kit is based on common restaurant practice.

## Free AI providers reviewed (2026-11-15)

From the awesome-freellm-apis list, checked against each provider's own terms for use inside a paid product that
serves other people's projects:

| Provider | Decision | Why |
|---|---|---|
| Groq, Cerebras, OpenRouter (`:free` and $0 models), Google Gemini, Cloudflare Workers AI | Already supported | Free tiers usable in products, with the data notes shown in the owner console |
| Chutes | **Added** (only models priced at $0) | Terms allow integrating it into your own product (no resale of raw access), no training on requests |
| NVIDIA NIM (build.nvidia.com) | Not added | Trial terms: testing and evaluation only, not production |
| Cohere | Not added | Trial keys may not be used for production or commercial purposes |
| Mistral (free Experiment plan) | Not added as free | Requests on the free plan may be used for training; paid Mistral keys are already supported |
| OpenCode Zen | Not added | Terms limit use to your own internal use, not on behalf of others |
| Kilo Code gateway | Not added | Free models route to providers' trial endpoints (including NVIDIA's) |
| OVHcloud AI Endpoints | Not added | Free only anonymously at 2 requests/minute; keys need a paid project |
| Ollama Cloud | Not added | Small starter allowance; commercial terms for the free plan unclear |
| Z AI (Zhipu), SiliconFlow, ModelScope | Not added | Sign-up needs a Chinese phone number; free-tier commercial terms unclear |
| LLM7.io, Gonka Broker, Agnes AI, Aion Labs, Glhf.chat, Cline, Grok (xAI) | Not added | Commercial terms of the free access unclear, or no standing free API |

Second web search (2026-11-15), beyond that list:

| Provider | Decision | Why |
|---|---|---|
| SambaNova Cloud | **Added** | Standing free tier while no payment method is linked; its terms cover use by your service and its users, and let it use usage logs but not request content. Limits are very small (about 20 requests/day per model) |
| Chutes | Kept, notes corrected | Free tier ended for new sign-ups in 2026; only $0 models are offered, so new accounts usually see none |
| Cerebras | Kept, notes corrected | New free accounts are reported to need a payment method on file |
| GitHub Models | Not added | Free use was for prototyping only, and GitHub retired the service in July 2026 |
| Hugging Face Inference Providers | Not added | Free accounts no longer get monthly credits (since October 2026) |
| Together AI | Not added as free | Its "-Free" endpoints are no longer on the serverless API; paid keys are already supported |
| Vercel AI Gateway | Not added | $5/month credit on a subset of models, but Vercel's free Hobby plan is for non-commercial use |
| Scaleway Generative APIs | Not added | First 1M tokens free, then billed automatically; needs a payment method, so it is not a free route |
| Inference.net | Not added | No published free-tier quota or commercial terms for free use |


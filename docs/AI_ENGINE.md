# AI Engine

- **Providers** (`packages/ai`): an `AiProvider` interface. **Anthropic** adapter on the official SDK with structured outputs. OpenAI and Gemini adapters are not built yet; the router handles any number of providers.
- **Router**: tiers (fast / balanced / deep) map to model routes stored in `AiProviderConfig` (admin-editable). Retries retryable errors with exponential backoff, falls back across routes, enforces a budget check before every call, and meters every attempt (`AiUsage`: tokens, USD-micro cost, latency, success).
- **Cost controls**: per-plan max credits per run, daily credit limit and balance checks before every model call. Runs stop with a clear message when a limit is reached.
- **Agents** (`packages/agents`, contracts in AGENT_CONTRACTS.md): architect, designer, frontend and QA/debug are live. Backend, database architect, security and release agents are planned with the full-stack and mobile templates.
- **Incremental edits**: edits send the current project files and get back minimal file patches. Destructive patches need approval. Every result is a git commit with version history and restore. Static import validation plus sandbox install, typecheck and build, with up to 2 automatic repair loops.
- **Execution**: generated code never runs in the API process. A local sandbox runs in dev; a Docker sandbox exists but has not been run here. Production config refuses the local sandbox.
- **Not yet built**: a model health dashboard, and context indexing for very large projects. Currently up to 180k characters of files are sent, with the rest listed by name.

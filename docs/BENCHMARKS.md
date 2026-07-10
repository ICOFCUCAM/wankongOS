# Benchmarks

Claims about employee quality are tests, not marketing. What CI enforces on
every commit (hermetic local provider — the floor, not the ceiling):

1. **Every marketplace template earns activation.** Each template is hired,
   runs its shipped starter eval suite, and must pass to activate
   (`apps/api/test/benchmark.test.ts`). A template that fails its own suite
   cannot ship.
2. **Golden tasks test enforced guardrails** — approval routing on payments,
   contracts, and refunds — not vocabulary the model might echo.
3. **The whole suite (250+ tests)** covers governance gates, tenancy
   isolation, the accounting identity, presence derivation, and reconciler
   determinism.

Cloud-provider benchmark runs (same suites over Anthropic/OpenAI/Google)
publish when API keys are configured; results will be listed here per
provider and model, pass rates only, no cherry-picking.

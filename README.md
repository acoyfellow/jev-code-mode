# jev-code-mode

> Typed Jev judgments behind two MCP tools: `search` and `execute`.

Agents skip cheap checks such as "is this page an injection?", "does the evidence
support this claim?", and "which of these 30 docs answers the question?". A frontier
model is too slow and costly to run them on every item, and one MCP tool per check
means one model round trip per call.

**Promise:** one `execute` call runs a small JavaScript program that composes
several validated [Jev](https://typesafe.ai) judgments through your Cloudflare AI
Gateway. It returns only schema-checked results.

## Quick start

```bash
bun install
export JEV_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/workers-ai/run/typesafe/jev
export JEV_GATEWAY_TOKEN=<token>
bun start
```

Register the server with any MCP client:

```json
{ "mcpServers": { "jev": { "command": "bun", "args": ["/path/to/jev-code-mode/src/bin.ts"],
  "env": { "JEV_GATEWAY_URL": "…", "JEV_GATEWAY_TOKEN": "…" } } } }
```

The model sees two tools. Inside `execute`:

```js
const screen = await tools.screen_text({ text: page, purpose: 'find pricing' });
if (screen.recommendation !== 'pass') return screen;
return await tools.check_claims({ claims, evidence: page });
```

## Tools reachable inside `execute`

| Tool | Jev questions | Returns |
| --- | --- | --- |
| `check_claims` | one choice per claim | supported / contradicted / unaddressed + accept/review |
| `screen_text` | yes/no: injection, substance, relevance | pass / review / block / skip |
| `pick_best` | yes/no presence + choice over ids | best id, answered flag, distribution |
| `classify_items` | one choice per item over your labels | label, margin, accept/review |
| `compare_passages` | one choice | agree / conflict / unrelated |
| `ask_yes_no` | one yes/no | probability |

`search` returns each tool's JSON Schema input and output.

## How it works

```text
MCP client --2026-07-28--> serveStdio / createMcpHandler (MCP TS SDK v2)
  -> mcp-code-mode: search | execute (worker sandbox, tool allowlist)
    -> zod input validation         (reject before any network call)
    -> Jev questions -> AI Gateway  (Workers AI typesafe/jev)
    -> answer validation            (labels, argmax, sum≈1, [0,1])
    -> zod output validation        (reject before returning)
```

The load-bearing primitive is the **three-gate tool wrapper** in
`src/server.ts#callJudgment`: input schema, answer validation, output schema. A
malformed model answer becomes `status: "invalid_response"` with `action:
"review"`. It never becomes a confident verdict.

## Proof

```bash
bun run verify          # tsc + biome + 43 tests
bun run gateway:stub &  # deterministic local gateway
JEV_GATEWAY_URL=http://localhost:8791/ JEV_GATEWAY_TOKEN=x bun run prove
```

The tests connect a real SDK v2 client over Streamable HTTP. The endpoint is strict
and modern-only, and the client is pinned to protocol `2026-07-28`. Every tool is
checked three ways: valid input yields schema-valid output; invalid input is
rejected with zero Jev calls; malformed answers fail closed.

`bun run prove` spawns the real stdio binary. It negotiates `2026-07-28` through
`server/discover`, calls every tool through `execute`, and writes a receipt to
`receipts/`.

Receipts in this repo:

- `receipts/stub-2026-09-23T23-53-07-619Z.json`: all six tools pass over stdio against the stub gateway.
- `receipts/live-2026-09-23T23-53-11-462Z.json`: **negative result.** The live AI Gateway routed to `typesafe/jev` and
  returned `402 Insufficient balance` (code 2021). The server surfaced the error
  as a tool error; it produced no verdict. A live pass is still **unproven**.

## What it does not do

- It enforces nothing. Recommendations are advisory; your agent decides.
- It is not a hostile-code sandbox. `execute` uses the `mcp-code-mode` worker
  VM, which is defense-in-depth. Only the six judgment tools are reachable.
- It does not retry. Network errors surface once with secrets redacted.
- It does not store keys or run a gateway. You provide both.

## Edit behavior

Thresholds and limits live in `src/policy.ts`. Question wording and result
shapes live in `src/tools.ts`.

## What this makes possible next

`callJudgment` works with any `{ input, output, run }` tool. Another notebook can
add a judgment by writing one `defineTool` block, and it gets MCP v2, code mode,
and fail-closed validation for free. Unproven until a second consumer exists.

## Configure

| Variable | Required | Meaning |
| --- | --- | --- |
| `JEV_GATEWAY_URL` | yes | Full POST URL of the Jev route on your AI Gateway |
| `JEV_GATEWAY_TOKEN` | yes | Bearer token (sent as `Authorization`) |
| `JEV_GATEWAY_ACCESS_TOKEN` | no | Sent as `cf-access-token` for Access-protected gateways |
| `JEV_TIMEOUT_MS` | no | Per-request deadline, default 30000 |

MIT. Independent project, not affiliated with TypeSafe.

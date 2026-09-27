# Contract

1. `tools/list` returns exactly `search` and `execute`.
2. The server negotiates MCP `2026-07-28` via `server/discover` on stdio and HTTP.
3. Only tools in `src/tools.ts` are callable inside `execute`.
4. Arguments failing a tool's input schema are rejected before any gateway request.
5. A Jev choice answer is valid only if its label is requested, its distribution has
   exactly the requested keys, each value is in [0,1], the sum is within 0.01 of 1,
   and the chosen label is an argmax.
6. A Jev yes/no answer is valid only if it is a finite number in [0,1].
7. An invalid answer yields `status: "invalid_response"` and never an accept action.
8. Results failing a tool's output schema are returned as tool errors.
9. Gateway errors never include configured secrets.

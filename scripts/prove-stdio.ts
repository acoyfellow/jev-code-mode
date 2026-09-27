import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { tools } from '../src/tools.js';
import { validInputs } from '../test/fixtures.js';

type Execution = {
  isError?: boolean;
  structuredContent?: { value?: unknown; error?: unknown };
  content?: unknown;
};

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
const transport = new StdioClientTransport({
  command: 'bun',
  args: ['src/bin.ts'],
  env,
  stderr: 'inherit',
});
const client = new Client(
  { name: 'jev-live-proof', version: '0.0.1' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
await client.connect(transport);

const gatewayHost = new URL(env.JEV_GATEWAY_URL ?? 'http://unset').host;
const isLocalGateway = /^(localhost|127\.0\.0\.1)(:|$)/.test(gatewayHost);
const protocolVersion = client.getNegotiatedProtocolVersion() ?? null;
const listed = (await client.listTools()).tools.map((tool) => tool.name);
const results = [];
for (const tool of tools) {
  const started = Date.now();
  const call = (await client.callTool({
    name: 'execute',
    arguments: {
      code: `return await tools.${tool.name}(${JSON.stringify(validInputs[tool.name])});`,
      timeout_ms: 45_000,
    },
  })) as Execution;
  const value = call.structuredContent?.value;
  const schemaValid = tool.output.safeParse(value).success;
  const answered = schemaValid && !JSON.stringify(value).includes('invalid_response');
  results.push({
    tool: tool.name,
    ok: !call.isError && answered,
    schemaValid,
    durationMs: Date.now() - started,
    value,
    error: call.isError ? call.content : undefined,
  });
}
await client.close();

const receipt = {
  kind: 'jev-code-mode.stdio-proof',
  observedAt: new Date().toISOString(),
  protocolVersion: protocolVersion,
  gatewayHost,
  gateway: isLocalGateway ? 'stub' : 'live',
  listedTools: listed,
  passed: results.every((result) => result.ok),
  results,
};
const path = `receipts/${isLocalGateway ? 'stub' : 'live'}-${receipt.observedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      path,
      passed: receipt.passed,
      protocolVersion: receipt.protocolVersion,
      tools: results.map(({ tool, ok, durationMs }) => ({ tool, ok, durationMs })),
    },
    null,
    2,
  ),
);
process.exit(receipt.passed ? 0 : 1);

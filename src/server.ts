import { Server } from '@modelcontextprotocol/server';
import { createCodeMode } from 'mcp-code-mode/core';
import { createWorkerSandbox } from 'mcp-code-mode/sandbox/worker';
import { z } from 'zod';
import type { JevClient } from './jev.js';
import { type AnyTool, tools } from './tools.js';

type TextResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function failure(message: string): TextResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export async function callJudgment(
  client: JevClient,
  tool: AnyTool,
  args: unknown,
  signal?: AbortSignal,
): Promise<TextResult> {
  const input = tool.input.safeParse(args);
  if (!input.success)
    return failure(`invalid input for ${tool.name}: ${z.prettifyError(input.error)}`);
  let raw: unknown;
  try {
    raw = await tool.run(client, input.data as never, signal);
  } catch (error) {
    return failure(`${tool.name} failed: ${(error as Error).message}`);
  }
  const output = tool.output.safeParse(raw);
  if (!output.success)
    return failure(`invalid output from ${tool.name}: ${z.prettifyError(output.error)}`);
  const structuredContent = output.data as Record<string, unknown>;
  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  };
}

export function catalog() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input) as Record<string, unknown>,
    outputSchema: z.toJSONSchema(tool.output) as Record<string, unknown>,
  }));
}

export function createJevServer(client: JevClient): Server {
  const byName = new Map<string, AnyTool>(tools.map((tool) => [tool.name, tool]));
  const codeMode = createCodeMode(
    {
      listTools: async () => catalog(),
      callTool: async (name, args) => {
        const tool = byName.get(name);
        return tool ? callJudgment(client, tool, args) : failure(`unknown tool ${name}`);
      },
    },
    { sandbox: createWorkerSandbox(), expose: [...byName.keys()] },
  );
  const server = new Server(
    { name: 'jev-code-mode', version: '0.0.1' },
    {
      capabilities: { tools: {} },
    },
  );
  server.setRequestHandler('tools/list', async () => (await codeMode.listTools()) as never);
  server.setRequestHandler(
    'tools/call',
    async (request) =>
      (await codeMode.callTool({
        params: { name: request.params.name, arguments: request.params.arguments ?? {} },
      })) as never,
  );
  return server;
}

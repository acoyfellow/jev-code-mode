#!/usr/bin/env bun
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createGatewayClient, gatewayConfigFromEnv } from './jev.js';
import { createJevServer } from './server.js';

const client = createGatewayClient(gatewayConfigFromEnv(process.env));
serveStdio(() => createJevServer(client));
console.error('[jev-code-mode] ready on stdio');

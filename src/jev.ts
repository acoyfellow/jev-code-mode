import { z } from 'zod';

export type NoulQuestion = { type: 'noul'; instructions: string };
export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
};
export type Question = NoulQuestion | ChoiceQuestion;
export type Questions = Record<string, Question>;

export type Usage = { inputTokens: number; outputTokens: number };
export type JevAnswers = Record<string, unknown>;
export type JevResponse = { answers: JevAnswers; usage: Usage | null };

export interface JevClient {
  ask(state: unknown, questions: Questions, signal?: AbortSignal): Promise<JevResponse>;
}

export const noul = (instructions: string): NoulQuestion => ({ type: 'noul', instructions });

export const choice = (
  instructions: string,
  criteria: Record<string, string | null>,
): ChoiceQuestion => ({ type: 'choice', instructions, criteria });

export type ValidChoice = { choice: string; probabilities: Record<string, number> };

const PROBABILITY_SUM_TOLERANCE = 0.01;
const ARGMAX_TOLERANCE = 1e-9;

export function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function readNoul(answer: unknown): number | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const value = (answer as { noul?: unknown }).noul;
  return isProbability(value) ? value : null;
}

export function readChoice(answer: unknown, labels: readonly string[]): ValidChoice | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { choice: picked, probabilities } = answer as { choice?: unknown; probabilities?: unknown };
  if (typeof picked !== 'string' || !labels.includes(picked)) return null;
  if (typeof probabilities !== 'object' || probabilities === null) return null;
  const entries = Object.entries(probabilities as Record<string, unknown>);
  if (entries.length !== labels.length) return null;
  const distribution: Record<string, number> = {};
  for (const label of labels) {
    const value = (probabilities as Record<string, unknown>)[label];
    if (!isProbability(value)) return null;
    distribution[label] = value;
  }
  const values = Object.values(distribution);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE) return null;
  const maximum = Math.max(...values);
  if ((distribution[picked] ?? 0) < maximum - ARGMAX_TOLERANCE) return null;
  return { choice: picked, probabilities: distribution };
}

export function runnerUpMargin(probabilities: Record<string, number>): number {
  const sorted = Object.values(probabilities).sort((a, b) => b - a);
  return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

const usageSchema = z
  .object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() })
  .transform((usage) => ({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }));

const payloadSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  usage: usageSchema.optional(),
});

export function parseGatewayBody(body: unknown): JevResponse {
  const envelope = body as {
    success?: unknown;
    result?: unknown;
    errors?: unknown;
    error?: unknown;
  };
  if (envelope && envelope.success === false) {
    throw new Error(
      `gateway rejected request: ${JSON.stringify(envelope.errors ?? envelope.error)}`,
    );
  }
  const nested = envelope?.result as { result?: unknown } | undefined;
  const candidate = nested?.result ?? envelope?.result ?? body;
  const parsed = payloadSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('gateway response missing a Jev answers object');
  return { answers: parsed.data.answers, usage: parsed.data.usage ?? null };
}

export type GatewayConfig = {
  url: string;
  token: string;
  accessToken?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_DETAIL = 300;

export function redact(text: string, secrets: Array<string | undefined>): string {
  return secrets.reduce<string>(
    (current, secret) => (secret ? current.split(secret).join('[redacted]') : current),
    text,
  );
}

export function createGatewayClient(config: GatewayConfig): JevClient {
  const send = config.fetch ?? fetch;
  return {
    async ask(state, questions, signal) {
      const deadline = AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const headers: Record<string, string> = {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      };
      if (config.accessToken) headers['cf-access-token'] = config.accessToken;
      const response = await send(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state, questions }),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      const text = await response.text();
      if (!response.ok) {
        const detail = redact(text, [config.token, config.accessToken]).slice(0, MAX_ERROR_DETAIL);
        throw new Error(`gateway HTTP ${response.status}: ${detail}`);
      }
      return parseGatewayBody(JSON.parse(text));
    },
  };
}

export function gatewayConfigFromEnv(env: Record<string, string | undefined>): GatewayConfig {
  const url = env.JEV_GATEWAY_URL;
  const token = env.JEV_GATEWAY_TOKEN;
  if (!url || !token) {
    throw new Error('Set JEV_GATEWAY_URL and JEV_GATEWAY_TOKEN. See README "Configure".');
  }
  const timeoutMs = env.JEV_TIMEOUT_MS ? Number(env.JEV_TIMEOUT_MS) : undefined;
  return { url, token, accessToken: env.JEV_GATEWAY_ACCESS_TOKEN, timeoutMs };
}

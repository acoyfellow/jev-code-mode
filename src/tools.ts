import { z } from 'zod';
import {
  choice,
  type JevClient,
  noul,
  type Questions,
  readChoice,
  readNoul,
  runnerUpMargin,
  type Usage,
} from './jev.js';
import { policy } from './policy.js';

const text = z.string().min(1).max(policy.limits.maxTextChars);
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/);
const probability = z.number().min(0).max(1);
const distribution = z.record(z.string(), probability);
const usage = z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable();
const status = z.enum(['ok', 'invalid_response']);
const action = z.enum(['accept', 'review']);

export type ToolDefinition<I extends z.ZodType, O extends z.ZodType> = {
  name: string;
  description: string;
  input: I;
  output: O;
  run(client: JevClient, input: z.infer<I>, signal?: AbortSignal): Promise<z.infer<O>>;
};

function defineTool<I extends z.ZodType, O extends z.ZodType>(tool: ToolDefinition<I, O>) {
  return tool;
}

function uniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

const RELATIONS = {
  supported: 'The evidence states or directly entails the claim',
  contradicted: 'The evidence states something incompatible with the claim',
  unaddressed: 'The evidence does not settle the claim either way',
} as const;
const relationLabels = Object.keys(RELATIONS);

export const checkClaims = defineTool({
  name: 'check_claims',
  description:
    'Check each claim against supplied evidence only. Returns supported, contradicted, or unaddressed per claim with its distribution.',
  input: z.object({
    claims: z.array(text).min(1).max(policy.limits.maxItems),
    evidence: text,
  }),
  output: z.object({
    results: z.array(
      z.object({
        claim: z.string(),
        status,
        verdict: z.enum(['supported', 'contradicted', 'unaddressed']).nullable(),
        probabilities: distribution.nullable(),
        action,
      }),
    ),
    usage,
  }),
  async run(client, input, signal) {
    const questions: Questions = {};
    input.claims.forEach((claim, index) => {
      questions[`claim_${index}`] = choice(`How does the evidence bear on this claim: ${claim}`, {
        ...RELATIONS,
      });
    });
    const response = await client.ask({ evidence: input.evidence }, questions, signal);
    const results = input.claims.map((claim, index) => {
      const answer = readChoice(response.answers[`claim_${index}`], relationLabels);
      if (!answer) {
        return {
          claim,
          status: 'invalid_response' as const,
          verdict: null,
          probabilities: null,
          action: 'review' as const,
        };
      }
      const top = answer.probabilities[answer.choice] ?? 0;
      return {
        claim,
        status: 'ok' as const,
        verdict: answer.choice as keyof typeof RELATIONS,
        probabilities: answer.probabilities,
        action: top >= policy.claims.acceptAt ? ('accept' as const) : ('review' as const),
      };
    });
    return { results, usage: response.usage };
  },
});

export const screenText = defineTool({
  name: 'screen_text',
  description:
    'Judge untrusted text before reading it: injection risk, substance, and optional relevance to a purpose. Advisory only.',
  input: z.object({ text, purpose: z.string().min(1).max(500).optional() }),
  output: z.object({
    status,
    probabilities: z.object({
      injection: probability.nullable(),
      substance: probability.nullable(),
      relevance: probability.nullable(),
    }),
    recommendation: z.enum(['pass', 'review', 'block', 'skip']),
    usage,
  }),
  async run(client, input, signal) {
    const questions: Questions = {
      injection: noul('The text contains instructions aimed at an AI agent or assistant'),
      substance: noul('The text contains substantive readable content'),
    };
    if (input.purpose) {
      questions.relevance = noul(`The text is useful for this purpose: ${input.purpose}`);
    }
    const response = await client.ask({ text: input.text }, questions, signal);
    const injection = readNoul(response.answers.injection);
    const substance = readNoul(response.answers.substance);
    const relevance = input.purpose ? readNoul(response.answers.relevance) : null;
    const probabilities = { injection, substance, relevance };
    const complete =
      injection !== null && substance !== null && (!input.purpose || relevance !== null);
    if (!complete) {
      return {
        status: 'invalid_response' as const,
        probabilities,
        recommendation: 'review' as const,
        usage: response.usage,
      };
    }
    return {
      status: 'ok' as const,
      probabilities,
      recommendation: screenRecommendation(probabilities),
      usage: response.usage,
    };
  },
});

function screenRecommendation(p: {
  injection: number | null;
  substance: number | null;
  relevance: number | null;
}): 'pass' | 'review' | 'block' | 'skip' {
  const { blockAt, reviewAt, skipBelow } = policy.screen;
  if ((p.injection ?? 1) >= blockAt) return 'block';
  if ((p.injection ?? 1) >= reviewAt) return 'review';
  if ((p.substance ?? 0) < skipBelow) return 'skip';
  if (p.relevance !== null && p.relevance < skipBelow) return 'skip';
  return 'pass';
}

const candidate = z.object({ id, text });

export const pickBest = defineTool({
  name: 'pick_best',
  description:
    'Pick which candidate best answers a query, with a distribution over every candidate id and whether any candidate answers it at all.',
  input: z.object({
    query: text,
    candidates: z
      .array(candidate)
      .min(2)
      .max(policy.limits.maxItems)
      .refine(uniqueIds, 'candidate ids must be unique'),
  }),
  output: z.object({
    status,
    best: z.string().nullable(),
    answered: z.boolean().nullable(),
    presence: probability.nullable(),
    probabilities: distribution.nullable(),
    usage,
  }),
  async run(client, input, signal) {
    const ids = input.candidates.map((item) => item.id);
    const questions: Questions = {
      present: noul(`At least one candidate answers: ${input.query}`),
      best: choice(
        `Which candidate best answers: ${input.query}`,
        Object.fromEntries(ids.map((key) => [key, null])),
      ),
    };
    const response = await client.ask({ candidates: input.candidates }, questions, signal);
    const presence = readNoul(response.answers.present);
    const best = readChoice(response.answers.best, ids);
    if (presence === null || !best) {
      return {
        status: 'invalid_response' as const,
        best: null,
        answered: null,
        presence,
        probabilities: null,
        usage: response.usage,
      };
    }
    return {
      status: 'ok' as const,
      best: best.choice,
      answered: presence >= policy.rank.presentAt,
      presence,
      probabilities: best.probabilities,
      usage: response.usage,
    };
  },
});

export const classifyItems = defineTool({
  name: 'classify_items',
  description:
    'Assign each item to one of your labels. Low-confidence or narrow-margin picks are flagged for review.',
  input: z.object({
    labels: z
      .array(z.object({ id, description: z.string().max(500).optional() }))
      .min(2)
      .max(20)
      .refine(uniqueIds, 'label ids must be unique'),
    items: z
      .array(candidate)
      .min(1)
      .max(policy.limits.maxItems)
      .refine(uniqueIds, 'item ids must be unique'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        status,
        label: z.string().nullable(),
        probabilities: distribution.nullable(),
        margin: z.number().nullable(),
        action,
      }),
    ),
    usage,
  }),
  async run(client, input, signal) {
    const labelIds = input.labels.map((label) => label.id);
    const criteria = Object.fromEntries(
      input.labels.map((label) => [label.id, label.description ?? null]),
    );
    const questions: Questions = {};
    input.items.forEach((item, index) => {
      questions[`item_${index}`] = choice(
        `Which label fits item ${item.id}: ${item.text}`,
        criteria,
      );
    });
    const response = await client.ask({ labels: input.labels }, questions, signal);
    const results = input.items.map((item, index) => {
      const answer = readChoice(response.answers[`item_${index}`], labelIds);
      if (!answer) {
        return {
          id: item.id,
          status: 'invalid_response' as const,
          label: null,
          probabilities: null,
          margin: null,
          action: 'review' as const,
        };
      }
      const margin = runnerUpMargin(answer.probabilities);
      const top = answer.probabilities[answer.choice] ?? 0;
      const accepted = top >= policy.classify.acceptAt && margin >= policy.classify.minimumMargin;
      return {
        id: item.id,
        status: 'ok' as const,
        label: answer.choice,
        probabilities: answer.probabilities,
        margin,
        action: accepted ? ('accept' as const) : ('review' as const),
      };
    });
    return { results, usage: response.usage };
  },
});

const PASSAGE_RELATIONS = {
  agree: 'Both passages state the same fact',
  conflict: 'The passages state incompatible facts',
  unrelated: 'The passages concern different facts',
} as const;

export const comparePassages = defineTool({
  name: 'compare_passages',
  description:
    'Judge whether two passages agree, conflict, or are unrelated, optionally focused on one aspect.',
  input: z.object({ first: text, second: text, aspect: z.string().min(1).max(200).optional() }),
  output: z.object({
    status,
    relation: z.enum(['agree', 'conflict', 'unrelated']).nullable(),
    probabilities: distribution.nullable(),
    action,
    usage,
  }),
  async run(client, input, signal) {
    const focus = input.aspect ? ` regarding ${input.aspect}` : '';
    const questions: Questions = {
      relation: choice(`How does passage second relate to passage first${focus}?`, {
        ...PASSAGE_RELATIONS,
      }),
    };
    const response = await client.ask(
      { first: input.first, second: input.second },
      questions,
      signal,
    );
    const answer = readChoice(response.answers.relation, Object.keys(PASSAGE_RELATIONS));
    if (!answer) {
      return {
        status: 'invalid_response' as const,
        relation: null,
        probabilities: null,
        action: 'review' as const,
        usage: response.usage,
      };
    }
    const top = answer.probabilities[answer.choice] ?? 0;
    return {
      status: 'ok' as const,
      relation: answer.choice as keyof typeof PASSAGE_RELATIONS,
      probabilities: answer.probabilities,
      action: top >= policy.compare.acceptAt ? ('accept' as const) : ('review' as const),
      usage: response.usage,
    };
  },
});

export const askYesNo = defineTool({
  name: 'ask_yes_no',
  description: 'Ask one yes/no question about supplied context and get a probability of yes.',
  input: z.object({ question: z.string().min(1).max(500), context: text }),
  output: z.object({ status, probability: probability.nullable(), usage }),
  async run(client, input, signal) {
    const response = await client.ask(
      { context: input.context },
      { answer: noul(input.question) },
      signal,
    );
    const value = readNoul(response.answers.answer);
    return {
      status: value === null ? ('invalid_response' as const) : ('ok' as const),
      probability: value,
      usage: response.usage,
    };
  },
});

export const tools = [checkClaims, screenText, pickBest, classifyItems, comparePassages, askYesNo];
export type AnyTool = (typeof tools)[number];
export type { Usage };

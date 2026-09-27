import type { JevClient, JevResponse, Questions } from '../src/jev.js';

type Answerer = (name: string, question: Questions[string]) => unknown;

export function fakeClient(answer: Answerer): JevClient & { calls: Questions[] } {
  const calls: Questions[] = [];
  return {
    calls,
    async ask(_state, questions): Promise<JevResponse> {
      calls.push(questions);
      const answers = Object.fromEntries(
        Object.entries(questions).map(([name, question]) => [name, answer(name, question)]),
      );
      return { answers, usage: { inputTokens: 10, outputTokens: 2 } };
    },
  };
}

export function pick(label: string, labels: string[]) {
  const probabilities = Object.fromEntries(
    labels.map((key) => [key, key === label ? 0.9 : 0.1 / (labels.length - 1)]),
  );
  return { choice: label, probabilities };
}

export function firstLabelOrYes(_name: string, question: Questions[string]) {
  if (question.type === 'noul') return { noul: 0.1 };
  const labels = Object.keys(question.criteria);
  return pick(labels[0] ?? '', labels);
}

export const validInputs: Record<string, Record<string, unknown>> = {
  check_claims: { claims: ['Helmets are optional.'], evidence: 'Every rider must wear a helmet.' },
  screen_text: { text: 'Starter costs $9.', purpose: 'Find pricing' },
  pick_best: {
    query: 'rotate api keys',
    candidates: [
      { id: 'auth', text: 'Rotate keys in Settings.' },
      { id: 'billing', text: 'Invoices are monthly.' },
    ],
  },
  classify_items: {
    labels: [{ id: 'bug' }, { id: 'feature' }],
    items: [{ id: 'i1', text: 'App crashes on login.' }],
  },
  compare_passages: { first: 'Price is $9.', second: 'Price is $12.', aspect: 'price' },
  ask_yes_no: { question: 'Is a price mentioned?', context: 'Starter costs $9.' },
};

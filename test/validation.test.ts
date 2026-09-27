import { describe, expect, test } from 'bun:test';
import { parseGatewayBody, readChoice, readNoul, redact } from '../src/jev.js';

describe('readChoice', () => {
  const labels = ['a', 'b'];
  test('accepts a complete argmax distribution', () => {
    expect(readChoice({ choice: 'a', probabilities: { a: 0.7, b: 0.3 } }, labels)).toEqual({
      choice: 'a',
      probabilities: { a: 0.7, b: 0.3 },
    });
  });
  test.each([
    ['unknown label', { choice: 'c', probabilities: { a: 0.7, b: 0.3 } }],
    ['missing key', { choice: 'a', probabilities: { a: 1 } }],
    ['extra key', { choice: 'a', probabilities: { a: 0.7, b: 0.3, c: 0 } }],
    ['sum drift', { choice: 'a', probabilities: { a: 0.7, b: 0.1 } }],
    ['non-argmax pick', { choice: 'b', probabilities: { a: 0.7, b: 0.3 } }],
    ['out of range', { choice: 'a', probabilities: { a: 1.2, b: -0.2 } }],
    ['non-object', null],
  ])('rejects %s', (_name, answer) => {
    expect(readChoice(answer, labels)).toBeNull();
  });
});

describe('readNoul', () => {
  test('accepts zero', () => expect(readNoul({ noul: 0 })).toBe(0));
  test.each([[{ noul: 1.1 }], [{ noul: Number.NaN }], [{ noul: '0.5' }], [null]])(
    'rejects %p',
    (answer) => {
      expect(readNoul(answer)).toBeNull();
    },
  );
});

describe('parseGatewayBody', () => {
  const payload = { answers: { q: { noul: 0.4 } }, usage: { input_tokens: 3, output_tokens: 1 } };
  test('reads a bare payload', () => {
    expect(parseGatewayBody(payload).usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });
  test('reads the Workers AI double envelope', () => {
    expect(parseGatewayBody({ success: true, result: { result: payload } }).answers).toEqual(
      payload.answers,
    );
  });
  test('surfaces gateway failures', () => {
    expect(() => parseGatewayBody({ success: false, error: [{ code: 2021 }] })).toThrow(
      'gateway rejected',
    );
  });
  test('rejects bodies without answers', () => {
    expect(() => parseGatewayBody({ result: {} })).toThrow('missing a Jev answers');
  });
});

test('redact removes every configured secret', () => {
  expect(redact('token=abc access=xyz', ['abc', 'xyz', undefined])).toBe(
    'token=[redacted] access=[redacted]',
  );
});

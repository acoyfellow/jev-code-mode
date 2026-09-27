type Question = { type: 'noul' } | { type: 'choice'; criteria: Record<string, unknown> };

function answer(question: Question) {
  if (question.type === 'noul') return { noul: 0.2 };
  const labels = Object.keys(question.criteria);
  const share = 0.2 / Math.max(labels.length - 1, 1);
  const probabilities = Object.fromEntries(
    labels.map((label, index) => [label, index === 0 ? 0.8 : share]),
  );
  return { choice: labels[0], probabilities };
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  async fetch(request) {
    const { questions } = (await request.json()) as { questions: Record<string, Question> };
    const answers = Object.fromEntries(
      Object.entries(questions).map(([key, question]) => [key, answer(question)]),
    );
    return Response.json({
      success: true,
      result: { answers, usage: { input_tokens: 1, output_tokens: 1 } },
    });
  },
});
console.log(server.url.href);

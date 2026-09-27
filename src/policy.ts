export const policy = {
  claims: { acceptAt: 0.8 },
  screen: { blockAt: 0.75, reviewAt: 0.25, skipBelow: 0.3 },
  rank: { presentAt: 0.5 },
  classify: { acceptAt: 0.85, minimumMargin: 0.5 },
  compare: { acceptAt: 0.8 },
  limits: { maxItems: 50, maxTextChars: 20_000 },
} as const;

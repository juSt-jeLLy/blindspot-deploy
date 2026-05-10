import { CONTRACTS, type PairKey } from "@/lib/contracts-config";

export type LivePair = {
  key: PairKey;
  tokenA: string;
  tokenB: string;
  label: string;
  underlyingA: string;
  underlyingB: string;
  cTokenA: string;
  cTokenB: string;
  escrow: string;
  matcher: string;
  settlement: string;
};

export const LIVE_PAIRS: LivePair[] = (Object.keys(CONTRACTS.pairs) as PairKey[]).map((key) => {
  const [tokenA, tokenB] = key.split("_");
  const entry = CONTRACTS.pairs[key];
  const cKeyA = `c${tokenA}` as keyof typeof CONTRACTS.wrappers;
  const cKeyB = `c${tokenB}` as keyof typeof CONTRACTS.wrappers;
  const uKeyA = tokenA as keyof typeof CONTRACTS.underlyings;
  const uKeyB = tokenB as keyof typeof CONTRACTS.underlyings;
  return {
    key,
    tokenA,
    tokenB,
    label: `${tokenA}/${tokenB}`,
    underlyingA: CONTRACTS.underlyings[uKeyA],
    underlyingB: CONTRACTS.underlyings[uKeyB],
    cTokenA: CONTRACTS.wrappers[cKeyA],
    cTokenB: CONTRACTS.wrappers[cKeyB],
    escrow: entry.escrow,
    matcher: entry.matcher,
    settlement: entry.settlement,
  };
});

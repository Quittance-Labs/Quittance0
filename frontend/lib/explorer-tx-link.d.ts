export type HorizonNetwork = 'public' | 'testnet';

export function buildHorizonTxUrl(
  txHash: string | undefined | null,
  network?: HorizonNetwork
): string | null;

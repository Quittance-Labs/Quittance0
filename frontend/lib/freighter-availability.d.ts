export const FREIGHTER_INSTALL_URL: string;
export const FREIGHTER_REQUIRED_MESSAGE: string;
export function FREIGHTER_WRONG_NETWORK_MESSAGE(targetNetwork?: string): string;

export function detectFreighter(
  checkConnection: () => Promise<boolean>
): Promise<boolean>;

export function isNetworkMatching(
  networkOrPassphrase?: string | null,
  expected?: string
): boolean;

export const FREIGHTER_INSTALL_URL: string;
export const FREIGHTER_REQUIRED_MESSAGE: string;

export function detectFreighter(
  checkConnection: () => Promise<boolean>
): Promise<boolean>;

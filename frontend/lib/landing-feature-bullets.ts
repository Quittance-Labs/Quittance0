export const LANDING_BULLETS = [
  {
    n: '01',
    title: 'Create',
    body: 'Connect Freighter and issue an invoice. Share the link or QR with your client.',
  },
  {
    n: '02',
    title: 'Get paid',
    body: 'They pay on Stellar. We match memo, amount, and destination on Horizon.',
  },
  {
    n: '03',
    title: 'Keep proof',
    body: 'Download your quittance as PDF, or email it when a client address is set.',
  },
] as const;

export function renderLandingBullets() {
  return LANDING_BULLETS.map((bullet) => ({ ...bullet }));
}

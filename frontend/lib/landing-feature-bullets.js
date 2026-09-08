const LANDING_BULLETS = Object.freeze([
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
]);

function renderLandingBullets() {
  return LANDING_BULLETS.map((bullet) => ({ ...bullet }));
}

module.exports = { LANDING_BULLETS, renderLandingBullets };

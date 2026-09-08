function getTimeRemaining(expiresAt) {
  const now = Date.now();
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const diff = expiry - now;

  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function expirySummary(expiresAt) {
  return getTimeRemaining(expiresAt);
}

module.exports = { expirySummary };

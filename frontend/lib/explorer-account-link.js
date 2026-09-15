function buildHorizonAccountUrl(publicKey, network = 'PUBLIC') {
  const pk = String(publicKey || '').trim();
  if (!pk) {
    throw new Error('publicKey is required');
  }
  const net = String(network || '').trim().toUpperCase();
  const netPath = net === 'TESTNET' ? 'testnet' : 'public';
  return `https://stellar.expert/explorer/${netPath}/account/${pk}`;
}

module.exports = {
  buildHorizonAccountUrl,
};

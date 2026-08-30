function networkDisplayName(passphraseOrId) {
  const value = passphraseOrId.trim().toLowerCase();
  if (value.includes('testnet') || value.includes('test sdf')) return 'Testnet';
  if (value.includes('public') || value.includes('mainnet')) return 'Public';
  return 'Unknown network';
}

module.exports = { networkDisplayName };

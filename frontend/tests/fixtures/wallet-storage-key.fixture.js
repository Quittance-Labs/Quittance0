export const walletStorageKeyFixture = [
  { input: 'testnet', output: 'wallet-storage:testnet' },
  { input: 'TESTNET', output: 'wallet-storage:testnet' },
  { input: 'public', output: 'wallet-storage:public' },
  { input: 'PUBLIC', output: 'wallet-storage:public' },
  { input: 'mainnet', output: 'wallet-storage:mainnet' },
  { input: 'futurenet', output: 'wallet-storage:futurenet' },
  { input: '  TESTNET  ', output: 'wallet-storage:testnet' },
  { input: '', output: 'wallet-storage' },
  { input: '   ', output: 'wallet-storage' },
  { input: null, output: 'wallet-storage' },
  { input: undefined, output: 'wallet-storage' },
];

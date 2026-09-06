export const walletInitialsFixture = [
  { input: 'GAP5YJSTB6RJ3IH76KPYSRH435G5GPV4EAX5B2NF4HA3THMSGENCHTW2', expected: 'GA' },
  { input: 'GB3MDQNG3A5PST6Z7WUG7JCS4LGYBHKQJ3Y3B3G7L', expected: 'GB' },
  { input: 'CA3D5KRYMCMCZKPO7SBCUCQHN3JAIA', expected: 'CA' },
  { input: '  GAP5YJSTB6  ', expected: 'GA' },
  { input: 'gap5yjstb6', expected: 'GA' },
  { input: 'G', expected: 'G' },
  { input: 'g', expected: 'G' },
  { input: '', expected: '' },
  { input: '   ', expected: '' },
  { input: '---', expected: '' },
  { input: null, expected: '' },
  { input: undefined, expected: '' },
];

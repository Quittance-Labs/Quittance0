/** @type {import('next').NextConfig} */
const stellarNetwork = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'TESTNET').toUpperCase();
if (!['TESTNET', 'PUBLIC'].includes(stellarNetwork)) {
  throw new Error('NEXT_PUBLIC_STELLAR_NETWORK must be TESTNET or PUBLIC');
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    domains: ['localhost', 'assets.coingecko.com'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
        pathname: '/coins/images/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

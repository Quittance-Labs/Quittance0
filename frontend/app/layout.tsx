import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Quittance — Crypto invoices you can prove',
  description:
    'Create Stellar invoices, get paid on-chain, and download or email your own payment proof — without exposing anyone else’s wallet history.',
  keywords: [
    'stellar',
    'crypto invoice',
    'quittance',
    'payment proof',
    'xlm',
    'usdc',
    'freelancer invoicing',
    'qr code',
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Toaster position="top-right" richColors />
        {children}
      </body>
    </html>
  );
}


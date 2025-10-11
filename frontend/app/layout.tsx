import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Link to Pay - Instant Crypto Payments',
  description: 'Create instant payment links with QR codes. Accept XLM on Stellar blockchain.',
  keywords: ['stellar', 'crypto', 'payment', 'blockchain', 'xlm', 'link to pay', 'qr code'],
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


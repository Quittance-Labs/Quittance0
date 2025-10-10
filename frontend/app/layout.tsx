import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'One-Click Crypto Invoice - Stellar Blockchain Payments',
  description: 'Create and manage crypto invoices on Stellar blockchain with one click',
  keywords: ['stellar', 'crypto', 'invoice', 'blockchain', 'xlm', 'payment'],
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


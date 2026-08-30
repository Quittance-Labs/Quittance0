import type { Metadata } from 'next';
import { Instrument_Serif } from 'next/font/google';
import { GeistSans } from 'geist/font/sans';
import { Toaster } from 'sonner';
import { MAIN_CONTENT_ID } from '@/lib/a11y';
import './globals.css';

const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Quittance — Invoice on Stellar. Keep the proof.',
  description:
    'Create Stellar invoices, get paid on-chain, and download or email your payment proof — without exposing anyone else’s wallet history.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${instrumentSerif.variable}`}>
      <body className={`${GeistSans.className} antialiased`}>
        {/*
          First focusable element on every page, so a keyboard user can jump the
          fixed header — which holds the wallet control on all four routes —
          instead of tabbing through it on every navigation. Each page provides
          the matching `<main id={MAIN_CONTENT_ID} tabIndex={-1}>` target.
        */}
        <a href={`#${MAIN_CONTENT_ID}`} className="skip-link">
          Skip to main content
        </a>
        {/*
          Toasts are the only feedback for several actions, so they need to reach
          a screen reader. Sonner renders its own polite live region; naming the
          region keeps it distinguishable from the pages' own status regions.
        */}
        <Toaster position="top-right" richColors closeButton />
        {children}
      </body>
    </html>
  );
}

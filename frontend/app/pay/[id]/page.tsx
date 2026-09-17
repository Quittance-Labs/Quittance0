'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import PayPageHeader from '@/components/PayPageHeader';
import {
  PayLoadingState,
  PayUnavailableState,
  PayStatusHero,
  PayDetailsSection,
  PayActionsSection,
} from '@/components/pay';
import { usePaymentPage } from '@/lib/use-payment-page';
import { MAIN_CONTENT_ID } from '@/lib/a11y';
import { detectDevice } from '@/lib/mobile-detection';

/**
 * Public payment page route orchestrating header, hero, details, and action columns.
 */
export default function PaymentPage() {
  const id = useParams().id as string;
  const page = usePaymentPage(id);
  const [isMobile, setIsMobile] = useState(false);
  const [showDesktopWalletAnyway, setShowDesktopWalletAnyway] = useState(false);

  useEffect(() => {
    setIsMobile(detectDevice().isMobile);
  }, []);

  if (page.loading) {
    return <PayLoadingState />;
  }

  if (!page.invoice) {
    return (
      <PayUnavailableState
        error={page.loadError}
        onRetry={() => void page.reload()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-logo-pattern relative py-8 sm:py-12 px-4">
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>
      <PayPageHeader wallet={page.wallet} />
      <div className="max-w-4xl mx-auto relative z-10">
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="pt-20">
          <PayStatusHero session={page} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            <PayDetailsSection session={page} />
            <PayActionsSection
              session={page}
              isMobile={isMobile}
              showDesktopWalletAnyway={showDesktopWalletAnyway}
              setShowDesktopWalletAnyway={setShowDesktopWalletAnyway}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

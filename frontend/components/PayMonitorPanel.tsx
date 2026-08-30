'use client';

import { Loader2 } from 'lucide-react';
import { paymentMonitorLabels } from '@/lib/payment-monitor';

export default function PayMonitorPanel({ active, intervalMs }: { active: boolean; intervalMs: number }) {
  const copy = active ? paymentMonitorLabels.listening : paymentMonitorLabels.paused;
  return (
    <aside aria-live="polite" className="card flex items-center gap-3" data-monitor-state={active ? 'listening' : 'paused'}>
      {active && <Loader2 className="w-4 h-4 animate-spin text-cyan-600" />}
      <div>
        <p className="font-semibold text-gray-900">{copy.title}</p>
        <p className="text-sm text-gray-600">{copy.description} {active && `Checking every ${intervalMs / 1000} seconds.`}</p>
      </div>
    </aside>
  );
}

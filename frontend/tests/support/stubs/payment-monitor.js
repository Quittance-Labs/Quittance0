/** `@/lib/payment-monitor` without the Horizon stream it opens on mount. */
export const paymentMonitorLabels = Object.freeze({
  listening: {
    title: 'Listening for payment',
    description: 'The invoice status updates automatically after confirmation.',
  },
  paused: {
    title: 'Payment monitoring stopped',
    description: 'Manual verification remains available.',
  },
});
export const paymentMonitor = {
  isMonitoring: () => false,
  startMonitoring: () => {},
  stopMonitoring: () => {},
};
export default paymentMonitor;

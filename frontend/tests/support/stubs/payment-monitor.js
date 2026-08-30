/** `@/lib/payment-monitor` without the Horizon stream it opens on mount. */
export const paymentMonitor = {
  isMonitoring: () => false,
  startMonitoring: () => {},
  stopMonitoring: () => {},
};
export default paymentMonitor;

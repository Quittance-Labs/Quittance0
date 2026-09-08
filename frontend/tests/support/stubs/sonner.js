/**
 * Toasts are side effects, not markup. Sonner renders into its own portal and
 * is not part of any audited page, so every call is a no-op here.
 */
const noop = () => undefined;
export const toast = Object.assign(noop, {
  success: noop,
  error: noop,
  warning: noop,
  info: noop,
  loading: noop,
  dismiss: noop,
  custom: noop,
});
export const Toaster = () => null;

/** Copy text without leaking clipboard permission or availability errors. */
export async function copyWithFeedback(text: string): Promise<boolean> {
  let textarea: HTMLTextAreaElement | null = null;
  let active: HTMLElement | null = null;
  try {
    if (typeof text !== 'string') {
      return false;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Clipboard API is missing in older/mobile webviews and non-secure local
    // contexts. The temporary textarea fallback keeps the explicit copy action
    // working without changing focus permanently.
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
      return false;
    }
    active = document.activeElement as HTMLElement | null;
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange?.(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.remove();
    active?.focus?.();
  }
}

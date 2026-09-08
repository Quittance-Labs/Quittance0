/** Copy text without leaking clipboard permission or availability errors. */
export async function copyWithFeedback(text: string): Promise<boolean> {
  try {
    if (typeof text !== 'string' || typeof navigator === 'undefined') {
      return false;
    }
    if (typeof navigator.clipboard?.writeText !== 'function') {
      return false;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

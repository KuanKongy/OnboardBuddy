/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * Lifted from NodeInfoPanel's private helper so the contact pills and the node
 * panel share one behaviour: the async Clipboard API first, then a hidden
 * textarea + execCommand fallback for browsers and contexts (older Safari, some
 * embedded webviews) where navigator.clipboard is unavailable or throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

// Copies text to the clipboard using a hidden textarea + execCommand.
//
// Why not navigator.clipboard.writeText?
//   navigator.clipboard is only available in secure contexts (HTTPS or
//   localhost). This app is commonly accessed over plain HTTP on a LAN
//   (e.g. http://10.1.2.5:3000), where navigator.clipboard is undefined
//   and any call throws "Cannot read properties of undefined". Since
//   HTTP access is a supported use case, we cannot rely on it.
//
// Why execCommand even though it is deprecated?
//   It is the only programmatic clipboard API that works in non-secure
//   contexts, and is still supported in all major browsers. There is no
//   non-deprecated alternative for HTTP environments.
export async function copyTextToClipboard(text: string): Promise<void> {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // Cannot use display:none — the element must be laid out and selectable
  // for execCommand('copy') to work. Hide it offscreen instead.
  textarea.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none;padding:0;';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  try {
    textarea.focus();
    textarea.select();
    // execCommand is deprecated but is the only API that works in non-secure contexts (HTTP)
    const exec = (
      document as unknown as {
        execCommand: (command: string) => boolean;
      }
    ).execCommand;
    const succeeded = exec.call(document, 'copy');
    if (!succeeded) {
      throw new Error('Failed to copy text to clipboard');
    }
  } finally {
    document.body.removeChild(textarea);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }
}

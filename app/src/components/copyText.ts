// Copy text to the clipboard (extracted from Chat's thread controls for phase 8
// item 18d, so Copy reference and the charter card's copy share one helper).
// It writes the text exactly as given, never markup, and answers whether the
// copy happened: a caller tells the owner when it did not (never a silent
// success).

/** Copy `text` to the clipboard: the async clipboard, else the selection's copy. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection's copy.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    active?.focus();
    return done;
  } catch {
    return false;
  }
}

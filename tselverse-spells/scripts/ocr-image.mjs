// A picture of a spell pasted or dropped on the "paste spell text" box: its text is read by the
// foundry-reveal helper on this computer (tesseract) and put in the box, where the usual reading
// turns it into a spell. The text stays there to check - OCR misreads numbers ("846" for 8d6).
const HELPER = "http://127.0.0.1:30099/ocr";

async function readPicture(file) {
  // no Content-Type: a "simple" request, so the browser doesn't ask the helper first
  const r = await fetch(HELPER, { method: "POST", body: new Blob([await file.arrayBuffer()]) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? r.statusText);
  // the one slip safe to mend: "$" for S in the components line
  return String(out.text ?? "").replace(/^(Components?:.*)$/im, line => line.replace(/\$/g, "S")).trim();
}

export function attachImageOCR(textarea) {
  if (!textarea || textarea.dataset.tsvspOcr) return;
  textarea.dataset.tsvspOcr = "1";
  const take = async file => {
    if (!file?.type?.startsWith("image/")) return false;
    const was = textarea.placeholder;
    textarea.placeholder = "Reading the picture…";
    try {
      textarea.value = await readPicture(file);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      ui.notifications.info("Read the picture's text - check it (especially numbers) before adding.");
    } catch (err) {
      ui.notifications.warn(`Couldn't read the picture (${err.message}). The foundry-reveal helper must be running on the computer Foundry runs on.`);
    } finally { textarea.placeholder = was; }
    return true;
  };
  textarea.addEventListener("paste", async ev => {
    const file = [...(ev.clipboardData?.files ?? [])].find(f => f.type.startsWith("image/"));
    if (file) { ev.preventDefault(); await take(file); }
  });
  textarea.addEventListener("dragover", ev => { if ([...(ev.dataTransfer?.items ?? [])].some(i => i.type.startsWith("image/"))) ev.preventDefault(); });
  textarea.addEventListener("drop", async ev => {
    const file = [...(ev.dataTransfer?.files ?? [])].find(f => f.type.startsWith("image/"));
    if (file) { ev.preventDefault(); await take(file); }
  });
}

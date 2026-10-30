/**
 * Show Players posts the picture to chat too (2026-10-20). The picture window Foundry pops up for players
 * can be closed or lost; the chat copy stays, and clicking it opens the picture full size again.
 * The name is only shown when Foundry would show it in the window (the creature is visible to players,
 * or "show title" was asked for), so an unknown creature's portrait doesn't give away what it is.
 */
const MODULE = "tselverse-common";

Hooks.once("init", () => {
  const IP = foundry.applications.apps.ImagePopout;
  const original = IP.prototype.shareImage;
  IP.prototype.shareImage = function (options = {}) {
    const r = original.call(this, options);
    try { postToChat(this, options); } catch (e) { console.warn(`${MODULE} | shown picture to chat`, e); }
    return r;
  };
});

async function postToChat(popout, options) {
  const src = options.image ?? popout.options.src;
  if (!src) return;
  const uuid = options.uuid ?? popout.options.uuid;
  const doc = uuid ? fromUuidSync(uuid) : null;
  let showTitle = options.showTitle ?? popout.options.showTitle;
  if (showTitle === undefined) showTitle = doc ? (doc.ownership?.default ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED : true;
  const title = showTitle ? (options.title ?? popout.options.window?.title ?? "") : "";
  const users = Array.isArray(options.users) ? options.users : null;
  const esc = foundry.utils.escapeHTML;
  const content = `<figure class="tsv-shown-image" data-src="${esc(src)}" data-title="${esc(title)}">`
    + `<img src="${esc(src)}" alt="${esc(title)}" style="width:100%;cursor:zoom-in;border:none" data-tooltip="Click to enlarge">`
    + (title ? `<figcaption style="text-align:center">${esc(title)}</figcaption>` : "")
    + `</figure>`;
  await ChatMessage.create({
    content,
    speaker: { alias: game.user.name },
    whisper: users ?? [],
    flags: { [MODULE]: { shownImage: true } }
  });
}

// click the picture in chat: open it full size
Hooks.on("renderChatMessageHTML", (message, html) => {
  const fig = html.querySelector?.(".tsv-shown-image");
  if (!fig) return;
  fig.querySelector("img")?.addEventListener("click", ev => {
    ev.preventDefault();
    const title = fig.dataset.title || " ";
    new foundry.applications.apps.ImagePopout({ src: fig.dataset.src, window: { title } }).render(true);
  });
});

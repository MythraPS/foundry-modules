// Fix Pictures: from an actor, item or token straight to foundry-import's picture choices for it,
// and the chosen picture swapped in here as soon as it is picked (the GUI posts back to this tab).
// a label from the language file, or its English until Foundry has loaded that file (it reads a
// module's language list only when the world starts)
const _t = (key, english) => game.i18n.has?.(key) ? game.i18n.localize(key) : english;
const GUI = "http://127.0.0.1:8765";
const GUI_ORIGINS = ["http://127.0.0.1:8765", "http://localhost:8765"];

/** The draft a document came from: foundry-import writes it on everything it builds. */
async function draftOf(doc) {
  let slug = doc.flags?.["foundry-import"]?.source;
  if (!slug && doc._stats?.compendiumSource) {                      // a world copy of a compendium entry
    const src = await fromUuid(doc._stats.compendiumSource).catch(() => null);
    slug = src?.flags?.["foundry-import"]?.source;
  }
  return slug ?? "";
}

async function openFix(doc) {
  if (!doc) return;
  const slug = await draftOf(doc);
  const url = `${GUI}/?fix=${encodeURIComponent(slug)}&name=${encodeURIComponent(doc.name)}&uuid=${encodeURIComponent(doc.uuid)}`;
  // a tab per entry: fixing a second picture opens its own tab instead of replacing one still in
  // progress (the same entry again goes back to its tab)
  const w = window.open(url, `foundry-import-${doc.uuid.replace(/[^A-Za-z0-9]/g, "-")}`);
  if (!w) ui.notifications.warn("The browser blocked the foundry-import page - allow pop-ups for Foundry.");
  else ui.notifications.info(`Choose ${doc.name}'s picture in the foundry-import tab; it will change here as soon as you pick it.`);
}

async function docFrom(app, li) {
  const id = li.closest("[data-entry-id]")?.dataset.entryId ?? li.dataset?.entryId;
  const pack = app.collection?.metadata ? app.collection : null;
  return pack ? pack.getDocument(id) : app.collection?.get?.(id) ?? null;
}

for (const hook of ["getActorContextOptions", "getItemContextOptions"]) {
  Hooks.on(hook, (app, options) => {
    options.push({
      label: _t("TSVPORT.FixPicture", "Fix picture (foundry-import)"),
      icon: "fa-solid fa-image",
      visible: () => game.user.isGM,
      onClick: async (event, li) => openFix(await docFrom(app, li))
    });
  });
}

// the token HUD (right-click a token): a picture button beside the others
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  const col = root.querySelector(".col.left") ?? root;
  const b = document.createElement("button");
  b.type = "button"; b.className = "control-icon"; b.dataset.tooltip = _t("TSVPORT.FixPictureTip", "Fix picture: opens foundry-import to choose another picture or reframe the token; the change shows here straight away.");
  b.innerHTML = '<i class="fa-solid fa-image"></i>';
  b.addEventListener("click", () => openFix(hud.object?.actor ?? hud.object?.document));
  col.appendChild(b);
});

// Right-click ANY picture of a document -> Fix picture: compendium search results in the sidebar,
// compendium windows, the Actors/Items lists, item rows and portraits on sheets, Item Piles windows.
// Only pictures are taken over, so right-clicking a row's name still opens Foundry's own menu.

/** The application instance an element belongs to (sheets, compendium windows, directories). */
const appOf = el => {
  const node = el.closest(".application, .app");
  return node?.id ? foundry.applications.instances.get(node.id) ?? ui.windows?.[node.dataset.appid] ?? null : null;
};

/** The document a picture stands for, or null. */
async function docForImage(img) {
  // an Item Piles row: no id on it - the item is found by name in the pile whose actor id is in the
  // window's id ("item-pile-merchant-<pile>-<buyer>")
  const pileRow = img.closest(".item-piles-app .item-piles-item-row");
  if (pileRow) {
    const pileId = pileRow.closest(".item-piles-app")?.id?.match(/item-pile-[a-z]+-([A-Za-z0-9]{16})/)?.[1];
    const name = pileRow.querySelector(".item-piles-name-container")?.textContent?.trim();
    return (pileId ? game.actors.get(pileId) : null)?.items.find(i => i.name === name) ?? null;
  }
  // anything that names its document ("data-uuid" - the sidebar's compendium search results)
  // (a spell row in Black Flag's Spell Manager names its spell with data-spell-uuid)
  const withUuid = img.closest("[data-uuid], [data-document-uuid], [data-spell-uuid]");
  const uuid = withUuid?.dataset.uuid ?? withUuid?.dataset.documentUuid ?? withUuid?.dataset.spellUuid;
  if (uuid && /^(Compendium|Actor|Item|Scene|JournalEntry)[.]/.test(uuid)) {
    const d = await fromUuid(uuid).catch(() => null);
    if (d && ("img" in d)) return d;
  }
  const app = appOf(img);
  // an item row on an actor sheet
  const itemRow = img.closest("[data-item-id]");
  const owner = app?.document ?? app?.actor;
  if (itemRow && owner?.items) return owner.items.get(itemRow.dataset.itemId) ?? null;
  // a compendium window or a sidebar directory row
  const entry = img.closest("[data-entry-id], [data-document-id]");
  const id = entry?.dataset.entryId ?? entry?.dataset.documentId;
  if (id) {
    const coll = app?.collection;
    if (coll?.metadata) return coll.getDocument(id);
    const d = coll?.get?.(id) ?? game.actors.get(id) ?? game.items.get(id);
    if (d) return d;
  }
  // anything else in a document's own window - the portrait on a sheet, the picture on an item sheet
  if (app?.document && "img" in app.document) return app.document;
  return null;
}

function showMenu(ev, onPick) {
  // the window the click was in: the main one, or a detached window (Foundry 14 pop-out)
  const document = ev.target?.ownerDocument ?? globalThis.document;
  document.querySelectorAll(".tsvport-menu").forEach(m => m.remove());
  const menu = document.createElement("nav");
  menu.className = "tsvport-menu";
  menu.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px;z-index:10000;background:var(--color-cool-5,#222);`
    + "color:var(--color-light-1,#eee);border:1px solid var(--color-cool-3,#555);border-radius:4px;padding:4px 0;min-width:180px;box-shadow:0 2px 8px #0008";
  menu.innerHTML = `<button type="button" style="all:unset;display:block;padding:4px 12px;cursor:pointer" data-tooltip="${
    foundry.utils.escapeHTML(_t("TSVPORT.FixPictureTip", "Fix picture: opens foundry-import to choose another picture or reframe the token; the change shows here straight away."))}"><i class="fa-solid fa-image"></i> ${
    foundry.utils.escapeHTML(_t("TSVPORT.FixPicture", "Fix picture (foundry-import)"))}</button>`;
  menu.querySelector("button").addEventListener("click", () => { menu.remove(); onPick(); });
  document.body.appendChild(menu);
  const away = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("pointerdown", away, true); } };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
}

function onContextMenu(ev) {
  if (!game.user?.isGM) return;
  // the compendium browser (compendium-browser-bf) has no right-click menu of its own: anywhere on a result row
  // counts, not just its small picture
  const browserRow = ev.target.closest?.("#compendium-browser-bf li[data-uuid]");
  const img = browserRow?.querySelector("img") ?? ev.target.closest?.("img");
  if (!img || img.closest("#board, .tsvport-menu, .chat-message, .editor-content, .journal-page-content")) return;
  // decided synchronously so Foundry's own menu doesn't open as well; the document is looked up after
  const looksLikeDoc = img.closest(".item-piles-item-row, [data-uuid], [data-document-uuid], [data-spell-uuid], [data-item-id], [data-entry-id], [data-document-id]")
    || appOf(img)?.document;
  if (!looksLikeDoc) return;
  ev.preventDefault(); ev.stopPropagation();
  showMenu(ev, async () => {
    const doc = await docForImage(img);
    if (!doc) return ui.notifications.warn(_t("TSVPORT.NoDoc", "Couldn't tell which document this picture belongs to."));
    // an item copied from a compendium: fix the compendium entry, so the fix reaches the pack and every copy
    const src = doc.parent && doc._stats?.compendiumSource ? await fromUuid(doc._stats.compendiumSource).catch(() => null) : null;
    openFix(src ?? doc);
  });
}
document.addEventListener("contextmenu", onContextMenu, true);
// detached windows (a window popped out of Foundry into its own browser window) have their own document
const watchWindow = win => { try { win?.document?.addEventListener("contextmenu", onContextMenu, true); } catch (e) {} };
Hooks.on("openDetachedWindow", (id, win) => watchWindow(win));
Hooks.once("ready", () => { for (const {window: win} of foundry.applications.detached?.windows?.values?.() ?? []) watchWindow(win); });

// ---- the GUI says a picture was picked: take it in without a restart
async function refetch(path) {
  if (!path) return;
  try { await fetch(`/${path}`.replace(/^\/+/, "/"), { cache: "reload" }); } catch (e) {}
  try { await foundry.canvas?.TextureLoader?.loader?.unloadTexture?.(path); } catch (e) {}
  try { PIXI.Assets?.cache?.remove?.(path); PIXI.Texture.removeFromCache?.(path); } catch (e) {}
}

async function updateDoc(doc, portrait, token) {
  const change = {};
  if (portrait && doc.img !== portrait) change.img = portrait;
  if (doc.documentName === "Actor" && token && doc.prototypeToken?.texture?.src !== token) change["prototypeToken.texture.src"] = token;
  if (!Object.keys(change).length) return false;
  const pack = doc.pack ? game.packs.get(doc.pack) : null;
  const wasLocked = pack?.locked;
  if (wasLocked) await pack.configure({ locked: false });
  try { await doc.update(change); } finally { if (wasLocked) await pack.configure({ locked: true }); }
  return true;
}

window.addEventListener("message", async ev => {
  if (!GUI_ORIGINS.includes(ev.origin) || ev.data?.type !== "fi-art-fixed" || !game.user.isGM) return;
  const { uuid, portrait, token } = ev.data;
  await refetch(portrait); await refetch(token);
  const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (doc) {
    await updateDoc(doc, portrait, token);
    // world copies of that compendium entry, and every token of the actor on the scenes
    const copies = doc.pack ? game.actors.filter(a => a._stats?.compendiumSource === doc.uuid) : [];
    for (const a of copies) await updateDoc(a, portrait, token);
    if (doc.documentName === "Item" && doc.pack) {
      for (const i of game.items.filter(i => i._stats?.compendiumSource === doc.uuid)) await updateDoc(i, portrait, token);
      for (const a of game.actors) for (const i of a.items.filter(i => i._stats?.compendiumSource === doc.uuid)) await updateDoc(i, portrait, token);
    }
    const actors = new Set([doc, ...copies].filter(d => d.documentName === "Actor").map(a => a.id));
    for (const scene of game.scenes) {
      const upd = scene.tokens.filter(t => actors.has(t.actorId) && token && t.texture.src !== token)
                              .map(t => ({ _id: t.id, "texture.src": token }));
      if (upd.length) await scene.updateEmbeddedDocuments("Token", upd);
    }
    for (const t of canvas?.tokens?.placeables ?? []) if (actors.has(t.document.actorId)) await t.draw?.();
    for (const app of foundry.applications.instances?.values?.() ?? []) if (app.document && actors.has(app.document.id)) app.render?.();
  }
  ui.notifications.info(`New picture in: ${doc?.name ?? "the entry"}.`);
});

// ---- pictures put on entries foundry-import didn't make (Black Flag's own lineages, other modules'
// items): the GUI records them in tselverse-art/art/foreign-art.json, and a system or module update
// replaces those packs - so the first GM to load the world puts them back
Hooks.once("ready", async () => {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  let map;
  try {
    const r = await fetch("modules/tselverse-art/art/foreign-art.json", { cache: "no-store" });
    if (!r.ok) return;
    map = await r.json();
  } catch (e) { return; }
  for (const [uuid, { img }] of Object.entries(map ?? {})) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc || !img || doc.img === img) continue;
    try { await updateDoc(doc, img, doc.documentName === "Actor" ? img : null); }
    catch (e) { console.warn(`tselverse-portraits | couldn't put the picture back on ${uuid}`, e); }
  }
});

// Show Map in Files: right-click a scene -> the file manager opens at its map image.
// The browser can't open folders itself; the foundry-reveal helper (127.0.0.1:30099) does it.
// a label from the language file, or its English until Foundry has loaded that file (it reads a
// module's language list only when the world starts)
const _t = (key, english) => game.i18n.has?.(key) ? game.i18n.localize(key) : english;
const HELPER = "http://127.0.0.1:30099/reveal";

/** The scene's map path (Data-relative): v14 keeps it on the scene's levels, older scenes on the scene. */
function mapOf(scene) {
  const level = scene.initialLevel ?? scene.levels?.contents?.[0];
  return level?.background?.src || scene.background?.src || null;
}

async function show(app, li) {
  const id = li.closest("[data-entry-id]")?.dataset.entryId;
  const pack = app.collection?.metadata ? app.collection : null;
  const scene = pack ? await pack.getDocument(id) : game.scenes.get(id);
  const src = scene && mapOf(scene);
  if (!src) return ui.notifications.warn(`${scene?.name ?? "This scene"} has no map image.`);
  const path = decodeURIComponent(src);
  try {
    const r = await fetch(HELPER, { method: "POST", body: path });   // text/plain: no preflight
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
    ui.notifications.info(`Showing ${path.split("/").pop()} in Files.`);
  } catch (err) {
    await game.clipboard.copyPlainText(path);
    ui.notifications.warn(`Couldn't open Files (${err.message}). The map's path was copied: ${path} (inside Foundry's Data folder).`);
  }
}

Hooks.on("getSceneContextOptions", (app, options) => {
  options.push({
    label: _t("TSVSCENE.ShowInFiles", "Show map in Files"),
    icon: "fa-solid fa-folder-open",
    visible: () => game.user.isGM,
    onClick: (event, li) => show(app, li)
  });
});

/**
 * Creature Journals - a notes button in the Token HUD.
 *
 * Right-click a token and the HUD shows a book. Notes live at two levels:
 *   - the CREATURE TYPE: every False Worm shares one journal (flag on the world actor);
 *   - this TOKEN only: the one on this map (flag on the token document).
 * For an unlinked token the book opens a small HUD menu with both, each marked "open" if it
 * exists or "new" if it does not, so either can be made at any time. A linked token - a PC,
 * a named NPC - is its own actor, so there is only one level and the book opens it directly.
 *
 * Every journal these create is tagged (flags: scope, actor uuid, token uuid) and shows a
 * banner saying whose notes it is, linking the creature and the notes at the other level.
 * The banner is drawn when the sheet renders - nothing is written into the notes themselves.
 *
 * GM only. Journals are created with no player ownership. Alt-click shows one to everyone
 * without granting ownership; Foundry's own "Show Players" does the same for a single page.
 */

const MODULE = "tselverse-notes";
const _loc = (k, d) => game.i18n.format(k, d ?? {});
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const Journal = () => foundry.documents.collections.Journal;

/** An unlinked token's `.actor` is a synthetic copy whose flags land in the token's delta,
 *  so type-wide notes go on the world actor. */
const worldActor = tokenDoc => game.actors.get(tokenDoc?.actorId) ?? tokenDoc?.actor ?? null;

async function journalFrom(uuid) {
  if (!uuid) return null;
  try { return await fromUuid(uuid); } catch { return null; }   // deleted since - treat as none
}

async function ensureFolder() {
  let folder = game.folders.find(f => f.type === "JournalEntry" && f.getFlag(MODULE, "root"));
  if (!folder) folder = await Folder.implementation.create({
    name: _loc("TSVNOTES.Folder"), type: "JournalEntry", color: "#4b3a2a",
    flags: {[MODULE]: {root: true}}
  });
  return folder;
}

const typeJournal = actor => journalFrom(actor?.getFlag(MODULE, "journal"));
const tokenJournal = tokenDoc => tokenDoc?.actorLink ? null : journalFrom(tokenDoc?.getFlag(MODULE, "journal"));

/** Make a journal for one level. scope "actor" needs only the actor; "token" needs the token. */
async function createJournal({actor, tokenDoc, scope}) {
  const folder = await ensureFolder();
  const name = scope === "token"
    ? `${tokenDoc.name} (${tokenDoc.parent?.name ?? "token"})`
    : actor.name;
  const link = actor ? `<p>@UUID[${actor.uuid}]{${actor.name}}</p>` : "";
  const entry = await JournalEntry.implementation.create({
    name, folder: folder.id,
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE},
    pages: [{name: _loc("TSVNOTES.Page"), type: "text", text: {content: `${link}<p></p>`}}],
    flags: {[MODULE]: {scope, actor: actor?.uuid ?? null, token: scope === "token" ? tokenDoc.uuid : null}}
  });
  if (scope === "token") await tokenDoc.setFlag(MODULE, "journal", entry.uuid);
  else await actor.setFlag(MODULE, "journal", entry.uuid);
  return entry;
}

/** Open a level's notes, making them first if they do not exist yet. */
async function openLevel({actor, tokenDoc, scope, show = false}) {
  let entry = scope === "token" ? await tokenJournal(tokenDoc) : await typeJournal(actor);
  if (!entry) entry = await createJournal({actor, tokenDoc, scope});
  if (show) return Journal().show(entry, {force: true});   // players see it, ownership unchanged
  entry.sheet.render(true);
  return entry;
}

/* ------------------------------------------------------------------ the HUD */

Hooks.on("renderTokenHUD", async (hud, element) => {
  if (!game.user.isGM) return;
  try {
    const root = element instanceof HTMLElement ? element : element?.[0];
    const col = root?.querySelector(".col.right");
    const tokenDoc = hud.document ?? hud.object?.document;
    if (!col || !tokenDoc) return;
    col.querySelectorAll(".tsvnotes, .tsvnotes-palette").forEach(n => n.remove());

    const actor = worldActor(tokenDoc);
    const own = await tokenJournal(tokenDoc);
    const type = actor ? await typeJournal(actor) : null;
    const twoLevels = actor && !tokenDoc.actorLink;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon tsvnotes";
    btn.dataset.tooltipHtml = _loc(twoLevels ? "TSVNOTES.TooltipTwo" : "TSVNOTES.TooltipOne");
    btn.setAttribute("aria-label", _loc("TSVNOTES.Label"));
    btn.innerHTML = `<i class="fa-solid fa-book-open" inert></i>`;
    if (own || type) btn.classList.add("has-notes");

    if (twoLevels) {
      // Foundry's own palette machinery: the HUD toggles any `.control-icon[data-palette]`
      // with a matching `.palette`, and `palette-list` is the list style it uses itself.
      btn.dataset.action = "togglePalette";
      btn.dataset.palette = "tsvnotes";
      const pal = document.createElement("div");
      pal.className = "palette palette-list tsvnotes-palette";
      pal.dataset.palette = "tsvnotes";
      const row = (scope, icon, label, exists) => `
        <button type="button" class="palette-list-entry" data-scope="${scope}">
          <span><i class="fa-solid ${icon}" inert></i> ${esc(label)}
            <em class="tsvnotes-state">${esc(_loc(exists ? "TSVNOTES.Open" : "TSVNOTES.New"))}</em></span>
        </button>`;
      pal.innerHTML = row("token", "fa-user", _loc("TSVNOTES.ForToken"), !!own)
                    + row("actor", "fa-users", _loc("TSVNOTES.ForType", {name: actor.name}), !!type);
      pal.addEventListener("click", ev => {
        const entry = ev.target.closest("[data-scope]");
        if (!entry) return;
        ev.preventDefault(); ev.stopPropagation();
        hud.togglePalette?.(null);
        openLevel({actor, tokenDoc, scope: entry.dataset.scope, show: ev.altKey});
      });
      col.append(btn, pal);
    } else {
      col.append(btn);
    }

    // Plain click on a two-level token falls through to the palette. Modifier shortcuts are
    // caught first and kept from reaching the HUD's own click handling.
    btn.addEventListener("click", ev => {
      if (twoLevels && !ev.shiftKey && !ev.altKey) return;
      ev.preventDefault(); ev.stopPropagation();
      const scope = twoLevels && !ev.shiftKey ? (own ? "token" : "actor") : (actor ? "actor" : "token");
      openLevel({actor, tokenDoc, scope: twoLevels && ev.shiftKey ? "actor" : scope, show: ev.altKey});
    });
    btn.addEventListener("contextmenu", ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (twoLevels) openLevel({actor, tokenDoc, scope: "token"});
    });
  } catch (err) {
    console.error(`${MODULE} | adding the journal button failed`, err);
  }
});

/* ------------------------------------------------------------------ the journal banner */

/** A strip under the title saying whose notes these are, with the other level beside it. */
async function banner(entry) {
  const f = entry.flags?.[MODULE];
  if (!f?.scope) return null;
  const actor = await journalFrom(f.actor);
  const el = document.createElement("div");
  el.className = "tsvnotes-banner";
  const creature = actor ? `<a class="tsvnotes-link" data-open="actor">${esc(actor.name)}</a>` : "";

  if (f.scope === "token") {
    const tokenDoc = await journalFrom(f.token);
    const where = tokenDoc?.parent?.name ? ` · ${esc(tokenDoc.parent.name)}` : "";
    const type = actor ? await typeJournal(actor) : null;
    el.innerHTML = `
      <span class="tsvnotes-scope"><i class="fa-solid fa-user" inert></i> ${esc(_loc("TSVNOTES.BannerToken"))}${where}</span>
      <span>${creature}</span>
      ${actor ? `<a class="tsvnotes-link" data-open="type">
        <i class="fa-solid fa-users" inert></i> ${esc(_loc(type ? "TSVNOTES.OpenType" : "TSVNOTES.MakeType", {name: actor.name}))}</a>` : ""}`;
  } else {
    // every token of this creature that has notes of its own
    const tokens = game.journal.filter(j => j.getFlag(MODULE, "scope") === "token" && j.getFlag(MODULE, "actor") === f.actor);
    el.innerHTML = `
      <span class="tsvnotes-scope"><i class="fa-solid fa-users" inert></i> ${esc(_loc("TSVNOTES.BannerType", {name: actor?.name ?? entry.name}))}</span>
      <span>${creature}</span>
      ${tokens.length ? `<span>${esc(_loc("TSVNOTES.TokenNotes"))} ${tokens.map(j =>
        `<a class="tsvnotes-link" data-open="uuid" data-uuid="${j.uuid}">${esc(j.name)}</a>`).join(", ")}</span>` : ""}`;
  }

  el.addEventListener("click", async ev => {
    const a = ev.target.closest("[data-open]");
    if (!a) return;
    ev.preventDefault();
    if (a.dataset.open === "actor") return actor?.sheet.render(true);
    if (a.dataset.open === "uuid") return (await journalFrom(a.dataset.uuid))?.sheet.render(true);
    if (a.dataset.open === "type" && actor) return openLevel({actor, scope: "actor"});
  });
  return el;
}

Hooks.on("renderApplicationV2", async (app, element) => {
  const entry = app.document;
  if (!game.user.isGM || entry?.documentName !== "JournalEntry" || !entry.getFlag(MODULE, "scope")) return;
  try {
    const root = element instanceof HTMLElement ? element : app.element;
    const header = root?.querySelector(".journal-header");
    if (!header) return;
    root.querySelector(".tsvnotes-banner")?.remove();
    const el = await banner(entry);
    if (el) header.after(el);
  } catch (err) {
    console.error(`${MODULE} | drawing the journal banner failed`, err);
  }
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = {openLevel, createJournal, worldActor, typeJournal, tokenJournal};
});

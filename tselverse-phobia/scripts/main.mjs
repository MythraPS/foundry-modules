/* Arachnophobia Cats: a flagged token shows a cat picture to the users who asked for it.
 * The swap is made in each client's own prepared token data (never in the stored document), so the map, the
 * combat tracker and the Token HUD all follow it and nothing is saved or sent to anyone else. */
const MOD = "tselverse-phobia";
const CAT_DIR = `modules/${MOD}/cats`;
const IMAGE = /\.(webp|png|jpe?g|avif|gif)$/i;

const afraid = () => !!game.user?.getFlag(MOD, "arachnophobia");
const cats = () => { try { return game.settings.get(MOD, "cats") ?? []; } catch { return []; } };

const creatures = () => { try { return game.settings.get(MOD, "creatures") ?? []; } catch { return []; } };
const norm = n => String(n ?? "").trim().toLowerCase().replace(/\s+/g, " ");
async function setCreatures(names) {
  const seen = new Set(), out = [];
  for (const n of names) { const t = String(n ?? "").trim().replace(/\s+/g, " "); if (t && !seen.has(norm(t))) { seen.add(norm(t)); out.push(t); } }
  out.sort((x, y) => x.localeCompare(y));
  await game.settings.set(MOD, "creatures", out);
}
/** Is a creature of this name on the bug-like list? ("Giant Spider*" covers every name starting that way.) */
function listed(name) {
  const n = norm(name);
  if (!n) return false;
  return creatures().some(c => { const k = norm(c); return k.endsWith("*") ? n.startsWith(k.slice(0, -1).trim()) : n === k; });
}
/** A creature is bug-like by its name: the token's actor (the world actor it was made from, so a renamed
 *  token still counts). The old per-token tick is still honoured where one was set. */
function flagged(doc) {
  let actor = null;
  try { actor = game.actors?.get(doc.actorId) ?? doc.actor; } catch { /* the actors aren't loaded yet */ }
  if (listed(actor?.name) || listed(actor?.prototypeToken?.name)) return true;
  const own = doc.flags?.[MOD]?.spider;
  if (own !== undefined && own !== null) return !!own;
  return !!actor?.prototypeToken?.flags?.[MOD]?.spider;
}

/** The same token always gets the same cat. */
function catFor(doc) {
  const list = cats();
  if (!list.length || !afraid() || !flagged(doc)) return null;
  let h = 0;
  for (const ch of doc.id ?? doc.name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

function swap(doc) {
  const cat = catFor(doc);
  if (!cat) return;
  doc.texture.src = cat;
  if (doc.ring?.subject?.texture) doc.ring.subject.texture = cat;
}

/** Prepare every token again and redraw what is on screen. */
async function refreshAll() {
  for (const scene of game.scenes) for (const t of scene.tokens) t.reset();
  if (canvas?.ready) for (const t of canvas.tokens.placeables) await t.draw();
  ui.combat?.render();
}

Hooks.once("init", () => {
  game.settings.register(MOD, "cats", {scope: "world", config: false, type: Array, default: []});
  game.settings.register(MOD, "creatures", {scope: "world", config: false, type: Array, default: []});
  const proto = CONFIG.Token.documentClass.prototype, base = proto.prepareBaseData;
  proto.prepareBaseData = function (...args) {
    const out = base.apply(this, args);
    try { swap(this); } catch (err) { console.warn(`${MOD} |`, err); }
    return out;
  };
});

/* ---- the GM's two lists, in the module's settings: who sees cats (every user, online or not) and
 * which creatures are bug-like (by name, so every drider is covered, whichever token or copy it is) */
function registerMenus() {
  const {ApplicationV2} = foundry.applications.api;
  const esc = foundry.utils.escapeHTML;
  class Listing extends ApplicationV2 {
    static DEFAULT_OPTIONS = {tag: "div", position: {width: 400, height: "auto"}};
    _replaceHTML(result, content) { content.replaceChildren(result); }
    _onRender() {
      this.element.querySelector("[data-save]")?.addEventListener("click", async ev => {
        ev.preventDefault();
        try { await this.save(this.element); await this.close(); }
        catch (err) { ui.notifications.error(err, {console: true}); }
      });
    }
    box(inner) {
      const div = document.createElement("div");
      div.className = "standard-form"; div.style.padding = "0.5rem 1rem";
      div.innerHTML = `${inner}<footer class="form-footer"><button type="button" data-save><i class="fa-solid fa-floppy-disk"></i> Save</button></footer>`;
      return div;
    }
  }
  class PhobiaUsers extends Listing {
    static DEFAULT_OPTIONS = {id: `${MOD}-users`, window: {title: "Arachnophobia: who sees cats", icon: "fa-solid fa-cat"}};
    async _renderHTML() {
      const rows = game.users.contents.sort((a, b) => a.name.localeCompare(b.name)).map(u => `
        <div class="form-group"><label>${esc(u.name)}${u.isGM ? " (GM)" : ""}${u.active ? "" : " <em>- offline</em>"}</label>
          <div class="form-fields"><input type="checkbox" data-user="${u.id}"${u.getFlag(MOD, "arachnophobia") ? " checked" : ""}></div></div>`).join("");
      return this.box(`<p class="hint">Ticked users see a cat picture instead of any bug-like creature's token.</p>${rows}`);
    }
    async save(el) {
      for (const box of el.querySelectorAll("input[data-user]")) {
        const u = game.users.get(box.dataset.user);
        if (u && box.checked !== !!u.getFlag(MOD, "arachnophobia")) await u.setFlag(MOD, "arachnophobia", box.checked);
      }
    }
  }
  class PhobiaCreatures extends Listing {
    static DEFAULT_OPTIONS = {id: `${MOD}-creatures`, window: {title: "Arachnophobia: bug-like creatures", icon: "fa-solid fa-spider"}};
    async _renderHTML() {
      return this.box(`<p class="hint">One creature name per line. Every token of a creature with that name is swapped for a cat, for the users who see cats. A line ending in * covers every name that starts that way (Giant Spider*). You can also right-click a creature in the Actors sidebar.</p>
        <textarea rows="16" style="width:100%;resize:vertical">${esc(creatures().join("\n"))}</textarea>`);
    }
    async save(el) { await setCreatures(el.querySelector("textarea").value.split("\n")); }
  }
  game.settings.registerMenu(MOD, "users", {name: "Who sees cats", label: "Choose users", icon: "fa-solid fa-cat", type: PhobiaUsers, restricted: true,
    hint: "Mark the users (online or not) who see a cat picture instead of bug-like creatures."});
  game.settings.registerMenu(MOD, "creatures", {name: "Bug-like creatures", label: "Edit the list", icon: "fa-solid fa-spider", type: PhobiaCreatures, restricted: true,
    hint: "The creatures, by name, whose tokens are swapped for cats."});
}
Hooks.once("init", registerMenus);

Hooks.once("setup", () => { for (const scene of game.scenes) for (const t of scene.tokens) t.reset(); });

Hooks.once("ready", async () => {
  // only a GM may list a folder; the list is kept in a world setting for everyone
  if (!game.users.activeGM?.isSelf) return;
  try {
    const FP = foundry.applications.apps.FilePicker.implementation;
    const found = (await FP.browse("data", CAT_DIR)).files.filter(f => IMAGE.test(f)).sort();
    if (JSON.stringify(found) !== JSON.stringify(cats())) await game.settings.set(MOD, "cats", found);
  } catch (err) { console.warn(`${MOD} | could not read ${CAT_DIR}`, err); }
});

Hooks.on("updateSetting", s => { if (s.key === `${MOD}.cats` || s.key === `${MOD}.creatures`) refreshAll(); });
Hooks.on("updateUser", (user, changes) => { if (user.isSelf && changes.flags?.[MOD]) refreshAll(); else if (changes.flags?.[MOD]) ui.players?.render(); });
Hooks.on("updateToken", (doc, changes) => { if (changes.flags?.[MOD] && afraid()) { doc.reset(); doc.object?.draw(); ui.combat?.render(); } });
Hooks.on("updateActor", (actor, changes) => {
  if (!(changes.prototypeToken?.flags?.[MOD] || changes.name !== undefined || changes.prototypeToken?.name !== undefined) || !afraid()) return;
  for (const scene of game.scenes) for (const t of scene.tokens) if (t.actorId === actor.id) { t.reset(); t.object?.draw(); }
  ui.combat?.render();
});

/* ---- marking a creature: right-click it in the Actors sidebar (GM) */
function creatureOptions(app, options) {
  if (!game.user.isGM) return;
  const actorOf = li => game.actors.get(li.dataset.entryId ?? li.dataset.documentId);
  options.push(
    {label: "Arachnophobia: mark as bug-like", icon: "fa-solid fa-spider", visible: li => { const a = actorOf(li); return !!a && !listed(a.name); },
     onClick: (event, li) => { const a = actorOf(li); if (a) setCreatures([...creatures(), a.name]); }},
    {label: "Arachnophobia: no longer bug-like", icon: "fa-solid fa-cat", visible: li => { const a = actorOf(li); return !!a && creatures().some(c => norm(c) === norm(a.name)); },
     onClick: (event, li) => { const a = actorOf(li); if (a) setCreatures(creatures().filter(c => norm(c) !== norm(a.name))); }});
}
Hooks.on("getActorContextOptions", creatureOptions);

/* ---- marking a player: also by right-clicking their name in the player list (a GM for anyone online, a player for themselves) */
Hooks.on("getUserContextOptions", (app, options) => {
  const userOf = li => game.users.get(li.dataset.userId);
  const mine = li => game.user.isGM || li.dataset.userId === game.user.id;
  options.push(
    {label: "Arachnophobia: show cats instead", icon: "fa-solid fa-cat", visible: li => mine(li) && !userOf(li)?.getFlag(MOD, "arachnophobia"),
     onClick: (event, li) => userOf(li)?.setFlag(MOD, "arachnophobia", true)},
    {label: "Arachnophobia: show the real tokens", icon: "fa-solid fa-spider", visible: li => mine(li) && !!userOf(li)?.getFlag(MOD, "arachnophobia"),
     onClick: (event, li) => userOf(li)?.setFlag(MOD, "arachnophobia", false)});
});
Hooks.on("renderPlayers", (app, element) => {
  for (const li of element.querySelectorAll(".player[data-user-id]")) {
    if (!game.users.get(li.dataset.userId)?.getFlag(MOD, "arachnophobia") || li.querySelector(`.${MOD}-mark`)) continue;
    const i = document.createElement("i");
    i.className = `fa-solid fa-cat ${MOD}-mark`; i.dataset.tooltip = "Sees cats instead of flagged tokens"; i.style.marginInlineStart = "0.35em"; i.style.opacity = "0.75";
    li.append(i);
  }
});

globalThis.TselversePhobia = {afraid, flagged, listed, creatures, setCreatures, catFor, cats, refreshAll};

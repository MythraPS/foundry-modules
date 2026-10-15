/* Shared Treasure: a party stash. The stash is an ordinary actor every player owns, so placing, taking and
 * claiming all work with no GM online; this window is the only thing that is new. */
const MOD = "tselverse-treasure";
const DialogV2 = foundry.applications.api.DialogV2;
const PHYSICAL = new Set(["ammunition", "armor", "consumable", "container", "currency", "gear", "sundry", "tool", "weapon"]);
const STACKS = new Set(["ammunition", "consumable", "currency", "gear", "sundry"]);
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

const stash = () => game.actors.find(a => a.getFlag(MOD, "stash"));
const qtyOf = item => Math.max(1, Number(item.system?.quantity ?? 1) || 1);
const claimsOf = item => item.getFlag(MOD, "claims") ?? {};
const nameOf = id => game.users.get(id)?.character?.name ?? game.users.get(id)?.name ?? "someone";

async function ensureStash() {
  if (stash() || !game.users.activeGM?.isSelf) return stash();
  return Actor.implementation.create({name: "Shared Treasure", type: "npc", img: "icons/containers/chest/chest-reinforced-steel-brown.webp",
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER}, flags: {[MOD]: {stash: true}}});
}

function say(text) {
  return ChatMessage.create({speaker: {alias: "Shared Treasure"}, content: `<p>${text}</p>`});
}

/** The characters this user could put an item on: their own; every player character for a GM. */
function characters() {
  const all = game.actors.filter(a => a.type === "pc" && (game.user.isGM || a.isOwner));
  const mine = game.user.character;
  return mine && all.includes(mine) ? [mine, ...all.filter(a => a !== mine)] : all;
}

async function askQuantity(title, max) {
  if (max <= 1) return 1;
  try {
    return await DialogV2.prompt({window: {title}, content: `<label>How many? (of ${max}) <input type="number" name="n" min="1" max="${max}" value="${max}" autofocus></label>`,
      ok: {label: "OK", callback: (ev, btn) => Math.min(max, Math.max(1, parseInt(btn.form.elements.n.value) || 1))}, rejectClose: false});
  } catch { return null; }
}

/** A copy of an item, ready to live somewhere else: its own quantity, out of any container, not worn, no claims. */
function copyOf(item, quantity) {
  const data = item.toObject();
  delete data._id;
  if (data.flags?.[MOD]) delete data.flags[MOD];
  if ("quantity" in (data.system ?? {}) || quantity > 1) data.system.quantity = quantity;
  if (data.system?.container) data.system.container = null;
  for (const k of ["equipped", "attuned"]) if (typeof data.system?.[k] === "boolean") data.system[k] = false;
  return data;
}

/** Add to a pile of the same thing when there is one, otherwise a new item. */
async function addTo(actor, data, quantity) {
  const twin = STACKS.has(data.type) && actor.items.find(i => i.type === data.type && i.name === data.name && !i.system?.container
    && !Object.keys(claimsOf(i)).length && "quantity" in (i.system ?? {}));
  if (twin) return twin.update({"system.quantity": qtyOf(twin) + quantity});
  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  return made;
}

async function removeFrom(item, quantity) {
  return quantity >= qtyOf(item) ? item.delete() : item.update({"system.quantity": qtyOf(item) - quantity});
}

/** Put an item into the stash. One that sits on a character you own is moved; anything else is copied. */
async function place(item, {quantity = null, silent = false} = {}) {
  const box = stash();
  if (!box) return ui.notifications.warn("There is no Shared Treasure yet: a GM has to log in once to create it.");
  if (!PHYSICAL.has(item.type)) return ui.notifications.warn(`${item.name} is not something you can carry, so it can't go in the Shared Treasure.`);
  const from = item.parent instanceof Actor ? item.parent : null;
  if (from === box) return;
  if (from && !from.isOwner) return ui.notifications.warn(`You don't control ${from.name}.`);
  if (from && item.type === "container" && from.items.some(i => i.system?.container === item.id))
    return ui.notifications.warn(`Empty ${item.name} first: only the container itself would move.`);
  const n = quantity ?? await askQuantity(`Place ${item.name}`, from ? qtyOf(item) : 1);
  if (!n) return;
  await addTo(box, copyOf(item, n), n);
  if (from) await removeFrom(item, n);
  if (!silent) say(`<b>${esc(from?.name ?? game.user.name)}</b> placed ${n > 1 ? `${n} × ` : ""}<b>${esc(item.name)}</b> in the Shared Treasure.`);
  return true;
}

/** Take an item out of the stash onto a character. */
async function take(item, actor, {quantity = null, silent = false} = {}) {
  if (!actor) return ui.notifications.warn("You have no character to take it with.");
  if (!actor.isOwner) return ui.notifications.warn(`You don't control ${actor.name}.`);
  const needs = Object.entries(claimsOf(item)).filter(([id, kind]) => kind === "need" && id !== game.user.id).map(([id]) => nameOf(id));
  if (needs.length && !silent) {
    const ok = await DialogV2.confirm({window: {title: `Take ${item.name}`}, content: `<p><b>${esc(needs.join(", "))}</b> claimed this. Take it anyway?</p>`, rejectClose: false});
    if (!ok) return;
  }
  const n = quantity ?? await askQuantity(`Take ${item.name}`, qtyOf(item));
  if (!n) return;
  await addTo(actor, copyOf(item, n), n);
  await removeFrom(item, n);
  if (!silent) say(`<b>${esc(actor.name)}</b> took ${n > 1 ? `${n} × ` : ""}<b>${esc(item.name)}</b> from the Shared Treasure.`);
  return true;
}

/** kind: "need" (I want this), "spare" (only if no one needs it) or null (withdraw). */
async function claim(item, kind, userId = game.user.id) {
  return kind ? item.update({[`flags.${MOD}.claims.${userId}`]: kind}) : item.update({[`flags.${MOD}.claims.${userId}`]: new foundry.data.operators.ForcedDeletion()});
}

/* ------------------------------------------------------------------ the window */
class TreasureApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {id: "tsvtreasure", classes: ["tsvtreasure"], window: {title: "Shared Treasure", icon: "fa-solid fa-coins", resizable: true},
    position: {width: 620, height: 640},
    actions: {take: TreasureApp.#take, claim: TreasureApp.#claim, sheet: TreasureApp.#sheet, remove: TreasureApp.#remove}};
  #filter = "";
  #as = null;

  get receiver() { const list = characters(); return list.find(a => a.id === this.#as) ?? list[0] ?? null; }

  static async #take(event, target) {
    const item = stash()?.items.get(target.closest("[data-item]").dataset.item);
    if (item) await take(item, this.receiver);
  }
  static async #claim(event, target) {
    const item = stash()?.items.get(target.closest("[data-item]").dataset.item);
    if (!item) return;
    const kind = target.dataset.kind;
    await claim(item, claimsOf(item)[game.user.id] === kind ? null : kind);
  }
  static #sheet(event, target) { stash()?.items.get(target.closest("[data-item]").dataset.item)?.sheet.render(true); }
  static async #remove(event, target) {
    const item = stash()?.items.get(target.closest("[data-item]").dataset.item);
    if (!item || !game.user.isGM) return;
    if (await DialogV2.confirm({window: {title: "Remove"}, content: `<p>Delete <b>${esc(item.name)}</b> from the Shared Treasure?</p>`, rejectClose: false})) await item.delete();
  }

  async _renderHTML() {
    const box = stash();
    if (!box) return `<p class="hint">There is no Shared Treasure yet: a GM has to log in once to create it.</p>`;
    if (!box.isOwner) return `<p class="hint">You can't use the Shared Treasure: ask the GM to make you an owner of the "Shared Treasure" actor.</p>`;
    const me = game.user.id, chars = characters(), f = this.#filter.toLowerCase();
    const items = box.items.filter(i => PHYSICAL.has(i.type) && (!f || i.name.toLowerCase().includes(f)))
      .sort((a, b) => (a.type === "currency") - (b.type === "currency") || a.name.localeCompare(b.name));
    const rows = items.map(i => {
      const c = claimsOf(i), mine = c[me];
      const need = Object.entries(c).filter(([, k]) => k === "need").map(([id]) => nameOf(id));
      const spare = Object.entries(c).filter(([, k]) => k === "spare").map(([id]) => nameOf(id));
      const who = [need.length ? `<span class="need"><i class="fa-solid fa-hand"></i> Claimed by ${esc(need.join(", "))}</span>` : "",
                   spare.length ? `<span class="spare">If no one needs it: ${esc(spare.join(", "))}</span>` : ""].filter(Boolean).join(" · ");
      const cls = mine === "need" ? "mine" : need.length ? "theirs" : "";
      return `<li data-item="${i.id}" class="${cls}">
        <img src="${esc(i.img)}" data-action="sheet" alt="">
        <span class="name" data-action="sheet">${esc(i.name)}${qtyOf(i) > 1 ? `<small>× ${qtyOf(i)}</small>` : ""}</span>
        <span class="acts">
          <button type="button" data-action="take" ${chars.length ? "" : "disabled"} data-tooltip="Put it on your character">Take</button>
          <button type="button" data-action="claim" data-kind="need" class="${mine === "need" ? "on" : ""}" data-tooltip="I want this">Claim</button>
          <button type="button" data-action="claim" data-kind="spare" class="${mine === "spare" ? "on" : ""}" data-tooltip="I'd like it, but only if no one needs it">If no one needs it</button>
          ${game.user.isGM ? `<button type="button" data-action="remove" data-tooltip="Delete from the treasure"><i class="fa-solid fa-trash"></i></button>` : ""}
        </span>
        <span class="who">${who || "&nbsp;"}</span></li>`;
    }).join("");
    const pick = chars.length > 1 ? `<label>Take as <select name="as">${chars.map(a => `<option value="${a.id}" ${a === this.receiver ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`
      : chars.length ? `<span>Taking as <b>${esc(chars[0].name)}</b></span>` : `<span class="hint">You have no character, so you can't take items.</span>`;
    return `<div class="top">${pick}<input type="search" name="filter" placeholder="Search" value="${esc(this.#filter)}"></div>
      ${rows ? `<ul class="loot">${rows}</ul>` : `<p class="hint">${f ? "Nothing matches." : "The treasure is empty."}</p>`}
      <div class="drop">Drag an item here to place it in the Shared Treasure.<br><span class="hint">From a character sheet it is moved; from a compendium or the Items sidebar it is copied.</span></div>`;
  }

  _replaceHTML(html, content) {
    content.innerHTML = html;
    const filter = content.querySelector('[name="filter"]');
    filter?.addEventListener("input", () => { this.#filter = filter.value; clearTimeout(this._t); this._t = setTimeout(async () => {
      await this.render(); const again = this.element.querySelector('[name="filter"]'); again?.focus(); again?.setSelectionRange(again.value.length, again.value.length); }, 250); });
    content.querySelector('[name="as"]')?.addEventListener("change", ev => { this.#as = ev.target.value; });
    content.ondragover = ev => { ev.preventDefault(); content.classList.add("over"); };
    content.ondragleave = () => content.classList.remove("over");
    content.ondrop = async ev => {
      ev.preventDefault(); content.classList.remove("over");
      let data; try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
      if (data?.type !== "Item" || !data.uuid) return;
      const item = await fromUuid(data.uuid);
      if (item) await place(item);
    };
  }
}

let app = null;
function open() { app ??= new TreasureApp(); app.render({force: true}); return app; }
const rerender = doc => { if (app?.rendered && (doc === stash() || doc?.parent === stash())) app.render(); };
for (const h of ["createItem", "updateItem", "deleteItem", "updateActor"]) Hooks.on(h, rerender);
Hooks.on("updateUser", () => { if (app?.rendered) app.render(); });

Hooks.once("ready", ensureStash);

/* ------------------------------------------------------------------ ways in */
Hooks.on("getSceneControlButtons", controls => {
  const group = Array.isArray(controls) ? controls.find(c => c.name === "token") : controls.tokens ?? controls.token;
  if (!group?.tools) return;
  const tool = {name: `${MOD}-open`, order: 97, title: "Shared Treasure", icon: "fa-solid fa-coins", visible: true, button: true, onClick: open, onChange: open};
  if (Array.isArray(group.tools)) group.tools.push(tool); else group.tools[tool.name] = tool;
});
Hooks.on("renderItemDirectory", (dir, element) => {
  if (element.querySelector(`.${MOD}-open`)) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = `${MOD}-open tsvtreasure-open`; b.innerHTML = `<i class="fa-solid fa-coins"></i> Shared Treasure`;
  b.addEventListener("click", open);
  (element.querySelector(".directory-header") ?? element).append(b);
});
/** The stash actor in the Actors sidebar opens this window instead of a blank creature sheet. */
Hooks.on("renderActorDirectory", (dir, element) => {
  const box = stash();
  const li = box && element.querySelector(`[data-entry-id="${box.id}"]`);
  if (!li || li.dataset.tsvtreasure) return;
  li.dataset.tsvtreasure = "1";
  li.addEventListener("click", ev => { ev.preventDefault(); ev.stopImmediatePropagation(); open(); }, true);
});

globalThis.TselverseTreasure = {open, stash, place, take, claim, claimsOf, characters, TreasureApp};

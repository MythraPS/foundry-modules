// Tselverse Shops: an Item Piles merchant opens on a category browser - category, then
// sub-category - instead of one long list that always starts at "A", and its items are sorted
// cheapest first unless the shopper picks another order (Item Piles' own Sort by menu and its
// column headings still work).
//
// Item Piles keeps its list state in a Svelte store this module can't reach, so everything goes
// through the merchant window's own controls: the type <select> (category), clicks on the
// "Price" column heading (sorting; a second click reverses it), and hiding rows for a
// sub-category. Rows carry no item id, so an item is found by name in the merchant's actor.

const MODULE = "tselverse-shops";
const _t = (key, english, data = {}) => {
  const text = game.i18n.has?.(key) ? game.i18n.localize(key) : english;
  return text.replace(/\{(\w+)\}/g, (m, k) => k in data ? String(data[k]) : m);
};
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

const state = new WeakMap();   // merchant window element -> {sorted, type, sub, chosen}

/** The merchant's actor, from the window id ("item-pile-merchant-<pile>-<buyer>"). */
function pileOf(app) {
  const id = app.id?.match(/item-pile-merchant-([A-Za-z0-9]{16})/)?.[1];
  return id ? game.actors.get(id) : null;
}

/** An item's sub-category: Black Flag's own label for its kind ("Wondrous Item", "Armor (Shield)"). */
function subOf(item) {
  const t = item.system?.type ?? {};
  let label = t.label ?? "";
  if (item.type === "weapon" && t.category) {
    const cat = t.category[0].toUpperCase() + t.category.slice(1);
    const kind = t.value ? t.value[0].toUpperCase() + t.value.slice(1) : "";
    label = `${cat} ${kind}`.trim();
  }
  return label || _t("TSVSHOP.Other", "Other");
}

function controls(app) {
  const selects = [...app.querySelectorAll("select")];
  const typeSel = selects.find(s => [...s.options].some(o => o.value === "all"));
  const sortSel = selects.find(s => [...s.options].some(o => /Sort/.test(o.textContent)));
  const list = app.querySelector(".item-piles-items-list");
  return { typeSel, sortSel, list, pane: list?.parentElement };
}

function rowItem(row, pile) {
  const name = row.querySelector(".item-piles-name-container")?.textContent?.trim();
  return name ? pile.items.find(i => i.name === name) : null;
}

/** Cheapest first: choose the Price column, then make its arrow point up. The heading's arrow
 *  shows the direction (down = most expensive first); a click on the heading of the column
 *  already chosen reverses it. Item Piles redraws after each click, so the heading is found
 *  again each time and given a moment. */
async function sortCheapestFirst(app, st) {
  if (st.sorted) return;
  const heading = () => [...app.querySelectorAll(".item-piles-items-list .item-piles-item-list-header a")]
    .find(e => e.textContent.trim() === "Price");
  if (!heading()) return;
  st.sorted = true;
  const sortSel = () => controls(app).sortSel;
  const wait = () => new Promise(r => setTimeout(r, 250));
  for (let tries = 0; tries < 4; tries++) {
    const h = heading(); if (!h) return;
    const chosen = /Price/.test(sortSel()?.selectedOptions[0]?.textContent ?? "");
    const up = /\bfa-(chevron|caret|arrow|sort)-up\b|fa-sort-amount-up|fa-sort-numeric-up/.test(h.querySelector("i")?.className ?? "");
    if (chosen && up) return;
    h.click();
    await wait();
  }
}

function applyRowFilter(app, st) {
  const pile = pileOf(app);
  if (!pile) return;
  for (const row of app.querySelectorAll(".item-piles-item-row")) {
    const item = rowItem(row, pile);
    const hide = !!(st.sub && item && subOf(item) !== st.sub);
    row.classList.toggle("tsvshop-hidden", hide);
  }
}

function choose(app, st, type, sub) {
  const { typeSel } = controls(app);
  st.type = type; st.sub = sub; st.chosen = true;
  if (typeSel) { typeSel.value = type; typeSel.dispatchEvent(new Event("change", { bubbles: true })); }
  app.querySelector(".tsvshop-browser")?.remove();
  setTimeout(() => { applyRowFilter(app, st); bar(app, st); }, 30);
}

function bar(app, st) {
  const { pane, typeSel } = controls(app);
  if (!pane) return;
  pane.querySelector(".tsvshop-bar")?.remove();
  if (!st.chosen) return;
  const typeLabel = st.type === "all" ? _t("TSVSHOP.All", "Show everything")
    : [...(typeSel?.options ?? [])].find(o => o.value === st.type)?.textContent ?? st.type;
  const div = document.createElement("div");
  div.className = "tsvshop-bar";
  div.innerHTML = `<span>${esc(_t("TSVSHOP.Showing", "Showing: {what}", { what: st.sub ? `${typeLabel} › ${st.sub}` : typeLabel }))}</span>
    <button type="button" data-tooltip="${esc(_t("TSVSHOP.ChangeTip", "Back to the categories."))}"><i class="fa-solid fa-table-cells-large"></i> ${esc(_t("TSVSHOP.Change", "Change category"))}</button>`;
  div.querySelector("button").addEventListener("click", () => {
    st.chosen = false; st.sub = null; st.type = "all";
    if (typeSel) { typeSel.value = "all"; typeSel.dispatchEvent(new Event("change", { bubbles: true })); }
    div.remove(); browser(app, st);
  });
  pane.prepend(div);
}

function browser(app, st) {
  const { pane, typeSel } = controls(app);
  const pile = pileOf(app);
  if (!pane || !typeSel || !pile || pane.querySelector(".tsvshop-browser")) return;
  const labels = Object.fromEntries([...typeSel.options].map(o => [o.value, o.textContent.trim()]));
  const groups = {};
  for (const item of pile.items) {
    if (item.type === "currency" || !(item.type in labels)) continue;
    if ((item.system?.quantity ?? 1) <= 0) continue;
    // an item the GM hid isn't on show to players, so it isn't counted for them either
    if (!game.user.isGM && foundry.utils.getProperty(item, "flags.item-piles.item.hidden")) continue;
    const g = groups[item.type] ??= { n: 0, subs: {} };
    g.n++; const s = subOf(item); g.subs[s] = (g.subs[s] ?? 0) + 1;
  }
  const count = n => n === 1 ? _t("TSVSHOP.One", "1 item") : _t("TSVSHOP.Items", "{n} items", { n });
  const div = document.createElement("div");
  div.className = "tsvshop-browser";
  div.innerHTML = `<h3>${esc(_t("TSVSHOP.Browse", "Browse by category"))}</h3>
    <p class="tsvshop-hint">${esc(_t("TSVSHOP.BrowseHint", "Pick a category to see what this merchant sells."))}</p>`
    + Object.entries(groups).sort((a, b) => labels[a[0]].localeCompare(labels[b[0]])).map(([type, g]) => `
      <div class="tsvshop-cat">
        <button type="button" data-type="${esc(type)}">${esc(labels[type])}<span class="tsvshop-count">${esc(count(g.n))}</span></button>
        ${Object.keys(g.subs).length > 1 ? `<div class="tsvshop-subs">${Object.entries(g.subs).sort((a, b) => a[0].localeCompare(b[0])).map(([s, n]) =>
          `<button type="button" data-type="${esc(type)}" data-sub="${esc(s)}">${esc(s)}<span class="tsvshop-count">${n}</span></button>`).join("")}</div>` : ""}
      </div>`).join("")
    + `<button type="button" data-type="all" data-tooltip="${esc(_t("TSVSHOP.AllTip", "Every item this merchant sells, in one list."))}">${esc(_t("TSVSHOP.All", "Show everything"))}</button>`;
  div.addEventListener("click", ev => {
    const b = ev.target.closest("button[data-type]");
    if (b) choose(app, st, b.dataset.type, b.dataset.sub ?? null);
  });
  if (getComputedStyle(pane).position === "static") pane.style.position = "relative";
  // over the item list only: the search box and sort menu above it stay usable
  const list = controls(app).list;
  div.style.top = `${list ? list.offsetTop : 0}px`;
  pane.appendChild(div);
}

/** Set a merchant window up, and keep it set up as Item Piles redraws parts of it. */
function attach(app) {
  headerButton(app);
  if (!state.has(app)) state.set(app, { sorted: false, type: "all", sub: null, chosen: false });
  const st = state.get(app);
  const { typeSel, list } = controls(app);
  if (!typeSel || !list) return;                         // (not the Buy Items tab)
  sortCheapestFirst(app, st);
  if (!st.chosen) browser(app, st);
  else { applyRowFilter(app, st); if (!app.querySelector(".tsvshop-bar")) bar(app, st); }
}

const watch = new MutationObserver(() => {
  for (const app of document.querySelectorAll(".item-piles-merchant-sheet")) {
    if (app.dataset.tsvshopBusy) continue;
    app.dataset.tsvshopBusy = "1";
    requestAnimationFrame(() => { try { attach(app); } finally { delete app.dataset.tsvshopBusy; } });
  }
});
// (set once Foundry is up: this file runs before game.modules exists)
Hooks.once("init", () => { game.modules.get(MODULE).api = { openPicker, rebuildStockTables }; });
const start = () => { if (game.modules.get("item-piles")?.active) watch.observe(document.body, { childList: true, subtree: true }); };
if (game.ready) start(); else Hooks.once("ready", start);

// ------------------------------------------------------------------ GM: stock a shop
// "Add items" in a merchant's title bar opens a picker over every item compendium: search by
// name, filter by type / rarity / price / book, tick items (with a quantity) and add them all.
// The picker also (re)builds "Shop Stock" roll tables from the same items, for Item Piles'
// Populate Items tab, which only lists tables in the world.

const SHOP_TYPES = ["weapon", "armor", "gear", "consumable", "ammunition", "container", "tool", "sundry"];
const PACK_ORDER = ["tselverse-art.tselverseitems", "tov-gm.tovgmitems", "black-flag.items", "koboldpressogl-bf.koboldpressitems"];
const STOCK_FOLDER = "Shop Stock";

function itemPacks() {
  // ours first: a name two packs share is listed from the first (the newer, imported printing)
  return game.packs.filter(p => p.documentName === "Item" && !/npcfeatures|currenc|spells|classes|lineages|heritages|backgrounds|talents|extras/i.test(p.collection))
    .sort((a, b) => (PACK_ORDER.indexOf(a.collection) + 1 || 99) - (PACK_ORDER.indexOf(b.collection) + 1 || 99));
}

async function catalogue() {
  const rows = [], seen = new Set();
  for (const pk of itemPacks()) {
    const idx = await pk.getIndex({ fields: ["type", "img", "system.rarity", "system.price", "system.type"] });
    for (const e of idx) {
      if (!SHOP_TYPES.includes(e.type)) continue;
      const key = e.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ uuid: `Compendium.${pk.collection}.Item.${e._id}`, name: e.name, img: e.img, type: e.type,
        kind: e.system?.type?.label ?? "", rarity: e.system?.rarity ?? "", price: Number(e.system?.price?.value) || 0,
        denom: e.system?.price?.denomination ?? "gp", pack: pk.metadata.label, packId: pk.collection });
    }
  }
  return rows;
}

const rarityLabel = r => r ? game.i18n.localize(CONFIG.BlackFlag?.rarities?.[r]?.label ?? r) : _t("TSVSHOP.Mundane", "Not magic");
const typeLabel = t => game.i18n.localize(CONFIG.Item.typeLabels?.[t] ?? t);

async function openPicker(pile) {
  const all = await catalogue();
  const packs = [...new Set(all.map(r => r.pack))];
  const rarities = ["", ...Object.keys(CONFIG.BlackFlag?.rarities ?? {})];
  const chosen = new Map();                                    // uuid -> quantity
  // (the dialog wants a bare element: the picker goes inside it)
  const outer = document.createElement("div");
  const content = document.createElement("div");
  content.className = "tsvshop-picker";
  outer.appendChild(content);
  content.innerHTML = `
    <div class="tsvshop-filters">
      <input type="search" name="q" placeholder="${esc(_t("TSVSHOP.Search", "Search by name..."))}">
      <select name="type"><option value="">${esc(_t("TSVSHOP.AnyType", "Any type"))}</option>${SHOP_TYPES.map(t => `<option value="${t}">${esc(typeLabel(t))}</option>`).join("")}</select>
      <select name="rarity"><option value="*">${esc(_t("TSVSHOP.AnyRarity", "Any rarity"))}</option>${rarities.map(r => `<option value="${r}">${esc(rarityLabel(r))}</option>`).join("")}</select>
      <input type="number" name="min" min="0" placeholder="${esc(_t("TSVSHOP.Min", "min gp"))}" data-tooltip="${esc(_t("TSVSHOP.MinTip", "Lowest price"))}">
      <input type="number" name="max" min="0" placeholder="${esc(_t("TSVSHOP.Max", "max gp"))}" data-tooltip="${esc(_t("TSVSHOP.MaxTip", "Highest price"))}">
      <select name="pack"><option value="">${esc(_t("TSVSHOP.AnyBook", "Every compendium"))}</option>${packs.map(p => `<option>${esc(p)}</option>`).join("")}</select>
    </div>
    <p class="tsvshop-count"></p>
    <div class="tsvshop-results"></div>`;
  // the dialog draws a copy of `content`: everything is looked up and wired on that copy
  let root = content, results, countEl;
  const f = n => root.querySelector(`[name=${n}]`);
  const render = () => {
    const q = f("q").value.trim().toLowerCase(), type = f("type").value, rar = f("rarity").value, pack = f("pack").value;
    const min = f("min").value === "" ? -1 : Number(f("min").value), max = f("max").value === "" ? Infinity : Number(f("max").value);
    const hits = all.filter(r => (!q || r.name.toLowerCase().includes(q)) && (!type || r.type === type) && (rar === "*" || r.rarity === rar)
      && (!pack || r.pack === pack) && r.price >= min && r.price <= max).sort((a, b) => (!a.price - !b.price) || a.price - b.price || a.name.localeCompare(b.name));   // (unpriced last)
    const shown = hits.slice(0, 300);
    countEl.textContent = _t("TSVSHOP.Matches", "{n} match - {c} ticked", { n: hits.length, c: chosen.size })
      + (hits.length > shown.length ? " " + _t("TSVSHOP.Narrow", "(showing the cheapest 300 - narrow the search)") : "");
    results.innerHTML = shown.map(r => `
      <label class="tsvshop-row" data-uuid="${r.uuid}">
        <input type="checkbox" ${chosen.has(r.uuid) ? "checked" : ""}>
        <img src="${esc(r.img)}" alt="">
        <span class="tsvshop-name">${esc(r.name)}<small>${esc(r.kind || typeLabel(r.type))} · ${esc(rarityLabel(r.rarity))} · ${esc(r.pack)}</small></span>
        <span class="tsvshop-price">${r.price ? `${r.price.toLocaleString()} ${esc(r.denom)}` : "—"}</span>
        <input type="number" class="tsvshop-qty" min="1" value="${chosen.get(r.uuid) ?? 1}" data-tooltip="${esc(_t("TSVSHOP.Qty", "How many to stock"))}">
      </label>`).join("");
  };
  const wire = el => {
    root = el; results = root.querySelector(".tsvshop-results"); countEl = root.querySelector(".tsvshop-count");
    results.addEventListener("change", ev => {
    const row = ev.target.closest(".tsvshop-row"); if (!row) return;
    const box = row.querySelector("input[type=checkbox]"), qty = Math.max(1, Number(row.querySelector(".tsvshop-qty").value) || 1);
    if (ev.target.classList.contains("tsvshop-qty")) box.checked = true;
    if (box.checked) chosen.set(row.dataset.uuid, qty); else chosen.delete(row.dataset.uuid);
    countEl.textContent = countEl.textContent.replace(/\d+ ticked/, `${chosen.size} ticked`);
  });
    const debounced = foundry.utils.debounce(render, 200);
    root.querySelector(".tsvshop-filters").addEventListener("input", debounced);
    root.querySelector(".tsvshop-filters").addEventListener("change", debounced);
    render();
  };

  await foundry.applications.api.DialogV2.wait({
    window: { title: _t("TSVSHOP.PickerTitle", "Stock {name}", { name: pile.name }), icon: "fa-solid fa-cart-plus", resizable: true },
    position: { width: 780, height: 680 },
    classes: ["tsvshop-picker-dialog"],
    content: outer,
    render: (event, dialog) => wire(dialog.element.querySelector(".tsvshop-picker")),
    buttons: [
      { action: "add", label: _t("TSVSHOP.AddTicked", "Add ticked items"), icon: "fa-solid fa-cart-plus", default: true,
        callback: async () => {
          if (!chosen.size) { ui.notifications.warn(_t("TSVSHOP.NoneTicked", "Tick some items first.")); return false; }
          const items = [];
          for (const [uuid, quantity] of chosen) {
            const doc = await fromUuid(uuid); if (!doc) continue;
            const data = doc.toObject();
            foundry.utils.setProperty(data, "_stats.compendiumSource", uuid);   // (so Fix picture and price updates find it)
            items.push({ item: data, quantity });
          }
          await game.itempiles.API.addItems(pile, items);
          ui.notifications.info(_t("TSVSHOP.Added", "{n} item(s) added to {name}.", { n: items.length, name: pile.name }));
          chosen.clear(); render();
          return false;
        } },
      { action: "tables", label: _t("TSVSHOP.Rebuild", "Rebuild stock tables"), icon: "fa-solid fa-table-list",
        callback: async () => { await rebuildStockTables(all); return false; } },
      { action: "close", label: _t("TSVSHOP.Close", "Close"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
}

/** World roll tables for Item Piles' Populate Items: one per rarity of magic item, and the
 *  non-magic weapons, armour and gear - every item in the compendiums, replaced on each rebuild. */
async function rebuildStockTables(all) {
  all ??= await catalogue();
  let folder = game.folders.find(f => f.type === "RollTable" && f.name === STOCK_FOLDER);
  folder ??= await Folder.create({ name: STOCK_FOLDER, type: "RollTable", sorting: "a" });
  const groups = [];
  for (const r of Object.keys(CONFIG.BlackFlag?.rarities ?? {}).filter(r => !["artifact", "fabled"].includes(r)))
    groups.push([_t("TSVSHOP.TableMagic", "Magic items - {rarity}", { rarity: rarityLabel(r) }), all.filter(x => x.rarity === r)]);
  for (const [t, label] of [["weapon", "Weapons"], ["armor", "Armour"], ["gear", "Gear"], ["consumable", "Consumables"], ["ammunition", "Ammunition"], ["tool", "Tools"]])
    groups.push([_t("TSVSHOP.TableMundane", "Not magic - {what}", { what: _t(`TSVSHOP.T.${t}`, label) }), all.filter(x => !x.rarity && x.type === t)]);
  let made = 0;
  for (const [name, rows] of groups) {
    for (const old of game.tables.filter(t => t.name === name && t.folder?.id === folder.id)) await old.delete();
    if (!rows.length) continue;
    const results = rows.map((r, i) => ({ type: "document", documentUuid: r.uuid, name: r.name, img: r.img, weight: 1, range: [i + 1, i + 1] }));
    await RollTable.create({ name, folder: folder.id, formula: `1d${rows.length}`, replacement: true, displayRoll: false, results,
      description: _t("TSVSHOP.TableDesc", "Built by Tselverse Shops from the item compendiums ({n} items). Rebuild from a shop's Add items window after importing more.", { n: rows.length }) });
    made++;
  }
  ui.notifications.info(_t("TSVSHOP.Rebuilt", "{n} stock tables built in the {folder} folder - use them in a shop's Populate Items tab.", { n: made, folder: STOCK_FOLDER }));
  return made;
}

/** The "Add items" button in a merchant's title bar (GMs). */
function headerButton(app) {
  if (!game.user.isGM || app.querySelector(".tsvshop-add")) return;
  const header = app.querySelector(".window-header");
  const pile = pileOf(app);
  if (!header || !pile) return;
  const a = document.createElement("a");
  a.className = "header-button tsvshop-add";
  a.dataset.tooltip = _t("TSVSHOP.AddTip", "Pick items from every compendium - search, filter, tick and add.");
  a.innerHTML = `<i class="fa-solid fa-cart-plus"></i> ${esc(_t("TSVSHOP.Add", "Add items"))}`;
  a.addEventListener("click", ev => { ev.preventDefault(); openPicker(pile); });
  const close = header.querySelector(".close, [data-action=close], a.header-button:last-of-type");
  header.insertBefore(a, header.querySelector(".header-button") ?? close ?? null);
}

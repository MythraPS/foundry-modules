/**
 * Rarity variants - a Variant dropdown on magic item sheets.
 *
 * Items printed at one rarity with lines giving other rarities (a lower DC, a property removed;
 * Loot Tavern, L'Arsene's, Heliana's...) carry those variants in
 * flags["tselverse-common"].variants, read by the importer (foundry-import variants.py):
 * {base, options: [{rarity, label, price, text, dc?, charges?, remove?, bonus?}]}.
 *
 * On an item the GM can edit (a world item or one on a sheet), the sidebar gets a Variant dropdown
 * beside Rarity. Picking a variant sets the item's rarity and price, its charges, the DC of its save
 * and cast buttons, its +N bonus, takes away the buttons of properties the variant removes, and puts
 * the variant's own paragraph at the top of the description. The printed version is kept in
 * flags["tselverse-common"].variantBase, so picking it again puts everything back as it was.
 * Players see which variant it is, read-only. Compendium entries can't be edited, so there the
 * description's "Price by variant" line is all there is.
 */
const MODULE = "tselverse-common";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BANNER = "tselverse-variant-banner";

const variantsOf = item => item?.flags?.[MODULE]?.variants;
const currentOf = item => item?.flags?.[MODULE]?.variant ?? variantsOf(item)?.base;

/** What a variant changes is always worked out from the printed item, never from another variant. */
function snapshot(item) {
  const s = item.system._source ?? item._source.system;
  return {
    rarity: s.rarity ?? "", price: s.price?.value ?? null, usesMax: s.uses?.max ?? "",
    magicalBonus: s.magicalBonus ?? null, description: s.description?.value ?? "",
    activities: foundry.utils.deepClone(s.activities ?? {})
  };
}

const named = (a, names) => names?.length && names.some(n => {
  const t = `${a.name ?? ""} ${a.description ?? ""}`.toLowerCase();
  return t.includes(n.toLowerCase());
});

/** The item update for one variant (or the printed item when `opt` is its base). */
function variantUpdate(item, base, opt, isBase) {
  const acts = foundry.utils.deepClone(base.activities);
  if (!isBase) for (const [id, a] of Object.entries(acts)) {
    if (named(a, opt.remove)) { delete acts[id]; continue; }
    if (opt.dc == null) continue;
    const save = a.system?.save?.dc;
    if (save && save.ability === "custom" && /^\d+$/.test(String(save.formula ?? "").trim())) save.formula = String(opt.dc);
    const ch = a.system?.spell?.challenge;
    if (ch?.override && ch.save != null && /^\d+$/.test(String(ch.save))) ch.save = opt.dc;
  }
  const banner = isBase ? "" : `<div class="${BANNER}" style="border-left: 3px solid #b08d57; padding-left: 8px; margin-bottom: 8px"><p><strong>${esc(opt.label)} variant.</strong> ${esc(opt.text)}</p></div>`;
  const update = {
    "system.rarity": isBase ? base.rarity : opt.rarity,
    "system.price.value": isBase ? base.price : (opt.price ?? base.price),
    "system.uses.max": isBase || opt.charges == null ? base.usesMax : String(opt.charges),
    "system.description.value": banner + base.description,
    "system.==activities": acts,
    [`flags.${MODULE}.variant`]: opt.rarity
  };
  // (a printed item with no bonus has none stored: back to "" so a variant's +2 doesn't stay behind)
  if (["weapon", "armor"].includes(item.type))
    update["system.magicalBonus"] = isBase || opt.bonus == null ? (base.magicalBonus ?? "") : String(opt.bonus);
  return update;
}

export async function setVariant(item, rarity) {
  const v = variantsOf(item);
  const opt = v?.options.find(o => o.rarity === rarity);
  if (!opt || rarity === currentOf(item)) return;
  const base = item.flags?.[MODULE]?.variantBase ?? snapshot(item);
  const isBase = rarity === v.base;
  const update = variantUpdate(item, base, opt, isBase);
  if (!item.flags?.[MODULE]?.variantBase) update[`flags.${MODULE}.variantBase`] = base;
  await item.update(update);
}

function addPicker(app, element) {
  const item = app.document ?? app.item;
  const v = variantsOf(item);
  if (!v?.options?.length || v.options.length < 2) return;
  const sidebar = element.querySelector(".sidebar");
  if (!sidebar || sidebar.querySelector(".tselverse-variant")) return;
  const cur = currentOf(item);
  const label = o => `${o.label}${o.rarity === v.base ? " (as printed)" : ""}${o.price != null ? ` · ${Number(o.price).toLocaleString("en-US")} gp` : ""}`;
  const group = document.createElement("div");
  group.className = "form-group label-adjacent uninputs tselverse-variant";
  const canEdit = game.user.isGM && app.isEditable && !item.pack;
  group.innerHTML = `<label>Variant</label><div class="form-fields">${canEdit
    ? `<select data-tooltip="This item comes in more than one rarity. Picking one sets its rarity, price, charges and DCs.">${
        v.options.map(o => `<option value="${esc(o.rarity)}"${o.rarity === cur ? " selected" : ""}>${esc(label(o))}</option>`).join("")}</select>`
    : `<span>${esc(label(v.options.find(o => o.rarity === cur) ?? v.options[0]))}</span>`}</div>`;
  const select = group.querySelector("select");
  // not part of the sheet's form: the sheet would otherwise try to save a field called nothing
  select?.addEventListener("change", ev => {
    ev.stopPropagation(); ev.preventDefault();
    setVariant(item, ev.currentTarget.value).catch(err => { console.error(err); ui.notifications.error(`Variant: ${err.message}`); });
  });
  const rarity = sidebar.querySelector('[name="system.rarity"]')?.closest(".form-group");
  sidebar.insertBefore(group, rarity ?? sidebar.firstChild);
}

Hooks.on("renderEquipmentSheet", addPicker);

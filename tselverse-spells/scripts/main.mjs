/**
 * Spell List for Black Flag stat blocks.
 *
 * Black Flag already stores a creature's spells as real spell items and groups them by
 * uses in `NPCSheet#_prepareActions` / `#_prepareSpellcasting`, which renders one plain
 * paragraph per group inside `blackflag-actions div.features.action > div.spellcasting.feature`.
 * This module:
 *   - replaces those paragraphs with a table: cast button, name (click for the description),
 *     action type, uses, range, save or attack, area;
 *   - turns every spell named in a "Spellcasting" trait into a link. A spell the creature
 *     has opens its description; one it does not have opens the add window (GM / trusted
 *     players only), which searches every installed spell compendium and otherwise offers
 *     a web search for the spell's text.
 *
 * Adding a spell sets its uses the same way Black Flag's own spellcasting config does
 * (`system.uses.max` + recovery, and the primary activity consumes the item), so the
 * sheet, the cast button and recovery on rest all behave normally.
 */

import { isSpellcastingName, parseSpellcasting, plainText, spellFromText } from "./spell-data.mjs";
import { attachImageOCR } from "./ocr-image.mjs";

const MODULE = "tselverse-spells";
const _loc = (k, d) => game.i18n.format(k, d ?? {});

/* ------------------------------------------------------------------ setup */

Hooks.once("init", () => {
  const reRender = () => {
    for (const app of foundry.applications.instances.values()) {
      if (app.element?.querySelector?.("blackflag-actions")) app.render();
    }
  };
  game.settings.register(MODULE, "table", {
    name: "TSVSP.Settings.Table.Name", hint: "TSVSP.Settings.Table.Hint",
    scope: "client", config: true, type: Boolean, default: true, onChange: reRender
  });
  game.settings.register(MODULE, "links", {
    name: "TSVSP.Settings.Links.Name", hint: "TSVSP.Settings.Links.Hint",
    scope: "client", config: true, type: Boolean, default: true, onChange: reRender
  });
  game.settings.register(MODULE, "zoom", {
    name: "TSVSP.Settings.Zoom.Name", hint: "TSVSP.Settings.Zoom.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  // remembers the hidden NPC the GM Spellbook casts from when no creature is the source
  game.settings.register(MODULE, "standIn", {
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(MODULE, "sideways", {
    name: "TSVSP.Settings.Sideways.Name", hint: "TSVSP.Settings.Sideways.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE, "searchSuffix", {
    name: "TSVSP.Settings.Search.Name", hint: "TSVSP.Settings.Search.Hint",
    scope: "world", config: true, type: String, default: "ToV Tales of the Valiant"
  });
  game.settings.register(MODULE, "searchUrl", {
    name: "TSVSP.Settings.SearchUrl.Name", hint: "TSVSP.Settings.SearchUrl.Hint",
    scope: "world", config: true, type: String, default: "https://duckduckgo.com/?q={q}"
  });
});

/* ------------------------------------------------------------------ 20th-level slots
 * Black Flag's full-caster table gives a 20th-level caster one 7th-circle slot; the Tales of
 * the Valiant tables print two (Player's Guide Wizard p99, Player's Guide 2 Theurge p65 and
 * Witch p87). One cell, set at setup, after the system has built CONFIG. To undo, delete this
 * block. */
Hooks.once("setup", () => {
  const row = CONFIG.BlackFlag?.spellSlotTable?.[20];
  if (Array.isArray(row) && row[7] === 1) row[7] = 2;
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { decorate, openAddDialog, addSpell, searchSpells, ensureSpellcasting, spellRow,
                                   gmCast, openGMSpellbook, freeSpellData, standInActor, gmCastClear, gmCastItem };
});

/** Adding spells is for Game Masters and trusted players only. */
function canManage(actor) {
  return (game.user.isGM || game.user.role >= CONST.USER_ROLES.TRUSTED) && !!actor?.isOwner;
}

/* ------------------------------------------------------------------ labels */

const TYPE_SHORT = { action: "A", bonus: "BA", reaction: "RA", free: "FA", legendary: "LA", lair: "LrA" };

function typeLabel(item) {
  const act = item.system.activities?.find(a => a.activation?.primary) ?? item.system.activities?.contents?.[0];
  const type = act?.activation?.type || item.system.casting?.type || "action";
  const long = CONFIG.BlackFlag.actionTypes?.localized?.[type]
    ?? game.i18n.localize(`BF.ACTIVATION.Type.${type.capitalize?.() ?? type}`);
  let style = "short";
  if (game.modules.get("action-labels")?.active) {
    try { style = game.settings.get("action-labels", "style"); } catch { /* not registered yet */ }
  }
  if (style === "off") return "";
  const short = TYPE_SHORT[type] ?? type.slice(0, 2).toUpperCase();
  const text = style === "long" ? long : short;
  return `<span class="tsvsp-type" data-tooltip="${foundry.utils.escapeHTML(String(long))}">${foundry.utils.escapeHTML(String(text))}</span>`;
}

function usesLabel(item) {
  const uses = item.system.uses;
  if (!uses?.max) return _loc("TSVSP.Table.AtWill");
  const period = uses.recovery?.[0]?.period;
  const config = CONFIG.BlackFlag.recoveryPeriods?.[period];
  const abbr = game.i18n.localize(config?.npcLabel ?? config?.abbreviation ?? "");
  return `${uses.value ?? 0}/${uses.max}${abbr ? ` <span class="tsvsp-dim">${abbr.toLowerCase()}</span>` : ""}`;
}

function rangeLabel(item) {
  const r = item.system.range ?? {};
  const unit = r.units ?? r.unit;
  if (unit === "self") return game.i18n.localize("BF.RANGE.Type.Self.Label");
  if (unit === "touch") return game.i18n.localize("BF.RANGE.Type.Touch.Label");
  if (!r.value) return r.special || "—";
  return `${r.value} ${unit === "mile" ? "mi" : "ft"}`;
}

/** DC of a save activity, or the bonus of an attack activity. */
function rollLabel(item, actor) {
  const acts = Array.from(item.system.activities ?? []);
  const bits = [];
  for (const a of acts) {
    if (a.type === "save") {
      const abilities = Array.from(a.system.save?.ability ?? []);
      const abbr = abilities.map(k => CONFIG.BlackFlag.abilities.localizedAbbreviations?.[k] ?? k).join("/");
      const dc = a.system.save?.dc?.formula || actor?.system.spellcasting?.dc || "";
      bits.push(`DC ${dc}${abbr ? ` ${abbr}` : ""}`);
    } else if (a.type === "attack") {
      const bonus = attackBonus(a);
      bits.push(bonus === null ? game.i18n.localize("BF.ATTACK.Label") : `${bonus >= 0 ? "+" : ""}${bonus}`);
    } else if (a.type === "heal") {
      const h = a.system.healing;
      if (h?.number && h?.denomination) bits.push(`${h.number}d${h.denomination}`);
    }
  }
  return bits.join(", ") || "—";
}

function attackBonus(activity) {
  try {
    const details = activity.getAttackDetails?.();
    if (!details?.parts?.length) return null;
    const roll = new Roll(details.parts.join(" + "), details.data ?? {});
    const total = roll.evaluateSync({ strict: false }).total;
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

function areaLabel(item) {
  const acts = Array.from(item.system.activities ?? []);
  const t = acts.find(a => a.target?.override && a.target.template?.type)?.target.template
        ?? item.system.target?.template;
  if (!t?.type) return "—";
  // `label` on these config entries is the localization KEY, not the word.
  const cfg = CONFIG.BlackFlag.areaOfEffectTypes?.[t.type] ?? {};
  let name = game.i18n.localize(cfg.label ?? cfg.localization ?? t.type);
  if (/^BF\./i.test(name)) name = t.type;
  const size = [t.size, t.width, t.height].filter(v => v !== "" && v != null);
  return `${size[0] ?? ""}${size[0] ? " ft " : ""}${String(name).toLowerCase()}`.trim();
}

/* ------------------------------------------------------------------ the table */

function spellRow(item, actor) {
  const editable = actor.isOwner;
  return `<tr data-item-id="${item.id}">
    <td class="tsvsp-cast">
      <button type="button" class="tsvsp-cast-button" data-tsvsp="cast" data-item-id="${item.id}"
              data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSP.Table.CastTooltip", { name: item.name }))}"
              aria-label="${foundry.utils.escapeHTML(_loc("TSVSP.Table.CastTooltip", { name: item.name }))}">
        <i class="fa-solid fa-wand-sparkles" inert></i>
      </button>
    </td>
    <td class="tsvsp-name"><a data-tsvsp="info" data-item-id="${item.id}" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSP.Table.InfoTooltip"))}">${foundry.utils.escapeHTML(item.name)}</a></td>
    <td class="tsvsp-type-cell">${typeLabel(item)}</td>
    <td class="tsvsp-uses">${usesLabel(item)}</td>
    <td>${foundry.utils.escapeHTML(String(rangeLabel(item)))}</td>
    <td>${foundry.utils.escapeHTML(String(rollLabel(item, actor)))}</td>
    <td>${foundry.utils.escapeHTML(String(areaLabel(item)))}</td>
    ${editable ? `<td class="tsvsp-row-controls"><button type="button" class="link-button" data-tsvsp="edit"
        data-item-id="${item.id}" data-tooltip="BF.ACTIVITY.Core.Action.Edit"><i class="fa-solid fa-pen-to-square" inert></i></button></td>` : "<td></td>"}
  </tr>`;
}

function buildTable(actor) {
  const spells = actor.items.filter(i => i.type === "spell")
    .sort((a, b) => (a.system.circle?.base ?? 0) - (b.system.circle?.base ?? 0) || a.name.localeCompare(b.name, game.i18n.lang));
  const head = ["Cast", "Spell", "Type", "Uses", "Range", "Roll", "Area"]
    .map(k => `<th${k === "Cast" ? "" : ` data-tooltip="${foundry.utils.escapeHTML(_loc(`TSVSP.Table.${k}Tip`))}"`}>${k === "Cast" ? "" : foundry.utils.escapeHTML(_loc(`TSVSP.Table.${k}`))}</th>`).join("");
  const rows = spells.length
    ? spells.map(i => spellRow(i, actor)).join("")
    : `<tr><td colspan="8" class="tsvsp-dim">${foundry.utils.escapeHTML(_loc("TSVSP.Table.Empty"))}</td></tr>`;
  const add = canManage(actor)
    ? `<button type="button" class="tsvsp-add-button" data-tsvsp="add" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSP.Table.AddTooltip"))}">
         <i class="fa-solid fa-plus" inert></i> ${foundry.utils.escapeHTML(_loc("TSVSP.Table.Add"))}</button>`
    : "";
  const table = document.createElement("div");
  table.className = "tsvsp-wrap";
  table.innerHTML = `<table class="tsvsp-table"><thead><tr>${head}<th></th></tr></thead><tbody>${rows}</tbody></table>${add}`;
  return table;
}

/* ------------------------------------------------------------------ trait links */

/** Wrap each spell name named in a Spellcasting trait in a link. */
function linkifyTrait(feature, actor, parsed) {
  const names = parsed.groups.flatMap(g => g.names.map(n => ({ name: n, uses: g.uses, period: g.period })));
  if (!names.length) return;
  const have = new Map(actor.items.filter(i => i.type === "spell").map(i => [i.name.toLowerCase(), i.id]));
  const byLower = new Map(names.map(e => [e.name.toLowerCase(), e]));
  const pattern = new RegExp(`\\b(${names.map(e => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");

  const walker = document.createTreeWalker(feature, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    if (node.parentElement.closest("a, .tsvsp-wrap")) continue;
    const text = node.nodeValue;
    if (!pattern.test(text)) { pattern.lastIndex = 0; continue; }
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = pattern.exec(text))) {
      const entry = byLower.get(m[1].toLowerCase());
      if (!entry) continue;
      if (m.index > last) frag.append(text.slice(last, m.index));
      const a = document.createElement("a");
      const itemId = have.get(m[1].toLowerCase());
      a.className = `tsvsp-link ${itemId ? "tsvsp-known" : "tsvsp-missing"}`;
      a.dataset.tsvsp = itemId ? "info" : "add";
      a.dataset.spellName = entry.name;
      if (itemId) a.dataset.itemId = itemId;
      if (entry.uses) { a.dataset.uses = String(entry.uses); a.dataset.period = entry.period ?? "longRest"; }
      a.dataset.tooltip = itemId ? m[1] : _loc("TSVSP.Add.Title");
      a.textContent = m[1];
      frag.append(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/* ------------------------------------------------------------------ rendering */

function decorate(app, actor, root) {
  const actions = root.querySelector("blackflag-actions");
  if (!actions) return;

  // The creature's Spellcasting trait, if it has one.
  let trait = null, parsed = null;
  for (const feature of actions.querySelectorAll("div.feature")) {
    const link = feature.querySelector(":scope > span.controls > a");
    if (!link || !isSpellcastingName(link.textContent)) continue;
    const item = actor.items.get(feature.dataset.itemId);
    if (!item) continue;
    const p = parseSpellcasting(item.system.description?.value ?? "");
    if (!p.groups.length && !p.dc) continue;
    trait = feature; parsed = p; break;
  }
  if (trait && parsed && game.settings.get(MODULE, "links")) linkifyTrait(trait, actor, parsed);

  if (!game.settings.get(MODULE, "table")) return;
  const spells = actor.items.filter(i => i.type === "spell");
  const bfBlock = actions.querySelector("div.spellcasting.feature");
  if (!spells.length && !trait && !bfBlock) return;

  // Black Flag's own grouped list is replaced by the table; its first paragraph carries
  // the ability / DC line and the configure cog, so that one stays.
  if (bfBlock) for (const p of bfBlock.querySelectorAll("p:not(.description)")) p.remove();

  root.querySelectorAll(".tsvsp-wrap").forEach(el => el.remove());
  const table = buildTable(actor);
  if (bfBlock) bfBlock.append(table);
  else trait?.after(table);

  // One listener per rendered element. A re-render replaces the element, so the flag
  // resets with it; without the flag a second decorate() pass would double-handle clicks.
  if (!actions.dataset.tsvspBound) {
    actions.dataset.tsvspBound = "1";
    actions.addEventListener("click", event => onClick(event, app, actor), { capture: true });
  }
}

async function onClick(event, sheet, actor) {
  const target = event.target.closest("[data-tsvsp]");
  if (!target || !actor) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const item = target.dataset.itemId ? actor.items.get(target.dataset.itemId) : null;

  switch (target.dataset.tsvsp) {
    case "cast":
      return castSpell(item, event, sheet);
    case "info":
      return item ? showSpell(item) : null;
    case "edit":
      return item?.sheet.render({ force: true });
    case "add": {
      if (!canManage(actor)) {
        return ui.notifications.info(_loc("TSVSP.Add.NoPermission", { name: target.dataset.spellName ?? "" }));
      }
      return openAddDialog(actor, {
        name: target.dataset.spellName ?? "",
        uses: target.dataset.uses ? Number(target.dataset.uses) : null,
        period: target.dataset.period ?? "longRest"
      });
    }
  }
}

Hooks.on("renderApplicationV2", (app, element) => {
  const root = element instanceof HTMLElement ? element : app.element;
  const actor = app.document;
  if (!root?.querySelector?.("blackflag-actions")) return;
  if (actor?.documentName !== "Actor") return;
  try { decorate(app, actor, root); }
  catch (err) { console.error(`${MODULE} | decorating ${actor.name} failed`, err); }
});

/**
 * Cast a spell from the table.
 * `Item#activate` asks WHICH activity to use whenever a spell has more than one (Contagion
 * carries a save and a rider), which is a pointless extra click for a cast button, so the
 * primary activity - the one Black Flag spends uses from - is activated directly. The spell's
 * other activities are still reachable from its own sheet.
 */
function castSpell(item, event, sheet) {
  if (!item) return null;
  const activities = Array.from(item.system.activities ?? []).filter(a => a.canUse);
  const activity = activities.find(a => a.activation?.primary) ?? activities[0];
  if (activity) return activity.activate({ event }, { options: { sheet } });
  return item.activate({ event }, { options: { sheet } });
}

/* ------------------------------------------------------------------ the description window */

async function showSpell(item) {
  const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
  const description = await enrich(item.system.description?.value ?? "", {
    secrets: false, rollData: item.getRollData(), relativeTo: item
  });
  const circle = item.system.circle?.base
    ? game.i18n.format("BF.Spell.Circle.Level", { number: item.system.circle.base })
    : game.i18n.localize("BF.Spell.Type.Cantrip.Label");
  const school = CONFIG.BlackFlag.spellSchools?.localized?.[item.system.school] ?? item.system.school ?? "";
  const facts = [
    [_loc("TSVSP.Table.Type"), plainText(typeLabel(item)) || item.system.casting?.type],
    [_loc("TSVSP.Table.Range"), rangeLabel(item)],
    [_loc("TSVSP.Table.Uses"), plainText(usesLabel(item))],
    [_loc("TSVSP.Table.Roll"), rollLabel(item, item.actor)],
    [_loc("TSVSP.Table.Area"), areaLabel(item)]
  ].filter(([, v]) => v && v !== "—");

  const content = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "tsvsp-info";
  content.append(inner);
  inner.innerHTML = `
    <p class="tsvsp-subtitle">${foundry.utils.escapeHTML(`${circle} ${school}`.trim())}</p>
    <dl class="tsvsp-facts">${facts.map(([k, v]) =>
      `<div><dt>${foundry.utils.escapeHTML(String(k))}</dt><dd>${foundry.utils.escapeHTML(String(v))}</dd></div>`).join("")}</dl>
    <div class="tsvsp-description">${description || `<p class="tsvsp-dim">${_loc("TSVSP.Info.NoDescription")}</p>`}</div>`;

  const buttons = [{
    action: "cast", label: _loc("TSVSP.Info.Cast"), icon: "fa-solid fa-wand-sparkles", default: true,
    callback: () => castSpell(item, null, null)
  }];
  if (item.isOwner) buttons.push({
    action: "sheet", label: _loc("TSVSP.Info.OpenSheet"), icon: "fa-solid fa-pen-to-square",
    callback: () => item.sheet.render({ force: true })
  });
  buttons.push({ action: "close", label: _loc("TSVSP.Info.Close"), icon: "fa-solid fa-xmark" });

  return foundry.applications.api.DialogV2.wait({
    window: { title: item.name, icon: "fa-solid fa-book-sparkles" },
    classes: ["tselverse-spells", "tsvsp-info-dialog"],
    position: { width: 520 },
    content, buttons, rejectClose: false
  });
}

/* ------------------------------------------------------------------ finding and adding */

const packCache = new Map();

/** Every spell in every installed Item compendium, matched by name. */
async function searchSpells(query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (q.length < 2) return [];
  const rows = [];
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    if (!packCache.has(pack.collection)) {
      const index = await pack.getIndex({ fields: ["type", "system.circle.base"] });
      packCache.set(pack.collection, index.filter(i => i.type === "spell")
        .map(i => ({ uuid: i.uuid ?? `Compendium.${pack.collection}.Item.${i._id}`, name: i.name,
                     circle: i.system?.circle?.base ?? null, pack: pack.metadata.label })));
    }
    rows.push(...packCache.get(pack.collection));
  }
  const score = r => {
    const n = r.name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
  };
  return rows.filter(r => r.name.toLowerCase().includes(q))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, game.i18n.lang))
    .slice(0, 20);
}

/** Set the creature's spellcasting ability and DC from what its own trait prints. */
async function ensureSpellcasting(actor) {
  const trait = actor.items.find(i => i.type === "feature" && isSpellcastingName(i.name));
  if (!trait) return null;
  const parsed = parseSpellcasting(trait.system.description?.value ?? "");
  const update = {};
  const source = actor._source.system.spellcasting ?? {};
  if (parsed.ability && source.ability !== parsed.ability) update["system.spellcasting.ability"] = parsed.ability;
  // Black Flag derives the DC as 8 + ability mod + proficiency, and an NPC's stored ability
  // `mod` is its SAVE bonus when proficient, so the derived number comes out above the
  // printed one (False Seraph: 32 derived, 25 printed). Write the printed DC once.
  if (parsed.dc != null && source.dc == null) update["system.spellcasting.dc"] = parsed.dc;
  if (!Object.keys(update).length) return null;
  await actor.update(update);
  if (update["system.spellcasting.dc"]) {
    ui.notifications.info(_loc("TSVSP.Add.SetDC", { dc: parsed.dc }));
  }
  return update;
}

/**
 * Put a spell on a creature with the uses its trait prints.
 * Mirrors Black Flag's own NPC spellcasting config: uses on the item, and the primary
 * activity consumes one of them, so casting spends a use and rest recovers it.
 */
async function addSpell(actor, doc, { uses = null, period = "longRest" } = {}) {
  const data = doc.toObject();
  delete data._id;
  data.folder = null;
  data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid };
  if (uses) {
    data.system.uses = { ...(data.system.uses ?? {}), max: String(uses), spent: 0, recovery: [{ period }] };
    for (const activity of Object.values(data.system.activities ?? {})) {
      if (activity.activation?.primary === false) continue;
      activity.consumption = { ...(activity.consumption ?? {}), targets: [{ type: "item", value: "1" }] };
    }
  }
  const existing = actor.items.find(i => i.type === "spell" && i.name.toLowerCase() === doc.name.toLowerCase());
  if (existing) {
    if (uses) await existing.update({ "system.uses.max": String(uses), "system.uses.recovery": [{ period }] });
    ui.notifications.info(_loc("TSVSP.Add.Updated", { name: doc.name }));
    return existing;
  }
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  await ensureSpellcasting(actor);
  ui.notifications.info(_loc("TSVSP.Add.Added", { name: doc.name, actor: actor.name }));
  return item;
}

function searchUrl(name) {
  const suffix = game.settings.get(MODULE, "searchSuffix");
  const url = game.settings.get(MODULE, "searchUrl") || "https://duckduckgo.com/?q={q}";
  return url.replace("{q}", encodeURIComponent(`${name} ${suffix}`.trim()));
}

const USE_OPTIONS = () => {
  const out = [{ value: "", label: _loc("TSVSP.Add.AtWill") }];
  for (const n of [1, 2, 3, 4, 5]) out.push({ value: `${n}|longRest`, label: _loc("TSVSP.Add.PerDay", { n }) });
  for (const n of [1, 2, 3]) out.push({ value: `${n}|shortRest`, label: _loc("TSVSP.Add.PerShortRest", { n }) });
  for (const n of [1, 2, 3]) out.push({ value: `${n}|encounter`, label: _loc("TSVSP.Add.PerEncounter", { n }) });
  return out;
};

async function openAddDialog(actor, { name = "", uses = null, period = "longRest" } = {}) {
  // DialogV2 rejects a content element that carries attributes, and it keeps only the
  // element's innerHTML - the element itself is thrown away, so nothing can be wired up
  // before rendering. The markup is built here and the handlers are attached to the
  // rendered dialog in its `render` callback.
  const content = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "tsvsp-add";
  content.append(inner);
  inner.innerHTML = `
    <div class="tsvsp-add-fields">
      <label>${foundry.utils.escapeHTML(_loc("TSVSP.Add.Name"))}
        <input type="text" name="spellName" value="${foundry.utils.escapeHTML(name)}" autofocus>
      </label>
      <label>${foundry.utils.escapeHTML(_loc("TSVSP.Add.Uses"))}
        <select name="uses">${USE_OPTIONS().map(o =>
          `<option value="${o.value}"${o.value === (uses ? `${uses}|${period}` : "") ? " selected" : ""}>${foundry.utils.escapeHTML(o.label)}</option>`).join("")}</select>
      </label>
    </div>
    <p class="tsvsp-message tsvsp-dim"></p>
    <ul class="tsvsp-results"></ul>
    <details class="tsvsp-paste">
      <summary>${foundry.utils.escapeHTML(_loc("TSVSP.Add.Paste"))}</summary>
      <p class="tsvsp-dim">${foundry.utils.escapeHTML(_loc("TSVSP.Add.PasteHint"))}</p>
      <textarea name="spellText" rows="8" placeholder="${foundry.utils.escapeHTML(_loc("TSVSP.Add.PastePlaceholder"))}"></textarea>
      <label>${foundry.utils.escapeHTML(_loc("TSVSP.Add.PasteSource"))}
        <select name="pasteSource">${["arcane", "divine", "primordial", "wyrd"].map(s =>
          `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>
      </label>
      <ul class="tsvsp-warnings tsvsp-dim"></ul>
    </details>
    <div class="tsvsp-preview"></div>
    <button type="button" class="tsvsp-web" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSP.Add.SearchTooltip"))}"><i class="fa-solid fa-magnifying-glass" inert></i>
      ${foundry.utils.escapeHTML(_loc("TSVSP.Add.Search"))}</button>`;

  const state = { doc: null, root: null };

  const wire = root => {
    state.root = root;
    const input = root.querySelector('input[name="spellName"]');
    const list = root.querySelector(".tsvsp-results");
    const message = root.querySelector(".tsvsp-message");
    const preview = root.querySelector(".tsvsp-preview");
    if (!input || root.dataset.tsvspWired) return;
    root.dataset.tsvspWired = "1";

    const select = async (uuid, el) => {
      for (const li of list.querySelectorAll("li")) li.classList.toggle("selected", li === el);
      state.doc = await fromUuid(uuid);
      if (!state.doc) return;
      const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
      preview.innerHTML = `<h4>${foundry.utils.escapeHTML(state.doc.name)}</h4>` +
        await enrich(state.doc.system.description?.value ?? "", { secrets: false, relativeTo: state.doc });
    };

    const run = foundry.utils.debounce(async () => {
      const query = input.value;
      message.textContent = _loc("TSVSP.Add.Searching");
      const rows = await searchSpells(query);
      list.innerHTML = rows.map(r =>
        `<li data-uuid="${r.uuid}"><span class="tsvsp-result-name">${foundry.utils.escapeHTML(r.name)}</span>
         <span class="tsvsp-dim">${r.circle ? `circle ${r.circle} · ` : ""}${foundry.utils.escapeHTML(r.pack)}</span></li>`).join("");
      message.textContent = rows.length ? _loc("TSVSP.Add.Found", { n: rows.length }) : _loc("TSVSP.Add.None");
      state.doc = null; preview.innerHTML = "";
      const exact = [...list.querySelectorAll("li")].find(li =>
        li.querySelector(".tsvsp-result-name").textContent.toLowerCase() === query.trim().toLowerCase());
      if (exact) await select(exact.dataset.uuid, exact);
    }, 250);

    input.addEventListener("input", run);

    // Paste spell text: the text becomes an unsaved spell, previewed like a search result,
    // and "Add" puts it on the sheet (spellFromText in spell-data.mjs does the reading)
    const paste = root.querySelector('textarea[name="spellText"]');
    const pasteSource = root.querySelector('select[name="pasteSource"]');
    const warnList = root.querySelector(".tsvsp-warnings");
    const fromText = foundry.utils.debounce(async () => {
      const text = paste.value.trim();
      warnList.innerHTML = "";
      if (!text) { state.doc = null; preview.innerHTML = ""; return; }
      const { item, warnings } = spellFromText(text, { fallbackSource: pasteSource.value });
      for (const li of list.querySelectorAll("li")) li.classList.remove("selected");
      state.doc = item;
      warnList.innerHTML = warnings.map(w => `<li>${foundry.utils.escapeHTML(w)}</li>`).join("");
      const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
      const circle = item.system.circle?.base ?? 0;
      preview.innerHTML = `<h4>${foundry.utils.escapeHTML(item.name)}</h4>
        <p class="tsvsp-dim">${circle ? `circle ${circle}` : "cantrip"} · ${foundry.utils.escapeHTML(item.system.school ?? "")}
          · ${foundry.utils.escapeHTML(Array.from(item.system.source ?? []).join(", "))}</p>` +
        await enrich(item.system.description?.value ?? "", { secrets: false });
    }, 300);
    paste?.addEventListener("input", fromText);
    attachImageOCR(paste);                             // or a picture of the spell, pasted or dropped
    pasteSource?.addEventListener("change", fromText);
    list.addEventListener("click", event => {
      const li = event.target.closest("li[data-uuid]");
      if (li) select(li.dataset.uuid, li);
    });
    root.querySelector(".tsvsp-web").addEventListener("click", () => {
      window.open(searchUrl(input.value), "_blank", "noopener");
    });
    if (input.value) run();
  };

  return foundry.applications.api.DialogV2.wait({
    window: { title: _loc("TSVSP.Add.Title"), icon: "fa-solid fa-wand-sparkles" },
    classes: ["tselverse-spells", "tsvsp-add-dialog"],
    position: { width: 560, height: 640 },
    content,
    render: (event, dialog) => wire(dialog.element),
    buttons: [
      {
        action: "add", label: _loc("TSVSP.Add.Add"), icon: "fa-solid fa-plus", default: true,
        callback: async () => {
          if (!state.doc) { ui.notifications.warn(_loc("TSVSP.Add.Pick")); return null; }
          const [n, p] = (state.root?.querySelector('select[name="uses"]')?.value || "|").split("|");
          return addSpell(actor, state.doc, { uses: n ? Number(n) : null, period: p || "longRest" });
        }
      },
      { action: "cancel", label: _loc("TSVSP.Add.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
}

/* ------------------------------------------------------------------ Spell Manager tidy
 * Black Flag's spell-learning dialog lists every spell a slot allows as one flat run of
 * names - no order, no search, no indication of a spell's circle. That is fine for the
 * dozen rituals a 3rd-level theurge sees and unusable for a free spell slot, which can
 * offer hundreds.
 *
 * The dialog hands its template `context.spells` straight from the compendium index, so
 * each row already carries the fields we need (system.circle.base, system.school,
 * system.source). Nothing here rebuilds those rows: the <li> elements and their radio and
 * checkbox inputs are moved, never recreated, so selection, replacement and the Learn
 * Spells button behave exactly as the system intends.
 */
const CIRCLE_LABEL = n => (n === 0 ? "Cantrips" : `${n}${["th","st","nd","rd"][n % 10 > 3 || (n % 100 - n % 10 === 10) ? 0 : n % 10]} Circle`);

function spellIndexFor(app) {
  // app.allSpells is the Collection the dialog itself built (a promise resolved at render)
  return app._tsvspIndex ?? null;
}

function tidySpellManager(app, root) {
  const list = root.querySelector("ul.spell-list");
  if (!list || list.dataset.tsvspTidied === "1") return;
  const items = Array.from(list.querySelectorAll("li[data-spell-uuid]"));
  if (items.length < 2) return;                       // nothing worth sorting
  const index = spellIndexFor(app);
  const meta = uuid => {
    const s = index?.get?.(uuid);
    return {
      circle: s?.system?.circle?.base ?? 0,
      school: s?.system?.school ?? "",
      source: Array.from(s?.system?.source ?? []).join(", "),
      tags: Array.from(s?.system?.tags ?? [])
    };
  };

  // circle/school under each name, so the list says what it is offering
  for (const li of items) {
    const m = meta(li.dataset.spellUuid);
    li.dataset.tsvspCircle = String(m.circle);
    li.dataset.tsvspName = (li.querySelector(".name")?.textContent ?? "").trim().toLowerCase();
    li.dataset.tsvspRitual = m.tags.includes("ritual") ? "1" : "0";
    const name = li.querySelector(".name");
    if (name && !name.querySelector(".tsvsp-sub")) {
      const sub = document.createElement("span");
      sub.className = "tsvsp-sub";
      const school = m.school ? m.school[0].toUpperCase() + m.school.slice(1) : "";
      const marks = m.tags.map(t => t === "ritual" ? "Ritual" : t === "concentration" ? "Concentration" : "");
      sub.textContent = [school, m.source, ...marks.filter(Boolean)].filter(Boolean).join(" · ");
      name.appendChild(sub);
    }
  }

  // One group per circle, in circle then name order. Rituals form their own group at the
  // top: a slot that can take any spell usually wants the ritual answered first, and a
  // ritual slot shows nothing else anyway.
  const groups = new Map();
  const anyRitual = items.some(li => li.dataset.tsvspRitual === "1");
  const allRitual = items.every(li => li.dataset.tsvspRitual === "1");
  for (const li of items) {
    const ritual = li.dataset.tsvspRitual === "1" && anyRitual && !allRitual;
    const c = ritual ? -1 : Number(li.dataset.tsvspCircle);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(li);
  }
  const frag = document.createDocumentFragment();
  for (const circle of [...groups.keys()].sort((a, b) => a - b)) {
    const rows = groups.get(circle).sort((a, b) => a.dataset.tsvspName.localeCompare(b.dataset.tsvspName, game.i18n.lang));
    if (groups.size >= 1) {
      const head = document.createElement("li");
      head.className = "tsvsp-circle-head";
      head.textContent = `${circle === -1 ? "Rituals" : CIRCLE_LABEL(circle)} (${rows.length})`;
      frag.appendChild(head);
    }
    for (const li of rows) frag.appendChild(li);
  }
  list.appendChild(frag);

  // search box above the list
  const section = list.closest("section.spells") ?? list.parentElement;
  if (section && !section.querySelector(".tsvsp-spell-search")) {
    const bar = document.createElement("div");
    bar.className = "tsvsp-spell-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = `Search ${items.length} spells…`;
    const count = document.createElement("span");
    count.className = "tsvsp-count";
    bar.append(input, count);
    section.prepend(bar);
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      for (const li of items) {
        const hit = !q || li.dataset.tsvspName.includes(q);
        li.style.display = hit ? "" : "none";
        if (hit) shown++;
      }
      // a heading with nothing under it is noise
      for (const head of list.querySelectorAll(".tsvsp-circle-head")) {
        let any = false;
        for (let n = head.nextElementSibling; n && !n.classList.contains("tsvsp-circle-head"); n = n.nextElementSibling)
          if (n.style.display !== "none") { any = true; break; }
        head.style.display = any ? "" : "none";
      }
      count.textContent = q ? `${shown} of ${items.length}` : "";
    };
    input.addEventListener("input", apply);
    input.addEventListener("keydown", e => { if (e.key === "Escape") { input.value = ""; apply(); } });
  }
  list.dataset.tsvspTidied = "1";
}

Hooks.on("renderSpellcastingDialog", async (app, element) => {
  const root = element instanceof HTMLElement ? element : app.element;
  if (!root) return;
  try {
    app._tsvspIndex ??= await app.allSpells;           // the dialog's own index Collection
    tidySpellManager(app, root);
  } catch (err) {
    console.error(`${MODULE} | tidying the Spell Manager failed`, err);
  }
});

/* ------------------------------------------------------------------ Choice pickers
 * The talent picker (ChooseFeaturesDialog) and the class/lineage/heritage/background
 * picker (ConceptSelectionDialog) both render a flat run of `section.option` cards in
 * whatever order the compendium search returned. With every Player's Guide imported a
 * talent list runs to dozens of cards, so finding one means scrolling past the rest.
 *
 * Both templates give each card a name and a source label, so the same toolbar serves
 * both: type to filter, and sort by name or by book. Cards are reordered in place - the
 * Choose buttons and their data-uuid hooks are untouched, so choosing still works.
 */
function tidyOptionPicker(root, label = "options") {
  const groups = new Map();
  for (const card of root.querySelectorAll("section.option[data-uuid]")) {
    const parent = card.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(card);
  }
  for (const [parent, cards] of groups) {
    if (cards.length < 2 || parent.dataset.tsvspPicker === "1") continue;
    for (const card of cards) {
      card.dataset.tsvspName = (card.querySelector(".name")?.textContent ?? "").trim().toLowerCase();
      card.dataset.tsvspSource = (card.querySelector(".source")?.textContent ?? "").trim().toLowerCase();
      card.dataset.tsvspText = (card.querySelector(".description")?.textContent ?? "").trim().toLowerCase().slice(0, 600);
    }
    const bar = document.createElement("div");
    bar.className = "tsvsp-picker-bar";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = `Search ${cards.length} ${label}…`;
    const sort = document.createElement("select");
    for (const [value, text] of [["name", "Sort: name"], ["source", "Sort: book"], ["none", "Sort: as listed"]]) {
      const o = document.createElement("option");
      o.value = value; o.textContent = text;
      sort.appendChild(o);
    }
    const count = document.createElement("span");
    count.className = "tsvsp-count";
    // Usable or not: Black Flag greys out the Choose button of an option whose prerequisites the
    // character doesn't meet (a lineage, an ability score, a level) - those can be hidden or shown alone
    for (const card of cards) card.dataset.tsvspUsable = card.querySelector('[data-action="choose"]')?.disabled ? "0" : "1";
    const blocked = cards.filter(c => c.dataset.tsvspUsable === "0").length;
    let usable = null;
    if (blocked) {
      usable = document.createElement("select");
      usable.className = "tsvsp-usable";
      usable.dataset.tooltip = tsvspResT("TSVSP.Picker.UsableTip", "Options whose prerequisites this character doesn't meet can't be chosen");
      for (const [value, text] of [["usable", tsvspResT("TSVSP.Picker.Usable", "Show: usable")],
                                   ["blocked", tsvspResT("TSVSP.Picker.Blocked", "Show: not usable")],
                                   ["all", tsvspResT("TSVSP.Picker.All", "Show: all")]]) {
        const o = document.createElement("option"); o.value = value; o.textContent = text; usable.appendChild(o);
      }
      let saved = "usable"; try { saved = localStorage.getItem(`${MODULE}.pickerUsable`) || "usable"; } catch {}
      usable.value = saved;
    }
    // Book: only the options from one book ("Tome of Heroes pg. 36" -> Tome of Heroes), with how
    // many each has; shown when the options come from more than one book
    const bookOf = card => (card.querySelector(".source")?.textContent ?? "").replace(/\s+/g, " ").trim()
      .replace(/,?\s*(?:pg\.?|p\.|page)\s*\d+.*$/i, "").trim();
    for (const card of cards) card.dataset.tsvspBook = bookOf(card);
    const bookCounts = new Map();
    for (const card of cards) bookCounts.set(card.dataset.tsvspBook, (bookCounts.get(card.dataset.tsvspBook) ?? 0) + 1);
    let book = null;
    if (bookCounts.size > 1) {
      book = document.createElement("select");
      book.className = "tsvsp-book";
      const all = document.createElement("option");
      all.value = ""; all.textContent = tsvspResT("TSVSP.Picker.AllBooks", "Book: all");
      book.appendChild(all);
      for (const [b, n] of [...bookCounts].sort((x, y) => (x[0] || "￿").localeCompare(y[0] || "￿"))) {
        const o = document.createElement("option");
        o.value = b; o.textContent = `${b || tsvspResT("TSVSP.Picker.NoBook", "(no book)")} (${n})`;
        book.appendChild(o);
      }
    }
    // Talent list (Magic / Martial / Technical), when the options are talents from more than one
    for (const card of cards) {
      const doc = fromUuidSync(card.dataset.uuid);
      card.dataset.tsvspList = doc?.type === "talent" ? doc.system?.type?.category ?? "" : "";
    }
    const lists = new Map();
    for (const card of cards) if (card.dataset.tsvspList) lists.set(card.dataset.tsvspList, (lists.get(card.dataset.tsvspList) ?? 0) + 1);
    let list = null;
    if (lists.size > 1) {
      list = document.createElement("select");
      list.className = "tsvsp-list";
      const all = document.createElement("option");
      all.value = ""; all.textContent = tsvspResT("TSVSP.Picker.AllLists", "List: all");
      list.appendChild(all);
      for (const [k, n] of [...lists].sort((x, y) => x[0].localeCompare(y[0]))) {
        const key = CONFIG.BlackFlag.talentCategories?.[k]?.localization;
        const name = key && game.i18n.localize(key) !== key ? game.i18n.localize(key) : k.capitalize();
        const o = document.createElement("option"); o.value = k; o.textContent = `${name} (${n})`; list.appendChild(o);
      }
    }
    bar.append(...[input, usable, list, book, sort, count].filter(Boolean));
    // Cards laid out in a row (Select Class / Subclass): inside that row the bar became a narrow
    // column in front of the first card, so it goes above the row instead. The row wraps now
    // (stylesheet), so wrapping no longer tells it apart from a list.
    const cs = getComputedStyle(parent);
    const sideways = /flex/.test(cs.display) && cs.flexDirection.startsWith("row");
    if (sideways) { bar.classList.add("tsvsp-picker-bar-above"); parent.parentElement.insertBefore(bar, parent); }
    else parent.insertBefore(bar, parent.firstChild);

    const original = cards.slice();
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      const want = usable?.value ?? "all";
      for (const card of cards) {
        const ok = (want === "all" || (want === "usable") === (card.dataset.tsvspUsable === "1"))
          && (!book?.value || card.dataset.tsvspBook === book.value)
          && (!list?.value || card.dataset.tsvspList === list.value);
        const hit = ok && (!q || card.dataset.tsvspName.includes(q)
          || card.dataset.tsvspSource.includes(q) || card.dataset.tsvspText.includes(q));
        card.style.display = hit ? "" : "none";
        if (hit) shown++;
      }
      count.textContent = shown < cards.length ? `${shown} of ${cards.length}` : `${cards.length}`;
      const mode = sort.value;
      const order = mode === "none" ? original : original.slice().sort((a, b) => {
        const key = mode === "source" ? "tsvspSource" : "tsvspName";
        return (a.dataset[key] || "￿").localeCompare(b.dataset[key] || "￿", game.i18n.lang)
          || a.dataset.tsvspName.localeCompare(b.dataset.tsvspName, game.i18n.lang);
      });
      for (const card of order) parent.appendChild(card);
    };
    input.addEventListener("input", apply);
    input.addEventListener("keydown", e => { if (e.key === "Escape") { input.value = ""; apply(); } });
    sort.addEventListener("change", apply);
    book?.addEventListener("change", apply);
    list?.addEventListener("change", apply);
    usable?.addEventListener("change", () => { try { localStorage.setItem(`${MODULE}.pickerUsable`, usable.value); } catch {} apply(); });
    parent.dataset.tsvspPicker = "1";
    apply();
  }
}

for (const [hook, label] of [["renderChooseFeaturesDialog", "options"], ["renderConceptSelectionDialog", "choices"]]) {
  Hooks.on(hook, (app, element) => {
    const root = element instanceof HTMLElement ? element : app.element;
    if (!root) return;
    try { tidyOptionPicker(root, label); }
    catch (err) { console.error(`${MODULE} | tidying ${hook} failed`, err); }
  });
}

/* ------------------------------------------------------------------ Ctrl + Scroll zoom
 * Every one of Black Flag's pickers prints more than fits, and each one is held to a size by
 * the system's own stylesheet: the Select Class window's content box is a fixed 800px
 * (`.concept-selection-dialog:is(.class, .subclass) .window-content { block-size: 800px }`)
 * against a card that is a 512px poster plus its name, summary, link and button; Lineages,
 * Heritages and Backgrounds are capped at `min(800px, 75vh)` with 202px rows; the talent
 * picker at `min(800px, 75vh)`.
 *
 * So the scale goes on the CONTENTS of `.window-content`, never on the box and never on the
 * window frame: the cards and rows themselves get smaller, which is what fits more of them
 * in view. The box is then measured against those scaled contents and given exactly what
 * they need, up to the screen space below it, with the system's caps set aside - zoom out and
 * more of the list comes into view at the same size on screen, far enough and the scrollbar
 * goes away. Scaling the box instead would only shrink the window and show no more than
 * before. The frame, title bar and resize corner are never touched, so dragging and resizing
 * still work on real coordinates. */

const ZOOM_MIN = 0.4, ZOOM_MAX = 3, ZOOM_STEP = 1.1;
/* The listeners below are bound when the module file runs, which is before `init`; a wheel
 * event on the loading screen would otherwise ask for a setting that does not exist yet. */
const zoomOn = () => { try { return game.settings.get(MODULE, "zoom"); } catch { return false; } };
const zoomKey = root => {
  const app = foundry.applications.instances.get(root.id);
  // One class does all five pickers, and `this.element.classList.add(this.type)` is the only
  // thing that tells them apart - so Lineages remembers its own level, not the class window's.
  const kind = app?.options?.details?.type ? `.${app.options.details.type}` : "";
  return `${MODULE}.zoom.${app?.constructor?.name ?? root.id.replace(/\d+$/, "")}${kind}`;
};

function zoomOf(root) {
  try { return Number(localStorage.getItem(zoomKey(root))) || 1; }
  catch { return 1; }
}

/** The scroll box, and the elements inside it that carry the scale. */
function zoomParts(root) {
  const content = root.querySelector(".window-content") ?? root;
  const layers = [...content.children]
    .filter(n => n.nodeType === Node.ELEMENT_NODE && !n.classList.contains("tsvsp-zoom-badge"));
  return {content, layers: layers.length ? layers : [content], nested: layers.length > 0};
}

/** The six properties the system sizes these boxes with, all of which have to give way. */
const BOX_SIZING = ["height", "min-height", "max-height", "block-size", "min-block-size", "max-block-size"];

function fitBox(content, z) {
  for (const prop of BOX_SIZING) content.style.removeProperty(prop);
  delete content.dataset.tsvspPinned;
  if (z === 1) return;
  // A window with a height of its own (a character sheet, anything resized by hand) already
  // scrolls its content inside that height. Pinning the box to the screen space below it made the
  // box taller than the window, and its last part sat under the window's bottom edge where no
  // scrolling could reach (Dungeone Daude's sheet, 2026-10-02). Only auto-height windows - the
  // pickers - are sized to their zoomed contents.
  const root = content.closest(".application, .window-app");
  const h0 = root?.style.height;
  if (h0 && h0 !== "auto") return;
  const room = window.innerHeight - content.getBoundingClientRect().top - 12;
  // Collapse the box first, then read scrollHeight: left at the system's own 800px the
  // measurement would read 800 straight back and the shrunken contents would sit in a gap.
  // scrollHeight is used rather than the children's boxes because it counts the padding and
  // any flex gap between them.
  for (const prop of ["height", "min-height", "block-size", "min-block-size"]) content.style.setProperty(prop, "0px");
  for (const prop of ["max-height", "max-block-size"]) content.style.setProperty(prop, "none");
  const natural = content.scrollHeight;
  const h = Math.round(Math.min(natural, Math.max(room, 200)));
  if (h <= 120) return;
  for (const prop of BOX_SIZING) content.style.setProperty(prop, `${h}px`);
  content.dataset.tsvspPinned = "1";
  // The window itself has a height cap (85% of the screen), and it cuts off whatever pokes out
  // below it. The screen space below the box can be more than that, so the last option sat past
  // the window's bottom edge where no scrolling could reach (talent picker, 2026-10-03). Shrink the
  // box until it ends inside the window.
  if (root) {
    const over = content.getBoundingClientRect().bottom - root.getBoundingClientRect().bottom + 1;
    if (over > 0) for (const prop of BOX_SIZING) content.style.setProperty(prop, `${Math.max(h - over, 120)}px`);
  }
}

function setZoom(root, factor, {badge = true} = {}) {
  const {content, layers, nested} = zoomParts(root);
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(factor * 1000) / 1000));
  for (const layer of layers) layer.style.zoom = z === 1 ? "" : z;
  if (nested) fitBox(content, z);
  try {
    if (z === 1) localStorage.removeItem(zoomKey(root));
    else localStorage.setItem(zoomKey(root), String(z));
  } catch { /* private mode: the zoom still applies, it just isn't remembered */ }
  if (badge) showZoomBadge(root, z);
  const label = root.querySelector(":scope > .window-header .tsvsp-zoom-level");
  if (label) label.textContent = `${Math.round(z * 100)}%`;
  return z;
}

/* Zoom buttons in the title bar: − / 100% / +. Ctrl+scroll does the same, but in Chrome a wheel
 * gesture that began as an ordinary scroll can't be stopped once Ctrl is pressed partway through,
 * and the whole page zooms instead (a player hit this, 2026-10-06). The buttons can't do that. */
function addZoomButtons(root) {
  const header = root.querySelector(":scope > .window-header");
  if (!header || header.querySelector(".tsvsp-zoom-controls")) return;
  const box = document.createElement("span");
  box.className = "tsvsp-zoom-controls";
  const btn = (cls, icon, tip, fn) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = `header-control icon tsvsp-zoom-${cls}`;
    if (icon) b.innerHTML = `<i class="fa-solid ${icon}" inert></i>`;
    b.dataset.tooltip = tip; b.setAttribute("aria-label", tip);
    // the header is the window's drag handle: a press here must not start a drag
    b.addEventListener("pointerdown", ev => ev.stopPropagation());
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); fn(); });
    return b;
  };
  const out = btn("out", "fa-magnifying-glass-minus", "Zoom this window out", () => setZoom(root, zoomOf(root) / ZOOM_STEP));
  const level = btn("level", null, "Reset this window to 100%", () => setZoom(root, 1));
  level.classList.remove("icon"); level.classList.add("tsvsp-zoom-level");
  level.textContent = `${Math.round(zoomOf(root) * 100)}%`;
  const inn = btn("in", "fa-magnifying-glass-plus", "Zoom this window in", () => setZoom(root, zoomOf(root) * ZOOM_STEP));
  box.append(out, level, inn);
  const close = header.querySelector('[data-action="close"]');
  close ? close.before(box) : header.append(box);
}

let badgeTimer = null;
function showZoomBadge(root, z) {
  let el = root.querySelector(":scope > .tsvsp-zoom-badge");
  if (!el) {
    el = document.createElement("div");
    el.className = "tsvsp-zoom-badge";
    root.appendChild(el);
  }
  el.textContent = `${Math.round(z * 100)}%`;
  el.classList.add("visible");
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => el.classList.remove("visible"), 900);
}

/** The window under the pointer or the keyboard focus, if it is one we may scale. */
const zoomTarget = node => node?.closest?.(".application, .window-app") ?? null;

/* The Select Class window lays its cards out in a row and scrolls sideways
 * (`overflow-x: scroll` on the same rule that fixes the box's height), so a wheel that only
 * moves the page up and down cannot reach the classes past the second one. Inside a box that
 * scrolls sideways, the wheel moves it sideways; hold Shift for up and down. Boxes that only
 * scroll up and down - chat, journals, sheets - are left alone. */
const sidewaysOn = () => { try { return game.settings.get(MODULE, "sideways"); } catch { return false; } };

function sidewaysBox(node, root) {
  for (let el = node; el instanceof HTMLElement; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return el;
    if (el === root) break;
  }
  return null;
}

document.addEventListener("wheel", ev => {
  const root = zoomTarget(ev.target);
  if (!root || root.querySelector("canvas#board")) return;

  if (ev.ctrlKey) {
    if (!zoomOn()) return;
    ev.preventDefault();               // otherwise Electron zooms the whole interface
    ev.stopPropagation();
    setZoom(root, zoomOf(root) * (ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    return;
  }

  if (ev.shiftKey || ev.deltaX || !sidewaysOn()) return;
  const box = sidewaysBox(ev.target, root);
  if (!box || !ev.deltaY) return;
  const step = ev.deltaY * (ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? box.clientWidth : 1);
  const limit = box.scrollWidth - box.clientWidth;
  // at either end, let the event through so the page can scroll normally
  if ((step > 0 && box.scrollLeft >= limit - 1) || (step < 0 && box.scrollLeft <= 0)) return;
  ev.preventDefault();
  box.scrollLeft += step;
}, {capture: true, passive: false});

document.addEventListener("keydown", ev => {
  if (!ev.ctrlKey || ev.key !== "0" || !zoomOn()) return;
  const root = zoomTarget(document.activeElement) ?? zoomTarget(document.querySelector(".application:hover"));
  if (!root) return;
  ev.preventDefault();
  setZoom(root, 1);
});

/** A window opens at the level it was left at. */
Hooks.on("renderApplicationV2", (app, element) => {
  try {
    const root = element instanceof HTMLElement ? element : app.element;
    if (!root || !zoomOn()) return;
    if (!root.querySelector("canvas#board")) addZoomButtons(root);
    const z = zoomOf(root);
    // after the frame has been sized, so the pinned height is the real one
    if (z !== 1) requestAnimationFrame(() => setZoom(root, z, {badge: false}));
  } catch (err) { console.error(`${MODULE} | restoring window zoom failed`, err); }
});

/* ------------------------------------------------------------------ GM Spellbook
 * Cast any spell in any compendium, from any creature or none, as many times as you like.
 * Nothing is added to a stat block and nothing is spent.
 *
 * Black Flag will only activate an item that is embedded on an actor and not in a pack
 * (`Activity#activate` bails on `!this.item.isEmbedded || this.item.pack`), so the spell is
 * built as a TEMPORARY item parented to the caster - never written to the actor, gone the
 * moment the cast resolves. Three things make it free:
 *   - `flags["black-flag"].relationship.mode = "atWill"`, because `requiresSpellSlot` is
 *     false for a preparation mode that is not `scalable`, so no slot is asked for;
 *   - every activity's `consumption.targets` is emptied, so no uses or resources are spent;
 *   - `activate({consume: false})`, which skips the consumption config entirely.
 * A save DC can be forced with `save.dc = {ability: "custom", formula: "15"}` - the system
 * reads a custom DC straight from the formula rather than from the caster's spellcasting.
 */

const STAND_IN_FLAG = "standIn";

/* An activity keeps its own fields under `activity.system` - `consumption` and `uses` sit at
 * the top level, but `save`, `attack` and `damage` do not. Writing `activity.save` (which is
 * what this did at first) creates a key nothing reads, so the override was silently ignored
 * and the caster's own spellcasting DC was used. */
const ACTIVITY_OVERRIDES = (activity, {dc, attack}) => {
  activity.system ??= {};
  // a custom DC is read straight from the formula instead of the caster's spellcasting
  if (dc) activity.system.save = {...(activity.system.save ?? {}),
                                  dc: {ability: "custom", formula: String(dc)}};
  // `flat` means the bonus IS the attack roll, rather than being added to the caster's
  if (attack !== null && attack !== undefined)
    activity.system.attack = {...(activity.system.attack ?? {}), flat: true, bonus: String(attack)};
};

/** Strip a compendium spell down to something that can be cast for free, right now. */
function freeSpellData(doc, {dc = null, attack = null} = {}) {
  const data = doc.toObject();
  delete data._id;
  data.folder = null;
  data._stats = {...(data._stats ?? {}), compendiumSource: doc.uuid};
  foundry.utils.setProperty(data, `flags.${game.system.id}.relationship.mode`, "atWill");
  data.system.uses = {spent: 0, max: "", recovery: []};
  for (const activity of Object.values(data.system.activities ?? {})) {
    activity.consumption = {...(activity.consumption ?? {}), targets: []};
    ACTIVITY_OVERRIDES(activity, {dc, attack});
  }
  return data;
}

/** The copy of `doc` this module put on `actor`, if it already did. */
function gmCastItem(actor, doc) {
  return actor?.items.find(i => i.getFlag(MODULE, "gmCast") && i.getFlag(MODULE, "spell") === doc.uuid);
}

/**
 * Cast `doc` from `actor`, at will.
 *
 * The spell has to be a REAL item on the actor, not a temporary one. Black Flag's chat card
 * resolves its own buttons with `fromUuid(dataset.activityUuid)` (black-flag.mjs ~19281), so
 * a card made from an item that was never saved has a Save, Damage and Place Template that
 * silently do nothing. The item is created once, flagged, and reused on every later cast of
 * the same spell by the same creature - it costs nothing to keep (at-will, no consumption)
 * and `stream of spells I added` can be swept up with `gmCastClear`.
 */
async function gmCast(actor, doc, {dc = null, attack = null, event = null} = {}) {
  if (!actor) { ui.notifications.warn(_loc("TSVSP.GM.NoCaster")); return null; }
  if (!doc) return null;

  let item = gmCastItem(actor, doc);
  if (!item) {
    const data = freeSpellData(doc, {dc, attack});
    foundry.utils.setProperty(data, `flags.${MODULE}.gmCast`, true);
    foundry.utils.setProperty(data, `flags.${MODULE}.spell`, doc.uuid);
    [item] = await actor.createEmbeddedDocuments("Item", [data]);
  } else if (dc !== null || attack !== null) {
    // the numbers changed since the last cast - rewrite them on the copy already there
    const updates = {};
    for (const id of Object.keys(item.toObject().system.activities ?? {})) {
      if (dc !== null) updates[`system.activities.${id}.system.save.dc`] = {ability: "custom", formula: String(dc)};
      if (attack !== null) updates[`system.activities.${id}.system.attack`] = {flat: true, bonus: String(attack)};
    }
    if (Object.keys(updates).length) await item.update(updates);
  }
  if (!item) return null;

  const activities = Array.from(item.system.activities ?? []).filter(a => a.canUse);
  const activity = activities.find(a => a.activation?.primary) ?? activities[0];
  const config = {consume: false, event};
  if (activity) return activity.activate(config);
  return item.activate(config);
}

/** Delete every spell this module added, from one actor or from all of them. */
async function gmCastClear(actor = null) {
  const actors = actor ? [actor] : game.actors.contents;
  let n = 0;
  for (const a of actors) {
    const ids = a.items.filter(i => i.getFlag(MODULE, "gmCast")).map(i => i.id);
    if (!ids.length) continue;
    await a.deleteEmbeddedDocuments("Item", ids);
    n += ids.length;
  }
  ui.notifications.info(_loc("TSVSP.GM.Cleared", {n}));
  return n;
}

/** The hidden NPC used when the spell comes from no creature - a trap, a rune, the world. */
async function standInActor({create = true} = {}) {
  const id = game.settings.get(MODULE, STAND_IN_FLAG);
  const existing = id ? game.actors.get(id) : null;
  if (existing) return existing;
  if (!create) return null;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: {title: _loc("TSVSP.GM.StandInTitle")},
    content: `<p>${foundry.utils.escapeHTML(_loc("TSVSP.GM.StandInAsk"))}</p>`,
    rejectClose: false
  });
  if (!ok) return null;
  const actor = await Actor.implementation.create({
    name: _loc("TSVSP.GM.StandInName"), type: "npc",
    img: "icons/magic/symbols/runes-star-blue.webp",
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE},
    flags: {[MODULE]: {standIn: true}}
  });
  await game.settings.set(MODULE, STAND_IN_FLAG, actor.id);
  return actor;
}

/** Everyone who could plausibly be casting: what you have selected, then your own token. */
function casterChoices() {
  const seen = new Map();
  for (const token of canvas.tokens?.controlled ?? [])
    if (token.actor) seen.set(token.actor.id, {id: token.actor.id, name: token.name, from: _loc("TSVSP.GM.Selected")});
  for (const token of canvas.tokens?.placeables ?? [])
    if (token.actor && !seen.has(token.actor.id) && token.isVisible)
      seen.set(token.actor.id, {id: token.actor.id, name: token.name, from: _loc("TSVSP.GM.OnScene")});
  return [...seen.values()];
}

async function openGMSpellbook() {
  if (!game.user.isGM) return;
  // one window: v14 fires both the tool's onClick and onChange for a single click, which opened
  // two - an open one is brought to the front instead
  const open = [...(foundry.applications.instances?.values?.() ?? [])].find(a => a.element?.querySelector?.(".tsvsp-gmbook"));
  if (open) { open.bringToFront?.(); return; }
  if (openGMSpellbook.opening) return;
  openGMSpellbook.opening = true;
  setTimeout(() => { openGMSpellbook.opening = false; }, 500);
  const state = {doc: null, root: null};

  const content = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "tsvsp-gmbook";
  content.append(inner);
  const esc = foundry.utils.escapeHTML;
  inner.innerHTML = `
    <div class="tsvsp-gm-row">
      <input type="search" class="tsvsp-gm-search" placeholder="${esc(_loc("TSVSP.GM.Search"))}" autofocus>
    </div>
    <div class="tsvsp-gm-row">
      <label>${esc(_loc("TSVSP.GM.Caster"))} <select class="tsvsp-gm-caster"></select></label>
      <label>${esc(_loc("TSVSP.GM.DC"))} <input type="number" class="tsvsp-gm-dc" min="1" max="40" placeholder="—"></label>
      <label>${esc(_loc("TSVSP.GM.Attack"))} <input type="number" class="tsvsp-gm-atk" min="-5" max="30" placeholder="—"></label>
    </div>
    <p class="tsvsp-dim tsvsp-gm-note">${esc(_loc("TSVSP.GM.Kept"))}</p>
    <p class="tsvsp-message tsvsp-dim"></p>
    <ul class="tsvsp-results"></ul>
    <details class="tsvsp-paste">
      <summary>${esc(_loc("TSVSP.Add.Paste"))}</summary>
      <p class="tsvsp-dim">${esc(_loc("TSVSP.Add.PasteHint"))}</p>
      <textarea name="spellText" rows="8" placeholder="${esc(_loc("TSVSP.Add.PastePlaceholder"))}"></textarea>
      <label>${esc(_loc("TSVSP.Add.PasteSource"))}
        <select name="pasteSource">${["arcane", "divine", "primordial", "wyrd"].map(s =>
          `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>
      </label>
      <ul class="tsvsp-warnings tsvsp-dim"></ul>
    </details>
    <div class="tsvsp-preview"></div>`;

  const wire = root => {
    if (root.dataset.tsvspGm) return;
    root.dataset.tsvspGm = "1";
    state.root = root;
    const input = root.querySelector(".tsvsp-gm-search");
    const list = root.querySelector(".tsvsp-results");
    const message = root.querySelector(".tsvsp-message");
    const preview = root.querySelector(".tsvsp-preview");
    const caster = root.querySelector(".tsvsp-gm-caster");

    const fillCasters = () => {
      const chosen = caster.value;
      const rows = casterChoices();
      caster.innerHTML = rows.map(r =>
        `<option value="${r.id}">${esc(r.name)} — ${esc(r.from)}</option>`).join("")
        + `<option value="@standin">${esc(_loc("TSVSP.GM.StandIn"))}</option>`;
      if (chosen) caster.value = chosen;
    };
    fillCasters();
    Hooks.on("controlToken", fillCasters);

    const select = async (uuid, el) => {
      for (const li of list.querySelectorAll("li")) li.classList.toggle("selected", li === el);
      state.doc = await fromUuid(uuid);
      if (!state.doc) return;
      const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
      preview.innerHTML = `<h4>${esc(state.doc.name)}</h4>`
        + await enrich(state.doc.system.description?.value ?? "", {secrets: true, relativeTo: state.doc});
    };

    const run = foundry.utils.debounce(async () => {
      const rows = await searchSpells(input.value);
      list.innerHTML = rows.map(r =>
        `<li data-uuid="${r.uuid}"><span class="tsvsp-result-name">${esc(r.name)}</span>
         <span class="tsvsp-dim">${r.circle !== null ? `circle ${r.circle} · ` : ""}${esc(r.pack)}</span></li>`).join("");
      message.textContent = rows.length ? _loc("TSVSP.Add.Found", {n: rows.length}) : _loc("TSVSP.Add.None");
      state.doc = null; preview.innerHTML = "";
    }, 250);

    input.addEventListener("input", run);

    // Paste spell text: the text becomes an unsaved spell, previewed like a search result,
    // and "Add" puts it on the sheet (spellFromText in spell-data.mjs does the reading)
    const paste = root.querySelector('textarea[name="spellText"]');
    const pasteSource = root.querySelector('select[name="pasteSource"]');
    const warnList = root.querySelector(".tsvsp-warnings");
    const fromText = foundry.utils.debounce(async () => {
      const text = paste.value.trim();
      warnList.innerHTML = "";
      if (!text) { state.doc = null; preview.innerHTML = ""; return; }
      const { item, warnings } = spellFromText(text, { fallbackSource: pasteSource.value });
      for (const li of list.querySelectorAll("li")) li.classList.remove("selected");
      state.doc = item;
      warnList.innerHTML = warnings.map(w => `<li>${foundry.utils.escapeHTML(w)}</li>`).join("");
      const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
      const circle = item.system.circle?.base ?? 0;
      preview.innerHTML = `<h4>${foundry.utils.escapeHTML(item.name)}</h4>
        <p class="tsvsp-dim">${circle ? `circle ${circle}` : "cantrip"} · ${foundry.utils.escapeHTML(item.system.school ?? "")}
          · ${foundry.utils.escapeHTML(Array.from(item.system.source ?? []).join(", "))}</p>` +
        await enrich(item.system.description?.value ?? "", { secrets: false });
    }, 300);
    paste?.addEventListener("input", fromText);
    attachImageOCR(paste);                             // or a picture of the spell, pasted or dropped
    pasteSource?.addEventListener("change", fromText);
    list.addEventListener("click", event => {
      const li = event.target.closest("li[data-uuid]");
      if (li) select(li.dataset.uuid, li);
    });
    list.addEventListener("dblclick", () => root.querySelector('[data-action="cast"]')?.click());
  };

  const cast = async event => {
    const root = state.root;
    if (!state.doc) { ui.notifications.warn(_loc("TSVSP.GM.Pick")); return; }
    const choice = root.querySelector(".tsvsp-gm-caster").value;
    const actor = choice === "@standin" ? await standInActor() : game.actors.get(choice);
    if (!actor) return;
    const dcField = root.querySelector(".tsvsp-gm-dc").value;
    const atkField = root.querySelector(".tsvsp-gm-atk").value;
    await gmCast(actor, state.doc, {
      dc: dcField === "" ? null : Number(dcField),
      attack: atkField === "" ? null : Number(atkField),
      event
    });
  };

  return foundry.applications.api.DialogV2.wait({
    window: {title: _loc("TSVSP.GM.Title"), icon: "fa-solid fa-book-open"},
    classes: ["tselverse-spells", "tsvsp-gm-dialog"],
    position: {width: 620, height: 660},
    content,
    render: (event, dialog) => wire(dialog.element),
    buttons: [
      // `callback` returning nothing still closes a DialogV2 button, so casting again and
      // again is done by keeping the dialog open explicitly.
      {action: "cast", label: _loc("TSVSP.GM.Cast"), icon: "fa-solid fa-wand-magic-sparkles",
       default: true, callback: async (event, button, dialog) => { await cast(event); return false; }},
      {action: "clear", label: _loc("TSVSP.GM.Clear"), icon: "fa-solid fa-broom",
       callback: async () => { await gmCastClear(); return false; }},
      {action: "close", label: _loc("TSVSP.GM.Close"), icon: "fa-solid fa-xmark"}
    ],
    rejectClose: false
  });
}

/** `/spell` in chat opens the same window - a second way in that does not depend on the
 *  scene controls having registered. */
Hooks.on("chatMessage", (log, message) => {
  if (!game.user.isGM || !/^\/spells?\b/i.test(message.trim())) return;
  openGMSpellbook();
  return false;
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const group = Array.isArray(controls) ? controls.find(c => c.name === "token") : controls.tokens ?? controls.token;
  if (!group?.tools) return;
  // core's own tools all carry an order; `button: true` + `onChange` is the one-shot shape
  // (see the Drawings "clear" tool), and onClick is kept for the older array-style API
  const tool = {name: `${MODULE}-gmbook`, order: 99, title: "TSVSP.GM.Title",
                // fa-hat-wizard renders as a missing glyph in the webfont Foundry ships
                // (the CSS is Font Awesome 7 Pro, the fonts are not) - fa-book-open is the
                // one Black Flag's own "More Information" link uses, so it is known good
                icon: "fa-solid fa-book-open", visible: true, button: true,
                onClick: openGMSpellbook, onChange: openGMSpellbook};
  if (Array.isArray(group.tools)) group.tools.push(tool);
  else group.tools[tool.name] = tool;
});

/* ------------------------------------------------------------------ detached windows fill their window
 * Foundry v14 can move an application into its own browser window ("detach"). It sizes that browser
 * window to the application once and then leaves them apart: make the browser window bigger and the
 * application stays the size it was in the corner (2026-10-02). Here the window's main application
 * follows the browser window - on detaching and on every resize of that window. */
const tsvspFitting = new WeakSet();
function tsvspFitDetached(win) {
  const desc = [...(foundry.applications.detached?.windows?.values?.() ?? [])].find(d => d.window === win);
  for (const app of desc?.applications?.values?.() ?? []) {
    if (app.window?.windowId !== app.id || !app.rendered) continue;     // only the window's own application
    Object.assign(app.element.style, {maxWidth: "", maxHeight: ""});
    app.setPosition({left: 0, top: 0, width: win.innerWidth, height: win.innerHeight});
  }
}
function tsvspWatchDetached(app) {
  const win = app.element?.ownerDocument?.defaultView;
  if (!win || win === window || tsvspFitting.has(win)) return;
  tsvspFitting.add(win);
  let t = null;
  win.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => tsvspFitDetached(win), 60); });
  setTimeout(() => tsvspFitDetached(win), 200);
}
Hooks.on("renderApplicationV2", app => { try { tsvspWatchDetached(app); } catch (err) { console.warn(`${MODULE} | detached window fit`, err); } });

/* ------------------------------------------------------------------ resize from any edge
 * Foundry's windows resize from the bottom-right corner only. Every resizable window gets thin grab
 * strips on all four edges and corners; dragging one moves that edge (the left and top ones move
 * the window too, so the opposite edge stays put). A window that fills a detached browser window
 * is left alone - its size is the browser window's. */
const TSVSP_EDGES = {n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1]};
function tsvspAddEdges(app) {
  const el = app.element;
  // every window, not only the ones Foundry marks resizable (Select Class, dialogs, pickers)
  if (!el || el.querySelector(":scope > .tsvsp-edge") || !el.classList.contains("application") || el.classList.contains("tsvsp-noresize")) return;
  if (el.ownerDocument.defaultView !== window && app.window?.windowId === app.id) return;
  for (const [dir, [dx, dy]] of Object.entries(TSVSP_EDGES)) {
    const h = el.ownerDocument.createElement("div");
    h.className = `tsvsp-edge tsvsp-edge-${dir}`;
    h.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const r = el.getBoundingClientRect(), pos = app.position;
      const start = {x: ev.clientX, y: ev.clientY, left: pos.left ?? r.left, top: pos.top ?? r.top, w: r.width, h: r.height};
      const minW = 200, minH = 120;
      h.setPointerCapture(ev.pointerId);
      const move = e => {
        const ddx = e.clientX - start.x, ddy = e.clientY - start.y, upd = {};
        if (dx === 1) upd.width = Math.max(minW, start.w + ddx);
        if (dx === -1) { const w = Math.max(minW, start.w - ddx); upd.width = w; upd.left = start.left + (start.w - w); }
        if (dy === 1) upd.height = Math.max(minH, start.h + ddy);
        if (dy === -1) { const hh = Math.max(minH, start.h - ddy); upd.height = hh; upd.top = Math.max(0, start.top + (start.h - hh)); }
        app.setPosition(upd);
      };
      const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); };
      h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
    });
    el.appendChild(h);
  }
}
Hooks.on("renderApplicationV2", app => { try { if (app.hasFrame !== false && app.options?.window?.frame !== false) tsvspAddEdges(app); } catch (err) { console.warn(`${MODULE} | edge resize`, err); } });

/* ------------------------------------------------------------------ "make the window bigger" warning
 * Foundry posts a permanent error when the browser window is under 1024 x 768 usable pixels
 * (ClientIssues#validateResolution, messages ERROR.RESOLUTION.Screen/Scale/Window) and posts it again
 * on every resize. New players should see it once; anyone who knows can tick "Don't show this
 * again" on the warning itself. The choice is per browser (client setting) and can be undone in
 * the module settings. */
const TSVSP_RES_KEYS = /^ERROR\.RESOLUTION\./;
const tsvspResT = (key, english) => { try { return game.i18n.has?.(key) ? game.i18n.localize(key) : english; } catch { return english; } };
let tsvspResDummy = 1e9;
function tsvspPatchNotifications() {
  const cls = foundry.applications?.ui?.Notifications ?? globalThis.ui?.notifications?.constructor;
  if (!cls?.prototype?.notify || cls.prototype.notify.__tsvsp) return;
  const original = cls.prototype.notify;
  const patched = function (message, type, options) {
    if (typeof message === "string" && TSVSP_RES_KEYS.test(message)) {
      let hidden = false;
      try { hidden = game.settings.get(MODULE, "hideResolutionWarning"); } catch {}
      // skipped: something with an id that removing does nothing to (Foundry removes it on resize)
      if (hidden) return {id: tsvspResDummy++, remove() {}, update() {}, active: false};
      const n = original.call(this, message, type, options);
      const addBox = (tries = 0) => {
        if (!n.element) return tries < 60 && requestAnimationFrame(() => addBox(tries + 1));
        if (n.element.querySelector(".tsvsp-res-hide")) return;
        const label = document.createElement("label");
        label.className = "tsvsp-res-hide";
        label.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:6px;font-size:0.9em;cursor:pointer";
        label.innerHTML = `<input type="checkbox" style="margin:0"> ${foundry.utils.escapeHTML(tsvspResT("TSVSP.ResolutionHide", "Don't show this again"))}`;
        label.querySelector("input").addEventListener("change", async ev => {
          ev.stopPropagation();
          if (ev.target.checked) { await game.settings.set(MODULE, "hideResolutionWarning", true); n.remove(); }
        });
        label.addEventListener("click", ev => ev.stopPropagation());     // the notification closes on any click
        n.element.appendChild(label);
      };
      addBox();
      return n;
    }
    return original.call(this, message, type, options);
  };
  patched.__tsvsp = true;
  cls.prototype.notify = patched;
}
tsvspPatchNotifications();
Hooks.once("init", () => {
  game.settings.register(MODULE, "hideResolutionWarning", {
    name: tsvspResT("TSVSP.ResolutionHideSetting.Name", "Hide the \"window too small\" warning"),
    hint: tsvspResT("TSVSP.ResolutionHideSetting.Hint", "Foundry warns when the browser window is smaller than 1024 x 768. Ticked, this browser stops showing that warning. Untick it to see the warning again."),
    scope: "client", config: true, type: Boolean, default: false
  });
  tsvspPatchNotifications();
});

/* ------------------------------------------------------------------ fewer spells to choose from
 * Black Flag's "learn spells" window (SpellcastingDialog) offers every spell of the right source and
 * circle from every compendium - 185 first-circle arcane spells here, Deep Magic twice over (our copy
 * and the Kobold Press module's). This:
 *   - keeps ONE copy of a spell that is in several packs: this world's own import first, then Black
 *     Flag's, then anything else (the system's own de-duplication kept whichever loaded last);
 *   - shows every book, the core books only, or only the extra books (client setting, "All" by default);
 *   - drops spells the GM hid (world setting, the "Spell list" menu);
 *   - adds role buttons (damage, healing, control, ...) so a player can ask for what they need.
 * Spell roles and books come from data/spells.json, made by foundry-import from every spell's text
 * and actions. A spell not in that file is shown and has no roles. */
const TSVSP_ROLES = [["damage", "Damage"], ["healing", "Healing"], ["control", "Control"], ["defence", "Defence"],
                     ["movement", "Movement"], ["summon", "Summoning"], ["boost", "Boost allies"], ["utility", "Utility"]];
let tsvspSpellData = null;
async function tsvspSpells() {
  if (tsvspSpellData) return tsvspSpellData;
  try { tsvspSpellData = await (await fetch(`modules/${MODULE}/data/spells.json`)).json(); }
  catch { tsvspSpellData = {}; }
  return tsvspSpellData;
}
/* The bender's elements also take every fitting spell from the whole library, not only the book's
 * short lists: data/element-spells.json ({air: [names], earth: [...], ...}), sorted from every
 * spell's text. Read once at ready; an "Elemental Affinity: X" feature (or a flag element: "x")
 * adds element X's names to the class list it is for. */
let tsvspElementSpells = {};
// and a class's own list grows the same way: data/class-spells.json ({tamer: [names]})
let tsvspClassSpells = {};
// spells that came without a source of magic (most of the Kobold Press module, a few of ours):
// data/spell-sources.json gives each one, so classes that learn by source can find them
let tsvspExtraSources = {};
Hooks.once("ready", async () => {
  try { tsvspExtraSources = await (await fetch(`modules/${MODULE}/data/spell-sources.json`)).json(); }
  catch { tsvspExtraSources = {}; }
  try { tsvspElementSpells = await (await fetch(`modules/${MODULE}/data/element-spells.json`)).json(); }
  catch { tsvspElementSpells = {}; }
  try { tsvspClassSpells = await (await fetch(`modules/${MODULE}/data/class-spells.json`)).json(); }
  catch { tsvspClassSpells = {}; }
});
const tsvspElementOf = it => String(it.getFlag?.(MODULE, "element") ?? it.name?.match(/Elemental Affinity:\s*(\w+)/i)?.[1] ?? "").toLowerCase();
const tsvspPackRank = col => col.startsWith("tselverse-art.") ? 0 : col.startsWith("black-flag.") ? 1 : 2;
const tsvspHidden = () => { try { return new Set(game.settings.get(MODULE, "hiddenSpells") ?? []); } catch { return new Set(); } };
// one name per book ("ToH" and "Tome of Heroes" are the same book) - tselverse-common's list
const tsvspBookName = b => game.modules.get("tselverse-common")?.api?.bookName?.(b) ?? b;

Hooks.once("init", () => {
  game.settings.register(MODULE, "hiddenSpells", {scope: "world", config: false, type: Array, default: []});
  game.settings.register(MODULE, "spellBooks", {
    name: tsvspResT("TSVSP.SpellBooks.Name", "Spells to choose from"),
    hint: tsvspResT("TSVSP.SpellBooks.Hint", "When learning spells: every book in this world, only the core books (Black Flag and the Tales of the Valiant Player's Guides), or only the other books. Also switchable in the spell window itself."),
    scope: "client", config: true, type: String, default: "all",
    choices: {all: tsvspResT("TSVSP.SpellBooks.All", "All books"), core: tsvspResT("TSVSP.SpellBooks.Core", "Core books"), more: tsvspResT("TSVSP.SpellBooks.More", "More books")}
  });
  game.settings.registerMenu(MODULE, "spellListMenu", {
    name: tsvspResT("TSVSP.SpellList.Name", "Spell list"), label: tsvspResT("TSVSP.SpellList.Label", "Choose which spells players see"),
    hint: tsvspResT("TSVSP.SpellList.Hint", "Hide spells from the learn-spells window (they stay in the compendiums). Spells the importer thinks are weak are flagged."),
    icon: "fa-solid fa-wand-sparkles", type: TsvspSpellListApp, restricted: true
  });
});

/* A class whose book lets the player choose Intelligence, Wisdom or Charisma to cast with (the
 * tamer, the bender - flags.tselverse-spells.castWithKeyAbility on the class) casts with the ability
 * picked in the class's 1st-level "Spellcasting Ability" step (a feature flagged castAbility). Black
 * Flag fixes one ability per class and never records a chosen key ability, so the getter is
 * wrapped; with nothing picked yet the class's configured ability applies. */
Hooks.once("init", () => {
  const cfg = CONFIG.BlackFlag?._advancementTypes?.spellcasting?.documentClass?.metadata?.dataModels?.configuration;
  const desc = cfg && Object.getOwnPropertyDescriptor(cfg.prototype, "spellcastingAbility");
  if (!desc?.get) return console.warn(`${MODULE} | spellcasting configuration not found - key-ability casting off`);
  Object.defineProperty(cfg.prototype, "spellcastingAbility", {configurable: true, get() {
    let item = this.parent?.item;
    if (item?.type === "subclass" && item.isEmbedded) item = item.actor.system.progression?.classes?.[item.system.identifier.class]?.document;
    if (item?.getFlag?.(MODULE, "castWithKeyAbility") && item.actor) {
      // the ability the character chose in the class's 1st-level Spellcasting Ability step
      const cls = item.identifier ?? item.system?.identifier?.value;
      const pick = item.actor.items.find(i => i.getFlag?.(MODULE, "castAbilityFor") === cls);
      const ab = pick?.getFlag(MODULE, "castAbility");
      if (ab) return ab;
    }
    return desc.get.call(this);
  }});
});

/* A class that knows its whole list (cleric, druid...) is handed every spell of a new circle at
 * once, and Black Flag reads them from the compendiums one at a time - with a big library that is
 * most of a minute for a new 1st-level cleric. Read them pack by pack in one go first; the
 * one-at-a-time reads then come straight from memory. */
Hooks.once("init", () => {
  const cls = CONFIG.BlackFlag?._advancementTypes?.spellcasting?.documentClass;
  const original = cls?.prototype?.createSpells;
  if (!original) return console.warn(`${MODULE} | spellcasting createSpells not found - spells load one at a time`);
  cls.prototype.createSpells = async function (toAdd, ...rest) {
    try {
      const byPack = {};
      for (const {uuid} of toAdd ?? []) {
        const r = uuid && foundry.utils.parseUuid(uuid);
        const pack = r?.collection instanceof foundry.documents.collections.CompendiumCollection ? r.collection : null;
        if (pack && r.id && !pack.has(r.id)) (byPack[pack.collection] ??= []).push(r.id);
      }
      await Promise.all(Object.entries(byPack).map(([k, ids]) => ids.length > 1 ? game.packs.get(k).getDocuments({_id__in: ids}) : null));
    } catch (err) { console.warn(`${MODULE} | reading spells in one go failed - loading one at a time`, err); }
    return original.call(this, toAdd, ...rest);
  };
});

Hooks.once("ready", () => {
  const find = (o, seen = new Set()) => { if (!o || typeof o !== "object" || seen.has(o)) return null; seen.add(o);
    if (o.SpellcastingDialog) return o.SpellcastingDialog; for (const v of Object.values(o)) { const r = find(v, seen); if (r) return r; } return null; };
  const cls = find(globalThis.BlackFlag?.applications);
  if (!cls?.prototype?._prepareContext) return console.warn(`${MODULE} | SpellcastingDialog not found - spell filters off`);
  // A class with its own spell list (flags.tselverse-spells.spellList on the class item - the
  // tamer's, read from its book by foundry-import) offers exactly those spells: the "source of
  // magic" restriction Black Flag adds becomes "is on the list". Names are compared by letters
  // only, so a spell from any pack, under either apostrophe, matches.
  const keyOf = n => String(n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const filtersOriginal = cls.prototype.prepareFilters;
  if (filtersOriginal) cls.prototype.prepareFilters = function (type) {
    const filters = filtersOriginal.call(this, type);
    if (!filters) return filters;           // a slot type Black Flag has no rule for: nothing to offer
    // the class's own list, plus the lists its chosen features add for it (the bender's
    // Elemental Affinity: each element brings its spells)
    const item = this.advancement?.item;
    const cls = item?.identifier ?? item?.system?.identifier?.value;
    const list = [...(item?.getFlag?.(MODULE, "spellList") ?? [])];
    if (list.length) list.push(...(tsvspClassSpells[cls] ?? []));
    for (const it of item?.actor?.items ?? [])
      if (it !== item && it.getFlag?.(MODULE, "spellListFor") === cls) {
        list.push(...(it.getFlag(MODULE, "spellList") ?? []));
        list.push(...(tsvspElementSpells[tsvspElementOf(it)] ?? []));
      }
    if (!list.length) { this._tsvspList = null; return filters; }
    const names = new Set(list.map(keyOf));
    this._tsvspList = names;
    return filters.filter(f => f.k !== "system.source");
  };
  const original = cls.prototype._prepareContext;
  cls.prototype._prepareContext = async function (options) {
    // every copy of every spell, then one per identifier, the preferred pack winning
    if (!this._tsvspAll) {
      const fields = ["system.source", "system.school", "system.circle.base", "system.tags", "system.identifier.value", "system.container"];
      this._tsvspAll = Promise.all(game.packs.filter(p => p.documentName === "Item" && p.visible).map(p => p.getIndex({fields})))
        .then(lists => {
          const best = new Map();
          for (const e of lists.flatMap(l => [...l])) {
            if (e.type !== "spell" || e.system?.container) continue;
            const have = e.system?.source; const n = Array.isArray(have) ? have.length : have ? [...(have.value ?? have)].length : 0;
            const extra = !n && tsvspExtraSources[keyOf(e.name)];
            if (extra) foundry.utils.setProperty(e, "system.source", [...extra]);
            const id = e.system?.identifier?.value || e.name.slugify({strict: true});
            foundry.utils.setProperty(e, "system.identifier.value", id);
            const cur = best.get(id);
            if (!cur || tsvspPackRank(e.uuid.split(".").slice(1, 3).join(".")) < tsvspPackRank(cur.uuid.split(".").slice(1, 3).join("."))) best.set(id, e);
          }
          return [...best.values()].sort((a, b) => a.name.localeCompare(b.name)).reduce((m, s) => m.set(s.uuid, s), new foundry.utils.Collection());
        });
      this.allSpells = this._tsvspAll;
    }
    const context = await original.call(this, options);
    if (Array.isArray(context.spells)) {
      const data = await tsvspSpells(), hidden = tsvspHidden();
      let books = "all"; try { books = this._tsvspBooks ?? game.settings.get(MODULE, "spellBooks"); } catch {}
      const role = this._tsvspRole ?? "";
      const book = this._tsvspBook ?? "";
      const circle = this._tsvspCircle ?? null;
      const before = context.spells;
      // the circles on offer, so the circle buttons only name ones there are spells for
      const circles = [...new Set(before.map(s => s.system?.circle?.base).filter(n => Number.isInteger(n)))].sort((a, b) => a - b);
      const bookOf = s => tsvspBookName(data[s.uuid]?.book ?? s.system?.description?.source?.book ?? "") || "";
      // the books on offer (with how many each has after the other filters), for the Book menu
      const bookCounts = new Map();
      const kept = before.filter(s => {
        if (s.selected) return true;
        const info = data[s.uuid];
        if (hidden.has(s.system?.identifier?.value) || (info && hidden.has(info.id))) return false;
        if (this._tsvspList && !this._tsvspList.has(keyOf(s.name))) return false;
        if (books === "core" && info && !info.core) return false;
        if (books === "more" && info?.core) return false;
        if (role && !(info?.r ?? []).includes(role)) return false;
        if (circle !== null && s.system?.circle?.base !== circle) return false;
        const b = bookOf(s);
        bookCounts.set(b, (bookCounts.get(b) ?? 0) + 1);
        if (book && b !== book) return false;
        return true;
      });
      context.spells = kept;
      this._tsvspCounts = {shown: kept.length, total: before.length, books, role, circle, circles, book,
        bookList: [...bookCounts].sort((a, b) => a[0].localeCompare(b[0], game.i18n.lang))};
    }
    return context;
  };
});

Hooks.on("renderSpellcastingDialog", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  const part = root?.querySelector('[data-application-part="spells"]');
  if (!part || !app._tsvspCounts) return;
  part.querySelector(":scope > .tsvsp-spellbar")?.remove();
  const c = app._tsvspCounts;
  const bar = document.createElement("div");
  bar.className = "tsvsp-spellbar";
  const btn = (label, on, tip, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.className = on ? "on" : ""; if (tip) b.dataset.tooltip = tip; b.addEventListener("click", ev => { ev.preventDefault(); fn(); app.render(); }); return b; };
  const books = document.createElement("span"); books.className = "tsvsp-group";
  books.append(btn(tsvspResT("TSVSP.SpellBooks.AllShort", "All"), c.books === "all", "Every book in this world", () => { app._tsvspBooks = "all"; }),
               btn(tsvspResT("TSVSP.SpellBooks.Core", "Core books"), c.books === "core", "Black Flag and the Tales of the Valiant Player's Guides only", () => { app._tsvspBooks = "core"; }),
               btn(tsvspResT("TSVSP.SpellBooks.More", "More books"), c.books === "more", "Only the other books: Deep Magic, Tome of Heroes, Ryoko's...", () => { app._tsvspBooks = "more"; }));
  const roles = document.createElement("span"); roles.className = "tsvsp-group";
  roles.append(btn(tsvspResT("TSVSP.Roles.Any", "Any"), !c.role, "", () => { app._tsvspRole = ""; }));
  for (const [r, label] of TSVSP_ROLES) roles.append(btn(tsvspResT(`TSVSP.Roles.${r}`, label), c.role === r, "", () => { app._tsvspRole = c.role === r ? "" : r; }));
  const circles = document.createElement("span"); circles.className = "tsvsp-group";
  const ord = n => n === 0 ? tsvspResT("TSVSP.Circle.Cantrip", "Cantrips")
    : `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
  if (c.circles.length === 1) {
    // only one circle on offer: say so, instead of buttons with nothing to choose between
    const note = document.createElement("span"); note.className = "tsvsp-circle-note";
    note.textContent = c.circles[0] === 0 ? tsvspResT("TSVSP.Circle.AllCantrips", "All cantrips")
      : tsvspResT("TSVSP.Circle.AllOne", "All {n} circle").replace("{n}", ord(c.circles[0]));
    note.dataset.tooltip = "Every spell you can pick for this slot is this circle. Circle buttons appear once you can choose from more than one.";
    circles.append(note);
  }
  if (c.circles.length > 1) {
    circles.append(btn(tsvspResT("TSVSP.Circle.Any", "Any circle"), c.circle === null, "", () => { app._tsvspCircle = null; }));
    for (const n of c.circles) circles.append(btn(ord(n), c.circle === n, n ? `${ord(n)}-circle spells only` : "", () => { app._tsvspCircle = c.circle === n ? null : n; }));
  }
  // one book: a menu of the books the other filters leave, with how many spells each has
  let bookMenu = null;
  if (c.bookList.length > 1 || c.book) {
    bookMenu = document.createElement("select");
    bookMenu.className = "tsvsp-book";
    const all = document.createElement("option"); all.value = ""; all.textContent = tsvspResT("TSVSP.Picker.AllBooks", "Book: all");
    bookMenu.append(all);
    for (const [b, n] of c.bookList) {
      const o = document.createElement("option"); o.value = b; o.textContent = `${b || tsvspResT("TSVSP.Picker.NoBook", "(no book)")} (${n})`;
      bookMenu.append(o);
    }
    bookMenu.value = c.book;
    bookMenu.addEventListener("change", () => { app._tsvspBook = bookMenu.value; app.render(); });
  }
  const count = document.createElement("span"); count.className = "tsvsp-count";
  count.textContent = `${c.shown} of ${c.total}`;
  bar.append(...[books, bookMenu, roles, circles, count].filter(Boolean));
  part.prepend(bar);
});

/* The GM's spell list: hide spells from players (world setting), flagged weak ones marked. */
class TsvspSpellListApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {id: "tsvsp-spell-list", classes: ["tsvsp-spell-list"], tag: "div",
    window: {title: "Spell list", resizable: true}, position: {width: 760, height: 720}};
  static PARTS = {main: {template: `modules/${MODULE}/templates/spell-list.hbs`}};
  q = ""; circle = ""; only = "all"; book = "";
  async _prepareContext() {
    const data = await tsvspSpells(), hidden = tsvspHidden();
    const seen = new Map();
    for (const [uuid, s] of Object.entries(data)) {        // one row per spell, the preferred copy
      const cur = seen.get(s.id);
      if (!cur || tsvspPackRank(s.pack) < tsvspPackRank(cur.pack)) seen.set(s.id, {...s, uuid, book: tsvspBookName(s.book)});
    }
    let rows = [...seen.values()];
    const books = [...new Set(rows.map(r => r.book))].sort();
    const q = this.q.toLowerCase();
    rows = rows.filter(r => (!q || r.n.toLowerCase().includes(q)) && (this.circle === "" || String(r.c) === this.circle)
      && (!this.book || r.book === this.book)
      && (this.only === "all" || (this.only === "weak" && r.weak) || (this.only === "hidden" && hidden.has(r.id)) || (this.only === "shown" && !hidden.has(r.id))));
    rows.sort((a, b) => (a.c ?? 0) - (b.c ?? 0) || a.n.localeCompare(b.n));
    const total = rows.length;
    const circles = [{v: "", label: "Any circle"}, {v: "0", label: "Cantrips"}, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => ({v: String(c), label: `Circle ${c}`}))]
      .map(c => ({...c, sel: c.v === this.circle}));
    return {q: this.q, circle: this.circle, circles, only: this.only, book: this.book, books, total, hiddenCount: hidden.size,
      rows: rows.slice(0, 400).map(r => ({...r, hidden: hidden.has(r.id), circleLabel: r.c === 0 ? "Cantrip" : r.c ?? "?", roles: (r.r ?? []).join(", ")})),
      more: total > 400 ? total - 400 : 0};
  }
  _onRender() {
    const el = this.element;
    const reRender = foundry.utils.debounce(() => this.render(), 250);
    el.querySelector('[name="q"]')?.addEventListener("input", ev => { this.q = ev.target.value; reRender(); });
    for (const k of ["circle", "only", "book"]) el.querySelector(`[name="${k}"]`)?.addEventListener("change", ev => { this[k] = ev.target.value; this.render(); });
    el.querySelectorAll("input[data-hide]").forEach(cb => cb.addEventListener("change", async ev => {
      const set = tsvspHidden(); ev.target.checked ? set.add(ev.target.dataset.hide) : set.delete(ev.target.dataset.hide);
      await game.settings.set(MODULE, "hiddenSpells", [...set]);
      const n = el.querySelector(".tsvsp-hidden-count"); if (n) n.textContent = String(set.size);
    }));
    el.querySelectorAll("a[data-uuid]").forEach(a => a.addEventListener("click", async ev => { ev.preventDefault(); (await fromUuid(a.dataset.uuid))?.sheet?.render(true); }));
    const q = el.querySelector('[name="q"]'); if (q && this.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
}

/* ------------------------------------------------------------------ duplicate spells out of sight
 * The same spell in several packs (our Deep Magic import and the Kobold Press module's, a Player's
 * Guide reprint of a Black Flag spell) showed twice in the compendium sidebar's search, in each
 * pack's own window and in the @-link suggestions. The copy the spell window keeps (tsvspPackRank:
 * this world's import, then Black Flag, then others) stays; the others are hidden from those lists
 * only - they stay in their packs and anything already linked to them still works. A client
 * setting shows them again. */
let tsvspDupeSet = null;
async function tsvspDupes() {
  if (tsvspDupeSet) return tsvspDupeSet;
  const data = await tsvspSpells(), best = new Map();
  for (const [uuid, s] of Object.entries(data)) {
    const cur = best.get(s.id);
    if (!cur || tsvspPackRank(s.pack) < tsvspPackRank(cur.pack)) best.set(s.id, {pack: s.pack, uuid});
  }
  const keep = new Set([...best.values()].map(b => b.uuid));
  return tsvspDupeSet = new Set(Object.keys(data).filter(u => !keep.has(u)));
}
const tsvspHideDupes = () => { try { return game.settings.get(MODULE, "hideDuplicateSpells"); } catch { return true; } };

Hooks.once("init", () => {
  game.settings.register(MODULE, "hideDuplicateSpells", {
    name: tsvspResT("TSVSP.HideDupes.Name", "Hide duplicate spells"),
    hint: tsvspResT("TSVSP.HideDupes.Hint", "A spell that is in more than one compendium is listed once in the compendium search, the compendium windows and link suggestions (this world's own copy first, then Black Flag's). Untick to see every copy."),
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => { for (const app of foundry.applications.instances.values()) if (app.collection?.documentName === "Item" && app.collection.metadata) app.render(); }
  });
  // the sidebar's compendium search and @-link suggestions both ask the document index
  const DI = foundry.helpers?.DocumentIndex ?? game.documentIndex?.constructor;
  const lookup = DI?.prototype?.lookup;
  if (!lookup) return console.warn(`${MODULE} | DocumentIndex.lookup not found - duplicate spells stay in search`);
  DI.prototype.lookup = function (query, options = {}) {
    const dupes = tsvspDupeSet;
    if (!dupes?.size || !tsvspHideDupes()) return lookup.call(this, query, options);
    const inner = options.filterEntries;
    return lookup.call(this, query, {...options, filterEntries: e => !dupes.has(e.uuid) && (inner ? inner(e) : true)});
  };
});
Hooks.once("ready", () => tsvspDupes());

Hooks.on("renderCompendium", async (app, html) => {
  const pack = app.collection;
  if (pack?.documentName !== "Item") return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  const dupes = await tsvspDupes(), on = tsvspHideDupes();
  let n = 0;
  for (const li of root.querySelectorAll("li[data-entry-id]")) {
    const hide = on && dupes.has(`Compendium.${pack.collection}.Item.${li.dataset.entryId}`);
    li.classList.toggle("tsvsp-dupe", hide); if (hide) n++;
  }
  root.querySelector(".tsvsp-dupe-note")?.remove();
  if (!n) return;
  const note = document.createElement("p");
  note.className = "tsvsp-dupe-note";
  note.textContent = tsvspResT("TSVSP.HideDupes.Note", "Hidden here: {n}, because another compendium has the same spell (setting: Hide duplicate spells)").replace("{n}", n);
  (root.querySelector(".directory-list")?.parentElement ?? root.querySelector(".window-content") ?? root).append(note);
});

/* The Compendium Browser module (compendium-browser-bf) reads every pack's index itself, so it listed
 * both copies of a spell too. Its result rows carry data-uuid and are added in batches as the list
 * scrolls; the duplicates are hidden as they appear (same rule and setting as above). */
Hooks.on("renderApplicationV2", async (app, element) => {
  const root = element instanceof HTMLElement ? element : app.element;
  if (!root || app.id !== "compendium-browser-bf" || root.dataset.tsvspDupeWatch) return;
  root.dataset.tsvspDupeWatch = "1";
  const dupes = await tsvspDupes();
  const sweep = () => {
    if (!tsvspHideDupes()) return;
    for (const el of root.querySelectorAll("[data-uuid]:not(.tsvsp-checked)")) {
      el.classList.add("tsvsp-checked");
      // it writes the short form, "Compendium.<pack>.<id>", without the document type
      const u = el.dataset.uuid.replace(/^(Compendium\.[^.]+\.[^.]+)\.(?!Item\.)/, "$1.Item.");
      if (dupes.has(u)) el.classList.add("tsvsp-dupe");
    }
  };
  sweep();
  new MutationObserver(sweep).observe(root, {childList: true, subtree: true});
});

/* Spells a feature hands you (a subclass's bonus spells, "always prepared and they don't count
 * against the number of spells you can prepare") come in through a grant-spells step, not the
 * class's spellcasting step - Black Flag still counts them against the class's spells known, so a
 * level-3 earth bender with the Ferocity Magic Missile read 5 of 4. Count only the picks. */
Hooks.once("init", () => {
  const Model = CONFIG.Item?.dataModels?.spell;
  const original = Model?.prototype?.prepareSpellStats;
  if (!original) return console.warn(`${MODULE} | spell stats not found - granted spells still count as picks`);
  Model.prototype.prepareSpellStats = function (...args) {
    const out = original.apply(this, args);
    try {
      const item = this.parent, actor = item?.actor;
      const [srcId, advId] = String(item?.getFlag?.("black-flag", "advancementOrigin") ?? "").split(".");
      const adv = srcId && advId ? actor?.items.get(srcId)?.system?.advancement?.get?.(advId) : null;
      const ident = item?.getFlag?.("black-flag", "relationship.origin")?.identifier;
      const origin = ident && actor?.system?.spellcasting?.origins?.[ident];
      if (adv && adv.type !== "spellcasting" && origin) {
        const kind = this.circle?.base === 0 ? "cantrips" : this.tags?.has?.("ritual") ? "rituals" : "spells";
        if (origin[kind]?.value > 0) origin[kind].value -= 1;
      }
    } catch (err) { console.warn(`${MODULE} | granted-spell count`, err); }
    return out;
  };
});

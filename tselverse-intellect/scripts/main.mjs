/**
 * Intelligence Proficiencies - The Dungeon Coach's house rule, for Black Flag.
 *
 *   "When creating your character, you gain a number of additional proficiencies equal to
 *    your Intelligence Modifier, these can be skills, tools, weapons, or even languages."
 *
 * and its Intellect Points variant, where the modifier buys points instead of proficiencies:
 * one point for a tool, weapon or language, two for a skill.
 *
 * HOW IT APPLIES. Black Flag already has a pipeline for "this proficiency comes from
 * somewhere else": `BlackFlagActor#applyAdvancementEffects` collects `{key, type, value}`
 * changes from every advancement and runs them through `ActiveEffect.applyChange` during
 * data preparation. Class and background grants arrive that way, and so do these picks -
 * `applyAdvancementEffects` is wrapped, not replaced, and the picks are appended after the
 * system's own. Nothing is written into `system.proficiencies`, so a proficiency the
 * character already has from their class is never overwritten and un-picking one here can
 * never take away a proficiency this module did not grant.
 *
 * The keys, the labels, the option lists and the update paths all come from the system's own
 * trait helpers (`game.blackFlag.utils.Trait`), the same ones the Trait advancement uses, so
 * anything the system knows how to grant can be picked here.
 *
 * WHY THE BUDGET IS LIVE. The rule says a character whose Intelligence modifier permanently
 * increases gains another proficiency. The budget is read from the character's Intelligence
 * every time it is needed rather than stored, so an ability score increase simply opens
 * another pick, and a drain closes one (the picks stay, and the sheet says it is over).
 */

const MODULE = "tselverse-intellect";
const _loc = (k, d) => game.i18n.format(k, d ?? {});

/** The four the rule names: "skills, tools, weapons, or even languages". */
const TRAITS = ["skills", "tools", "weapons", "languages"];

const Trait = () => game.blackFlag?.utils?.Trait;
const setting = (key, fallback) => { try { return game.settings.get(MODULE, key); } catch { return fallback; } };

/* ------------------------------------------------------------------ setup */

Hooks.once("init", () => {
  game.settings.register(MODULE, "mode", {
    name: "TSVIP.Settings.Mode.Name", hint: "TSVIP.Settings.Mode.Hint",
    scope: "world", config: true, type: String, default: "flat",
    choices: {flat: "TSVIP.Settings.Mode.Flat", points: "TSVIP.Settings.Mode.Points"},
    onChange: () => { for (const app of foundry.applications.instances.values()) app.render?.(false); }
  });
  game.settings.register(MODULE, "minimum", {
    name: "TSVIP.Settings.Minimum.Name", hint: "TSVIP.Settings.Minimum.Hint",
    scope: "world", config: true, type: Number, default: 0
  });

  // The system sets CONFIG.Actor.documentClass in its own init, which runs first: the system
  // is loaded before any module, and both register with Hooks.once("init").
  const cls = CONFIG.Actor.documentClass;
  if (!cls?.prototype?.applyAdvancementEffects) {
    console.error(`${MODULE} | Black Flag's applyAdvancementEffects is missing - picks will not apply`);
    return;
  }
  const wrapped = cls.prototype.applyAdvancementEffects;
  cls.prototype.applyAdvancementEffects = function (...args) {
    const result = wrapped.apply(this, args);
    try { applyPicks(this); }
    catch (err) { console.error(`${MODULE} | applying Intelligence proficiencies failed`, err); }
    return result;
  };
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = {budget, spent, picksOf, setPicks, openPicker, optionsFor, costOf};
});

/* ------------------------------------------------------------------ the budget */

/** The character's Intelligence modifier, from prepared data when there is any. */
function intMod(actor) {
  const abilities = actor?.system?.abilities ?? {};
  const int = abilities.intelligence ?? abilities.int;
  if (Number.isNumeric(int?.mod)) return int.mod;
  const score = int?.value ?? actor?.system?._source?.abilities?.intelligence?.value;
  return Number.isNumeric(score) ? Math.floor((score - 10) / 2) : 0;
}

/** How many proficiencies (or Intellect Points) this character has to spend. */
function budget(actor) {
  return Math.max(setting("minimum", 0), intMod(actor));
}

/** The rule as written charges one for anything; the variant charges two for a skill. */
function costOf(key) {
  return setting("mode", "flat") === "points" && key.startsWith("skills:") ? 2 : 1;
}

const picksOf = actor => [...(actor?.getFlag(MODULE, "picks") ?? [])];
const spent = actor => picksOf(actor).reduce((n, key) => n + costOf(key), 0);

async function setPicks(actor, picks) {
  const sorted = [...new Set(picks)].sort();
  return actor.setFlag(MODULE, "picks", sorted);
}

/* ------------------------------------------------------------------ applying */

/** The same shape the Trait advancement's `changes()` returns, for the same pipeline. */
function pickChanges(actor) {
  const T = Trait();
  if (!T) return [];
  const changes = [];
  for (const key of picksOf(actor)) {
    const keyPath = T.changeKeyPath(key);
    if (!keyPath) continue;
    const existing = foundry.utils.getProperty(actor, keyPath);
    if (foundry.utils.getType(existing) === "Set") changes.push({key: keyPath, type: "add", value: key.split(":").pop()});
    else changes.push({key: keyPath, type: "upgrade", value: 1});
  }
  return changes;
}

function applyPicks(actor) {
  if (actor.type !== "pc") return;
  const changes = pickChanges(actor);
  if (!changes.length) return;
  const AE = CONFIG.ActiveEffect.documentClass;
  const overrides = {};
  for (const change of changes) {
    change.priority ??= CONST.ACTIVE_EFFECT_CHANGE_TYPES[change.type] ?? 0;
    Object.assign(overrides, AE.applyChange(actor, change) ?? {});
  }
  // the system stashes what advancement changed here, for the sheet's "set elsewhere" marks
  actor.advancementOverrides = foundry.utils.mergeObject(
    actor.advancementOverrides ?? {}, foundry.utils.expandObject(overrides), {inplace: false});
}

/* ------------------------------------------------------------------ the options */

/**
 * Every pickable key for one trait, with its label, cost, and whether the character already
 * has it. `Trait.choices` builds the same tree the system's own trait pickers show, and
 * `.set` flattens it to the leaves; `Trait.actorValues` says what is already proficient.
 */
/** "weapons:simple:pistol" -> ["weapons:simple"]: the categories a key sits in (the trait name itself excluded). */
const ancestorsOf = key => { const p = key.split(":"); return p.slice(2).map((_, i) => p.slice(0, i + 2).join(":")); };

function optionsFor(actor, trait) {
  const T = Trait();
  if (!T) return [];
  const tree = T.choices(trait, {prefixed: true});
  const held = T.actorValues(actor, trait) ?? {};
  const mine = new Set(picksOf(actor));
  const rows = [];
  for (const key of tree.set) {
    if (key.endsWith(":ALL") || key.endsWith(":*") || key.endsWith("!")) continue;
    const entry = tree.get(key);
    if (entry && entry.selectable === false) continue;
    rows.push({
      key,
      label: T.keyLabel(key),
      cost: costOf(key),
      picked: mine.has(key),
      // a proficiency this module granted reads back as held, so it is only "already had it"
      // when something else gave it
      // (or the whole category above it: Simple weapons cover the pistol - 2026-10-14)
      alreadyHad: !mine.has(key) && ((held[key] ?? 0) > 0 || ancestorsOf(key).some(a => (held[a] ?? 0) > 0 && !mine.has(a)))
    });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  return rows;
}

/* ------------------------------------------------------------------ the picker */

async function openPicker(actor) {
  const T = Trait();
  if (!T) return ui.notifications.error(_loc("TSVIP.Error.NoSystem"));

  const state = {picks: new Set(picksOf(actor))};
  const cost = key => costOf(key);
  const total = () => [...state.picks].reduce((n, k) => n + cost(k), 0);

  const content = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "tsvip-picker";
  content.append(inner);

  const groups = TRAITS.map(trait => ({trait, label: T.traitLabel(trait, 2), rows: optionsFor(actor, trait)}))
    .filter(g => g.rows.length);

  const esc = foundry.utils.escapeHTML;
  inner.innerHTML = `
    <header class="tsvip-head">
      <div class="tsvip-budget"><span class="tsvip-spent"></span></div>
      <input type="search" class="tsvip-search" placeholder="${esc(_loc("TSVIP.Picker.Search"))}">
    </header>
    <p class="tsvip-hint">${esc(_loc(setting("mode", "flat") === "points"
      ? "TSVIP.Picker.HintPoints" : "TSVIP.Picker.HintFlat"))}</p>
    <div class="tsvip-groups">
      ${groups.map(g => `
        <section class="tsvip-group" data-trait="${esc(g.trait)}">
          <h4>${esc(g.label)}</h4>
          <ul>
            ${g.rows.map(r => `
              <li data-key="${esc(r.key)}" data-label="${esc(r.label.toLowerCase())}"
                  class="${r.alreadyHad ? "tsvip-had" : ""}">
                <label>
                  <input type="checkbox" value="${esc(r.key)}"
                         ${r.picked ? "checked" : ""} ${r.alreadyHad ? "disabled" : ""}>
                  <span class="tsvip-label">${esc(r.label)}</span>
                  ${r.cost > 1 ? `<span class="tsvip-cost">${r.cost}</span>` : ""}
                  ${r.alreadyHad ? `<span class="tsvip-note">${esc(_loc("TSVIP.Picker.Already"))}</span>` : ""}
                </label>
              </li>`).join("")}
          </ul>
        </section>`).join("")}
    </div>`;

  const wire = root => {
    if (root.dataset.tsvipWired) return;
    root.dataset.tsvipWired = "1";
    const spentEl = root.querySelector(".tsvip-spent");
    const search = root.querySelector(".tsvip-search");
    const boxes = [...root.querySelectorAll('.tsvip-picker input[type="checkbox"]')];

    const refresh = () => {
      const max = budget(actor);
      const used = total();
      spentEl.textContent = _loc(setting("mode", "flat") === "points"
        ? "TSVIP.Picker.SpentPoints" : "TSVIP.Picker.Spent", {used, max});
      spentEl.classList.toggle("tsvip-over", used > max);
      for (const box of boxes) {
        if (box.disabled && !box.checked && !box.dataset.tsvipBudget) continue;   // already proficient
        const key = box.value;
        const tooExpensive = !state.picks.has(key) && used + cost(key) > max;
        box.disabled = tooExpensive;
        box.dataset.tsvipBudget = tooExpensive ? "1" : "";
        box.closest("li").classList.toggle("tsvip-unaffordable", tooExpensive);
      }
    };

    for (const box of boxes) box.addEventListener("change", () => {
      if (box.checked) state.picks.add(box.value); else state.picks.delete(box.value);
      refresh();
    });

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const li of root.querySelectorAll(".tsvip-group li"))
        li.style.display = !q || li.dataset.label.includes(q) ? "" : "none";
      for (const section of root.querySelectorAll(".tsvip-group"))
        section.style.display = [...section.querySelectorAll("li")].some(li => li.style.display !== "none") ? "" : "none";
    });
    search.addEventListener("keydown", e => { if (e.key === "Escape") { search.value = ""; search.dispatchEvent(new Event("input")); } });

    refresh();
  };

  return foundry.applications.api.DialogV2.wait({
    window: {title: _loc("TSVIP.Picker.Title", {name: actor.name}), icon: "fa-solid fa-brain"},
    classes: ["tselverse-intellect", "tsvip-dialog"],
    position: {width: 620, height: 700},
    content,
    render: (event, dialog) => wire(dialog.element),
    buttons: [
      {
        action: "save", label: _loc("TSVIP.Picker.Save"), icon: "fa-solid fa-check", default: true,
        callback: () => setPicks(actor, [...state.picks])
      },
      {action: "cancel", label: _loc("TSVIP.Picker.Cancel"), icon: "fa-solid fa-xmark"}
    ],
    rejectClose: false
  });
}

/* ------------------------------------------------------------------ the sheet
 * Two places, because the rule is a character-creation rule that keeps mattering:
 *   - the Progression view, beside Lineage / Heritage / Background / Class, where the
 *     character is built. Abilities are assigned in that same view, so the budget appears
 *     the moment Intelligence does.
 *   - the normal sheet's left column, under Vehicles, where the proficiencies it grants are
 *     already listed.
 * Both are rendered by the same sheet, so one hook handles them; each is injected only if
 * its own landmark is in the DOM. */

const OVER = used => used > 0 ? " tsvip-over" : "";

function sheetSummary(actor) {
  const T = Trait();
  return {
    max: budget(actor), used: spent(actor), picks: picksOf(actor),
    label: k => foundry.utils.escapeHTML(T?.keyLabel(k) ?? k)
  };
}

/** The Progression view's row, built like the system's own `.typeControl` fieldsets. */
function progressionFieldset(actor) {
  const {max, used, picks} = sheetSummary(actor);
  const esc = foundry.utils.escapeHTML;
  const box = document.createElement("fieldset");
  box.className = "tsvip tsvip-progression";
  const state = used > max ? _loc("TSVIP.Sheet.Over", {used, max})
    : used < max ? _loc("TSVIP.Sheet.Remaining", {n: max - used})
    : max === 0 ? _loc("TSVIP.Sheet.None")
    : _loc("TSVIP.Sheet.Done", {n: used});
  box.innerHTML = `
    <legend>${esc(_loc("TSVIP.Label"))}</legend>
    <figure class="icon"><i class="fa-solid fa-brain" inert></i></figure>
    <span>
      <button type="button" class="link-button tsvip-open" data-tooltip="${esc(_loc("TSVIP.Sheet.Tooltip"))}">${esc(state)}</button>
      ${picks.length ? `<span class="subclass tsvip-picks">${picks.map(k =>
        esc(Trait()?.keyLabel(k) ?? k)).join(", ")}</span>` : ""}
    </span>
    <span class="levels tsvip-count${used > max ? " tsvip-over" : ""}">${used}/${max}</span>`;
  return box;
}

/** The main tab's fieldset, in the column that already lists skills, tools and vehicles. */
function mainFieldset(actor) {
  const {max, used, picks, label} = sheetSummary(actor);
  const esc = foundry.utils.escapeHTML;
  const box = document.createElement("fieldset");
  box.className = "tsvip tsvip-main";
  box.innerHTML = `
    <legend>
      ${esc(_loc("TSVIP.Label"))}
      <button type="button" class="link-button tsvip-open" data-tooltip
              aria-label="${esc(_loc("TSVIP.Picker.Open"))}">
        <i class="fa-solid fa-cog" inert></i>
      </button>
      <span class="tsvip-count${used > max ? " tsvip-over" : ""}">${used}/${max}</span>
    </legend>
    ${picks.length
      ? `<ul class="tsvip-list">${picks.map(k => `<li>${label(k)}</li>`).join("")}</ul>`
      : `<p class="tsvip-empty">${esc(max > 0 ? _loc("TSVIP.Sheet.Unspent", {n: max}) : _loc("TSVIP.Sheet.None"))}</p>`}`;
  return box;
}

// renderApplicationV2 rather than renderPCSheet: the sheet class registered for the "pc"
// actor type comes from the system's own metadata, so the class-name hook is not guaranteed
// to be the one we want. The guards below are what actually identify the sheet.
Hooks.on("renderApplicationV2", (app, element) => {
  try {
    const root = element instanceof HTMLElement ? element : app.element;
    const actor = app.document ?? app.actor;
    if (!root || actor?.documentName !== "Actor" || actor.type !== "pc") return;

    const spots = [
      // the Progression view: the column of Lineage / Heritage / Background / Class
      [root.querySelector("section.details fieldset.background")?.parentElement, progressionFieldset],
      // the normal sheet: the column with Skills / Tools / Vehicles
      [root.querySelector("fieldset.vehicles")?.parentElement
        ?? root.querySelector("fieldset.skills")?.parentElement, mainFieldset]
    ];

    for (const [column, build] of spots) {
      if (!column) continue;
      column.querySelector(":scope > fieldset.tsvip")?.remove();
      const box = build(actor);
      const open = box.querySelector(".tsvip-open");
      if (actor.isOwner) open.addEventListener("click", () => openPicker(actor));
      else open.replaceWith(...open.childNodes);
      column.append(box);
    }
  } catch (err) {
    console.error(`${MODULE} | decorating the character sheet failed`, err);
  }
});

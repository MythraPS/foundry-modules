/**
 * Set Level - go straight to a level instead of pressing Level Up over and over.
 *
 * Black Flag's own button (`data-action="levelUp"` in templates/actor/pc-progression.hbs)
 * calls `actor.system.levelUp(cls)` once. That method adds the level and enqueues the
 * advancements for it, which is what makes the sheet ask for talents, ability increases,
 * spells and subclass choices. This module calls the SAME method in a loop, so every level
 * on the way is gained normally and every prompt still appears - nothing is auto-picked.
 *
 * Levelling down uses `actor.system.levelDown()`, the system's own, one level at a time.
 */

const MODULE = "tselverse-setlevel";
const _loc = (k, d) => game.i18n.format(k, d ?? {});

Hooks.once("init", () => {
  game.settings.register(MODULE, "hitPoints", {
    name: "TSVSL.Settings.HitPoints.Name", hint: "TSVSL.Settings.HitPoints.Hint",
    scope: "world", config: true, type: String, default: "ask",
    choices: {
      ask: "TSVSL.Settings.HitPoints.Ask",
      average: "TSVSL.Settings.HitPoints.Average",
      roll: "TSVSL.Settings.HitPoints.Roll"
    }
  });
  game.settings.register(MODULE, "ascending", {
    name: "TSVSL.Settings.Ascending.Name", hint: "TSVSL.Settings.Ascending.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.element?.querySelector?.(".leveling")) app.render();
      }
    }
  });
  game.settings.register(MODULE, "editable", {
    name: "TSVSL.Settings.Editable.Name", hint: "TSVSL.Settings.Editable.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.element?.querySelector?.(".leveling")) app.render();
      }
    }
  });
  game.settings.register(MODULE, "guide", {
    name: "TSVSL.Settings.Guide.Name", hint: "TSVSL.Settings.Guide.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE, "enabled", {
    name: "TSVSL.Settings.Enabled.Name", hint: "TSVSL.Settings.Enabled.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => {
      for (const app of foundry.applications.instances.values()) {
        if (app.element?.querySelector?.(".leveling")) app.render();
      }
    }
  });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { setLevel, classFor, resolveHitPoints, pendingHitPointLevels, setLevelHitPoints };
});

/** Which class the new levels go into: the one taken at level 1, or the only one there is. */
function classFor(actor) {
  const classes = Object.values(actor.system.progression?.classes ?? {});
  return actor.system.progression?.levels?.[1]?.class ?? classes[0]?.document ?? null;
}

/**
 * Take a character to `target`, one level at a time.
 * @returns {Promise<{from: number, to: number}>}
 */
async function setLevel(actor, target) {
  const max = CONFIG.BlackFlag.maxLevel ?? 20;
  const from = actor.system.progression?.level ?? 0;
  target = Math.clamp(Math.floor(Number(target) || 0), 0, max);
  // Pressing it on a character already at that level still fills in any hit points that were
  // never decided - useful for a character levelled before this module existed.
  if (target === from) {
    const mode = game.settings.get(MODULE, "hitPoints");
    const filled = mode === "ask" ? 0 : await resolveHitPoints(actor, mode);
    if (filled) ui.notifications.info(_loc("TSVSL.FilledHP", { name: actor.name, hp: filled }));
    return { from, to: from };
  }

  // Both levelUp and levelDown ENQUEUE their advancement work (BlackFlagActor keeps a private
  // queue and processes it in the background), so the actor's level is not final when they
  // return. Firing the next one immediately made level-down take only a single level off.
  // Each step waits for the level to actually move before the next.
  const settled = async expected => {
    for (let i = 0; i < 100; i++) {
      if ((actor.system.progression?.level ?? 0) === expected) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };

  if (target > from) {
    const cls = classFor(actor);
    if (!cls) {
      ui.notifications.warn(_loc("TSVSL.NoClass"));
      return { from, to: from };
    }
    for (let level = from; level < target; level++) {
      try {
        await actor.system.levelUp(cls);
      } catch (err) {
        ui.notifications.warn(err.message);
        break;
      }
      if (!(await settled(level + 1))) break;
    }
  } else {
    for (let level = from; level > target; level--) {
      await actor.system.levelDown();
      if (!(await settled(level - 1))) break;
    }
  }
  const to = actor.system.progression?.level ?? 0;
  let hp = 0;
  const mode = game.settings.get(MODULE, "hitPoints");
  if (to > from && mode !== "ask") hp = await resolveHitPoints(actor, mode);
  ui.notifications.info(_loc(hp ? "TSVSL.DoneHP" : "TSVSL.Done",
    { name: actor.name, from, to, hp, mode: game.i18n.localize(`TSVSL.Settings.HitPoints.${mode === "roll" ? "Roll" : "Average"}`) }));
  return { from, to };
}

/**
 * Fill in the hit points for levels that have none.
 *
 * `HitPointsAdvancement#apply` only decides for itself at 1st level (max) or when the level
 * before took the average - otherwise it returns and waits to be asked, which is why a jump
 * to 20 left every level blank. Black Flag derives `hp.max` from the per-level values the
 * advancement has recorded (`prepareDerivedHitPoints` -> `getAdjustedTotal(con mod)`), so the
 * fix is to record a value for every level: written in ONE update per class, because applying
 * them one at a time fought with the actor's own advancement queue and only the first few
 * stuck. Current hit points rise by the same amount, and the constitution modifier (minimum
 * 1 per level) is applied here exactly as the system does it.
 *
 * @param {BlackFlagActor} actor
 * @param {"average"|"roll"} mode
 * @returns {Promise<number>} how many levels were filled in
 */
async function resolveHitPoints(actor, mode) {
  const top = actor.system.progression?.level ?? 0;
  const conMod = actor.system.abilities?.[CONFIG.BlackFlag.defaultAbilities?.hitPoints ?? "constitution"]?.mod ?? 0;
  const byClass = new Map();
  let filled = 0, gained = 0;

  for (let character = 1; character <= top; character++) {
    const data = actor.system.progression?.levels?.[character];
    const cls = data?.class?.id ? actor.items.get(data.class.id) : null;
    const advancement = cls?.system.advancement?.byType?.("hitPoints")?.[0];
    if (!advancement) continue;
    if (!byClass.has(cls.id)) {
      byClass.set(cls.id, { advancement, granted: foundry.utils.deepClone(advancement.value.granted ?? {}) });
    }
    const entry = byClass.get(cls.id);
    const classLevel = data.levels?.class ?? character;
    if (entry.granted[classLevel] !== undefined) continue;        // already decided

    const denomination = entry.advancement.configuration.denomination;
    let value, rolled;
    if (character === 1) { value = "max"; rolled = denomination; }
    else if (mode === "roll") {
      // The sheet's own "Roll Hit Die" stores the whole Roll as JSON, so the level shows its
      // die result and can be undone; matching that keeps both routes interchangeable.
      const roll = await new Roll(`1d${denomination}`).evaluate();
      value = JSON.stringify(roll.toJSON());
      rolled = roll.total;
    } else { value = "avg"; rolled = denomination / 2 + 1; }
    entry.granted[classLevel] = value;
    gained += Math.max(rolled + conMod, 1);
    filled++;
  }
  if (!filled) return 0;

  const update = {};
  for (const { advancement, granted } of byClass.values()) {
    update[`${advancement.valueKeyPath}.granted`] = granted;
  }
  update["system.attributes.hp.value"] = (actor.system.attributes.hp.value ?? 0) + gained;
  await actor.update(update);
  return filled;
}

/** Confirm before taking levels away: the system's own warning says what is lost. */
async function confirmDown(actor, target) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: _loc("TSVSL.Down.Title") },
    content: `<p>${_loc("TSVSL.Down.Message", {
      name: foundry.utils.escapeHTML(actor.name),
      from: actor.system.progression?.level ?? 0, to: target
    })}</p><p>${game.i18n.localize("BF.Progression.Action.LevelDown.Message")}</p>`,
    rejectClose: false, modal: true
  });
}

/** How many levels have no hit points decided yet. */
function pendingHitPointLevels(actor) {
  let pending = 0;
  const top = actor.system.progression?.level ?? 0;
  for (let character = 1; character <= top; character++) {
    const data = actor.system.progression?.levels?.[character];
    const cls = data?.class?.id ? actor.items.get(data.class.id) : null;
    const advancement = cls?.system.advancement?.byType?.("hitPoints")?.[0];
    if (!advancement) continue;
    const classLevel = data.levels?.class ?? character;
    if ((advancement.value.granted ?? {})[classLevel] === undefined) pending++;
  }
  return pending;
}

/* ------------------------------------------------------------------ editing by hand */

/**
 * Put a number field on every level's hit points row, so a value can be typed instead of
 * rolled or averaged - and a value already taken can be corrected.
 *
 * Black Flag renders each level's advancement as
 * `form.advancement-entry[data-type="hitPoints"]` inside `div[data-level="N"]`, with the
 * level in the form's own id after the "#". The recorded value lives in the class item's
 * hitPoints advancement under `granted[<class level>]`, and `hp.max` is derived from it, so
 * typing a number writes that key and moves current hit points by the difference.
 */
async function setLevelHitPoints(actor, characterLevel, value) {
  const data = actor.system.progression?.levels?.[characterLevel];
  const cls = data?.class?.id ? actor.items.get(data.class.id) : null;
  const advancement = cls?.system.advancement?.byType?.("hitPoints")?.[0];
  if (!advancement) return false;
  const classLevel = data.levels?.class ?? characterLevel;
  const denomination = advancement.configuration.denomination;
  const conMod = actor.system.abilities?.[CONFIG.BlackFlag.defaultAbilities?.hitPoints ?? "constitution"]?.mod ?? 0;
  const applicable = v => Math.max(v + conMod, 1);

  const granted = foundry.utils.deepClone(advancement.value.granted ?? {});
  const old = granted[classLevel];
  const oldRolled = old === undefined ? null
    : old === "max" ? denomination
    : old === "avg" ? denomination / 2 + 1
    : Number.isNumeric(old) ? Number(old)
    : JSON.parse(old)?.total ?? null;

  const wanted = Math.clamp(Math.round(Number(value)), 1, denomination);
  if (!Number.isFinite(wanted)) return false;
  granted[classLevel] = wanted;

  const delta = applicable(wanted) - (oldRolled === null ? 0 : applicable(oldRolled));
  await actor.update({
    [`${advancement.valueKeyPath}.granted`]: granted,
    "system.attributes.hp.value": Math.max(0, (actor.system.attributes.hp.value ?? 0) + delta)
  });
  return true;
}

function addHitPointFields(app, actor, root) {
  if (!actor.isOwner || !game.settings.get(MODULE, "editable")) return;
  for (const form of root.querySelectorAll('form.advancement-entry[data-type="hitPoints"]')) {
    if (form.querySelector(".tsvsl-hp-edit")) continue;
    const level = Number(form.id?.split("#")[1] ?? form.closest("[data-level]")?.dataset.level);
    if (!Number.isFinite(level)) continue;
    const data = actor.system.progression?.levels?.[level];
    const cls = data?.class?.id ? actor.items.get(data.class.id) : null;
    const advancement = cls?.system.advancement?.byType?.("hitPoints")?.[0];
    if (!advancement) continue;
    const classLevel = data.levels?.class ?? level;
    const current = advancement.valueForLevel?.(classLevel) ?? null;
    const denomination = advancement.configuration.denomination;

    const wrap = document.createElement("span");
    wrap.className = "tsvsl-hp-edit";
    wrap.innerHTML = `
      <input type="number" min="1" max="${denomination}" step="1" value="${current ?? ""}"
             placeholder="d${denomination}"
             data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSL.Edit.Hint", { die: denomination }))}"
             aria-label="${foundry.utils.escapeHTML(_loc("TSVSL.Edit.Hint", { die: denomination }))}">`;
    const input = wrap.querySelector("input");
    const commit = async () => {
      if (input.value === "" || Number(input.value) === current) return;
      input.disabled = true;
      await setLevelHitPoints(actor, level, input.value);
      app.render();
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
    });
    // Clicks inside the advancement form would otherwise submit it (Take Average / Roll).
    input.addEventListener("click", event => event.stopPropagation());
    (form.querySelector(".advancement-actions") ?? form).append(wrap);
  }
}

/**
 * List the levels 1st to 20th. Black Flag builds `context.progressionLevels` from
 * `levels.reverse()`, so the Progression view reads 20 down to 1; each level is its own
 * `section.levels > div.level[data-level]`, and moving those blocks keeps everything inside
 * them - including the advancement-flow placeholders the sheet fills in afterwards by id.
 */
function orderLevels(root) {
  if (!game.settings.get(MODULE, "ascending")) return;
  const section = root.querySelector("section.levels");
  if (!section) return;
  const levels = [...section.querySelectorAll(":scope > div.level[data-level]")];
  levels.sort((a, b) => Number(a.dataset.level) - Number(b.dataset.level));
  for (const el of levels) section.append(el);
}

function addControl(app, actor, root) {
  if (!game.settings.get(MODULE, "enabled")) return;
  const wrapper = root.querySelector("section.leveling .wrapper");
  if (!wrapper || wrapper.querySelector(".tsvsl-box")) return;
  // Only where the system itself would allow levelling: an editable sheet the user owns.
  if (!actor.isOwner || !app.isEditable) return;

  const max = CONFIG.BlackFlag.maxLevel ?? 20;
  const current = actor.system.progression?.level ?? 0;
  const box = document.createElement("span");
  box.className = "tsvsl-box";
  box.innerHTML = `
    <label class="tsvsl-label" for="tsvsl-${actor.id}">${foundry.utils.escapeHTML(_loc("TSVSL.Label"))}</label>
    <input id="tsvsl-${actor.id}" class="tsvsl-input" type="number" min="0" max="${max}" step="1"
           value="${current}" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSL.Hint"))}">
    <button type="button" class="link-button tsvsl-go" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSL.Go"))}"
            aria-label="${foundry.utils.escapeHTML(_loc("TSVSL.Go"))}">
      <i class="fa-solid fa-angles-up" inert></i>
    </button>`;

  const input = box.querySelector("input");
  const run = async () => {
    const target = Number(input.value);
    const now = actor.system.progression?.level ?? 0;
    if (!Number.isFinite(target) || target === now) return;
    if (target < now && !(await confirmDown(actor, target))) { input.value = now; return; }
    box.querySelector(".tsvsl-go").disabled = true;
    try { await setLevel(actor, target); }
    finally { box.querySelector(".tsvsl-go").disabled = false; }
  };
  box.querySelector(".tsvsl-go").addEventListener("click", run);
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); run(); } });

  const levelUp = wrapper.querySelector('[data-action="levelUp"]');
  levelUp ? levelUp.after(box) : wrapper.append(box);

  // Each level keeps its own Take Average / Roll Hit Die buttons; these do whatever is left
  // in one press, for a character who arrived at 20 in one go.
  const pending = pendingHitPointLevels(actor);
  if (pending) {
    const hpRow = document.createElement("span");
    hpRow.className = "tsvsl-hp";
    hpRow.innerHTML = `
      <span class="tsvsl-label">${foundry.utils.escapeHTML(_loc("TSVSL.HP.Label", { n: pending }))}</span>
      <button type="button" class="link-button tsvsl-hp-avg" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSL.HP.AverageTip"))}">${foundry.utils.escapeHTML(_loc("TSVSL.HP.Average"))}</button>
      <span class="tsvsl-or">${foundry.utils.escapeHTML(_loc("TSVSL.HP.Or"))}</span>
      <button type="button" class="link-button tsvsl-hp-roll" data-tooltip="${foundry.utils.escapeHTML(_loc("TSVSL.HP.RollTip"))}">${foundry.utils.escapeHTML(_loc("TSVSL.HP.Roll"))}</button>`;
    const fill = async mode => {
      for (const b of hpRow.querySelectorAll("button")) b.disabled = true;
      try {
        const filled = await resolveHitPoints(actor, mode);
        if (filled) ui.notifications.info(_loc("TSVSL.FilledHP", { name: actor.name, hp: filled }));
      } finally { app.render(); }
    };
    hpRow.querySelector(".tsvsl-hp-avg").addEventListener("click", () => fill("average"));
    hpRow.querySelector(".tsvsl-hp-roll").addEventListener("click", () => fill("roll"));
    box.after(hpRow);
  }
}

/**
 * Keep the sheet's scroll position across a re-render. Black Flag's PC sheet lists no
 * `scrollable` selectors for its Progression part, so every update (Roll Hit Die, Take
 * Average, a talent pick) rebuilds it and the view jumps back to the top. Before each render
 * the scrolled elements are noted by their place in the sheet; afterwards (and after the levels
 * are re-ordered) each is scrolled back.
 */
const SCROLL = new WeakMap();
function scrollKey(el, root) {
  const path = [];
  for (let e = el; e && e !== root; e = e.parentElement) {
    const id = e.dataset?.applicationPart || e.id || [...(e.classList ?? [])].filter(c => !/active|scroll/.test(c)).slice(0, 2).join(".");
    path.unshift(`${e.tagName}:${id}`);
  }
  return path.join(">");
}
Hooks.on("preRenderApplicationV2", (app) => {
  const actor = app.document;
  if (actor?.documentName !== "Actor" || actor.type !== "pc" || !app.element) return;
  const saved = new Map();
  for (const el of [app.element, ...app.element.querySelectorAll("*")]) {
    if (el.scrollTop > 0) saved.set(scrollKey(el, app.element), el.scrollTop);
  }
  SCROLL.set(app, saved);
});
function restoreScroll(app) {
  const saved = SCROLL.get(app);
  if (!saved?.size || !app.element || globalThis.TSVSL_NO_SCROLLFIX) return;     // (the flag: tests only)
  SCROLL.delete(app);
  const apply = () => {
    for (const el of [app.element, ...app.element.querySelectorAll("*")]) {
      const top = saved.get(scrollKey(el, app.element));
      if (top != null) el.scrollTop = top;
    }
  };
  apply();
  requestAnimationFrame(apply);          // after the sheet's own post-render work has laid out
}

/**
 * Character creation tips: tooltips on a PC sheet's own controls, numbered in the order a new
 * player should go. Each "Choose" button disappears once its step is done, taking its tip with
 * it. Existing tooltips are only replaced where they are a raw label (the lock's "BF.EditingMode...").
 */
function addGuide(app, root) {
  if (!game.settings.get(MODULE, "guide")) return;
  const tip = (el, key) => {
    if (!el) return;
    const cur = el.dataset.tooltip ?? "";
    if (cur && !/^BF\./.test(cur) && !el.dataset.tsvslGuide) return;
    el.dataset.tooltip = _loc(key); el.dataset.tsvslGuide = "1";
  };
  tip(root.querySelector('[data-action="assignAbilities"]'), "TSVSL.Guide.Abilities");
  for (const type of ["lineage", "heritage", "background", "class"])
    tip(root.querySelector(`[data-action="selectConcept"][data-type="${type}"]`), `TSVSL.Guide.${type}`);
  const prog = root.querySelector('[data-action="toggleProgression"]');
  if (prog) { prog.dataset.tsvslGuide = "1"; tip(prog, /return/i.test(prog.textContent) ? "TSVSL.Guide.Return" : "TSVSL.Guide.Progression"); }
  tip(root.querySelector('[data-action="levelUp"]'), "TSVSL.Guide.LevelUp");
  const lock = root.querySelector('[data-action="toggleSheetMode"]');
  if (lock) {
    const editing = app.isEditable && app._mode === app.constructor.MODES?.EDIT;
    lock.dataset.tsvslGuide = "1";
    tip(lock, editing ? "TSVSL.Guide.Unlocked" : "TSVSL.Guide.Locked");
  }
  for (const form of root.querySelectorAll('form[data-type="hitPoints"], .advancement-entry[data-type="hitPoints"]')) {
    for (const b of form.querySelectorAll("button")) {
      if (/roll/i.test(b.textContent)) tip(b, "TSVSL.Guide.HitDie");
      else if (/average/i.test(b.textContent)) tip(b, "TSVSL.Guide.Average");
    }
  }
  tip([...root.querySelectorAll('a[data-action="tab"]')].find(a => /biography/i.test(a.dataset.tab ?? a.textContent)), "TSVSL.Guide.Biography");
}

/**
 * Scroll guard for the Progression view. A player reported the view jumping to the top after
 * each Roll Hit Die (2026-10-06, Chrome over the public address); it could not be reproduced
 * here in Chrome or Firefox, locally or with network delay, so this does not depend on the
 * cause: pressing a button in a PC sheet notes the scroll position, and for the next 4 seconds
 * any jump of more than 150 px that the player didn't make (no wheel, key, scrollbar drag or
 * touch since) is put back. Any scrolling of their own ends the guard at once.
 */
const GUARD = { el: null, top: 0, until: 0 };
function guardScroll(event) {
  const sheet = event.target?.closest?.(".application");
  const sc = sheet?.querySelector?.(".window-content");
  if (!sc || !sheet.querySelector("section.leveling") || !event.target.closest("button, a, [data-action]")) return;
  // buttons that change the view on purpose (Progression toggle, tabs, sheet mode) aren't guarded
  if (event.target.closest('[data-action="toggleProgression"], [data-action="toggleSheetMode"], [data-tab], nav, .tabs')) return;
  Object.assign(GUARD, { el: sc, top: sc.scrollTop, until: Date.now() + 4000, sheet });
}
const endGuard = () => { GUARD.until = 0; };
document.addEventListener("pointerdown", event => {
  // a press on the scrollbar itself is the player scrolling
  const sc = event.target?.closest?.(".window-content");
  if (sc && event.offsetX > sc.clientWidth) return endGuard();
  guardScroll(event);
}, true);
for (const type of ["wheel", "keydown", "touchmove"]) document.addEventListener(type, endGuard, true);
function checkGuard() {
  if (!GUARD.until || Date.now() > GUARD.until) return;
  // the sheet may have been re-rendered: find its current scroller again
  const sc = GUARD.el?.isConnected ? GUARD.el : GUARD.sheet?.querySelector?.(".window-content");
  if (!sc) return;
  GUARD.el = sc;
  if (GUARD.top - sc.scrollTop > 150) sc.scrollTop = GUARD.top;
}
document.addEventListener("scroll", checkGuard, true);
(function tick() { checkGuard(); requestAnimationFrame(tick); })();
globalThis.TselverseScrollGuard = GUARD;

Hooks.on("renderApplicationV2", (app, element) => {
  const root = element instanceof HTMLElement ? element : app.element;
  const actor = app.document;
  if (actor?.documentName !== "Actor" || actor.type !== "pc") return;
  try { addGuide(app, root); } catch (err) { console.error(`${MODULE} | character creation tips failed`, err); }
  if (!root?.querySelector?.("section.leveling")) { restoreScroll(app); return; }
  try { orderLevels(root); addControl(app, actor, root); addHitPointFields(app, actor, root); }
  catch (err) { console.error(`${MODULE} | adding the level controls to ${actor.name} failed`, err); }
  restoreScroll(app);
});

/* Faster "choose a talent" lists.
 * Black Flag's ChooseFeaturesAdvancement#choices() loads its pool with one `fromUuid` per entry,
 * in turn - one server round trip each. A converted background offers every talent (143), and
 * the picker took 50 seconds to open (measured 2026-10-01; rendering the list itself took 25 ms).
 * This asks each compendium once for all of its entries in the pool, keeps the pool's order, and
 * applies the system's own selection limit. Anything it can't batch (a world item, an error)
 * falls back to the system's own loop. */
Hooks.once("ready", () => {
  const cls = CONFIG.BlackFlag?._advancementTypes?.chooseFeatures?.documentClass;
  if (!cls?.prototype?.choices) return console.warn(`${MODULE} | ChooseFeaturesAdvancement not found - talent lists not sped up`);
  const original = cls.prototype.choices;
  cls.prototype.choices = async function () {
    try {
      const pool = Object.values(this.configuration.pool ?? {});
      if (!pool.length) return original.call(this);   // drop-only lists: tselverse-common fills these
      const byPack = new Map(), loaded = new Map();
      for (const c of pool) {
        const p = foundry.utils.parseUuid(c.uuid);
        if (p?.collection instanceof foundry.documents.collections.CompendiumCollection && p.documentId && !p.embedded?.length) {
          if (!byPack.has(p.collection)) byPack.set(p.collection, []);
          byPack.get(p.collection).push(p.documentId);
        }
      }
      await Promise.all([...byPack].map(async ([pack, ids]) => {
        for (const d of await pack.getDocuments({_id__in: ids})) loaded.set(d.uuid, d);
      }));
      const choices = [];
      for (const c of pool) {
        const item = loaded.get(c.uuid) ?? await fromUuid(c.uuid);
        if (item && !this.selectionLimitReached(item)) choices.push(item);
      }
      return choices;
    } catch (err) {
      console.warn(`${MODULE} | batched talent list failed, using the system's own`, err);
      return original.call(this);
    }
  };
});

/* Faster lineage / heritage / background / class / subclass pickers.
 * ConceptSelectionDialog#_prepareContext calls `fromUuid` once for every registered option of the
 * type - every subclass of every class, filtered to the class afterwards - one server request each.
 * The Choose Subclass window took 17 seconds to open (measured 2026-10-01). Before it runs, ask
 * each compendium once for all of those documents, so its own `fromUuid` calls hit the cache. */
const tsvslPrefetch = async uuids => {
  const byPack = new Map();
  for (const u of uuids) {
    const p = foundry.utils.parseUuid(u);
    if (!(p?.collection instanceof foundry.documents.collections.CompendiumCollection) || !p.documentId || p.embedded?.length) continue;
    if (p.collection.get(p.documentId)) continue;                       // already loaded
    if (!byPack.has(p.collection)) byPack.set(p.collection, []);
    byPack.get(p.collection).push(p.documentId);
  }
  await Promise.all([...byPack].map(([pack, ids]) => pack.getDocuments({_id__in: ids})));
};
Hooks.once("ready", () => {
  const find = (o, seen = new Set()) => {
    if (!o || typeof o !== "object" || seen.has(o)) return null; seen.add(o);
    if (o.ConceptSelectionDialog) return o.ConceptSelectionDialog;
    for (const v of Object.values(o)) { const r = find(v, seen); if (r) return r; }
    return null;
  };
  const cls = find(globalThis.BlackFlag?.applications);
  if (!cls?.prototype?._prepareContext) return console.warn(`${MODULE} | ConceptSelectionDialog not found - pickers not sped up`);
  const original = cls.prototype._prepareContext;
  cls.prototype._prepareContext = async function (options) {
    try {
      const reg = Object.values(CONFIG.BlackFlag.registration.list(this.type) ?? {});
      await tsvslPrefetch(reg.map(o => o.sources?.at(-1)).filter(Boolean));
    } catch (err) { console.warn(`${MODULE} | picker prefetch failed (the picker still works, just slower)`, err); }
    return original.call(this, options);
  };
});

/* Talents that raise an ability score.
 * A 5E feat brought over as a talent can say "Increase your Strength or Dexterity score by 1, to a
 * maximum of 20". foundry-import builds the fixed ones ("your Constitution score") with the +1 as an
 * effect on the talent; the ones with a choice carry the abilities in
 * flags["foundry-import"].asi. When such a talent is added to a character, the person who added it
 * is asked which ability, and the +1 is added to the talent as an effect - so it shows on the
 * sheet, and removing the talent takes it away again. A score already at 20 isn't offered. */
// (a module's language file is read when the world starts: English until then)
const tsvslT = (key, english, data = {}) => {
  const raw = game.i18n.has?.(key) ? game.i18n.localize(key) : english;
  return raw.replace(/\{(\w+)\}/g, (m, k) => data[k] ?? m);
};
const TSVSL_ABIL = {strength: "STR", dexterity: "DEX", constitution: "CON", intelligence: "INT", wisdom: "WIS", charisma: "CHA"};
async function tsvslAskAbility(item) {
  const actor = item.parent, pool = item.flags?.["foundry-import"]?.asi ?? [];
  if (!actor || !pool.length || item.effects.some(e => e.flags?.[MODULE]?.asi)) return;
  const open = pool.filter(a => (actor.system.abilities?.[a]?.value ?? 0) < 20);
  if (!open.length) return ui.notifications.info(tsvslT("TSVSL.Asi.AllMax", "{name}: every ability it can raise is already 20.", {name: item.name}));
  const label = a => { const v = actor.system.abilities?.[a]?.value;
    return game.i18n.localize(CONFIG.BlackFlag?.abilities?.[a]?.labels?.full ?? a) + (Number.isFinite(v) ? ` (${v})` : ""); };
  const content = `<p>${foundry.utils.escapeHTML(tsvslT("TSVSL.Asi.Prompt", "{name} raises one ability score by 1 (to a maximum of 20). Which one?", {name: item.name}))}</p>`
    + `<select name="ability" style="width:100%">${open.map(a => `<option value="${a}">${foundry.utils.escapeHTML(label(a))}</option>`).join("")}</select>`;
  const ability = await foundry.applications.api.DialogV2.prompt({
    window: {title: tsvslT("TSVSL.Asi.Title", "{name}: raise an ability", {name: item.name})}, content, rejectClose: false,
    ok: {label: tsvslT("TSVSL.Asi.Ok", "Raise it"), callback: (event, button) => button.form.elements.ability.value}
  });
  if (!ability) return ui.notifications.warn(tsvslT("TSVSL.Asi.Skipped", "{name}: no ability chosen, so no score was raised. Remove the talent and add it again to choose.", {name: item.name}));
  await item.createEmbeddedDocuments("ActiveEffect", [{
    name: `${item.name}: +1 ${TSVSL_ABIL[ability] ?? ability}`, img: "icons/svg/upgrade.svg", transfer: true, disabled: false,
    changes: [{key: `system.abilities.${ability}.value`, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "1", priority: 20}],
    flags: {[MODULE]: {asi: ability}}
  }]);
}
Hooks.on("createItem", (item, options, userId) => {
  if (userId !== game.user.id || item.type !== "talent" || !(item.parent instanceof Actor)) return;
  if (item.flags?.["foundry-import"]?.asi?.length) tsvslAskAbility(item);
});

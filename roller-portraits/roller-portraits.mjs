/**
 * Roller Portraits.
 *
 * Chat: Foundry 14's templates/sidebar/chat-message.hbs renders the sender as
 * <header class="message-header"><h4 class="message-sender">{{alias}}</h4>...; the
 * `renderChatMessageHTML(message, html)` hook runs for every message on every client, so a
 * picture added there is seen by everyone who can see the message.
 *
 * Dialogs: Black Flag's BasicRollConfigurationDialog exposes `config.subject` - the actor
 * for checks and saves (rollAbilityCheck sets `rollConfig.subject = this`), or the
 * activity for attacks and damage (whose `.actor` is the roller) - and `message.data.speaker`.
 */

const MODULE = "roller-portraits";

Hooks.once("init", () => {
  game.settings.register(MODULE, "image", {
    name: "ROLLPORT.Settings.Image.Name", hint: "ROLLPORT.Settings.Image.Hint",
    scope: "world", config: true, type: String, default: "portrait",
    choices: { portrait: "ROLLPORT.Settings.Image.Portrait", token: "ROLLPORT.Settings.Image.Token" }
  });
  game.settings.register(MODULE, "size", {
    name: "ROLLPORT.Settings.Size.Name", hint: "ROLLPORT.Settings.Size.Hint",
    scope: "client", config: true, type: Number, default: 28, range: { min: 16, max: 64, step: 2 }
  });
  game.settings.register(MODULE, "dialog", {
    name: "ROLLPORT.Settings.Dialog.Name", hint: "ROLLPORT.Settings.Dialog.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
});

/** Picture for a speaker: token document and/or actor. */
function pictureFor({ tokenDoc, actor }) {
  const wantToken = game.settings.get(MODULE, "image") === "token";
  const token = tokenDoc?.texture?.src;
  const portrait = actor?.img;
  const pick = wantToken ? (token || portrait) : (portrait || token);
  return pick && !/mystery-man/.test(pick) ? pick : (token || portrait || null);
}

function resolveSpeaker(speaker) {
  if (!speaker) return {};
  const scene = speaker.scene ? game.scenes.get(speaker.scene) : null;
  const tokenDoc = scene && speaker.token ? scene.tokens.get(speaker.token) : null;
  const actor = tokenDoc?.actor ?? (speaker.actor ? game.actors.get(speaker.actor) : null);
  return { tokenDoc, actor };
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  try {
    const sender = html.querySelector(".message-sender");
    if (!sender || sender.querySelector(".rollport-img")) return;
    const who = resolveSpeaker(message.speaker);
    if (!who.actor && !who.tokenDoc) return;                 // plain player chat: leave alone
    const src = pictureFor(who);
    if (!src) return;
    const img = document.createElement("img");
    img.className = "rollport-img";
    img.src = src;
    img.alt = message.alias ?? "";
    img.style.setProperty("--rollport-size", `${game.settings.get(MODULE, "size")}px`);
    sender.classList.add("rollport-sender");
    sender.prepend(img);
  } catch (err) { console.error(`${MODULE} | chat portrait failed`, err); }
});

/* ------------------------------------------------------------------ targets in the dialog */

/**
 * Pick mode: while a targeted roll's dialog is open with nothing targeted, the map switches
 * to Foundry's own Target tool, and a plain click ADDS or REMOVES a target instead of
 * replacing the others (Token#_onClickLeft, with the tool active, calls
 * `setTarget(!isTargeted, {releaseOthers: !event.shiftKey})` - Shift was needed for more
 * than one). The previous control and tool come back when the dialog closes.
 */
const picking = new Map();                         // dialog app id -> {control, tool}

Hooks.once("setup", () => {
  const Token = foundry.canvas.placeables.Token;
  const original = Token.prototype._onClickLeft;
  Token.prototype._onClickLeft = function(event) {
    if (picking.size && game.activeTool === "target") {
      event?.stopPropagation?.();
      return this.setTarget(!this.isTargeted, { releaseOthers: false });
    }
    return original.call(this, event);
  };
});

function targetCount(activity) {
  const raw = activity?.target?.affects?.count;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildTargetsRow(app) {
  const root = app.element;
  if (!root) return;
  root.querySelector(".rollport-targets")?.remove();
  const subject = app.config?.subject;
  if (!subject || subject instanceof Actor) return;
  const targets = [...(game.user.targets ?? [])].filter(t => t.actor);
  const wanted = targetCount(subject);
  const row = document.createElement("div");
  row.className = "rollport-dialog rollport-targets";
  const label = document.createElement("span");
  label.textContent = wanted && wanted > 1
    ? game.i18n.format("ROLLPORT.TargetingCount", { n: targets.length, max: wanted })
    : game.i18n.localize("ROLLPORT.Targeting");
  row.append(label);
  if (!targets.length) {
    const hint = document.createElement("em");
    hint.className = "rollport-hint";
    hint.textContent = wanted && wanted > 1
      ? game.i18n.format("ROLLPORT.PickMany", { n: wanted })
      : game.i18n.localize("ROLLPORT.PickOne");
    row.append(hint);
  }
  for (const t of targets) {
    const chip = document.createElement("span");
    chip.className = "rollport-target";
    const src = pictureFor({ tokenDoc: t.document, actor: t.actor });
    if (src) { const ti = document.createElement("img"); ti.src = src; ti.alt = t.name; chip.append(ti); }
    const tn = document.createElement("span"); tn.textContent = t.name; chip.append(tn);
    row.append(chip);
  }
  const anchor = root.querySelector(".rollport-dialog") ?? null;
  if (anchor) anchor.after(row);
  else (root.querySelector(".window-content") ?? root).prepend(row);
}

async function startPicking(app) {
  if (picking.has(app.id) || !canvas.ready || !ui.controls) return;
  picking.set(app.id, { control: ui.controls.control?.name, tool: ui.controls.tool?.name });
  await ui.controls.activate({ control: "tokens", tool: "target" });
}

async function stopPicking(app) {
  const prior = picking.get(app.id);
  if (!prior) return;
  picking.delete(app.id);
  if (picking.size) return;
  if (game.activeTool === "target" && prior.control) await ui.controls.activate({ control: prior.control, tool: prior.tool });
}

Hooks.on("targetToken", () => {
  for (const app of foundry.applications.instances.values()) {
    if (app.element?.querySelector?.(".rollport-targets") || picking.has(app.id)) buildTargetsRow(app);
  }
});

Hooks.on("closeBasicRollConfigurationDialog", app => { stopPicking(app); });

Hooks.on("renderBasicRollConfigurationDialog", (app, element) => {
  try {
    if (!game.settings.get(MODULE, "dialog")) return;
    const root = element instanceof HTMLElement ? element : app.element;
    if (!root || root.querySelector(".rollport-dialog")) return;
    const subject = app.config?.subject;
    let actor = subject instanceof Actor ? subject : subject?.actor ?? null;
    let tokenDoc = actor?.token ?? null;
    if (!actor) ({ actor, tokenDoc } = resolveSpeaker(app.message?.data?.speaker));
    if (!actor) return;
    const src = pictureFor({ tokenDoc, actor });
    const row = document.createElement("div");
    row.className = "rollport-dialog";
    if (src) { const img = document.createElement("img"); img.src = src; img.alt = actor.name; row.append(img); }
    const name = document.createElement("span");
    name.textContent = game.i18n.format("ROLLPORT.Rolling", { name: tokenDoc?.name ?? actor.name });
    row.append(name);
    const body = root.querySelector(".window-content") ?? root;
    body.prepend(row);

    // Targets, when the roll acts on them (attacks, damage, other activity rolls).
    if (!(subject instanceof Actor)) {
      buildTargetsRow(app);
      if (![...(game.user.targets ?? [])].some(t => t.actor)) startPicking(app);
    }
  } catch (err) { console.error(`${MODULE} | dialog portrait failed`, err); }
});

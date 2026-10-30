/**
 * A quick switch between the two modes for the GM's own rolls: "review" (every roll waits on a
 * Reroll / Confirm / Discard card, the Hold setting) and "automatic" (rolls go straight through).
 * A toggle in the Token controls on the left (hand icon, lit = review on) and a key, Alt+R.
 * Players' rolls are never held either way.
 */
import { MODULE_ID } from "./hold.mjs";

const isOn = () => { try { return !!game.settings.get(MODULE_ID, "hold"); } catch { return false; } };

async function setMode(on) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "hold", !!on);
  ui.notifications.info(game.i18n.localize(on ? "BFAD.Mode.On" : "BFAD.Mode.Off"));
  ui.controls?.render?.({ reset: true });
}

Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls?.tokens ?? controls?.token;
  if (!tokens?.tools || !game.user.isGM) return;
  tokens.tools.bfadReview = {
    name: "bfadReview", order: Object.keys(tokens.tools).length + 1,
    title: "BFAD.Mode.Tool", icon: "fa-solid fa-hand", visible: game.user.isGM,
    toggle: true, active: isOn(),
    onChange: (event, active) => { if (active !== isOn()) setMode(active); }
  };
});

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "toggleReview", {
    name: "BFAD.Mode.Key", hint: "BFAD.Mode.KeyHint",
    editable: [{ key: "KeyR", modifiers: ["Alt"] }], restricted: true,
    onDown: () => { setMode(!isOn()); return true; }
  });
});

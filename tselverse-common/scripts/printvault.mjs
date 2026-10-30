/**
 * The Printvault (officially the Fingerprint Vault): everyone in the Tselverse has one implanted in a finger.
 * It is a feature, not an item, so it never sits in an inventory: it can't be dropped, sold, traded or stolen,
 * and has no price or weight. Every player character gets it; the active GM adds it on load and to new PCs,
 * and keeps its text up to date. Marked flags["tselverse-common"].printvault.
 */
const MODULE = "tselverse-common";
const JOURNAL = "JournalEntry.O4qflDlVq0zjIAV7.JournalEntryPage.8SdAfZP3gm63GZjY";

const feature = () => ({
  name: "Printvault",
  type: "feature",
  img: "icons/commodities/currency/coin-engraved-slot-one-copper.webp",
  flags: { [MODULE]: { printvault: 2 } },
  system: {
    type: { category: "heritage", value: "" },
    identifier: { value: "printvault" },
    description: {
      value: "<p>A tiny prosthetic set into one of your fingers: the Fingerprint Vault, usually just called the printvault or \"vault\". "
        + "You can't feel it until you mean to use it.</p>"
        + "<ul><li><strong>Coins.</strong> It opens a pinhole portal to a pocket dimension that holds your coins. Draw them into your hand or drop them in.</li>"
        + "<li><strong>Balance.</strong> It always knows exactly how much you hold.</li>"
        + "<li><strong>Transfers.</strong> Pay someone vault to vault; both balances update.</li></ul>"
        + "<p>The coins on your sheet are what your vault holds, and they weigh nothing. "
        + "The vault is part of you: it can't be removed, sold or stolen.</p>"
        + `<p>@UUID[${JOURNAL}]{Money and the Printvault}</p>`,
      source: { book: "Tselverse", fallback: "", page: "" }
    }
  }
});

const isMain = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

async function ensure(actor) {
  if (actor?.type !== "pc" || !actor.isOwner) return;
  const want = feature();
  const have = actor.items.find(i => i.getFlag(MODULE, "printvault"));
  if (!have) return actor.createEmbeddedDocuments("Item", [want]);
  if ((have.getFlag(MODULE, "printvault") ?? 0) < want.flags[MODULE].printvault)
    return have.update({ name: want.name, img: want.img, "system.description.value": want.system.description.value, [`flags.${MODULE}.printvault`]: want.flags[MODULE].printvault });
}

Hooks.once("ready", async () => {
  if (!isMain()) return;
  for (const a of game.actors.filter(a => a.type === "pc")) {
    try { await ensure(a); } catch (e) { console.warn(`${MODULE} | printvault on ${a.name}`, e); }
  }
});
Hooks.on("createActor", (actor, options, userId) => { if (isMain()) ensure(actor).catch(e => console.warn(`${MODULE} | printvault`, e)); });

export { ensure as ensurePrintvault };

// part of the character: players can't delete it from their sheets (the GM still can)
Hooks.on("preDeleteItem", (item, options, userId) => {
  if (item.getFlag?.(MODULE, "printvault") && !game.users.get(userId)?.isGM) {
    if (userId === game.user.id) ui.notifications.warn("The printvault is part of you: it can't be removed.");
    return false;
  }
});

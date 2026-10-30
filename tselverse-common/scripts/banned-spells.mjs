/**
 * House rule: spells the GM has banned for players.
 *
 * Players don't see banned spells in any compendium (the compendium window, the Compendium
 * Browser and spell pickers all list from the pack index), and a player can't add one to an
 * actor, for example by dragging an old link. The GM still sees and uses them, e.g. for NPCs.
 * A name bans that spell in every pack, so a copy in another book is caught too. A compendium
 * UUID (Compendium.pack.Item.id) bans only that one entry, e.g. an official spell that a house-rule
 * copy with the same name replaces. The list is a world setting, entries separated by semicolons.
 */
const MODULE = "tselverse-common";
const KEY = "bannedSpells";
const DEFAULT = [
  "Healing Spirit", "Entropic Fire", "Eye of the Hoard Watcher", "Pluck Soul", "Shiver",
  "Lock Armor", "Electrify", "Throes of Ecstasy", "Exsanguinate", "Endow Attribute", "Action"
].join("; ");

const norm = s => String(s ?? "").normalize("NFKC").replace(/[’‘`]/g, "'").trim().toLowerCase();
let BANNED = new Set();
const readList = () => {
  try { BANNED = new Set(String(game.settings.get(MODULE, KEY) ?? "").split(";").map(norm).filter(Boolean)); }
  catch { BANNED = new Set(); }
};
const appliesToMe = () => game.user && !game.user.isGM;
const isBanned = (type, name, uuid) => type === "spell" && (BANNED.has(norm(name)) || (!!uuid && BANNED.has(norm(uuid))));

const prune = pack => {
  if (!appliesToMe() || pack?.documentName !== "Item") return;
  for (const e of [...pack.index]) if (isBanned(e.type, e.name, `Compendium.${pack.collection}.Item.${e._id}`)) pack.index.delete(e._id);
};
const pruneAll = () => { if (game.packs) for (const p of game.packs) prune(p); };

Hooks.once("init", () => {
  game.settings.register(MODULE, KEY, {
    name: "Banned spells",
    hint: "Spell names (or compendium UUIDs, for one copy only) players can't see in compendiums or add to a character, separated by semicolons. The GM is not affected. Players reload to pick up a change.",
    scope: "world", config: true, type: String, default: DEFAULT,
    onChange: () => { readList(); pruneAll(); }
  });
  const CC = foundry.documents.collections?.CompendiumCollection ?? CompendiumCollection;
  const getIndex = CC.prototype.getIndex;
  CC.prototype.getIndex = async function(...args) {
    const index = await getIndex.apply(this, args);
    prune(this);
    return index;
  };
});
Hooks.once("setup", () => { readList(); pruneAll(); });
Hooks.once("ready", pruneAll);

Hooks.on("preCreateItem", (item, data, options, userId) => {
  if (userId !== game.user?.id || !appliesToMe()) return;
  const from = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  if (!isBanned(item.type, item.name, from)) return;
  ui.notifications?.warn(`${item.name} is banned at this table. Ask your GM.`);
  return false;
});

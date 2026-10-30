/**
 * Black Flag lists Pistol, Arquebus, Blunderbuss, Musket and Revolving Musket as weapon types but
 * links no item to them, so picking one in an equipment choice ("any simple weapon") fails with
 * "Must make selections for each equipment choice" (findSelection finds no link). Each is pointed
 * at a world copy of the GM's Guide item (folder "Base Firearms", players can read it).
 */
const LINKS = {
  simple: { pistol: "Item.tsvFirearmPistol" },
  martial: { arquebus: "Item.tsvFirearmArqbus", blunderbuss: "Item.tsvFirearmBlndrb",
             musket: "Item.tsvFirearmMusket", revolvingMusket: "Item.tsvFirearmRevMus" }
};
Hooks.once("ready", () => {
  const weapons = CONFIG.BlackFlag?.weapons;
  if (!weapons) return;
  for (const [cat, keys] of Object.entries(LINKS)) for (const [key, uuid] of Object.entries(keys)) {
    const entry = weapons[cat]?.children?.[key];
    if (entry && !entry.link && game.items.get(uuid.slice(5))) entry.link = uuid;
  }
});

/**
 * One name per book, everywhere a book is shown or filtered on.
 *
 * Black Flag prints an item's source as its stored `book` value, so the same book turns up under
 * several names: the Kobold Press module stores codes ("ToH", "WG4", "DM2"), Black Flag's own
 * content "BFRD", the importer full titles ("Tome of Heroes"), and a few old imported entries
 * still carry the PDF's file name ("Some_Book_v1.2_PAGES"). Every picker's Book
 * filter (tselverse-spells) and the Compendium Browser's source filter then list one book two
 * or three times.
 *
 * The name used: a known file-style name -> its title (book-titles.mjs, filled in per world;
 * empty in the public copy), else a registered code -> the title its module gives it
 * (`CONFIG.BlackFlag.sourceBooks`, "ToH" -> "Tome of Heroes"), else the stored value. Only the
 * prepared label changes; nothing stored is rewritten.
 */
const MODULE = "tselverse-common";

import TITLES from "./book-titles.mjs"; // stored value -> title; kept per world, empty in the public copy

/** The one name to show for a stored book value. */
export function bookName(book) {
  if (!book) return book;
  const raw = String(book);
  const titled = TITLES[raw] ?? TITLES[raw.trim()];
  if (titled) return titled;
  // registered codes: a localization key ("SOURCE.BOOK.ToH") or already the title ("BFRD")
  const code = CONFIG.BlackFlag?.sourceBooks?.[raw];
  if (code) return game.i18n?.localize(code) || code;
  return raw.trim();
}

Hooks.once("init", () => {
  const SourceField = BlackFlag?.data?.fields?.SourceField;
  if (!SourceField?.prepareData) { console.warn(`${MODULE} | SourceField not found - book names left as stored`); return; }
  const original = SourceField.prepareData;
  SourceField.prepareData = function(uuid) {
    original.call(this, uuid);
    // a fixed label ("Player's Guide") stands in for the book: tidy that instead
    if (this.fallback) {
      const named = bookName(this.fallback);
      if (named !== this.fallback) this.label = this.value = named;
      return;
    }
    if (!this.book) return;
    const name = bookName(this.book);
    if (name === this.book) return;
    const page = Number.isNumeric(this.page) ? game.i18n.format("BF.SOURCE.Display.Page", { page: this.page }) : this.page ?? "";
    this.label = game.i18n.format("BF.SOURCE.Display.Full", { book: name, page }).trim();
    this.value = name;
    this.slug = BlackFlag.utils?.formatIdentifier?.(name) ?? this.slug;
  };
});

/* The Compendium Browser (compendium-browser-bf) reads book values straight from the compendium
 * index and keys its source filter on them; giving it the same names merges the duplicates. Its
 * class is only reachable from one of its windows, so it is patched the first time one renders. */
Hooks.on("renderApplicationV2", app => {
  if (app.id !== "compendium-browser-bf") return;
  const cls = app.constructor;
  if (cls._tsvBookNames || typeof cls._getSourceBook !== "function") return;
  const original = cls._getSourceBook;
  cls._getSourceBook = function(entry, pack) { return bookName(original.call(this, entry, pack)) ?? ""; };
  cls._tsvBookNames = true;
  app.render({ parts: ["sidebar", "results"] });
});

// for other modules (tselverse-spells' spell window): game.modules.get("tselverse-common").api.bookName
Hooks.once("init", () => {
  const mod = game.modules.get(MODULE);
  if (mod) mod.api = { ...(mod.api ?? {}), bookName };
});

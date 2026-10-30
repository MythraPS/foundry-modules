# Foundry VTT modules

Twenty-two small modules for **Foundry VTT v14**, many of them for the
**Black Flag** (Tales of the Valiant) system. Each folder is one module.

| Module | Folder | System |
| --- | --- | --- |
| Facing Arrow | `tselverse-facing` | any |
| Black Flag Area Targets | `bf-area-targets` | Black Flag |
| Canvas Redo | `canvas-redo` | any |
| Action Type Labels | `action-labels` | Black Flag |
| Auto Damage, Roll Review and Crit Tables | `bf-auto-damage` | Black Flag |
| Dead Tokens | `dead-tokens` | any |
| Undo Damage (Ctrl+Z) | `hp-undo` | any |
| Roller Portraits | `roller-portraits` | any |
| Trait Reminders | `trait-reminders` | any |
| Everyone Speaks Common | `tselverse-common` | Black Flag |
| Intelligence Proficiencies | `tselverse-intellect` | Black Flag |
| Creature Journals | `tselverse-notes` | any |
| Arachnophobia Cats | `tselverse-phobia` | any |
| Matching Portrait & Token | `tselverse-portraits` | any |
| Show Map in Files | `tselverse-scene-preview` | any |
| Set Level | `tselverse-setlevel` | Black Flag |
| Ship Bridge (Dark Matter) | `tselverse-ships` | Black Flag |
| Tselverse Shops | `tselverse-shops` | any (needs Item Piles) |
| Spell List | `tselverse-spells` | Black Flag |
| Shared Treasure | `tselverse-treasure` | Black Flag |
| Tamer Companions | `tselverse-companions` | Black Flag |
| Battle Simulator | `tselverse-battlesim` | Black Flag |

The first three have longer notes below on *why* they work the way they do, with
the source lines that justify the approach. The rest are described more briefly
after them.

---

## Facing Arrow (`tselverse-facing`)

Keeps token artwork upright while movement still records facing, and draws an
arrow that points the way the token is facing.

Two settings are easy to confuse, and the split is what makes this possible:

| setting | scope | effect |
| --- | --- | --- |
| `core.tokenAutoRotate` | world, default `true` | writes the movement direction into `TokenDocument#rotation` |
| `TokenDocument#lockRotation` | per token | decides **only** whether the artwork turns |

```js
// client/canvas/placeables/token.mjs
this.mesh.angle = this.document.lockRotation ? 0 : this.document.rotation;
```

Facing therefore keeps being recorded even with the art locked. The module locks
every token's art and renders that rotation as an arrow instead.

**The arrow direction is derived, not assumed.** Foundry computes
`rotation = toDegrees(ray.angle) - 90`, so inverting it gives the true movement
vector and the arrow cannot end up 90° out:

```js
const rad = Math.toRadians(rotation + 90);   // -> (cos, sin) in canvas space
```

Three things worth knowing, each found by reading the source rather than guessing:

* **`refreshRotation` is gated on `!lockRotation`** (`token.mjs`), so with the art
  locked *no* refresh fires on a rotation change. The arrow hooks
  `Token#_onAnimationUpdate` instead — the only place the per-frame animated
  rotation exists — so it turns smoothly rather than snapping.
* **`token.mesh` is not a child of the Token container.** `Token#_draw` does
  `this.mesh = canvas.primary.addToken(this)`, so z-ordering against it throws.
* **Three placements** (world setting "Arrow placement"):
  * *Edge of token square* (default): the arrow's point sits a set gap outside
    the token's own square, so every token's arrow is the same distance out.
  * *Edge of artwork*: token art varies wildly in how much of its canvas it
    fills — inset "ring room" discs reach ~0.60 of the radius, Black Flag's own
    art ~0.98 — so this samples the alpha bounding box once per texture and
    anchors the arrow's base to the real edge.
  * *Fixed distance*: one value for every token.

  All three follow the token's texture scale, so a token drawn at 0.9 keeps its
  arrow against the smaller disc — but never push it past the token's square.

Per-creature opt-out and per-creature colour override live on the token's
Appearance tab, on both the token and the prototype.

---

## Black Flag Area Targets (`bf-area-targets`)

When an activity places an area template, target every token inside it, and let
the save/check buttons on a chat card roll against those targets.

Black Flag's `getActionTargets()` reads only `canvas.tokens.controlled` and
carries a `TODO: Alternatively fetch targeted tokens`. This fills that in.

**Save and check links in text** (`[[/save]]`, `[[/check]]`, `[[/skill]]`) roll for
targeted tokens too. Black Flag gives each link its own click listener that rolls
for `canvas.tokens.controlled` only and sets `target.disabled = true` while it runs,
so nothing later in the event sees the click; this module listens in the *capture*
phase instead, and only when something is targeted — with no targets the system's
own behaviour is untouched.

**Cube areas place.** Black Flag builds a cube as a "ray" (a line) whose width is
`template.width * grid` — and a cube has no width (not even the system's own
Thunderwave), so it came out `NaN`, `LineShapeData` rejected it and the Place
Template button only warned. `blackFlag.preCreateMeasuredTemplate` fills it in:
a cube's width is its size (a line S long and S wide *is* the cube seen from
above); a wall without one gets one grid square.

Also clears templates on turn change, with `Alt+Delete` to clear by hand
(registered in `init` — a keybinding registered in `ready` throws and never exists).

> Note for v14: `MeasuredTemplateDocument` is deprecated — "merged into the
> functionality of the Region document" — and the TemplateLayer's scene controls
> are `visible: false`. Region cones default to **60°**, while 5e/ToV cones are
> **53.13°** (`CONFIG.MeasuredTemplate.defaults.angle`).

---

## Canvas Redo (`canvas-redo`)

Foundry has undo (`Ctrl+Z`) but no redo. This adds `Ctrl+Y` / `Ctrl+Shift+Z`.

Implemented as snapshot-and-diff rather than by replaying history entries,
because **`TokenLayer#storeHistory` strips `MOVEMENT_FIELDS`** from the entry it
records — so a naive redo silently loses token movement.

---

## The other modules

**Action Type Labels** (`action-labels`) — tags every ability in a Black Flag NPC
stat block as Action, Bonus Action, Reaction, Free Action, Passive Effect,
Legendary or Lair Action, as short tags or in full. Display only.

**Auto Damage, Roll Review and Crit Tables** (`bf-auto-damage`) — when an attack
hits a targeted token, rolls its damage (dice doubled on a crit) and can apply it,
respecting resistances and immunities. Uses Black Flag's `blackFlag.postRollAttack`
hook and the attack card's own hit rule. Optionally holds every GM roll for review
(Reroll, Confirm, Discard) before players see it, and draws from critical hit and
failure tables.

**Dead Tokens** (`dead-tokens`) — a creature at 0 HP is faded, desaturated, drawn
under living tokens and crossed by a large skull; healing revives it.

**Undo Damage** (`hp-undo`) — Ctrl+Z reverses the last hit point change (damage,
healing or temp HP), Ctrl+Y re-applies it. With nothing to undo, the key falls
through to Foundry's own canvas undo.

**Roller Portraits** (`roller-portraits`) — the roller's portrait and name in the
header of chat messages and Black Flag's roll dialogs.

**Trait Reminders** (`trait-reminders`) — whispers the GM when a monster's passive
trait should trigger: auras at turn start/end, start/end-of-turn traits, on-kill
and on-damage traits, with the trait text included. Never applies anything itself.

**Everyone Speaks Common** (`tselverse-common`) — house rule: every PC and every
speaking NPC knows Common, applied at data preparation (nothing is written to
actors). Also: one display name per source book, weapon mastery buttons and a few
small fixes.

**Intelligence Proficiencies** (`tselverse-intellect`) — the Dungeon Coach's house
rule: extra proficiencies equal to the INT modifier, as written or as Intellect
Points. Layered on through the system's advancement pipeline, so un-picking one
removes it cleanly.

**Creature Journals** (`tselverse-notes`) — a book button in the Token HUD opens a
GM journal for that creature type, or for that one token; created on demand.

**Arachnophobia Cats** (`tselverse-phobia`) — chosen players see a cat instead of
every token of the creatures you list (spiders, insects...), on the map and in the
combat tracker. Client-side only; nothing is saved. The 21 cat photos are CC0
from Wikimedia Commons (`cats/CREDITS.md`).

**Matching Portrait & Token** (`tselverse-portraits`) — an actor with a portrait
but the default token gets a token cropped around the face. Uses
[face-api](https://github.com/vladmandic/face-api) (MIT, `lib/face-api-LICENSE.txt`).

**Show Map in Files** (`tselverse-scene-preview`) — right-click a scene to open
your file manager on its map image. Needs a small local helper (`foundry-reveal`,
not included); without it, the path is copied to the clipboard.

**Set Level** (`tselverse-setlevel`) — type a level beside Level Up and the
character goes there in one go, still asking every choice along the way.

**Ship Bridge (Dark Matter)** (`tselverse-ships`) — Dark Matter Sci-Fi 5E ship
combat on Black Flag vehicles: crew roles and their actions, directional shields
that recharge, explosion saves at 0 Mega HP, and the movement cone on the map.
Rules mechanics only; no book text.

**Tselverse Shops** (`tselverse-shops`) — Item Piles merchants open on a category
browser, sorted cheapest first; the GM gets an item picker and shop-stock tables.

**Spell List** (`tselverse-spells`) — a creature's spells as a table on its stat
block with cast buttons, spell names in Spellcasting traits turned into links,
search and grouping in the Spell Manager, Ctrl+Scroll zoom, and a GM Spellbook.
`data/spells.json` (spell roles and book names) ships empty: it is generated per
world, and spells not in it simply show without roles. The same goes for
`data/class-spells.json`, `data/element-spells.json` and `data/spell-sources.json`
(extra spells for class lists, Bender elements and spell sources).

**Shared Treasure** (`tselverse-treasure`) — a party stash anyone can open; drag
items in, take them out, claim them or mark "if no one needs it". Works without a
GM online.

**Tamer Companions** (`tselverse-companions`) — companions on Black Flag: any
character whose features give a companion can bond a creature, summon and dismiss
it, heal it on long rests and have it act right after them. For the tamer (Ryoko's
Guide to the Yokai Realms) also: bonding into a vessel, bonded-companion limits by
level, Companion Improvement Training and its Hit Dice, the Soul Bond healing pool
and a shared initiative, all from a Companions button on the sheet.

**Battle Simulator** (`tselverse-battlesim`) — put creatures on a map and watch them
fight it out, sides by token disposition. Each creature moves and uses its real
attacks, multiattack, saving-throw and recharge abilities, spells, healing and
legendary actions; every roll goes to a GM-only chat card, and Reset puts
positions, hit points and uses back. Macros: Simulate Battle, Stop Battle, Reset
Battle.

---

## Installing

Copy any module folder into `Data/modules/` and enable it in **Manage Modules**.
Not submitted to Foundry's package registry; there is no manifest URL.

## Licence

MIT — see [LICENSE](LICENSE). No game content is included; these are code only, with one
exception: the weapon mastery rules in `tselverse-common/scripts/mastery.mjs` come
from the SRD 5.2.1 (see below). Rules text from books that can't be shared (Complete
Dancer's two masteries) and lists made for one world (book titles, spell lists) ship
as empty files to fill in per world.
Bundled third-party files keep their own licences: face-api (MIT) in
`tselverse-portraits/lib/`, and the CC0 cat photos in `tselverse-phobia/cats/`.

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by
Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is
licensed under the Creative Commons Attribution 4.0 International License, available
at https://creativecommons.org/licenses/by/4.0/legalcode.

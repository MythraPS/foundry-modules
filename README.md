# Foundry VTT modules

Three small modules for **Foundry VTT v14**, two of them specific to the
**Black Flag** (Tales of the Valiant) system.

Each one exists because something in core or the system did not behave the way a
table needs it to. The notes below record *why*, with the source lines that
justify the approach — those were the expensive part to work out, not the code.

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
* **Placement is measured from the artwork.** Token art varies wildly in how much
  of its canvas it fills — inset "ring room" discs reach ~0.60 of the radius,
  Black Flag's own art ~0.98 — so a fixed distance sits neatly outside one and
  buried inside the other. The module samples the alpha bounding box once per
  texture and anchors the arrow's base to the real edge.

Per-creature opt-out and per-creature colour override live on the token's
Appearance tab, on both the token and the prototype.

---

## Black Flag Area Targets (`bf-area-targets`)

When an activity places an area template, target every token inside it, and let
the save/check buttons on a chat card roll against those targets.

Black Flag's `getActionTargets()` reads only `canvas.tokens.controlled` and
carries a `TODO: Alternatively fetch targeted tokens`. This fills that in.

Also clears templates on turn change, with `Alt+Delete` to clear by hand.

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

## Installing

Copy any module folder into `Data/modules/` and enable it in **Manage Modules**.
Not submitted to Foundry's package registry; there is no manifest URL.

## Licence

MIT — see [LICENSE](LICENSE). No game content is included; these are code only.

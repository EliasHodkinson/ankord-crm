# Ankor'd CRM — design system

Incumbent authority: **Ankor'd Complete Brand Guidelines** (Softriver, 2026) and
the official logo artwork. This document records how that brand becomes an
interface; it does not invent a new visual world.

## Mode
**Operate.** People are in a task. Scanability and consistency outrank
expression. The brand shows up in precision — the navigation colour, the
Sunrise accent on exactly one thing per view, the shape language of the mark.

## Colour
From the guidelines, unchanged:

| Token | Hex | Role in the CRM |
|---|---|---|
| Deep Coastal | `#08393a` | Navigation rail, primary buttons, headings on light |
| Sunrise | `#d2691e` | The single accent: primary action, current selection, focused state |
| White | `#ffffff` | Content surfaces |
| Sea Mist | `#a8bdb8` | Dividers, muted marks, chart neutrals |
| Coastal Teal | `#2e7a78` | Focus ring, informational state, secondary emphasis |
| Charcoal Ink | `#1c2826` | Body text |

Ramps for each are declared in `globals.css`; nothing outside the file invents a
colour. Semantic tokens (`--surface`, `--border`, `--nav-bg`, `--ok`, `--warn`,
`--danger`) sit on top so light and dark are one substitution.

The content area is a warm off-white (`#f4f7f6`) with white cards; the
navigation rail is Deep Coastal. That is the second neutral layer Operate mode
asks for, and it is also how the brand's own layouts read — dark teal panel,
generous white, orange doing one job.

Sunrise is reserved for: the primary button in a view, the active navigation
item's marker, and genuinely urgent state. It never decorates.

One accessibility adjustment: pure Sunrise reaches only 3.6:1 against white, so
anything carrying text — the primary button, accent links — uses Sunrise 600
(`#b25517`, 5.0:1). The pure hue lives on in `--accent-mark` for the emblem
watermark, the navigation marker and other non-text uses. Every text pair in
the system was measured; none is below 4.5:1.

The navigation rail stays Deep Coastal in dark mode as well as light. On a
near-black page it still reads as a distinct panel, and it keeps the one piece
of the interface that is unmistakably Ankor'd constant between themes.

## Type
Primary typeface **Aeonik** is a licensed face and is not embedded here.
**Figtree** is the substitute: the same geometric-grotesque construction,
matching x-height and a near-identical `a`, `g` and `r`, available for web use.
One family carries everything — headings, labels, data, buttons.

Fixed rem scale, ratio ≈1.15, tracking tightening as size grows, per the
guidelines' `-3%` display tracking:

`11px` micro-label · `12px` meta · `13px` dense table · `14px` body ·
`16px` lead · `20px` card title · `24px` page title · `30px` display

Numbers in tables, money and dates use `font-variant-numeric: tabular-nums`.

## Shape and depth
- Radius `10px` on cards and inputs, `8px` on buttons and chips, `999px` on
  avatars and status dots. The mark's own terminals are round; the interface
  echoes that without becoming soft.
- Shadows are offset and blurred, tinted with Deep Coastal rather than black.
  Cards rest on a hairline border first, shadow second.
- The emblem's 45° diagonal is the only decorative motif, used at very low
  contrast and only on empty states and the sign-in panel.

## Motion
150–250ms, ease-out, on state only: hover, selection, disclosure, row focus.
No page-load choreography. All of it drops out under `prefers-reduced-motion`.

## Charts
One ordinal ramp, drawn from Coastal, `--chart-1` through `--chart-6`. Funnel
stages are ordinal — the order is part of the meaning — so the colour carries
the order rather than spending the identity channel on it.

Dark mode is a *selected* set of steps from the same ramp anchored the other
way, not an inversion: every step clears 3:1 against its own surface. Bars cap
at 20px with a 4px rounded data-end and a square baseline; gridlines are
hairline; a single series gets no legend box because the title names it. Every
chart carries a "Show the numbers" table, so nothing is gated behind colour.

Status colours (`--ok`, `--warn`, `--danger`) are reserved for state and never
reused as a series colour.

## Density
Tables run at 13px with 40px rows and no zebra striping — a hairline between
rows and a hover tint does the work. Record pages are two columns on wide
screens: the record on the left, the timeline and files on the right.

# DESIGN.md

Design source of truth for dsh-memory-evolve's web UI. This records the language the plugin already uses; it does not introduce a new one. New surfaces reuse these tokens and components.

## Principles

- Dense, calm, utilitarian. The UI is a tool, not a landing page.
- One primary action per pane.
- Empty states name the next action, not just the absence.
- Every degraded state is visible, never silent.
- No gradients, no marketing hero, no generic card grid.

## Typography

- System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- Mono: `ui-monospace, SFMono-Regular, Menlo, monospace` for ids, tiers and scores.
- Sizes: 12px meta, 13px body, 14px list row, 16px section title, 20px page title.
- Line height: 1.4 body, 1.2 headings.

## Color

- Base: background `#ffffff` / `#111418` (dark), surface `#f6f7f9` / `#1a1d21`, border `#e3e6ea` / `#2a2f36`.
- Text: primary `#1c2024` / `#e8eaed`, secondary `#5b6470` / `#9aa3ad`.
- Accent: a single blue `#2f6fed` for primary actions and selection.
- Semantic: success `#1a7f37`, warning `#b26a00`, danger `#c62828`. Always pair color with text or an icon.

## Spacing

- 4px scale: 4, 8, 12, 16, 24, 32.
- List row padding `8px 12px`; detail field gap `8px`; section gap `24px`.

## Components to reuse

- **Sub-tab bar**: the existing `MemoryTabView` Guide/Suggestions pattern.
- **List row**: 44px minimum height, title, meta line, status chip.
- **Detail field**: 12px secondary label, 13px primary value, 8px gap.
- **Status chip**: 20px tall, 12px text, neutral background, semantic dot.
- **Header badge**: 20px tall, 12px text, icon plus tier name; a dot below 480px.
- **Buttons**: 32px minimum, 44px on touch; primary filled accent, secondary outline.
- **Focus ring**: 2px accent, 2px offset; never remove it.

## Interaction

- Keyboard: arrow keys move list selection; Enter opens the detail; Esc closes the detail or editor; the editor traps focus.
- Touch targets: 44x44px minimum.
- Contrast: 4.5:1 for body text, 3:1 for large text and UI boundaries.
- Reduced motion: no animation beyond a 120ms opacity change.

## Responsive

- `>= 900px`: master-detail, two panes.
- `600-899px`: the list is full width; the detail overlays from the right.
- `< 600px`: the list, then the detail full screen with a Back control; filters collapse to a sheet.
- Header badge: the tier name at `>= 480px`, a dot below.

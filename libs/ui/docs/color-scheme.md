# Color Scheme Variables

Theme-sensitive palette tokens are defined on `:root` and supported theme
ancestors, then inherited by components. Typography and component-local layout
tokens are declared on `.ez-root, [data-ezclassify]`; override those on the
component container. `EzTheme` can supply scoped palette overrides.

The tables list default light-theme values. Theme selectors can change them;
[`styles.css`](../src/styles.css) is the complete source of current defaults.

## Core Palette

| Variable                      | Default                            | Description                                                         |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `--ez-color-text`             | `inherit`                          | Primary text color                                                  |
| `--ez-color-background`       | `#ffffff`                          | Primary background color for inputs, panes, cards                   |
| `--ez-color-border`           | `#d1d5db`                          | Default border color for inputs, dropdowns, panels                  |
| `--ez-color-border-focus`     | `var(--ez-color-primary, #fdb827)` | Border color when an input or control has focus                     |
| `--ez-color-placeholder`      | `#767676`                          | Placeholder text and empty-state text color (WCAG AA on white)      |
| `--ez-color-muted`            | `#6b7280`                          | Secondary/muted text (descriptions, hints, counts)                  |
| `--ez-color-primary`          | `#fdb827`                          | Accent color for focus rings, active states, badges                 |
| `--ez-color-primary-contrast` | `#1c1c1c`                          | Text color on primary-colored backgrounds (badges, filled segments) |
| `--ez-color-error`            | `#b91c1c`                          | Error state color for borders and validation messages               |
| `--ez-color-success`          | `#22c55e`                          | Success state color for borders, checkmarks, progress bars          |
| `--ez-color-warning`          | `#f59e0b`                          | Warning color for caution states                                    |

## Surface Colors

| Variable                    | Default   | Description                                                        |
| --------------------------- | --------- | ------------------------------------------------------------------ |
| `--ez-color-surface`        | `#f8f9fa` | Secondary background for pane headers, group headers, preview      |
| `--ez-color-surface-hover`  | `#f3f4f6` | Hover background for list items, buttons                           |
| `--ez-color-surface-active` | `#e8f0fe` | Active/highlighted background for focused list items, filter focus |

## Focus

| Variable                 | Default                                                                           | Description                           |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| `--ez-focus-ring-shadow` | `0 0 0 3px color-mix(in srgb, var(--ez-color-primary, #3b82f6) 15%, transparent)` | Box-shadow for `.ez-input:focus` ring |

## Dropdown

| Variable                   | Default                                                                 | Description                                           |
| -------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `--ez-dropdown-background` | `var(--ez-color-background)`                                            | Dropdown panel background                             |
| `--ez-dropdown-color`      | `var(--ez-color-text)`                                                  | Dropdown text color                                   |
| `--ez-dropdown-shadow`     | `0 4px 6px -1px rgba(0,0,0,0.1)`                                        | Dropdown box-shadow                                   |
| `--ez-dropdown-item-hover` | `#f3f4f6`                                                               | Background on dropdown item hover                     |
| `--ez-dropdown-highlight`  | `color-mix(in srgb, var(--ez-color-primary, #3b82f6) 20%, transparent)` | Background for keyboard-highlighted items             |
| `--ez-dropdown-selected`   | `color-mix(in srgb, var(--ez-color-success, #22c55e) 10%, transparent)` | Background for already-selected items in multi-select |
| `--ez-dropdown-group-bg`   | `rgba(0,0,0,0.04)`                                                      | Background for group headers in dropdowns and matrix  |

## Marking Label

| Variable                     | Default   | Description                                        |
| ---------------------------- | --------- | -------------------------------------------------- |
| `--ez-marking-label-default` | `#6b7280` | Default background color for the marking label bar |
| `--ez-marking-label-text`    | `#ffffff` | Text color on the marking label bar                |

## Tags

TagInput chips (`.proto-tag`) render as filled pills: a category-colored
background with a contrast-checked text color, both set inline per chip by
`tag-factory.ts` (concept color coding, `data-ezclassify-tags-color-coding`).
The two variables below are only the fallback shown when color coding is off
for a chip (or the whole field); they are not general theme overrides for a
category-colored chip, JS wins there since it sets the same properties
inline, which beats a stylesheet rule of equal origin.

| Variable         | Default (light) | Description                                    |
| ---------------- | --------------- | ---------------------------------------------- |
| `--ez-tag-color` | `#475569`       | Chip text color when color coding is off       |
| `--ez-tag-bg`    | `#e2e8f0`       | Chip background color when color coding is off |

The remove (×) control has no separate color variable: it always inherits
`currentColor` from the chip (`--ez-tag-color` or the category text color),
so it stays legible against whatever background is in play, category-colored
or not.

## Keyboard Hints

| Variable              | Default            | Description                      |
| --------------------- | ------------------ | -------------------------------- |
| `--ez-kbd-background` | `rgba(0,0,0,0.06)` | Background for `<kbd>` hint keys |

## Single-Select Cards

| Variable                    | Default                                                                | Description                    |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `--ez-select-active-border` | `var(--ez-color-primary, #3b82f6)`                                     | Border color for selected card |
| `--ez-select-active-bg`     | `color-mix(in srgb, var(--ez-color-primary, #3b82f6) 6%, transparent)` | Background for selected card   |
| `--ez-select-hover-shadow`  | `0 1px 4px rgba(0,0,0,0.08)`                                           | Box-shadow on card hover       |

## Handbook

Tokens shared by both `Handbook` and `AccessHandbook` components.

| Variable                    | Default            | Description                                                                                                                                                                                               |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ez-handbook-overview-bg` | `rgba(0,0,0,0.02)` | Background of the overview section at the top of both handbook components. Near-transparent overlay; no separate dark-mode variant is needed; the value reads acceptably in both light and dark contexts. |

## Typography

| Variable           | Default   | Description                       |
| ------------------ | --------- | --------------------------------- |
| `--ez-font-family` | `inherit` | Font family for all form controls |
| `--ez-font-size`   | `inherit` | Base font size                    |
| `--ez-font-weight` | `inherit` | Base font weight                  |
| `--ez-line-height` | `inherit` | Base line height                  |

## Spacing

| Variable          | Default   | Description                                             |
| ----------------- | --------- | ------------------------------------------------------- |
| `--ez-spacing-xs` | `0.25rem` | Extra-small spacing (validation margins, group padding) |
| `--ez-spacing-sm` | `0.5rem`  | Small spacing (input padding, tag gaps)                 |
| `--ez-spacing-md` | `0.75rem` | Medium spacing (input horizontal padding)               |
| `--ez-spacing-lg` | `1rem`    | Large spacing (marking label padding)                   |

## Layout

| Variable             | Default      | Description                                |
| -------------------- | ------------ | ------------------------------------------ |
| `--ez-border-radius` | `0.375rem`   | Border radius for inputs, dropdowns, cards |
| `--ez-border-width`  | `1px`        | Border width for inputs                    |
| `--ez-transition`    | `150ms ease` | Default transition timing                  |
| `--ez-z-dropdown`    | `1000`       | Z-index for dropdown overlays              |

## Using Themes

Import `THEMES` and `applyTheme` from `themes.ts`:

```ts
import { THEMES, applyTheme } from '@ezclassify/ui';

// Adopt the theme stylesheet, then choose the subtree it styles.
const sheet = new CSSStyleSheet();
sheet.replaceSync(applyTheme(THEMES.dark));
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

// Scope to a subtree
container.setAttribute('data-theme', 'dark');
```

Built-in themes: `corporate`, `government`, `minimal`, `dark`.

### Custom theme

Create an `EzTheme` object and pass it to `applyTheme()`:

```ts
import type { EzTheme } from '@ezclassify/ui';

const myTheme: EzTheme = {
    name: 'My App',
    input: {
        '--ez-color-text': '#222',
        '--ez-color-background': '#fefefe',
        '--ez-color-primary': '#7c3aed',
        '--ez-color-primary-contrast': '#ffffff',
        '--ez-color-surface': '#f5f3ff',
        '--ez-color-surface-hover': '#ede9fe',
        '--ez-color-surface-active': '#ddd6fe',
        '--ez-focus-ring-shadow': '0 0 0 3px rgba(124, 58, 237, 0.15)',
        // ...
    },
    dropdown: {/* ... */},
    badge: {/* ... */},
    notice: {/* ... */},
};
```

### CSS-only override

You can also set variables directly in CSS without using `themes.ts`:

```css
[data-ezclassify] {
    --ez-color-primary: #7c3aed;
    --ez-color-primary-contrast: #ffffff;
    --ez-color-background: #1a1a2e;
    --ez-color-text: #e5e7eb;
    --ez-color-surface: #111827;
    --ez-color-surface-hover: #374151;
}
```

# `data-ezclassify-*` attribute reference

Every `data-ezclassify-*` attribute the runtime reads or writes, in one table.
This is the source of truth for what an author may put in markup and what the
runtime stamps back. It applies to vanilla `@ezclassify/ui` and, identically, to
the React / Vue / Angular adapters; the adapters only wire lifecycle; the
attributes are the same DOM contract.

Conventions used below:

- **Owner**: the module that reads (or stamps) the attribute.
- **Audience**: `author` (you set it in markup), `runtime` (the library stamps
  it; do not set it by hand), or `tooling` (used by the x-ray/locator overlay).
- **Scope**: `host` (any element; the binding/behavior seam) or
  `prefixed` (a `data-ezclassify-<controller>-<option>` option harvested for a
  specific controller).
- **Status**: `canonical`, or `internal` (runtime-stamped, not part of the
  authoring surface).

The seam between the two layers, engine **binding** (behavior) and visual
**treatment** (view), is documented in [`binding-model.md`](./binding-model.md);
this file is the flat attribute index that complements it.

---

## Host-level binding & behavior attributes

These live on any element. Carrying any one of them makes the element
"ezclassify-bound" and brings it into the scanner. Exactly one **binding axis**
attribute (`bound-to` / `facet-of` / `source` / `aggregate`) may be present per
element; if more than one is set the scanner keeps the first in that order and
warns.

| Attribute                              | Owner                                                                       | Audience          | Values                                                                                                                                                                                                                                                                             | Default                       | Status                                  |
| -------------------------------------- | --------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------- |
| `data-ezclassify-bind`                 | `element-scanner` / `ezclassify-ui`                                         | author            | presence-only; enhances a raw marking input, or binds a native `<select>` in place when combined with `facet-of` and `category`                                                                                                                                                    | (none)                        | canonical                               |
| `data-ezclassify-rendered`             | `element-scanner`                                                           | author            | presence-only; the element's DOM `id` is the marking id                                                                                                                                                                                                                            | (none)                        | canonical                               |
| `data-ezclassify-bound-to`             | `element-scanner`                                                           | author            | marking id (binding axis: two-way full-marking view)                                                                                                                                                                                                                               | (none)                        | canonical                               |
| `data-ezclassify-source`               | `element-scanner`                                                           | author            | marking id (binding axis: one-way read)                                                                                                                                                                                                                                            | (none)                        | canonical                               |
| `data-ezclassify-aggregate`            | `element-scanner`                                                           | author            | empty value for the page aggregate; whole marking id for its parts-only rollup                                                                                                                                                                                                     | (none)                        | canonical                               |
| `data-ezclassify-facet-of`             | `element-scanner`                                                           | author            | marking id (binding axis: two-way category-scoped view; use with `data-ezclassify-category`)                                                                                                                                                                                       | (none)                        | canonical                               |
| `data-ezclassify-category`             | `element-scanner` / `component-factory`                                     | author            | category id                                                                                                                                                                                                                                                                        | (none)                        | canonical                               |
| `data-ezclassify-part-of`              | `element-scanner`                                                           | author            | parent marking id (this field is one part of a composite marking)                                                                                                                                                                                                                  | (none)                        | canonical                               |
| `data-ezclassify-target`               | `element-scanner` / `forms/rollup`                                          | author            | element id this binding rolls up into                                                                                                                                                                                                                                              | (none)                        | canonical                               |
| `data-ezclassify-scope`                | `element-scanner` / `component-factory`                                     | author            | presence-only flag or scope label                                                                                                                                                                                                                                                  | (none)                        | canonical                               |
| `data-ezclassify-scheme`               | `element-scanner` / `component-factory`                                     | author            | scheme id (multi-scheme engines; inherited from nearest ancestor that sets it)                                                                                                                                                                                                     | engine default scheme         | canonical                               |
| `data-ezclassify-controller`           | `element-scanner`                                                           | author            | one of: `tags`, `select`, `checklist`, `selector`, `card`, `banner`, `dualpane`, `handbook`, `guidebook`, `access-handbook`, `guide-helper`, `guide-checklist`, `decisionflow`, `hidden`, `marked-textarea`, `marked-input`, `marking`, `text`, `equivalency`, `context-reference` | (none)                        | canonical                               |
| `data-ezclassify-format`               | `format-resolver` / `component-factory`                                     | author            | render-format id; honored on a plain enhanced input and on any controller host. A `data-ezclassify-<controller>-format` option on the same element wins. Read from the element itself, never inherited from an ancestor                                                            | context default render format | canonical                               |
| `data-ezclassify-role`                 | `components/ezclassify-text`                                                | author            | role string on a `text` host                                                                                                                                                                                                                                                       | (none)                        | canonical                               |
| `data-ezclassify-context`              | `components/ezclassify-text`, `hidden-assertion-field`, `marked-field-base` | author            | shared-context id linking related fields                                                                                                                                                                                                                                           | (none)                        | canonical                               |
| `data-ezclassify-group`                | `forms/rollup`                                                              | author            | rollup group label (fields sharing a group roll up together)                                                                                                                                                                                                                       | (none)                        | canonical                               |
| `data-ezclassify-show-when-parent-has` | `forms/rollup`                                                              | author            | `parentId:CONCEPT1,CONCEPT2`; element is shown only when the parent holds one of the listed concepts                                                                                                                                                                               | (none)                        | canonical                               |
| `data-ezclassify-hide-when-parent-has` | `forms/rollup`                                                              | author            | `parentId:CONCEPT1,CONCEPT2`; element is hidden when the parent holds one of the listed concepts                                                                                                                                                                                   | (none)                        | canonical                               |
| `data-ezclassify-error-target`         | `components/ezclassify-text`                                                | author            | id of the element that should display this field's error                                                                                                                                                                                                                           | (none)                        | canonical                               |
| `data-ezclassify-first-part-binding`   | `ezclassify-ui`                                                             | author            | marking id whose first part this composite host binds                                                                                                                                                                                                                              | (none)                        | canonical                               |
| `data-ezclassify-no-rollup`            | `forms/rollup` / `ezclassify-ui`                                            | author or runtime | presence-only; exclude this field from the page rollup (also stamped by the runtime on fields it auto-excludes)                                                                                                                                                                    | (none)                        | canonical (author) / internal (stamped) |
| `data-ezclassify-no-tooltips`          | `component-factory` / `components/component-base`                           | author            | presence-only; disables concept/detail hover tooltips for the host and its subtree (closest-ancestor semantics)                                                                                                                                                                    | tooltips enabled              | canonical                               |
| `data-ezclassify-no-hints`             | `component-factory` / `components/marked-field-base`                        | author            | presence-only; disables keyboard-hint chrome (hint footers, floating hint chips) for the host and its subtree; the touch "Add marking" affordance is core interaction and stays                                                                                                    | hints enabled                 | canonical                               |

A field that names no `data-ezclassify-format` writes the context default,
except a field that shows a part: one whose own host, or the marking it is
bound to or is a facet of, names a whole in `data-ezclassify-part-of`. That
field writes the scheme's part default, the format the store writes the part
in.

## Runtime-stamped attributes (do not author)

The runtime writes these onto the DOM as it mounts components. Authors read them
in tests and CSS but must not set them by hand.

| Attribute                    | Owner                               | Audience | Values                                                                                                                                                                           | Status   |
| ---------------------------- | ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `data-ezclassify-mount`      | `component-factory`                 | runtime  | the controller name on a sibling mount. Pickers render inside it; text editors use their own wrappers. In-place views have no sibling mount (see binding model §3.2).            | internal |
| `data-ezclassify-mount-root` | `ezclassify-ui` / `element-scanner` | runtime  | the instance id stamped on each `EzClassifyUI` root; the cross-instance ownership boundary.                                                                                      | internal |
| `data-ezclassify-error`      | `forms/rollup` / `forms/styles`     | runtime  | presence-only; stamped on a field without a component that failed the rollup's check, styled by the default stylesheet. A component shows the failure in its own errors instead. | internal |
| `data-ezclassify-invalid`    | `ezclassify-ui`                     | runtime  | presence-only; stamped on a mount container whose value is invalid.                                                                                                              | internal |
| `data-ezclassify-powered`    | `component-locator`                 | tooling  | presence-only; marks native elements a developer populates in JS so the x-ray overlay can highlight them.                                                                        | internal |

### Enhancement status mark (runtime element, not an attribute)

Each enhanced input and textarea carries one `.ez-status-mark` element inside
its wrapper. MarkedInput and MarkedTextArea place it in their bottom hint row
alongside the ★ favorites button, right-aligned opposite the ⌘+Enter tip;
MarkingField and TagInput place it in a small ★ drawer attached to the
field's bottom-right edge (mirroring to the top-right while the field's own
suggestion dropdown is open below it: the drawer always sits on the edge
OPPOSITE the dropdown, never the same one). The mark is the 3-bar-plus-sparkle
brand glyph and cycles through three
states as fixes arrive and get noticed: `.ez-status-mark--quiet` (the
default: nothing applied yet, whole glyph muted), `.ez-status-mark--unseen`
(EzClassify applied a fix the user hasn't been shown yet: the sparkle turns
accent-colored, a corner notification dot appears, and the sparkle pulses on
an interval), and `.ez-status-mark--seen` (the fix tooltip has actually
presented, past its hover-intent delay, or the mark was focused: the dot
clears but the accent sparkle stays). A fourth state,
`.ez-status-mark--error`, overrides the other three while the field could not
check all of its text, as when a MarkedTextArea's scan stops before the end of
the body: the sparkle takes the error color and the popover and label lead with
the reason. Hovering or focusing an active (non-quiet) mark lists each change the
engine applied, once, in the engine's own words for it. Style hooks:
`--ez-status-mark-color` for the resting/muted color, the shared
`--ez-color-primary` for the accent sparkle and dot, the shared
`--ez-color-error` for the error sparkle, and
`--ez-status-mark-ring` for the color of the ring that stands the dot off the
background it sits on (falls back to `--ez-color-background`). The
`data-ezclassify-no-tooltips` opt-out silences the mark's explanation like any
other tooltip; the mark itself is state display and cannot be disabled.

### Incomplete readings (runtime elements, not attributes)

When a MarkedTextArea's scan stops before the end of its text, or fails, the
field says so in words as well as on its status mark. A
`.marked-textarea-scan-notice` element in the field's mount container shows
`⚠` (`.marked-textarea-scan-notice__icon`, hidden from assistive technology)
and the `mark.scanIncomplete` message (`.marked-textarea-scan-notice__text`).
The textarea is described by it (`aria-describedby`) while it shows, and a
polite live region announces the message once when it appears. The notice is
`hidden` otherwise.

A banner showing a rollup the store flags `stale`, or a marking bound to a
first portion no scan has read, gains `.status-banner--incomplete` and a
`.status-banner-incomplete` line with `⚠`
(`.status-banner-incomplete__icon`) and the `rollup.incomplete` message, which
its accessible name also carries. The runtime's rollup field
(`#ezclassify-rollup` or the configured `rollupId`) carries the same message as
its custom validity, with `aria-invalid="true"`, while its scope's rollup may
be incomplete. The default hidden input is barred from constraint validation,
so it does not block a submit; the textarea's own validity does. Both messages
are locale keys and follow `setLocale`.

## Prefixed controller options

Each controller harvests `data-ezclassify-<controller>-<option>` attributes off
its host into an options bag (see `element-scanner.harvestControllerOptions` and
`component-factory.parseComponentOptions`). Parsed `show-*` flags are enabled by their presence, including a value of
`"false"`. Other flags and options follow their table entries. JSON options must be valid JSON. Unknown suffixes pass through
verbatim and have no effect unless the controller reads them.

| Attribute                                   | Controller        | Audience | Values                                                                 | Default                          | Status    |
| ------------------------------------------- | ----------------- | -------- | ---------------------------------------------------------------------- | -------------------------------- | --------- |
| `data-ezclassify-tags-color-coding`         | `tags`            | author   | `"false"` opts out; any other value (or absence) keeps color coding on | on                               | canonical |
| `data-ezclassify-tags-show-preview`         | `tags`            | author   | presence-only; render a live rendered-string preview                   | off                              | canonical |
| `data-ezclassify-select-category`           | `select`          | author   | category id                                                            | host `data-ezclassify-category`  | canonical |
| `data-ezclassify-select-mode`               | `select`          | author   | `"dropdown"` or `"cards"`                                              | `dropdown`                       | canonical |
| `data-ezclassify-select-color-map`          | `select`          | author   | JSON color map                                                         | (none)                           | canonical |
| `data-ezclassify-checklist-category`        | `checklist`       | author   | category id                                                            | host `data-ezclassify-category`  | canonical |
| `data-ezclassify-checklist-show-preview`    | `checklist`       | author   | presence-only; render a live preview                                   | off                              | canonical |
| `data-ezclassify-selector-category-groups`  | `selector`        | author   | JSON array of category groups                                          | (none)                           | canonical |
| `data-ezclassify-selector-show-codes`       | `selector`        | author   | presence-only; show concept codes alongside labels                     | off                              | canonical |
| `data-ezclassify-banner-affix`              | `banner`          | author   | `top` or `bottom`; fixed viewport edge                                 | (none)                           | canonical |
| `data-ezclassify-banner-boundary`           | `banner`          | author   | boundary the current marking is measured against                       | (none)                           | canonical |
| `data-ezclassify-banner-show-current-data`  | `banner`          | author   | presence-only; show the current-data line                              | on when boundary or affix is set | canonical |
| `data-ezclassify-banner-current-label`      | `banner`          | author   | label for the current-data line                                        | scheme vocabulary                | canonical |
| `data-ezclassify-banner-boundary-label`     | `banner`          | author   | label for the boundary line                                            | scheme vocabulary                | canonical |
| `data-ezclassify-decisionflow-categories`   | `decisionflow`    | author   | JSON array (or comma list) of category ids to walk                     | (none)                           | canonical |
| `data-ezclassify-equivalency-equivalencies` | `equivalency`     | author   | JSON array of `{ source, target }` equivalency entries                 | (none)                           | canonical |
| `data-ezclassify-equivalency-source-label`  | `equivalency`     | author   | header label for the source column                                     | (none)                           | canonical |
| `data-ezclassify-equivalency-target-label`  | `equivalency`     | author   | header label for the target column                                     | (none)                           | canonical |
| `data-ezclassify-hidden-format`             | `hidden`          | author   | render-format id for the hidden rollup field                           | context default                  | canonical |
| `data-ezclassify-marked-textarea-format`    | `marked-textarea` | author   | render-format id                                                       | context default                  | canonical |
| `data-ezclassify-text-format`               | `text`            | author   | render-format id                                                       | context default                  | canonical |

> Shared options harvested off the host (not under the controller prefix):
> `data-ezclassify-scope`, `data-ezclassify-scheme`, and `data-ezclassify-category`
> are read once on the host so they don't need to be repeated under each
> controller prefix; see `component-factory.parseComponentOptions`.

## Context reference drawer

The `context-reference` controller mounts in place and reads these presentation
options from `data-ezclassify-context-reference-<option>`:

| Option           | Values                                                                   | Default               |
| ---------------- | ------------------------------------------------------------------------ | --------------------- |
| `placement`      | `left`, `right`, `top`, `bottom`                                         | `right`               |
| `size`           | CSS length                                                               | controller stylesheet |
| `open`           | presence opens; `"false"` closes                                         | closed                |
| `tabs`           | comma-separated tab ids; built-ins are `handbook`, `guidebook`, `access` | available built-ins   |
| `theme`          | preset theme slug                                                        | inherited theme       |
| `tab-label-<id>` | tab label override                                                       | built-in label        |
| `tab-icon-<id>`  | short text or emoji                                                      | built-in icon         |

Direct children declaring `data-ezclassify-tab` supply custom tabs. They accept
`data-ezclassify-tab-id`, `data-ezclassify-tab-label` (defaults to the tab id),
`data-ezclassify-tab-icon`, and numeric `data-ezclassify-tab-order`.

## Instance-level options (not attributes)

A `data-ezclassify-*` value is always a string on an element, so it can only
carry serializable config. A few options are functions instead, and those have
no data-attribute form at all: a declarative host sets them once, on the
`EzClassifyUI` constructor, and every scanner-mounted field in that instance
picks them up through its `ComponentOptions`.

| Option      | Constructor option                         | Shape                                                                                    | Threaded into                                                                                        | Default                          |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| `favorites` | `new EzClassifyUI(adapter, { favorites })` | `FavoritesConfig` (`load`/optional `save`/`remove`, see `components/favorites-panel.ts`) | `ComponentOptions.favorites` on every `tags`, `marked-textarea`, `marked-input`, and `marking` mount | unset (★ button does not render) |

`favorites.load` is called with `{ schemeId, scope, formatId }` every time a
field's ★ popover opens; the component never caches the result across opens.
The library stores nothing itself: a host owns persistence entirely and
observes an applied favorite the same way it observes any other edit, through
the field's native `input`/`change` events (Host Form Contract). Framework
integrations that construct `EzClassifyUI` internally (React/Vue/Angular)
accept and forward the same option; see their own docs for the prop/attribute
name.

A host supplies one `FavoritesConfig` with its own persistence, such as
`localStorage` for one browser or a server for shared favorites. The same three
hooks support either choice; no field component code changes.

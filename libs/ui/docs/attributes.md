# `data-ezclassify-*` attribute reference

Every `data-ezclassify-*` attribute the runtime reads or writes, in one table.
This is the source of truth for what an author may put in markup and what the
runtime stamps back. It applies to vanilla `@ezclassify/ui` and, identically, to
the React / Vue / Angular adapters. The adapters only wire lifecycle; the
attributes are the same DOM contract. After initialization, everything is
markup.

Conventions used below:

- **Owner**: the module that reads (or stamps) the attribute.
- **Audience**: `author` (you set it in markup) or `runtime` (the library
  stamps it; do not set it by hand).
- **Scope**: `host` (any element; the binding/behavior seam) or
  `prefixed` (a `data-ezclassify-<controller>-<option>` option harvested for a
  specific controller).

What wholes, parts, collections and views mean, and how a store holds them,
is specified in [`binding-model.md`](./binding-model.md); this file is the flat
attribute index that complements it.

---

## Host-level attributes

These live on any element. Carrying any one of them brings the element into the
scanner; ordinary page text is never read. Exactly one **view** attribute
(`bound-to` / `facet-of` / `source` / `aggregate`) may be present per element;
if more than one is set the scanner keeps the first in that order and warns.

The attributes split into five groups:

- **Markings.** `controller` names what a field holds; `marking` declares a
  marking with no controller.
- **Structure.** `whole`, `part-of`, `collection`, `member-of` and `ignore`
  place each marking in the tree. Most pages need only `whole`.
- **Views.** `bound-to`, `facet-of`, `source`, `aggregate` and `translate` show
  or edit a marking or a level. A view never contributes to a rollup.
- **Selection and presentation.** `context` and `scheme` choose what a marking
  is read against; the rest are presentation and opt-outs.
- **Developer tools.** `powered` marks content your own code fills from
  EzClassify data. The runtime does not read it; the devtools overlay shows it.

| Attribute                              | Owner                                                | Audience | Values                                                                                                                                                                                                                                                                                                   | Default                       |
| -------------------------------------- | ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `data-ezclassify-controller`           | `element-scanner`                                    | author   | one of: `tags`, `select`, `checklist`, `selector`, `card`, `banner`, `dualpane`, `handbook`, `guidebook`, `access-handbook`, `crosswalk-handbook`, `guide-helper`, `guide-checklist`, `decisionflow`, `hidden`, `marked-textarea`, `marked-input`, `marking`, `text`, `equivalency`, `context-reference` | (none)                        |
| `data-ezclassify-marking`              | `binding-model` / `ezclassify-ui`                    | author   | presence-only; a marking with no controller, whose DOM `id` is the marking id. A visible text input gets the validation helper, a hidden input holds the value as data, and any other element shows the rendered text. A native `<select>` with `facet-of` and `category` binds in place without it      | (none)                        |
| `data-ezclassify-whole`                | `binding-model`                                      | author   | on a container: the marking id of the whole it holds. The host with that DOM id is the whole; every other marking host inside is a part of it                                                                                                                                                            | (none)                        |
| `data-ezclassify-part-of`              | `binding-model`                                      | author   | whole marking id, on a part that does not sit inside its whole's container. It always names a whole and the host always reads as a part                                                                                                                                                                  | (none)                        |
| `data-ezclassify-collection`           | `binding-model` / `store`                            | author   | on a container: the collection id. The wholes and collections nested inside it are its members                                                                                                                                                                                                           | (none)                        |
| `data-ezclassify-member-of`            | `binding-model`                                      | author   | collection id, on a whole or collection that does not sit inside the collection it belongs to                                                                                                                                                                                                            | nearest enclosing collection  |
| `data-ezclassify-ignore`               | `binding-model` / `element-scanner`                  | author   | presence-only; nothing inside the subtree is read. A marking host inside it is a host error                                                                                                                                                                                                              | (none)                        |
| `data-ezclassify-bound-to`             | `element-scanner`                                    | author   | marking id (view: two-way full-marking editor)                                                                                                                                                                                                                                                           | (none)                        |
| `data-ezclassify-facet-of`             | `element-scanner`                                    | author   | marking id (view: two-way category-scoped editor; use with `data-ezclassify-category`)                                                                                                                                                                                                                   | (none)                        |
| `data-ezclassify-category`             | `element-scanner` / `component-factory`              | author   | category id                                                                                                                                                                                                                                                                                              | (none)                        |
| `data-ezclassify-source`               | `element-scanner`                                    | author   | marking id (view: one-way read)                                                                                                                                                                                                                                                                          | (none)                        |
| `data-ezclassify-aggregate`            | `element-scanner` / `forms/rollup`                   | author   | empty (or `"true"`) for the page; a whole id for its parts; a collection id for its members. With no controller, a hidden input holds the value and any other element shows it as text                                                                                                                   | (none)                        |
| `data-ezclassify-translate`            | `components/translated-view`                         | author   | crosswalk id; on a view, shows its value translated through that crosswalk. Empty when the Context holds exactly one crosswalk from its primary scheme                                                                                                                                                   | (none)                        |
| `data-ezclassify-context`              | `context-binding`                                    | author   | Context key from the `contexts` map given at initialization. Needed only with several Contexts. A marking host inherits it from the nearest ancestor that sets one; a level view filters by its own attribute only                                                                                       | the only Context              |
| `data-ezclassify-scheme`               | `context-binding` / `component-factory`              | author   | the Context-local scheme selector. Inherited from the nearest ancestor that sets it. A marking host marks only in the Context's primary scheme; one that selects another is a host error                                                                                                                 | the Context's primary scheme  |
| `data-ezclassify-format`               | `format-resolver` / `component-factory`              | author   | render-format id; honored on a plain enhanced input and on any controller host. Read from the element itself, never inherited from an ancestor                                                                                                                                                           | context default render format |
| `data-ezclassify-role`                 | `components/ezclassify-text`                         | author   | `part`, on a `text` host that shows a part with no whole on the page. Every other role comes from structure                                                                                                                                                                                              | (none)                        |
| `data-ezclassify-scope`                | `element-scanner` / `component-factory`              | author   | scope label, on a whole field that authors a non-default scope. A facet takes its scope from its category's declared scope instead. It never removes a field from a rollup                                                                                                                               | (none)                        |
| `data-ezclassify-show-when-parent-has` | `forms/rollup`                                       | author   | `parentId:CONCEPT1,CONCEPT2`; element is shown only when the parent holds one of the listed concepts                                                                                                                                                                                                     | (none)                        |
| `data-ezclassify-hide-when-parent-has` | `forms/rollup`                                       | author   | `parentId:CONCEPT1,CONCEPT2`; element is hidden when the parent holds one of the listed concepts                                                                                                                                                                                                         | (none)                        |
| `data-ezclassify-error-target`         | `components/ezclassify-text`                         | author   | id of the element that should display this field's error                                                                                                                                                                                                                                                 | (none)                        |
| `data-ezclassify-no-rollup`            | `store` / `forms/rollup`                             | author   | presence-only; a live control that is not content, such as a filter picker. It is processed and validated but feeds no rollup. A host error on a part or on a whole with parts                                                                                                                           | (none)                        |
| `data-ezclassify-no-tooltips`          | `component-factory` / `components/component-base`    | author   | presence-only; disables concept/detail hover tooltips for the host and its subtree (closest-ancestor semantics)                                                                                                                                                                                          | tooltips enabled              |
| `data-ezclassify-no-hints`             | `component-factory` / `components/marked-field-base` | author   | presence-only; disables keyboard-hint chrome (hint footers, floating hint chips) for the host and its subtree; the touch "Add marking" affordance is core interaction and stays                                                                                                                          | hints enabled                 |
| `data-ezclassify-powered`              | `devtools/component-locator`                         | author   | presence-only; content your own code fills from EzClassify data, so the devtools overlay can show it. On a container it covers the subtree with one outline. The library never sets it                                                                                                                   | (none)                        |

Presence attributes read `"true"` as present and `"false"` as absent, so a
framework that writes booleans as strings works unchanged.

### Seeing them on a page

The "Highlight components" overlay outlines everything on a page these
attributes describe, one color per group, and lists hidden inputs it cannot
outline. It ships from its own entry so it never reaches a production bundle
unless you import it:

```ts
import { createComponentLocator } from '@ezclassify/ui/devtools';

document.body.append(createComponentLocator().element);
```

Loading that entry also defines `ezclassify.devtools()`, so on a page with no
build step you can turn the highlights on from the browser console and off
again with `ezclassify.devtools(false)`.

### Where a marking sits

| Where the marking host sits                            | It reads as                               |
| ------------------------------------------------------ | ----------------------------------------- |
| Inside a `whole` container, other than the named whole | a part of that whole                      |
| Anywhere, with `part-of`                               | a part of the named whole                 |
| Inside a collection, outside any `whole` container     | a whole, member of the nearest collection |
| In neither                                             | a whole, member of the page               |

The instance root is the page. A nested library instance (a framework island)
is a member of the nearest collection around it.

A field that names no `data-ezclassify-format` writes the context default,
except a field that shows a part: a part itself, or a view bound to a part or
a facet of one. That field writes the scheme's part default, the format the
store writes the part in.

### Host errors

Where markup contradicts itself, the runtime refuses it instead of guessing.
The element stays unenhanced, an `ezclassify:host-error` event bubbles from it
with a `code` and a `message`, and every level above it is flagged incomplete,
from the collection it sits in and the whole that encloses it up to the page:
an unread marking is never treated as an absent one. Markup refused for what it
names elsewhere (a missing whole or collection, a whole of another Context, an
id another host holds) is read again when that element arrives, leaves or is
renamed. The cases:

- a marking host or a view inside an `ignore` subtree;
- a `whole` container with no value, naming no host, or inside another `whole`
  container;
- a collection with no value, inside a `whole` container, or on a marking host;
- a `part-of` that names no element, names something other than a whole,
  disagrees with its
  enclosing `whole` container, crosses Contexts or schemes, or sits on an
  element that holds no marking;
- a `member-of` that names no collection, sits on a part, or names its own
  collection or one inside it;
- `no-rollup` on a part or on a whole with parts;
- `data-ezclassify-marking` together with a view attribute;
- a nested library instance inside a `whole` container;
- a marking host that resolves no Context, or selects a scheme other than its
  Context's primary, and one marking id on two marking hosts;
- a `translate` view on a form control or a controller host, or with no
  crosswalk to translate through;
- a controller-less `aggregate` output that does not name its bucket when its
  level has several (see below).

### Rollup outputs and buckets

A rollup is kept per bucket: one Context key and one scheme selector. Buckets
never merge. A `banner` on a level shows every non-empty bucket, and every
bucket missing a marking as not read, each labeled whenever the level can hold
more than one, unless its own `context` or `scheme` attribute picks one. A controller-less
output holds one value, so when the instance has several Contexts, or the
Context several schemes, the output names its bucket with its own `context` and
`scheme` attributes.

Each change to a level fires `ezclassify:rollup` on the level's element (the
instance root for the page, a collection's container, a whole's host).
`detail.level` names the level, `null` for the page, and `detail.buckets` lists
each bucket that holds a marking or misses one as
`{ context, scheme, rendered, assertions, stale }`. `context` and `scheme` are
`null` for the only Context and for a Context's primary scheme.

## Runtime-stamped attributes (do not author)

The runtime writes these onto the DOM as it mounts components. Authors read them
in tests and CSS but must not set them by hand.

| Attribute                    | Owner                               | Audience | Values                                                                                                                                                                           | Status   |
| ---------------------------- | ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `data-ezclassify-mount`      | `component-factory`                 | runtime  | the controller name on a sibling mount. Pickers render inside it; text editors use their own wrappers. In-place views have no sibling mount (see binding model §3.2).            | internal |
| `data-ezclassify-mount-root` | `ezclassify-ui` / `element-scanner` | runtime  | the instance id stamped on each `EzClassifyUI` root; the cross-instance ownership boundary.                                                                                      | internal |
| `data-ezclassify-error`      | `forms/rollup` / `forms/styles`     | runtime  | presence-only; stamped on a field without a component that failed the rollup's check, styled by the default stylesheet. A component shows the failure in its own errors instead. | internal |
| `data-ezclassify-invalid`    | `ezclassify-ui`                     | runtime  | presence-only; stamped on a mount container whose value is invalid.                                                                                                              | internal |

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
its accessible name also carries. An `aggregate` output the host placed
carries the same message as its custom validity, with `aria-invalid="true"`,
while its level's rollup may be incomplete. A hidden input is barred from
constraint validation, so it does not block a submit; the textarea's own
validity does. Both messages are locale keys and follow `setLocale`.

## Prefixed controller options

Each controller harvests `data-ezclassify-<controller>-<option>` attributes off
its host into an options bag (see `element-scanner.harvestControllerOptions` and
`component-factory.parseComponentOptions`). Parsed `show-*` flags are enabled by their presence, including a value of
`"false"`. Other flags and options follow their table entries. JSON options must be valid JSON. Unknown suffixes pass through
verbatim and have no effect unless the controller reads them.

| Attribute                                         | Controller           | Audience | Values                                                                                                                            | Default                          |
| ------------------------------------------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `data-ezclassify-tags-color-coding`               | `tags`               | author   | `"false"` opts out; any other value (or absence) keeps color coding on                                                            | on                               |
| `data-ezclassify-tags-show-preview`               | `tags`               | author   | presence-only; render a live rendered-string preview                                                                              | off                              |
| `data-ezclassify-select-mode`                     | `select`             | author   | `"dropdown"` or `"cards"`                                                                                                         | `dropdown`                       |
| `data-ezclassify-select-color-map`                | `select`             | author   | JSON color map                                                                                                                    | (none)                           |
| `data-ezclassify-checklist-parent-concept`        | `checklist`          | author   | concept id; list only the category's concepts under this parent                                                                   | every concept in the category    |
| `data-ezclassify-checklist-show-preview`          | `checklist`          | author   | presence-only; render a live preview                                                                                              | off                              |
| `data-ezclassify-selector-category-groups`        | `selector`           | author   | JSON array of category groups                                                                                                     | (none)                           |
| `data-ezclassify-selector-show-codes`             | `selector`           | author   | presence-only; show concept codes alongside labels                                                                                | off                              |
| `data-ezclassify-banner-affix`                    | `banner`             | author   | `top` or `bottom`; fixed viewport edge                                                                                            | (none)                           |
| `data-ezclassify-banner-boundary`                 | `banner`             | author   | boundary the current marking is measured against; the banner reads the marking it shows as a whole against this one boundary only | (none)                           |
| `data-ezclassify-banner-show-current-data`        | `banner`             | author   | presence-only; show the current-data line                                                                                         | on when boundary or affix is set |
| `data-ezclassify-banner-current-label`            | `banner`             | author   | label for the current-data line                                                                                                   | scheme vocabulary                |
| `data-ezclassify-banner-boundary-label`           | `banner`             | author   | label for the boundary line                                                                                                       | scheme vocabulary                |
| `data-ezclassify-decisionflow-categories`         | `decisionflow`       | author   | JSON array (or comma list) of category ids to walk                                                                                | (none)                           |
| `data-ezclassify-equivalency-equivalencies`       | `equivalency`        | author   | JSON array of `{ source, target }` equivalency entries                                                                            | (none)                           |
| `data-ezclassify-equivalency-source-label`        | `equivalency`        | author   | header label for the source column                                                                                                | (none)                           |
| `data-ezclassify-equivalency-target-label`        | `equivalency`        | author   | header label for the target column                                                                                                | (none)                           |
| `data-ezclassify-crosswalk-handbook-crosswalk-id` | `crosswalk-handbook` | author   | crosswalk id; which of the Context's crosswalks to show. Needed only when the Context holds several                               | the Context's only crosswalk     |

> Shared options harvested off the host (not under the controller prefix):
> `data-ezclassify-format`, `data-ezclassify-scope`, `data-ezclassify-scheme`
> and `data-ezclassify-category` are read once on the host, and no controller
> has a prefixed copy of them; see `component-factory.parseComponentOptions`.

## Context reference drawer

The `context-reference` controller mounts in place and reads these presentation
options from `data-ezclassify-context-reference-<option>`:

| Option           | Values                                                                                | Default               |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------- |
| `placement`      | `left`, `right`, `top`, `bottom`                                                      | `right`               |
| `size`           | CSS length                                                                            | controller stylesheet |
| `open`           | presence opens; `"false"` closes                                                      | closed                |
| `tabs`           | comma-separated tab ids; built-ins are `handbook`, `guidebook`, `access`, `crosswalk` | available built-ins   |
| `theme`          | preset theme slug                                                                     | inherited theme       |
| `tab-label-<id>` | tab label override                                                                    | built-in label        |
| `tab-icon-<id>`  | short text or emoji                                                                   | built-in icon         |

The drawer shows every Context the EzClassifyUI instance holds, so it takes no
`data-ezclassify-context`. Each Context gets a handbook tab, a guidebook tab when
it holds a guide, an access tab when it holds an access policy, and a crosswalk
tab listing every crosswalk it holds. With several Contexts the tabs are grouped
by Context in the order the host gave them, each labeled with the Context's key,
and each built-in id carries the key as a prefix: `records-handbook`,
`county-crosswalk`.

Direct children declaring `data-ezclassify-tab` supply custom tabs. They accept
`data-ezclassify-tab-id`, `data-ezclassify-tab-label` (defaults to the tab id),
`data-ezclassify-tab-icon`, and numeric `data-ezclassify-tab-order`.

## Initialization (not attributes)

The constructor is the only code a page writes. It takes one Context, or
several by key:

```ts
new EzClassifyUI(context, options?);
new EzClassifyUI({ contexts: { district, records } }, options?);
```

With several Contexts, markup chooses one with `data-ezclassify-context`. No key
is the default by position; a marking host with no Context on an ancestor is a
host error. `options.root` defaults to `document.body`, and `options.store`
supplies a store the host already owns.

## Instance-level options (not attributes)

A `data-ezclassify-*` value is always a string on an element, so it can only
carry serializable config. A few options are functions instead, and those have
no data-attribute form at all: a declarative host sets them once, on the
`EzClassifyUI` constructor, and every scanner-mounted field in that instance
picks them up through its `ComponentOptions`.

| Option      | Constructor option                         | Shape                                                                                    | Threaded into                                                                                        | Default                          |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| `favorites` | `new EzClassifyUI(context, { favorites })` | `FavoritesConfig` (`load`/optional `save`/`remove`, see `components/favorites-panel.ts`) | `ComponentOptions.favorites` on every `tags`, `marked-textarea`, `marked-input`, and `marking` mount | unset (★ button does not render) |

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

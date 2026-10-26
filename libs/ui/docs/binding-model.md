# `@ezclassify/ui` binding model

This is the architecture spec for the binding and aggregation layer that
ships in `@ezclassify/ui`. The attribute vocabulary it defines
and the `EzClassifyStore` interface it specifies are public surface; every
SDK, framework adapter, and downstream component leans on the shapes
written here.

This file is the specification the implementation answers to. If the two
diverge, the doc wins: either the doc gets a deliberate update, or the
implementation gets fixed.

The [vanilla document form](../README.md#mark-a-document-and-its-parts)
and [React document form](../../../integrations/react/README.md) show a working
whole MarkingField with MarkingField, TagInput, MarkedInput and MarkedTextArea
parts, one form store, separate authored/parts rollup displays and store writes.

## 1. Mental model

The library tracks a small graph of marking objects. Each marking has an
id, a state (rendered string + assertions + validity), and zero or more
DOM views, inputs, chips, banners, tag inputs, that read from it
or write into it. Views declare their relationship to a marking with
`data-ezclassify-*` attributes. When any view publishes a change, the
library writes it to the store, the store fans the new state to every
subscribed view, and a separate page-level aggregate recomputes from the
markings that contribute to it.

```
   ┌─────────────────────────────────────────────────────────────┐
   │                       Page aggregate                         │
   │   data-ezclassify-aggregate (read-only subscribers only)     │
   └──────────────────────────▲──────────────────────────────────┘
                              │ recomputed on any contributor change
                              │
   ┌──────────────────────┐   │   ┌──────────────────────┐
   │ marking "doc"        │───┘   │ marking "para-1"     │
   │ identity:            │       │ identity:            │
   │   data-ezclassify-   │◀──────│   data-ezclassify-   │
   │   rendered          │ part- │   rendered          │
   │                      │ of    │   part-of="doc"      │
   └──────▲───────▲───────┘       └──────▲───────────────┘
          │       │                      │
   bound-to    facet-of(cat)         bound-to
          │       │                      │
   ┌──────┴─┐ ┌───┴────┐             ┌──┴─────────┐
   │ tags   │ │ select │             │ inline-    │
   │ (chip) │ │ (tier) │             │ marked-    │
   │ (two-  │ │ (two-  │             │ textarea   │
   │ way)   │ │ way    │             │ (publish)  │
   └────────┘ │ scoped)│             └────────────┘
              └────────┘
```

Three binding modes:

- **`bound-to`**: full marking, two-way. The view sees the entire
  rendered/assertions state and any edit it makes replaces the whole
  marking.
- **`facet-of` + `category`**: one category slice of the marking,
  two-way. The view sees only that category's assertions; an edit
  patches that category and leaves the rest of the marking alone.
- **`source` / `aggregate`**: one-way read. The view subscribes but
  cannot publish back. Use `source="<marking-id>"` to mirror a specific
  marking; use `aggregate` to subscribe to the computed page rollup.

`part-of` is structural, not a binding mode. It declares a coverage
relationship between two marking objects: "this marking's content must
be covered by the named parent marking." It does not move data. A field
bound to the parent is processed with the parts' markings as `parts`, so
its errors and fixes account for them (see ARCHITECTURE.md, "A whole is
processed with its parts").

### 1.1 Two aggregates: page-aggregate vs whole-rollup

The store exposes two distinct aggregate views. They answer different
questions and must not be conflated:

- **Page aggregate**: `engine.aggregateAssertions(assertions of every marking
object in the store)`. Includes wholes, parts, and standalone markings. One per
  store. Subscribed via `subscribeAggregate(listener)`. The author hooks
  this to a page-classification banner that summarizes "what is the
  highest marking found anywhere on this page."
- **Whole-rollup**: `engine.aggregateAssertions(assertions of parts declaring
part-of=X)` for a specific whole `X`. One per `X`. Subscribed via
  `subscribeWholeRollup(wholeId, listener)`. The whole itself is _not_
  included; this is the rollup of what flows up TO the whole, used to
  prove "the body content requires the banner to at least cover Y."

The two coincide only when a page has no markings outside one whole's
subtree. In any document with a banner field plus body parts, they
diverge:

| Banner field  | Body parts                                     | Page aggregate       | doc-banner whole-rollup |
| ------------- | ---------------------------------------------- | -------------------- | ----------------------- |
| `HIGH/AUTH-X` | `[[LOW]]`, `[[MED/CTRL-A]]`, `[[HIGH/CTRL-A]]` | `HIGH/AUTH-X/CTRL-A` | `HIGH/CTRL-A`           |
| `HIGH/AUTH-X` | `[[LOW]]` only                                 | `HIGH/AUTH-X`        | `LOW`                   |
| `MED`         | `[[HIGH]]` only                                | `HIGH`               | `HIGH`                  |

Edit the banner alone, the page aggregate updates but the whole-rollup
stays put; the banner isn't a part of itself. Edit a part, both
update.

### 1.2 Subscribing: three ways

```ts
// 1. Programmatic: the typical path for framework code.
const unsub = store.subscribeAggregate((s) => setPageBanner(s.rendered));
const unsub2 = store.subscribeWholeRollup('doc-banner', (s) =>
    setRollupTip(s.rendered),
);
```

```html
<!-- 2. Declarative: `data-ezclassify-aggregate` with no value is the
     page aggregate; with a value it's that whole's rollup. -->
<div data-ezclassify-controller="banner" data-ezclassify-aggregate>...</div>
<div data-ezclassify-controller="banner" data-ezclassify-aggregate="doc-banner">
    ...
</div>
```

```ts
// 3. Read once on ezclassify:ready, then live on subscribe. Matches the
//    document.readyState pattern; see §5.1.
if (forms.isReady) {
    setRollupTip(store.getWholeRollup('doc-banner').rendered);
}
```

`subscribeWholeRollup(wholeId, …)` fires on every commit of a
contributor; every marking whose `setPartOf(.., wholeId)` named the
whole. It does NOT fire on a commit of the whole itself, since the
whole isn't part of its own rollup.

#### Watching a scoped control

A control carrying `data-ezclassify-scope` is not on a separate channel.
It is a facet of the marking it names, so its assertions land in that
marking's own committed state and reach that marking's subscribers, in
the same notification any default-scope edit produces:

```ts
// Everything the authority block controls publish arrives here, alongside
// the banner categories. There is no per-scope subscription, and
// subscribeFacet() is the narrower view of ONE category, not the way to
// watch a scoped edit on the whole.
store.subscribe(DOC_MARKING_ID, (state) => {
    setAuthority(
        state.assertions.filter((a) => AUTHORITY_CATEGORIES.has(a.categoryId)),
    );
});
```

Read `state.assertions`, not `state.rendered`. The whole-marking render
format excludes alternate-scope categories by construction, so a scoped
assertion is present in the assertion set and absent from the rendered
string, always. Render a scoped block by handing the assertions you
filtered out to `render(assertions, '<the scope's format>')`.

What decides whether an assertion is scoped is the **scheme**, not the
attribute: the store routes on each category's declared `scopes` and the
scheme's `defaultScope`, read through `listCategories()` and
`getSchemeMeta()`. `data-ezclassify-scope` says which scope the author
means the control to author in; it scopes the control's own concept list
and nothing else. When the two disagree the library warns, because the
silent version is expensive: a category the scheme reports as
default-scope goes through the whole-marking render format, that format
excludes it, and the assertions render to nothing and never reach
committed state. Nothing appears to publish and no subscriber ever fires.
The two ways to land there are a typo in the attribute and a scheme that
reached the client without its scope declarations.

### 1.3 Worked example: the marked-document demo

Seeded state, banner field shows `HIGH/AUTH-X` (user-typed), MTA
parts read `[[LOW]] [[MED/CTRL-A]] [[HIGH/CTRL-A]]`. The DOM:

```html
<input id="doc-banner" type="hidden" data-ezclassify-rendered />
<input
    id="doc-banner-input"
    data-ezclassify-controller="tags"
    data-ezclassify-bound-to="doc-banner" />
<textarea
    id="doc-body"
    data-ezclassify-controller="marked-textarea"
    data-ezclassify-part-of="doc-banner">
…</textarea>
```

The MarkedTextArea creates one hidden marking object per part under
`doc-body`'s mount container, each declared `part-of="doc-banner"`. The
store tracks them through `setPartOf`. Part edits update their rollups. Whole
edits reread contributions only when the scheme can depend on that whole:
explicit `roleAware: false` proves independence; true or missing metadata is
conservative. Coverage validation against the changed whole still runs.

What each display reads:

- **Top + bottom green banners** ("LIVE COMPUTED PAGE CLASSIFICATION"),
  `store.subscribeAggregate(…)`. Reads `HIGH/AUTH-X/CTRL-A` (banner OR'd
  with parts; the highest level wins and the handling concepts union).
- **Section-1 hint** ("computed part rollup: …"),
  `store.subscribeWholeRollup('doc-banner', …)`. Reads
  `HIGH/CTRL-A` (parts only, so the banner's `AUTH-X` is excluded).

Edit the banner to `MED/CTRL-A`: page aggregate updates (the page is no
longer dominated by a HIGH banner, so it falls back to the part
maximum which is `HIGH/CTRL-A`); the section-1 rollup stays the
same (banner edit doesn't touch any part-of edge). Edit a part: both
update.

### 1.4 Aggregates compute from assertions, not strings

Every marking object in the store carries three pieces of state:
`assertions`, `rendered`, and `valid`. The assertions are the
structured truth; the rendered string is a display projection of those
assertions through the scheme's chosen render format. The two are kept
in sync by the engine round-trip on every commit, but they are not
interchangeable inputs to downstream computation.

Aggregates compute from **assertions**: never by re-parsing rendered
strings. The store calls `engine.aggregateAssertions(assertionSets, …)`
with each contributor's `state.assertions` directly. The engine runs
context inheritance, per-category rollup math, post-merge inference,
and forbid enforcement over those structured inputs, then renders the
combined result once at the end.

Why this matters. Re-parsing rendered strings is lossy whenever a
contributor's rendered form does not match the scheme's default parse
format. A part marking like `[[HIGH/CTRL-A]]` (brackets, part
format) cannot be parsed against a banner-format scheme; the parser
would silently produce empty assertions and the contributor's level
would drop out of the rollup. The structured form has no such
dependency on which render format produced it.

Worked example with the marked-document demo's seeded state: three
parts each contribute `assertions` rather than their `rendered`
strings:

```
                store.markings
                ┌──────────────────────────────────────────────┐
 doc-banner   → state.assertions = [level:HIGH, authority:AUTH-X]
 part-1    → state.assertions = [level:LOW]
 part-2    → state.assertions = [level:MED, controls:CTRL-A]
 part-3    → state.assertions = [level:HIGH, controls:CTRL-A]
                └──────────────────────────────────────────────┘
                                       │
                                       ▼
       engine.aggregateAssertions([[…], […], […], […]])
                                       │
              per-category rollup math (max, union, …)
                                       │
                                       ▼
              combined assertions → render once
                                       │
                                       ▼
              "HIGH/AUTH-X/CTRL-A"
```

Consumers pick `rendered` if they need a display string, `assertions`
if they need to feed the marking into another engine call (cover
checks, access decisions, secondary aggregations). The contract is
**structured-form-in, structured-form-out**; rendering is the last
step.

`engine.aggregate(inputs: string[], …)` serves callers that hold
strings (a server endpoint parsing JSON bodies, an external tool reading
a document). Both paths share the same post-parse pipeline; the only
difference is that `aggregate(strings)` runs the parser on each input
first, while `aggregateAssertions` skips that step entirely.

### 1.5 Recompute budget

On any commit the store does at most one whole-rollup recompute (only for the
whole the committed marking belongs to) and at most one page-aggregate
recompute. Listeners on unaffected wholes are not notified.

Spelled out by commit type:

- **Part commit**: a marking whose `setPartOf` points to some `<whole-id>`:
  one `aggregateAssertions` call for `<whole-id>`'s rollup, one for the page
  aggregate. No other whole's rollup recomputes.
- **Whole commit**: a marking that is the parent of other markings but has no
  `part-of` edge itself: no whole-rollup call, one page-aggregate call. The
  whole is not part of its own rollup.
- **Standalone commit**: a marking with no `part-of` edge and not referenced
  as a whole by anything else: no whole-rollup call, one page-aggregate call.

This is the published contract that adapter implementers must honor. Over a
remote engine each `aggregateAssertions` call is one network round trip, so the
store's per-commit budget is also the floor for network traffic: N edits in a
row produce N pairs of calls (whole-rollup + page-aggregate).

## 2. One marking-object kind

There is no `whole` type and no `part` type. There is only the marking
object. Whether a marking acts as a "whole" or a "part" comes from the
relationships pointed at it or away from it:

- A marking with no `part-of` and at least one marking that names it as
  a `part-of` parent acts as a _whole_ for that subtree.
- A marking with a `part-of` attribute acts as a _part_ of the named
  parent.
- A marking can be both, nested wholes, but nested wholes are
  deferred from the 1.0 surface (see §16).
- A marking can be neither: a standalone marking with no part-of edges
  is the simplest case.

This is the right shape because the engine itself treats these as one
kind of thing. `engine.process` doesn't care if you're processing a
whole or a part; `context.role` flags it on the call, but the marking
object stays one type. The UI mirrors that.

Standalone `marking`, `tags`, `marked-input`, and `text` controllers declare
their own marking identity through their DOM `id` (an id is assigned when
omitted). Plain or hidden marking data uses `data-ezclassify-rendered`.
An explicit `bound-to`, `facet-of`, `source`, or `aggregate` view uses its named
marking or computed value instead of registering another marking.
The initial scan indexes identities before binding views, so a preview may
precede its marking control in the document.

## 3. Attribute vocabulary

Three axes. An element can carry one identity attribute, one structural
attribute, and one binding attribute. Mixing two binding attributes on a
single element is an error; the scanner logs and ignores extras.

| Attribute                             | Axis       | Meaning                                                                                                 | Example                                                                              |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `data-ezclassify-rendered`            | Identity   | This element IS a marking object. Its `id` is the marking-id.                                           | `<input id="doc-marking" data-ezclassify-rendered />`                                |
| `data-ezclassify-part-of="<id>"`      | Structural | This marking's content must be covered by the named parent marking.                                     | `data-ezclassify-part-of="doc-marking"`                                              |
| `data-ezclassify-bound-to="<id>"`     | Binding    | Two-way full-marking view. Reads `state.rendered` + `state.assertions`; publishes back via either side. | `data-ezclassify-bound-to="doc-marking"`                                             |
| `data-ezclassify-facet-of="<id>"`     | Binding    | Two-way category-scoped view. Used with `data-ezclassify-category`.                                     | `data-ezclassify-facet-of="doc-marking" data-ezclassify-category="level"`            |
| `data-ezclassify-category="<cat>"`    | Binding    | Names the category slice for `facet-of`. Required with `facet-of`.                                      | `data-ezclassify-category="from_school"`                                             |
| `data-ezclassify-source="<id>"`       | Binding    | One-way read of a specific marking by id. Read-only views.                                              | `<div data-ezclassify-source="doc-marking" data-ezclassify-controller="card">`       |
| `data-ezclassify-aggregate`           | Binding    | One-way read: empty value for the page aggregate, or a whole id for its parts-only rollup.              | `<div data-ezclassify-controller="banner" data-ezclassify-aggregate>`                |
| `data-ezclassify-controller="<name>"` | View       | Mounts the named visual component on this host. Independent of the binding axis.                        | `<input data-ezclassify-controller="tags" data-ezclassify-bound-to="doc-marking" />` |

Notes on shape:

- Every binding attribute references a marking by `id`. Marking-ids must
  be unique within an ezclassify root.
- Marking ids must also be unique across all forms that are on screen at
  the same time. A Vue `<Transition>` without `mode="out-in"` keeps the
  leaving form mounted while the entering one mounts, so two forms
  briefly share the page and a repeated id collides.
- An element with a binding attribute does not need
  `data-ezclassify-rendered` on itself; it points _at_ a marking, it
  doesn't _declare_ one.
- An element with `data-ezclassify-rendered` does not need a binding
  attribute; it can be a pure container that other views bind to.
- Hidden inputs as marking declarations are fine and idiomatic:
    ```html
    <input
        id="doc-marking"
        name="documentMarking"
        type="hidden"
        data-ezclassify-rendered />
    ```
    The hidden input integrates with native `FormData`, so server submits
    pick up the rendered value automatically.

### 3.1 Why `facet`

The category-scoped binding is `data-ezclassify-facet-of`, not
"fragment". "Fragment" collides with at least four meanings in web tech:

1. `DocumentFragment`: the DOM container type.
2. GraphQL fragments: reusable selection sets.
3. CSS fragments / fragmentation: `break-before`, multi-column.
4. URL fragments: the `#hash` part of a URL.

Every one of those readings is wrong here, and a reader who already
knows web tech will misread the attribute name on first contact. "Facet"
has no prior meaning in web platform vocabulary, reads naturally as "one
side of a thing," and matches what the attribute actually does, name
one category-shaped face of a marking.

### 3.2 Controller rendering: in-place vs hidden-host + mount sibling

The runtime mounts `banner`, `card`, `text`, `equivalency`, and
`context-reference` in place on their authored hosts.

Other controllers receive a sibling `<div data-ezclassify-mount="<controller>">`.
Most hide the authored host and render their interactive controls inside that
mount. Text editors manage their own wrappers instead:

- `marking` and `marked-input` use authored native `<input>` elements and
  owned, unnamed wrapping textareas. The original inputs retain form values,
  labels, events, reset behavior, and focus forwarding.
- `tags` keeps its native input as the value/form target and renders its chips
  and editor in the mount.
- `marked-textarea` enhances the authored `<textarea>` in its own wrapper.

For automation, query the mount for picker controls such as `select` and
`checklist`. For text editors, query their visible wrapper/editor, not a hidden
native input or an empty sibling mount. The native input remains the place to
inspect the submitted text value.

```html
<!-- what you author -->
<input
    id="level-select"
    data-ezclassify-controller="select"
    data-ezclassify-facet-of="doc-marking"
    data-ezclassify-category="level" />

<!-- what the runtime produces -->
<input
    id="level-select"
    data-ezclassify-controller="select"
    data-ezclassify-facet-of="doc-marking"
    data-ezclassify-category="level"
    style="display: none" />
<div data-ezclassify-mount="select">
    <!-- rendered select UI lives here -->
</div>
```

#### Select presentation

The `select` controller uses a conventional dropdown by default. The runtime
creates an additional `<select class="select-dropdown">` **inside** the
`[data-ezclassify-mount="select"]` container. The original host `<select>` stays
hidden with a single placeholder `<option>`; `.select-dropdown` is the actual
interactive `<select>` rendered to the user. If the selected concept requires a
text value, its ordinary labeled companion input appears directly below it.

```html
<!-- authored -->
<select
    data-ezclassify-controller="select"
    data-ezclassify-facet-of="doc-marking"
    data-ezclassify-category="level"></select>

<!-- runtime output -->
<select data-ezclassify-controller="select" ... style="display: none">
    <option value=""><!-- placeholder --></option>
</select>
<div data-ezclassify-mount="select">
    <select class="select-dropdown">
        <option value="">Select…</option>
        <option value="U">Unclassified</option>
        <option value="C">Confidential</option>
        …
    </select>
</div>
```

Correct query target for the default select:

```js
// Wrong: the host is hidden and carries only a placeholder option
page.locator('[data-ezclassify-controller="select"]');

// Correct: the rendered interactive element
page.locator('.select-dropdown');
// or, if multiple dropdowns are on the page, scope to the mount:
page.locator('[data-ezclassify-mount="select"] .select-dropdown');
```

Set `data-ezclassify-select-mode="cards"` only when the host deliberately wants
the richer comparison surface. In that mode the controller renders its options
directly in the mount container; `.select-dropdown` does not exist and the card
items are the interaction target instead.

Applications that already use a design-system control (for example MUI, React
Select, Ant Design, PrimeNG, or Vuetify) should keep that control and bind it
through the framework/store API. EzClassify supplies concepts, assertions,
availability, validation, and rendering; the third-party library continues to
own DOM, styling, and keyboard behavior.

## 4. `EzClassifyState` shape

Every marking entry in the store carries both representations of its
content:

```ts
import type {
    Assertion,
    ConceptColor,
    ProcessResult,
    RenderAssessment,
    RenderResultsByFormat,
    ValidationError,
} from '@ezclassify/types';

export type EzClassifyState = {
    /** Recognition of supplied text; absent for structured/computed states. */
    recognition?: ProcessResult['recognition'];
    rendered: string;
    /** What writing `rendered` wrote, left out, or could not write. */
    assessment?: RenderAssessment;
    /** The outputs this marking's views asked for (see requestOutput). */
    renders: RenderResultsByFormat;
    assertions: Assertion[];
    valid: boolean;
    errors: ValidationError[];
    /**
     * Portable scheme default; host/component color overrides are
     * presentation-only.
     */
    displayColor?: ConceptColor;
    /** Present on computed rollups. */
    aggregate?: true;
    /** A failed rollup is holding its previous value. */
    stale?: boolean;
};
```

A process writes only the outputs it is asked for. A view that shows the
marking in an output other than `rendered` asks the store for it with
`store.requestOutput(id, output)`, and every publish for that marking names
it while the request is held. The output is spelled as the scheme's metadata
lists it in `formats`; the store refuses any other spelling, because a
process refuses to name it. A state committed before the request, or a
rolled-up one, has no entry for it, and the view writes it from `assertions`
instead.

`rendered` normally uses a known format: the store's own, or the
scheme's default for a whole marking and its part default for a part. A
scheme that writes each role in a view of its own would otherwise write it in
the view of whatever role the text happened to read as.

`rendered` is the engine's rendering of the text it read, verbatim, with every
fix the engine applied, whether the result is valid or not. `appliedFixes` says
what the engine changed to get there, and `errors` and `proposedFixes` are the
engine's judgment of `rendered` itself: what is still wrong with the marking
the store holds and how to fix it. Text the engine could not read stays in
`rendered` where the engine wrote it. When the result says the rendering is not
a reading of the text (no recognition metadata, or a rendering the engine
refused to write), `rendered` keeps the original text and the state has no
`assessment`. Parsed assertions and validation diagnostics remain available
either way.

Both `rendered` and `assertions` are always present in the state. This
costs one engine round-trip per edit but it pays for itself the first
time a component on the other side of the store reads from the
representation the publisher didn't write.

The engine is responsible for the round-trip:

- A `publishRendered(id, str)` edit triggers
  `engine.process(str) → { rendered, assertions, valid, errors }` and
  stores the result.
- A `publishAssertions(id, list)` edit triggers `engine.process(list)`
  over the structured assertions and stores the result, so nothing is
  flattened to a string on the way.

Consumers never call `process` or `render` themselves to keep the two
sides in sync. That logic lives in the store implementation, exactly
once.

`valid` and `errors` are populated even when the rendered string is
empty; the engine reports "no assertions" as a valid empty state, not
an error.

## 5. Dual publish API

```ts
export interface EzClassifyStore {
    /**
     * Get the current state for a marking. Returns the empty state when the
     * marking is unknown.
     */
    get(id: string): EzClassifyState;

    /**
     * Subscribe to state changes. Fires synchronously on every commit. Returns
     * an unsubscribe handle.
     */
    subscribe(
        id: string,
        listener: (state: EzClassifyState) => void,
        source?: PublishSource,
    ): () => void;

    /**
     * Publish an edit from the string side. The store calls engine.process
     * internally and writes the full state. The string restates the default
     * scope, on top of whatever the marking was seeded with.
     */
    publishRendered(
        id: string,
        rendered: string,
        source?: PublishSource,
    ): Promise<void>;

    /**
     * Publish an edit from the assertion side. The store calls engine.process
     * over the structured assertions and writes the full state. The categories
     * that differ from what the caller read replace those categories, on top of
     * whatever the marking was seeded with. A caller that edits known
     * categories names them in `options.categories`, and each is replaced by
     * exactly what it gives, even the value it read.
     */
    publishAssertions(
        id: string,
        assertions: Assertion[],
        source?: PublishSource,
        options?: { categories?: readonly string[] },
    ): Promise<void>;

    /**
     * Seed a marking with the value its host was served with: its baseline,
     * under the edits.
     */
    seedRendered(id: string, rendered: string): Promise<void>;

    /** Seed a marking from assertions its host already carries. */
    seedAssertions(id: string, assertions: Assertion[]): Promise<void>;

    /**
     * Release a marking whose host has left the page: drop its baseline and its
     * edits and empty it.
     */
    releaseSeed(id: string): void;

    /**
     * Ask for `output` in `renders` on every state committed for `id` from now
     * on. Returns the release; the store names only outputs some view holds.
     */
    requestOutput(id: string, output: string): () => void;

    /**
     * Get the current page-aggregate state. Computed from contributing
     * markings.
     */
    getAggregate(): EzClassifyState;

    /** Subscribe to aggregate state changes. */
    subscribeAggregate(listener: (state: EzClassifyState) => void): () => void;

    /**
     * Tear the store down. Disconnects all listeners and releases the engine
     * reference.
     */
    destroy(): void;
}

/**
 * Identifies the view that published a change, so the store can skip an
 * unchanged self-echo while still returning canonicalized corrections.
 */
export interface PublishSource {
    /** A stable token for the publishing view: usually the DOM element. */
    token: unknown;
}
```

`PublishSource.token` exists so the store can dedupe unchanged self-echoes. When
a tag input publishes a string and the store fans the same value out to
subscribers, the tag input itself does not need a callback. When processing
commits a different canonical value, the publisher does receive that callback
and reconciles with the store. The token is opaque; the store compares by
identity.

A component picks its natural publish channel based on what its UI
produces:

- MarkingField publishes its marking text. TagInput and MarkedInput publish
  their resolved assertions; MarkedTextArea publishes separate portion sets
  through `publishAggregate`, never the full prose as marking text.
- Category pickers and checklists publish assertion lists; those are
  what the user just clicked.
- A category facet view publishes only assertions for its category;
  the store merges them with the rest of the marking's assertions
  before round-tripping.

Markup never declares the publish channel. The component's internals
decide. The same `data-ezclassify-bound-to="doc-marking"` attribute is
correct for TagInput and a category picker, even though they present
different editing surfaces.

#### Two layers: the baseline and the edits

Everything above is an **edit**: something a user, a field, or an application
wrote. A **seed** is different. It is the value a marking's host was served
with, and the runtime reads it into the store only after every field on the
page has initialized (see §5.1). A framework binding can publish well before
then, and a user can pick a value while the page is still starting. So each
marking holds two layers, and its committed value is always the engine's
reading of one with the other on top:

- The **baseline** is what the host was served with. Only `seedRendered` and
  `seedAssertions` set it. A rendered value states only the default scope, so a
  rendered baseline contributes no alternate scope; an assertion baseline
  contributes both.
- The **edits** are what was written. Only `publishRendered` and
  `publishAssertions` change them. A rendered edit restates the whole default
  scope. An assertion edit replaces each category it changed, measured against
  what its caller read, so two pickers on one marking never revert each other.
  A facet picker names its category instead, so putting back the value it shows
  while its own pick is still on the wire is an edit too.
  Alternate-scope categories and capture values live here.

Read aloud, a marking reads like this: marking `doc` has baseline
`INTERNAL//DO NOT FORWARD` and edits `{ level: CONFIDENTIAL }`, so it commits
`CONFIDENTIAL//DO NOT FORWARD`. That is the result whichever arrived first: the
pick before the seed, during it, or after it. The pick is kept, and so is the
served handling nobody touched.

Because every change composes the marking from both layers again, only the
newest composition commits. An older engine answer was read from layers that
have since changed and is dropped, and an engine call that never answers holds
nothing up: the next change supersedes it. A later seed replaces the baseline
and keeps the edits.

A seed belongs to the page whose host was served with it. When a host leaves
the page the runtime calls `releaseSeed(id)`, which drops both layers and empties
the marking, so a store shared by one page after another serves each page its
own value, and a pick made on the next page before its runtime seeds it is still
kept. A runtime torn down over hosts that stay on the page, as under StrictMode
or a remount, releases nothing: the next runtime seeds the same hosts under the
same edits.

A seed costs one engine call. Edits to default-scope categories over a rendered
baseline that has not been read yet cost one more, once: the reading is kept for
the next change.

### 5.1 Lifecycle: `ezclassify:ready`

`@ezclassify/ui`'s runtime mount sweep is async; components like
MarkedTextArea, TagInput, and the select facets each run their
own async `init()`. Once every one has finished, the runtime seeds each
marking host the sweep mounted, all at once and each exactly once, from its
value, empty or not (`seedRendered`, or `seedAssertions` for a body editor's
parsed mark), as the baseline under any edit already made (see §5, "Two
layers"). A host mounted after the sweep is seeded the same way as it mounts. A consumer that subscribes during the
same tick the runtime starts up will see the store fire as the seeds
land; a consumer that reads `store.getAggregate()` or `store.get(id)`
synchronously after construction will see the empty placeholder.

A field does not have to wait for this event before it publishes. A pick
made while the runtime is still starting is an edit, and the seed lands
under it. A facet's options do not wait for it either: the store computes
a facet as soon as its first listener subscribes.

To close that gap the runtime fires a single `ezclassify:ready` DOM
event on its root element once every component's `init()` has
resolved and the store is settled. The intended use:

```ts
const root = forms.root;

// Subscribe to live updates up front.
const unsub = store.subscribeAggregate((s) => setAggregate(s.rendered));

// Pull initial state in one shot when the runtime says it's stable.
const onReady = () => {
    setAggregate(store.getAggregate().rendered);
    const mta = forms.components.get(textareaEl) as MarkedTextArea | undefined;
    if (mta) setSegments(mta.getSegments());
};
if (forms.isReady) onReady();
else root.addEventListener('ezclassify:ready', onReady, { once: true });
```

The `forms.isReady` check handles the case where the consumer's
listener attaches AFTER the constructor's async chain has already
fired the event, common under React StrictMode dev re-mounts, where
the previous mount's instance is destroyed and a new one is
constructed before the parent component's effect re-runs. Same
pattern as `document.readyState === 'complete'` for `load`.

Contract:

- **Fires once per `EzClassifyUI` instance**, after the initial
  scan + mount sweep settles, seeds included. Calling `destroy()`
  before the sweep finishes suppresses the event. The seeds wait on
  the engine, so an engine across a network has to time its calls
  out: a call it never answers holds the event back.
- **Fires AFTER every component's `init()` resolves.** By the time
  the event fires, `store.get(id)` and `store.getAggregate()` return
  the correct initial state and `MarkedTextArea.getSegments()`
  returns the seeded part list.
- **Bubbles.** Listeners on a wrapping container catch it; matches
  the `ezclassify:rollup` convention.
- **`forms.isReady`** flips to `true` in the same chain that fires
  the event. Consumers can read it synchronously to decide whether
  to wait or apply immediately.
- **Event detail** carries the seeded marking-ids the runtime
  registered and the count of managed components:
    ```ts
    interface EzClassifyReadyDetail {
        markingIds: string[];
        componentCount: number;
    }
    ```
- **No re-fire on dynamic mounts.** A consumer that adds an
  `[ezClassify]`-managed element to the DOM after construction is on
  its own for that one; the event does not fire again. A host that mounts
  views dynamically should read the store directly rather than wait for a
  second event. Lifting this is a post-1.0 question.

## 6. Engine round-trip: ship gate

Every scheme that ships must round-trip cleanly in both
directions:

```
engine.process(rendered).assertions  ──render──▶  rendered
engine.render(assertions).rendered   ──process──▶ assertions
```

The two cycles must be losslessly equivalent. This applies to every
scheme a package ships, not to a list kept here: each scheme package
owns its own inventory, and a copy of that inventory in this document
would only tell a reader what shipped on the day it was written.

Conformance test shape (lives in each scheme package, alongside its
existing per-scheme fixtures; specified here, implemented there):

```ts
describe.each(SCHEME_FIXTURES)('%s round-trip', (fixture) => {
    it('rendered → assertions → rendered is stable', async () => {
        const a = await engine.process(fixture.rendered);
        const b = await engine.render(a.assertions);
        expect(b.rendered).toBe(fixture.rendered);
    });

    it('assertions → rendered → assertions is stable', async () => {
        const r = await engine.render(fixture.assertions);
        const p = await engine.process(r.rendered);
        expect(p.assertions).toEqual(fixture.assertions);
    });
});
```

A scheme that can't round-trip can't ship a fully-functional binding
view, string-side and assertion-side components would drift
out of sync on every edit. The suite above is not wired up across every
scheme package yet; a scheme that fails is noted in its own README as
binding-incomplete, and a consumer should read that note before binding
assertion-side views to it.

## 7. Coverage is a check, never a push

When a marking with `data-ezclassify-part-of="<parent-id>"` changes, or
when the parent marking changes, the library re-runs
`engine.checkCoverage(children, parent)` for every affected parent and
processes each child with its parent as `partOf`.

The engine compares each child with its parent and says on the child's own
result when the child exceeds it: the parent lacks something the child
needs, or carries something the child does not allow (a release list wider
than the child's). That child marking's state is written with
`valid: false` and the coverage error is surfaced as a DOM event on the
child element:

```ts
childEl.dispatchEvent(
    new CustomEvent('ezclassify:coverage-error', {
        bubbles: true,
        detail: {
            childId: 'para-1-marking',
            parentId: 'doc-marking',
            childRendered: 'HIGH/CTRL-A',
            parentRendered: 'MED',
            // The engine's CoverageReport for the parent, or null if unavailable.
            report,
        },
    }),
);
```

A child the engine does not report is not at fault, whatever the parent's
coverage check says about the others. A finding no single child causes
stays on the parent: its own validation names it, and no child receives
the event.

The library never mutates the child marking to fit a changed parent.
That mutation rule applies whether the parent loosened, tightened, or
shifted categories. The author resolves the conflict; either by
relaxing the parent, downgrading the child, or removing the part-of
relationship.

The one push the library offers goes the other way, and only on request.
A whole field that judges its parts itself (see ARCHITECTURE.md, "A whole
is processed with its parts") shows the engine's coverage error and the
fix that raises it, like any other rule error. For any other parent that
a component or field can write (the parent element itself, or anything
`bound-to` it), a small whole-over-parts control mounts beside it
instead. It shows the marking the engine requires for the current parts
and applies it only when the author clicks. A container that merely aggregates the parts it owns has
no authored whole: a marked-textarea's parts name the textarea as
their parent so its aggregate state can be published, but the textarea
declares `authorsWhole: false` on its component instance and never gets
the control. Writing a marking into it would replace its body.

The same stance holds for _child-changes_: the rollup dispatches
`ezclassify:validation` and leaves the child as written. In both
directions the library reports a coverage gap and never corrects either
side silently, even when a scheme lacks structural terms in its
vocabulary.

## 8. The state adapter pattern (keystone)

This is the architectural decision the rest of the model hangs on:
`@ezclassify/ui` defines the store _interface_, and each framework
adapter ships its own implementation that wraps the framework's native
reactive primitive. There is no bridge layer.

### Why

The cost of getting it wrong is repeated in every component. If
`@ezclassify/ui` owned a single store implementation (say, a plain
`Map<string, EzClassifyState>`), then every Angular component built on top
would need an effect to mirror the store value into a signal, plus
cycle-protection to avoid re-firing the effect when the user writes the
signal. Multiply by Vue and React and we own the bridge logic three
times over, with three subtly different cycle-bug shapes.

If instead the store's _entries_ ARE the framework's native primitive,
an Angular `WritableSignal<EzClassifyState>` is the store entry, a Vue
`Ref<EzClassifyState>` is the store entry; there is no mirroring. The
framework's reactive system already handles fan-out, dependency
tracking, change detection, and cycle protection. The store just
_is_ the right shape.

### Interface

```ts
// In @ezclassify/ui: the interface only
export interface EzClassifyStore {
    get(id: string): EzClassifyState;
    subscribe(
        id: string,
        listener: (state: EzClassifyState) => void,
        source?: PublishSource,
    ): () => void;
    publishRendered(
        id: string,
        rendered: string,
        source?: PublishSource,
    ): Promise<void>;
    publishAssertions(
        id: string,
        assertions: Assertion[],
        source?: PublishSource,
        options?: { categories?: readonly string[] },
    ): Promise<void>;
    seedRendered(id: string, rendered: string): Promise<void>;
    seedAssertions(id: string, assertions: Assertion[]): Promise<void>;
    releaseSeed(id: string): void;
    requestOutput(id: string, output: string): () => void;
    getAggregate(): EzClassifyState;
    subscribeAggregate(listener: (state: EzClassifyState) => void): () => void;
    destroy(): void;
}
```

### Implementations

| Package               | Class                    | Backing primitive                                                   |
| --------------------- | ------------------------ | ------------------------------------------------------------------- |
| `@ezclassify/ui`      | `VanillaEzClassifyStore` | Plain `Map<string, EzClassifyState>` + listener Set                 |
| `@ezclassify/angular` | `AngularSignalStore`     | `Map<string, WritableSignal<EzClassifyState>>`                      |
| `@ezclassify/react`   | `ReactEzClassifyStore`   | `Map<string, EzClassifyState>` + `useSyncExternalStore` integration |
| `@ezclassify/vue`     | `VueRefStore`            | `Map<string, Ref<EzClassifyState>>`                                 |

The runtime accepts the store as a constructor arg:

```ts
const ui = new EzClassifyUI(engine, { root: rootEl, store });
```

If no store is passed, the runtime defaults to a `VanillaEzClassifyStore`.

The store talks to an engine through the small `EzClassifyStoreEngine`
surface. EzClassify supports only its own engines behind it, the
in-process engine and the REST client. Custom external engines are not
supported.
Framework adapters (`@ezclassify/angular`'s `EzClassifyDirective`,
`@ezclassify/react`'s `EzClassifyProvider`, `@ezclassify/vue`'s
`useEzClassify`) inject their own store automatically; the consumer
doesn't pass it explicitly.

### Conformance test

All four implementations run the same shared parity suite,
[`libs/ui/src/store/adapter-parity-suite.ts`](../src/store/adapter-parity-suite.ts), each against its own store, so a
lossless-transport break shows up whichever adapter introduced it. The suite
covers:

- `publishAssertions` retains scoped assertions and capture values (the
  authoring-page shape).
- An alternate-scope facet refreshes using its own category scope.
- Facet state lives in a cell that tracks the listener stream.
- Scoped state survives a part edit followed by a whole rollup.
- Each publish names exactly the outputs its views hold, and an output the
  scheme does not declare is refused without stopping later publishes.
- `publishRendered` over a marking preserves its scoped assertions.
- `captureFormState` → `restoreFormState` round-trips scoped and captured state
  into a fresh mount.
- A seed lands under an edit made before it or published while it is on the
  wire, and keeps the served scoped assertions and capture values; a rendered
  edit replaces only the default scope, and a rendered baseline replaces scoped
  assertions nobody edited.

The `EzClassifyStore` conformance suite adds the two-layer contract under a
late-answering engine: an edit before, during, or still in flight at the seed;
a later seed that keeps the edits; two seeds in a row; and a released marking.

## 9. Framework helpers

Each framework adapter exposes thin sugar over the store. The sugar is
just a typed projection; it doesn't add bridge logic or guard against
cycles, because at this point in the stack there's nothing to guard
against.

### Bring your own select or multiselect

`data-ezclassify-controller` selects an EzClassify visual component. It is not
required for policy behavior. Applications using Angular Material, MUI,
React Aria, PrimeVue, or another component library should keep that library's
control and bind its value through the framework store.

For a control representing one category within a larger marking, use
`publishFacetSelection`. It replaces only that category and preserves the rest
of the marking:

```ts
import { publishFacetSelection } from '@ezclassify/ui';

await publishFacetSelection(
    store,
    'document-marking',
    'controls',
    selectedConceptIds, // one id for single-select; many for multiselect
);
```

Use `store.subscribeFacet(markingId, categoryId, listener)` when the control
also needs live `allowableOptions` and `selectedAssertions`, and
`store.getFacet(markingId, categoryId)` for the synchronous read that pairs
with it, the same way `get` pairs with `subscribe`. The UI library continues to
own its DOM, overlay/portal, keyboard handling, and styling; EzClassify owns
the assertions, rule filtering, validation, rendering, and rollup. This is the
supported integration seam for controls that do not expose or even render a
native `<select>`.

Facet state lives in a reactive cell, like marking, aggregate, and whole-rollup
state. That is what lets a framework binding project the facet instead of
copying it: the Angular, React, and Vue facet composables read the cell through
their adapter's typed accessor (`facetSignalRef`, `facetSnapshot`, `facetRef`)
and hold no state of their own. A facet is recomputed only while it has at
least one `subscribeFacet` listener, so a binding that reads a cell keeps a
subscription open for as long as it does. React's `useSyncExternalStore`
subscription owns that lifetime; Angular and Vue retain one facet subscription
alongside their native signal or ref projections. They publish selections through
the shared `publishFacetSelection` helper. A facet that missed a commit while nobody
listened is computed again for its next listener rather than replayed, so a
control remounted by the change it depends on, such as a list of codes keyed by
the path chosen above it, shows the options for that change.

For libraries that prefer one adapter object, including jQuery plugins and web
components, use the same contract through `createEzClassifyFacetBinding`:

```ts
const binding = createEzClassifyFacetBinding(
    store,
    'document-marking',
    'controls',
);

await binding.ready;
const unsubscribe = binding.subscribe(
    ({ selectedConceptIds, allowableOptions }) => {
        control.setValue(selectedConceptIds);
        control.setOptions(allowableOptions);
    },
);
control.onChange((ids) => binding.setSelected(ids));
```

The compatibility contract is deliberately limited to plain data and
callbacks: no React, Angular, Vue, jQuery, DOM, or form-library types cross the
boundary. Therefore it applies equally to Angular Material,
`ng-multiselect-dropdown`, MUI, React Select, Ant Design, React Aria, Chakra,
PrimeReact/PrimeVue, Vuetify, Select2, Bootstrap plugins, native controls, and
custom web components. Library-specific convenience wrappers may reduce
boilerplate, but do not define compatibility.

### Angular

```ts
import { injectEzClassifyFacet } from '@ezclassify/angular';

// Call in an Angular injection context. Bind value()/options() to your
// design-system control, and call setValue(ids) from its change output.
const level = injectEzClassifyFacet('doc-marking', 'level');
```

The returned signals are read-only projections. `level.setValue(ids)` publishes
through the store. For full document bindings, use `bindEzClassifyToSignal`;
see the [Angular guide](../../../integrations/angular/README.md).

### React

```ts
import { useEzClassify } from '@ezclassify/react';

const [state, setRendered] = useEzClassify('doc-marking');
// state: EzClassifyState, full shape
// setRendered: (next: string) => void, publishes via the rendered side
```

For the assertion-side variant: `useEzClassifyAssertions`.

### Vue

```ts
import { useEzClassify } from '@ezclassify/vue';

const docRendered: Ref<string> = useEzClassify('doc-marking');
```

Writing the ref calls `publishRendered` on the store. For the
assertion side: `useEzClassifyAssertions`.

## 10. Domain-object binding helper

Most consumers don't want to wire individual markings by id; they want
to wire a whole document object's classification fields in one call.
`bindEzClassifyToObject` is that helper.

```ts
import { bindEzClassifyToObject } from '@ezclassify/ui';

const handle = bindEzClassifyToObject(store, doc, {
    'doc-marking': 'classification',
    'title-marking': 'title.classification',
    'para1-marking': { path: '/para-1/classification', mode: 'assertions' },
});

handle.onChange((updatedDoc, diff) => {
    // updatedDoc is the doc with the latest values; diff lists what changed.
});

handle.setPath('title.classification', 'HIGH/AUTH-X'); // programmatic edit
handle.dispose();
```

Path syntax:

- **Dot-notation**: `'title.classification'`. The default.
- **JSON Pointer** (RFC 6901): `'/title/classification'`. Detected by
  a leading slash. Use this when keys contain dots or other
  dot-notation-illegal characters (`para-1` is fine; `para.1` is not).

Per-marking config:

- A bare string is shorthand for `{ path, mode: 'rendered' }`.
- `{ path, mode: 'rendered' | 'assertions' }` lets the consumer pick.

`setPath` is the only safe way to push programmatic edits from JS into
the document object, plain JS objects are not reactive, so a direct
`doc.title.classification = 'HIGH'` mutation will not propagate to the
store. (Framework variants observe their native update mechanism:
`bindEzClassifyToSignal` for Angular observes signal writes,
`useEzClassifyObject` for React exposes `setDoc` and `setPath`, and
`bindEzClassifyToReactiveDoc` for Vue observes reactive document changes.
Mutating an ordinary object directly does not trigger a React or Angular update.)

All four are the same algorithm. `createDocBinding` in `@ezclassify/ui`
walks the paths, dedupes the round trip, and orders the writes and
publishes; each variant supplies a `ReactiveDoc`, which is three
functions: read the document, write a path, and (optionally) report a
host write. It is the doc-binding counterpart of the store's
`ReactiveCell`, and it is the only place the frameworks differ. A
container that leaves `observe` off gets a one-way binding, store to
document, which is exactly what `bindEzClassifyToObject` is.

`handle.onChange` receives a `diff` shaped as `Array<{ path: string,
before: string, after: string }>` so consumers don't need to compare
objects themselves.

## 11. The four-fields-one-marking example

The canonical case: one logical marking, edited from four different
fields. Vanilla HTML, no framework, no JavaScript glue:

```html
<input
    id="doc-marking"
    name="documentMarking"
    type="hidden"
    data-ezclassify-rendered />

<input
    data-ezclassify-controller="tags"
    data-ezclassify-bound-to="doc-marking" />

<input
    data-ezclassify-controller="select"
    data-ezclassify-facet-of="doc-marking"
    data-ezclassify-category="level" />

<input
    data-ezclassify-controller="select"
    data-ezclassify-facet-of="doc-marking"
    data-ezclassify-category="from_school" />

<textarea
    data-ezclassify-controller="marked-textarea"
    data-ezclassify-bound-to="doc-marking"></textarea>
```

The marking lives in `#doc-marking`. TagInput reads and edits the full marking.
MarkedTextArea contributes its portions as separate assertion sets through
`store.publishAggregate(id, assertionSets, source)`. The engine aggregates them
and the store retains that result's rendering, validity and errors. Reprocessing
only the aggregate's assertions would lose failures in its contributors.
Built-in stores provide this method; custom stores used for a bound
MarkedTextArea must provide it too. Each portion also has a stable store entry ID. A store edit
to one entry updates that portion's marking token while retaining its body.
A parent-marking update can address a single portion; with several portions it
is ambiguous, so the textarea retains its exact text and reports an entry
conflict instead of choosing a paragraph. The store fans committed changes out to the facet pickers. The facet-pickers each subscribe to a
single category slice, `level`, `from_school`, and publish only
that category's assertions back. The store merges, re-renders, and
echoes the new state out to TagInput. The textarea keeps its authored body.

No JS is required because the binding lives entirely in the attributes.
`new EzClassifyUI(engine, { root: rootEl })` scans the DOM, wires the store, and
the views handle the rest. The hidden `#doc-marking` input integrates
with `FormData` on submit, the server picks up the rendered marking
string with zero extra plumbing.

### Variable entries in a marked body

The shipped stores implement the optional `MarkingEntriesStore` capability.
`getEntryIds(collectionId)` returns an immutable ordered ID list, or `undefined`
before membership has been committed. An empty list is an explicit collection
with no markings. A bound textarea uses its `bound-to` marking ID as its
collection ID; a standalone textarea uses its own element ID.

Each ID addresses ordinary `store.get`, `subscribe`, `publishAssertions` and
`publishRendered` operations. Membership holds no duplicate marking state and
no prose. For example, after a textarea has mounted:

```ts
const ids = forms.store.getEntryIds?.('doc-marking');
if (!ids?.length) throw new Error('No portion entry is available');

// Change only this portion's level. Other categories and captured values stay.
await forms.store.publishAssertions(
    ids[0],
    [
        {
            categoryId: 'level',
            conceptId: selectedLevel,
            confidence: 'certain',
            source: 'user',
        },
    ],
    undefined,
    { categories: ['level'] },
);
```

`setEntryIds(collectionId, ids, source?)` commits membership; `subscribeEntries`
observes subsequent commits. Subscribe before reading the current IDs when
hydrating an external view. IDs must be nonempty and unique, and a collection
cannot include itself. Publish a new entry's marking state before adding its
ID. Removing an ID removes its marking token, retaining the body as unmarked
prose. An empty entry keeps an insertion anchor, so later state can restore
its token. Clearing membership removes tokens, not document text.

A segment owns its token and the exact body bytes up to the next marking.
Reordering existing IDs moves those owned spans together; a needed newline
keeps a moved token at a line boundary. New entries append at the end on a new
line. Unrecognized source tokens remain source text. Replacement of several
source spans cannot inherit unrelated old IDs by position; it creates new IDs.
This seam synchronizes markings, not prose between separate textarea views.
An already populated textarea cannot infer how unrelated preexisting IDs map
to its paragraphs and reports `ambiguous-source-entries` instead.

Rendering is guarded by entry membership, source revision and component
lifetime. A late result cannot rewrite an edited body or restore a removed
entry. A textarea that adds entries to its collection, on mount or through an
edit, keeps each added portion as its body holds it until the store has
committed that entry, so a portion whose first read is still on the wire, or
failed, keeps its mark while store edits to the other entries still apply. A
textarea seeds the entries it parsed from their portions as it mounts, whether
during the runtime's initial sweep or after it. Unresolved loaded text is retained and reports `unresolved-source` if
an entry update cannot safely replace its token. A multi-entry parent update
reports `ambiguous-parent`. These conflicts appear in
`data-ezclassify-entry-conflict`; parent ambiguity also emits
`ezclassify:entry-conflict`. A failed render preserves the body and emits
`ezclassify:entry-error`.

Custom stores without the optional membership methods retain scalar assertion
publication. They do not provide two-way variable-entry binding. The explicit
`first-part-binding` mode continues to bind only its designated first portion.

## 12. The structured-document example

Most non-trivial consumers don't have one marking: they have a
document with classifications scattered across nested fields. Here's
the canonical structured shape:

```js
const doc = {
    'productID': 'abc',
    'classification': 'HIGH/CTRL-A',
    'title': { classification: 'MED', value: 'the title' },
    'para-1': { classification: 'LOW', text: 'this is my paragraph' },
};
```

Three classification fields, each their own marking object:

```html
<input
    id="doc-marking"
    name="documentMarking"
    type="hidden"
    data-ezclassify-rendered />
<input
    id="title-marking"
    type="hidden"
    data-ezclassify-rendered
    data-ezclassify-part-of="doc-marking" />
<input
    id="para1-marking"
    type="hidden"
    data-ezclassify-rendered
    data-ezclassify-part-of="doc-marking" />

<!-- Document-level: full marking, with a tag input -->
<input
    data-ezclassify-controller="tags"
    data-ezclassify-bound-to="doc-marking" />

<!-- Title: also a full marking, but only the level facet has a picker -->
<label>Title</label>
<input type="text" value="the title" />
<input
    data-ezclassify-controller="select"
    data-ezclassify-facet-of="title-marking"
    data-ezclassify-category="level" />

<!-- Paragraph: inline marked-textarea on the text body -->
<label>Paragraph 1</label>
<textarea
    data-ezclassify-controller="marked-textarea"
    data-ezclassify-bound-to="para1-marking">
this is my paragraph</textarea>
```

The `productID`, `title.value`, and `para-1.text` fields are plain HTML;
ezclassify doesn't touch them. The classification fields are the
marking objects, and `part-of` declares the structural relationship. The
textarea itself owns its prose; save its native value with the document.

JS bridge:

```ts
import { bindEzClassifyToObject } from '@ezclassify/ui';

const handle = bindEzClassifyToObject(store, doc, {
    'doc-marking': 'classification',
    'title-marking': 'title.classification',
    'para1-marking': '/para-1/classification', // JSON Pointer, key contains a dash
});

handle.onChange((updated) => save(updated));
```

When TagInput publishes a change to `doc-marking`, the store
fires the subscriber chain → the helper runs the rendered string
through to `doc.classification` and calls `onChange(doc, diff)`. When
the user edits a marking inside `para-1`'s textarea, the same
mechanism updates `doc['para-1'].classification`. Coverage checks fire
in the background; coverage failures surface as `valid: false` on the
failing child plus a DOM event on the child element.

## 13. String-side vs assertion-side schemes

Schemes split naturally into two patterns by what users type first.

### String-primary (banner and part markings)

The user types `HIGH/CTRL-A`. The marking is a string; assertions are
derived by the engine. Components surfacing this pattern:

```html
<input id="banner-marking" type="hidden" data-ezclassify-rendered />

<input
    data-ezclassify-controller="tags"
    data-ezclassify-bound-to="banner-marking"
    placeholder="Type the marking…" />

<input
    data-ezclassify-controller="marking"
    data-ezclassify-bound-to="banner-marking" />

<div
    data-ezclassify-controller="banner"
    data-ezclassify-source="banner-marking"></div>
```

Read state.rendered, write state.rendered. The assertion-side views
(if any) are derived displays, a card showing the parsed concepts,
say.

### Assertion-primary (geography, allergens, pantry-tags)

The user clicks `DAIRY`, `GLUTEN`. The marking is a set of assertions;
the rendered form is a CSV the engine emits. Components:

```html
<input id="allergen-marking" type="hidden" data-ezclassify-rendered />

<div
    data-ezclassify-controller="checklist"
    data-ezclassify-facet-of="allergen-marking"
    data-ezclassify-category="allergens"></div>

<div
    data-ezclassify-controller="card"
    data-ezclassify-source="allergen-marking"></div>
```

The checklist publishes `assertions`; the engine renders a CSV string;
the card displays it.

Both patterns work uniformly because every `EzClassifyState` carries both
representations. The component's internal mode (rendered-side vs
assertion-side) is invisible to the markup; only the scheme decides
which pattern reads naturally.

## 14. Industry-alignment notes

We're not inventing a paradigm. The conformant pieces:

- **`data-*` attributes follow the HTML5 dataset spec.** Same pattern
  as Stimulus, htmx, Alpine, Turbo.
- **Hidden-input form integration is native.** `FormData` collects the
  rendered marking string on submit with no extra code.
- **CustomEvent for cross-component signaling.** Bubbles, capturable,
  cancelable. The web platform's pub-sub.
- **Pub-sub store interface.** `subscribe(id, listener) → unsubscribe`
  is the shape Redux, Zustand, Pinia, and Jotai all use, narrowed to
  per-id keys because that's what fits the binding model.
- **Coverage-as-check aligns with form-validation idioms.** Angular
  validators, React Hook Form, and Final Form all return `valid` +
  `errors`; the consumer reads, they don't push. Same posture here.
- **JSON Pointer (RFC 6901) for cross-key paths** is the standard
  spec for addressing into JSON.

The explicit non-default choices:

- **Shared algorithms, framework-native storage.** The core owns marking
  commits, validation and aggregate updates. Each framework adapter supplies
  reactive cells backed by its native signals, refs or snapshots; bindings
  project those cells without maintaining a second state copy. See §8.
- **`data-*` controllers vs custom elements.** Custom elements would
  give us encapsulation and shadow DOM. They also force every consumer
  into the custom-elements lifecycle, which fights Angular's structural
  directives and React's tree reconciler. `data-*` controllers
  progressively enhance existing elements and stay out of the host
  framework's way.
- **`facet` names a partial view of a marking.** See §3.1, a
  collision-free term distinct from the engine's own vocabulary.
- **Path syntax accepts dot-notation OR JSON Pointer.** Dot is what
  consumers reach for; JSON Pointer handles edge cases (keys with
  dots, dashes that aren't dotted access). Auto-detect by leading
  slash; no flag.

## 15. Forbidden patterns

Things you must not do. Each one has a concrete failure mode.

- **No `[(ngModel)]`, `v-model`, or fully-controlled React inputs on
  `@ezclassify/ui`-managed elements.** The framework's two-way binding
  will fight the library's binding; both write to `.value`, neither
  knows about the other, and the field stutters on every edit. If you
  need two-way, use the framework helper (Angular signal, Vue ref,
  React hook) which goes _through_ the store. Plain text fields
  without ezclassify controllers are fine for native framework
  two-way; this rule applies only to elements ezclassify has wired
  up.
- **No bespoke per-demo Handbook / Guidebook / scheme-picker
  components.** Demos consume the shared `@ezclassify/ui` controllers.
  A demo that re-implements a
  shared component is a demo that lies about what the library
  produces.
- **No bypassing the store.** Don't read or write `EzClassifyState` by
  poking at the DOM. Don't read the hidden input's `.value` to learn
  what's in the marking, go through `store.get(id)`. Don't write the
  hidden input's `.value` to set the marking, go through
  `store.publishRendered(id, ...)`. The store is the only authority on
  marking state; the DOM is a view of it.
- **No silent coverage corrections.** When a parent's coverage shifts,
  the library never re-writes the child to match, however helpful a
  fix would look. See §7.
- **No mixing two binding attributes on one element.** Either
  `bound-to` or `facet-of` or `source` or `aggregate`. The scanner
  warns and ignores extras, but the right rule is "don't write it."

## 16. Deferred from the 1.0 surface

The model supports extensions beyond the 1.0 implementation. Explicit deferrals:

- **Nested wholes.** A marking that is `part-of` a parent marking
  which is itself `part-of` a grandparent. The graph supports it;
  the engine round-trip would work; the UI runtime wouldn't compute
  multi-level coverage correctly without more work. Customers who
  need this can file a feature request.
- **Cross-engine context.** A single marking field driven by two
  schemes at once, side by side, each from a different authority.
  The multi-profile rollup is a flat aggregation, not a true
  multi-engine context. It needs its own design.
- **SSR / hydration.** The whole binding layer assumes a live DOM.
  Server-rendered markup with client-side hydration works if the
  server emits the right hidden inputs, but we don't ship a
  hydration story or matching server-side render utility yet.
  Separate design.

Each limit is scoped. The model leaves room for each one without
breaking the public attribute vocabulary or the `EzClassifyStore`
interface.

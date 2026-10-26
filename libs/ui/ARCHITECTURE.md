# Forms Library Architecture

## Mental Model

The forms library enhances native HTML form elements (`<input>`, `<select>`, `<fieldset>`) with interactive tagging components. The architecture follows a strict data flow:

```
User action → Component assertions → Native input value → Form rollup
                                └→ Marking store → Structured rollup
```

Native controls remain the host form boundary. The form rollup aggregates native
values and component renderings with `aggregate()`. The marking store aggregates
committed assertions with `aggregateAssertions()`, preserving structured facts
that a rendering cannot represent.

### The Native Input Is the Source of Truth

Enhanced controls preserve the native form field and its `.value`
for host form integration. For bound markings, the marking store retains the
structured assertion state; a native rendered value is a projection of that
state, not a lossless replacement for it. An editable marking field may instead
hold an uncommitted draft, including invalid text. Components read existing native text
on initialization and keep the field synchronized when its rendering changes.

- **On init**: Seed from the supplied initial value or native field. The shared
  base skips its initial read for empty text; read-only components use
  `validate()`, and editable components use `process()`. Setup and store
  subscriptions can perform additional work.
- **On user action**: Settle edits through the engine and synchronize committed
  renderings with the native field. Draft typing and committed changes have
  separate paths; their request costs depend on the component and binding.
- **On rendered value unchanged**: Skip the redundant native-value write and
  ordinary form events. Structured assertion, validity, or whole/part-context
  changes can still require store updates and validation.

### Host Form Contract

Enhancement does not replace the host application's form contract. The original native field remains in the DOM, retains the field's current text in its value, and exposes ordinary bubbling form events for edits. A MarkingField can retain an invalid draft while its structured state still holds the last committed marking; native validity reports that draft's error. A host may ignore EzClassify's structured API and continue reading, validating, and submitting the field as an ordinary form control.

The canonical authored hosts are native text inputs for MarkingField, TagInput,
and MarkedInput, and a native textarea for MarkedTextArea. Wrapping editors are
component-owned DOM; consumers do not author them.

`data-ezclassify-controller="marking"` accepts a native text input or textarea.
For an input it owns an unnamed `textarea.marking-field-host` beside the original
inside `.marking-field-wrap`. Draft text and normal input/change events remain
on the original named control; the editor adds no submitted value or scanner
binding. Labels, focus, native constraints and reset follow that control, and
teardown removes the editor and restores the original input. An existing
textarea remains the editor itself.

`data-ezclassify-controller="marked-input"` uses a native text input. It owns
an unnamed wrapping `textarea.marked-input-native` inside `.marked-input-wrap`;
the original input retains its identity, submitted value, labels, constraints,
normal form events and reset behavior. Teardown restores that input and removes
the editor. MarkedTextArea continues to enhance a native body textarea.

Over a native text input, the three single-line fields share one outer height:
the `2rem` floor their stylesheets declare. MarkingField and TagInput mirror the
input's box onto the layers they own. A host whose box is shorter is held to the
floor with its line centered, on both of MarkingField's layers so focusing never
moves it; a host that asks for more height keeps it.

Standalone MarkingField and TagInput controllers register their own marking
identity from the native input's id, generating one when it has none. They do
not require a hidden rendered
field or a redundant `data-ezclassify-rendered` attribute. Explicit
`data-ezclassify-bound-to` still selects a separate marking when the host
application needs one; hidden and plain rendered fields retain their own
`data-ezclassify-rendered` declaration.

EzClassify events are additive. `ezclassify:change` carries both `detail.rendered` and `detail.assertions` for hosts that want to subscribe to structured changes and persist assertions instead of the rendered string. Using those events is optional; it must never be required to recover the field's current rendered value or observe an ordinary value change.

MarkedInput holds a leading part marking followed by free text. MarkedTextArea
holds body text with multiple marking segments, so its structured events differ
in shape: `ezclassify:marked-change` fires when the set of recognized marking segments changes and carries `detail.segments` (each with its own assertions and rendered form), and `ezclassify:text-change` fires on body edits for live previews. Each part also registers as its own marking object with the ordinary `ezclassify:change` semantics. The native rules above still apply unchanged: the native field keeps its full text as `.value` and emits normal bubbling events when that value changes.

### Progressive Enhancement Contract

Every component enhances a native control. It must preserve every input mode the native control supports: keyboard-only, mouse-only, and touch-only interaction. EzClassify may add shortcuts such as Tab completion and Up/Down suggestion browsing, but an enhancement must not take away or trap the native interaction.

The current component family also includes read-only displays and headless
assertion fields that do not enhance a native control. That differs from the
universal scope stated above; it does not relax the native-input interaction
requirements.

The component must remain usable and visually stable on mobile and desktop, in the host's light and dark themes. Theme state comes from the host application, not directly from the operating system: if the host does not change when the system theme changes, the EzClassify component does not change either. Tooltips, hover content, and toasts must not block the control, move it unexpectedly, or make an input mode unusable. Optional guidance surfaces must have documented `data-ezclassify-*` attributes that let the host disable them.

Embedded components are customizable by contract. The host controls presentation through documented attributes and CSS hooks. The website documentation must enumerate the supported behavior, presentation, and opt-out controls so an integrator does not need to inspect the implementation to discover them.

Configuration stays narrow. Subjective and optional helper surfaces, such as tooltips, may be disabled. Core correctness and interaction behavior are not configuration choices.

### Enhancement Status Indicator

Every enhanced input and textarea, including a data-only field, has one EzClassify status mark: the 3-bar-plus-sparkle brand glyph. MarkedInput and MarkedTextArea put it in their existing bottom hint row, right-aligned opposite the ⌘+Enter tip; MarkingField and TagInput put it in a small ★ drawer attached to the field's bottom-right edge (mirroring to the top-right when the field's own composer opens _below_ it: the drawer always sits on the edge OPPOSITE the composer, never the same one, see `field-chrome-drawer.ts`). On the top edge the drawer hangs into the label's line, so it carries only the mark and ★ there; TagInput's key hints show on the bottom edge only. The one remaining absolutely-positioned placement (an input's right edge) belongs to the plain, chrome-less `<input>` binding path in `ezclassify-ui.ts`: a bare field with no hint row or drawer of its own to fold the mark into.

- **Quiet** is the default: the whole glyph sits muted. It means the field is enhanced by EzClassify and nothing has been fixed. A proposed fix does not change the mark; only an applied fix does.
- **Unseen**: EzClassify applied a fix the user has not yet been shown. The sparkle turns accent-colored, a small corner dot appears, and the sparkle pulses on an interval (disabled under `prefers-reduced-motion`, where the dot alone carries the state).
- **Seen**: the fix tooltip has actually presented, past its hover-intent delay, or the mark was focused. The dot clears and the pulse stops; the accent sparkle persists as "done and known."
- **Error**: the field could not check all of its text, as when a
  MarkedTextArea's scan stops before the end of the body. The sparkle takes the
  error color and the popover and accessible label lead with the reason, ahead
  of any fixes. It overrides the fix states and needs no acknowledgment: it
  clears when its cause does. The tooltip opt-out never hides it.
- A fix not yet shown re-arms unseen even if the field was previously seen. Clearing the fix set (a clean reprocess) returns to quiet and forgets what was shown, so the next fix starts unseen again. State is per-field, in-memory only.
- A field always has one status mark. Multiple fixes never create a stack of icons.
- Hovering (past hover-intent) or focusing an active mark explains every change the engine made: each `Change` once, as the change's own `message`. The field writes none of the words itself; a change says only what the engine's message says. One rule that removes three concepts made three changes and lists three lines; reading the same text again does not repeat a line.

The indicator communicates state; it is not a per-fix activity feed.

`HiddenAssertionField` currently hides its container and renders no status mark.
That implementation differs from the data-only-field requirement above.

### The composer (one picker for the field family)

`components/composer/` is the single picker behind TagInput, MarkingField,
MarkedInput and MarkedTextArea. The controller owns typing, commit, blur,
and list behavior across the four fields.

- `composer-controller.ts` is headless: the draft (the text as typed), a
  tolerant engine reading of the whole draft on every keystroke, ranking,
  the commit table, and announcements. Its header comment carries the commit
  table; `composer/composer-contract.spec.ts` drives all four fields through it
  over the real engine and asserts identical stored results.
- `composer-view.ts` is the one row renderer and surface: the pinned result
  row ("Saves as", with change marks, unread fragments flagged in place), the
  needed strip, a flat ranked list for a query and a grouped browse for an
  empty one, gated rows, and the live region. A popover anchored to the field
  on fine pointers; a sheet docked to the top of the keyboard on coarse
  pointers below 768px.
- `composer-reading.ts` turns a process result into a reading: complete only
  when recognition accounted for every character, with render-suppressed
  committed facts carried forward.

A field supplies a port (its engine binding and how it stores a result), its
draft shape (the text is the whole marking, or adds to a committed set as
TagInput's filter does), where the composer opens from, and how the
committed value is displayed. Read the controller's header before changing any
field's typing, accept, commit, blur or Escape path.

### Rollup Observes Native Inputs

`forms/rollup.ts` aggregates native input values, component renderings, and
nested scopes' rolled-up wholes into per-profile markings. Changes schedule a
debounced pass. Facet groups contribute their combined parent marking when one
is present.

The marking store has a separate path in `store/base-ezclassify-store.ts`: it
collects committed assertion sets and calls `aggregateAssertions()` for page
aggregates and whole rollups. It does not reparse rendered strings, so
render-suppressed assertions and captured values survive aggregation.

- Collect each input's resolved profile id and rendered string.
- Group values by profile id.
- Call `engine.aggregate(values, options)` for each scheme group. An addressable
  adapter also receives the scheme id; a Context-bound adapter omits it.
- Write each group's result to `data-rendered-<schemeId>` on the rollup target.
- Set `rollup.value` to the only contributing scheme's rendering, or prefer the
  default scheme among multiple contributors. Without a contributing default,
  use the first contributing scheme.
- Emit `ezclassify:rollup` with `detail.byScheme` (a `{ schemeId: rendered }` map) so multi-scheme pages can read every group's output without parsing attributes. The event also carries `detail.rendered`, `detail.contributions`, and `detail.assertions`.

#### Multi-profile rollup contract

Each enhanced component carries a resolved `schemeId` (set during `init` via
`resolveProfile(container, engine, options)`). Resolution order (implemented in `resolveProfile` in `components/component-base-readonly.ts`):

1. `data-ezclassify-scheme` on the host element or closest ancestor, then
   `options.schemeId`.
2. A Context-bound adapter uses `getScheme().id` and rejects a requested id
   that differs from that bound scheme.
3. An addressable adapter uses an explicit request, then its default scheme.
   Without scheme-list introspection, its bound `getScheme().id` is used;
   with exactly one listed scheme, that scheme is selected.
4. Multiple listed schemes without a request or default cause an error that
   names the available ids.

The rollup never produces a merged cross-profile rendering; profiles are
independent at render time by design.

### Rollups read settled values

An engine across a network answers in whatever order it likes. Everything a
rollup or a part sends is computed from settled values, so the requests a page
makes follow from its markings and the user's actions, never from that order. A
replay server that answers only recorded requests depends on this, and so does
anyone comparing two loads of the same form.

- The store computes a rollup only from settled contributors: a contributor is
  settled when the store has nothing pending for it, meaning no read of it is
  on the wire and the read it was asked for has committed or failed. A marking
  nobody has seeded or published was never asked for, so it is settled and
  contributes nothing; once it is seeded or published it is a contributor like
  any other and its commit computes the rollup again. A rollup that comes out
  empty while it already holds the empty state is not announced, so
  registering parts before anything is asked for them makes no whole field
  read itself again. A whole rollup's
  contributors are the parts registered under it and the whole itself; the
  page aggregate's are every registered part and every seeded or published
  marking. A rollup of a contributor set with a read still pending is never
  sent; the answer that settles the last contributor computes it. Contributor
  sets go to `aggregateAssertions` in marking-id order. A contributor whose
  first read fails counts as settled: the rollup is computed without it and
  flagged `stale`.
- A MarkedTextArea whose scan did not read its whole text (the scan's
  `limits.status` is not `complete`) is an incomplete contributor. A scan that
  throws counts as one that read nothing. Integrity fails closed: nothing
  committed is dropped on the strength of text nobody read, the unread rest is
  flagged, and nothing waits on it.
    - Portions up to where the scan stopped follow the scan. The scan reports no
      offset for that point, so the end of the last marking it returned stands
      in. Portions committed earlier that sit past it are kept until a complete
      scan replaces them: one whose mark the edit left in place stays where its
      mark now is, and one whose mark the edit rewrote or removed is held at an
      empty anchor, undisplayed, with what it committed. Store states are not
      reflected into the body while a portion is held.
    - The page aggregate and the rollup of the whole its portions feed are
      flagged `stale` until a complete scan clears it. A custom store without
      the reference stores' internal hook does not flag them.
    - The field shows the error on its status mark, in a visible notice beside
      the field that the textarea is described by, and once through a polite
      live region when it appears. It sets the textarea's custom validity and
      `aria-invalid`, clearing only a message it set.
    - In first-part-binding mode, a scan that read no portion leaves the marking
      the first portion is bound to unread: banners mirroring that marking say
      it may be incomplete until a scan reads the first portion.
- A rollup on display says when it may be missing markings. A banner showing a
  `stale` rollup keeps its value and adds a visible, announced statement that it
  may be incomplete. The runtime's rollup field is invalid (custom validity and
  `aria-invalid`) while its scope has an incomplete MarkedTextArea, the store
  holds the page aggregate as stale, or a nested scope's whole is incomplete; a
  scope built from an incomplete inner whole is incomplete too. The flag is
  raised at once and cleared only by the rollup pass that recomputes the value,
  which it asks for. Raising it sends no engine request.
- The store sets no timer. Every `EzClassifyStoreEngine` call resolves or
  rejects in bounded time, which is the adapter's job over a network, so
  bad or incomplete caller code, such as a part registered with `setPartOf`
  and never seeded or published, can leave a contributor out of a rollup but
  never hold it.
- The runtime seeds each marking host once, in the step that mounts it: a host
  with no controller after its part edge is registered, a controller once its
  init has resolved, and a MarkedTextArea's portions once the textarea's init
  has. The initial sweep holds those seeds and starts them together once every
  init has resolved, because the inits read the engine and answer in any order;
  seeding each host as its own init resolved would let a part roll up before a
  sibling part had been asked for. A host mounted later is seeded as it mounts.
- The form rollup (`forms/rollup.ts`) runs a pass only while the store has no
  read on the wire, and reads each contributor that holds or shows a store
  marking from its committed value, not from the field's own rendering, which
  can still be on its way there. A field holding an uncommitted draft is read
  from the field. A pass that finds a read on the wire waits for the store's next return to
  idle and checks again, so it waits as long as reads keep starting. They start
  on seeds and publishes, which follow the page's hosts and the user's actions,
  so the waiting ends when those do.
- A whole field's `parts` and a part's whole context come from the store's
  committed values (see below). A MarkedTextArea whose whole is being read
  again waits for it before reading its marks (`whole-read-gate.ts`), so one
  action that both commits a mark and changes the whole reads the marks once,
  against the new whole.
- A runtime-mounted controller binds exactly its registered host
  (`mount-host-registry.ts`). It never adopts the first input of a form whose
  fields share one parent, which would read another field's value as its own and
  write its own value into that field.

Edits after the page settles recompute the same way. The converged rollups,
coverage findings and fixes are the ones the unsettled intermediate states
would have converged to; only the intermediate requests are gone.

### Suggest Is Lazy

Suggestion work must remain user-driven: do not add `suggest()` calls during
initialization or background rendering. Calls may be HTTP requests, so avoid
redundant work and reuse the field's existing reading. Typing should read the
whole draft with one `process()` per keystroke; a newer draft must supersede an
older reading still in flight.

The composer loads its base catalog on first open and caches it until
invalidated. Draft assertion changes refresh contextual offerings; unread query
text can request gated rows. For a part, contextual offerings come from
`process(..., { context, suggestFor })`. A newer draft supersedes an older
reading still in flight. Additive drafts also call `validate()` before
`process()`; facets with sibling assertions perform another judging read.

DecisionFlow and DualPane share the composer's suggestion catalog and Context
binding. They load or refresh cached offerings on focus, query and navigation
input, pointer interaction, and completion of a user edit. Setup, rendering, and
external assertion updates do not request suggestions; rendering consumes the
cache. A changed Context invalidates the cache for the next interaction.

Store-backed facets still refresh availability when subscribers arrive and
markings commit. That current path does not meet the lazy-suggestion requirement
above; it does not authorize adding eager calls.

### A part's excess over its whole is the part's own result

When a rollup changes, each part is processed with its whole as `partOf`
(one cached `process` per part and whole). The engine compares a part that is
valid on its own with a whole that reads as a valid marking, and reports what
the part carries beyond it as the part's own `_exceeds_whole` error: something
the whole does not cover, or something the whole carries that the part does
not allow. The rollup attributes nothing itself.

- A part with that error gets `ezclassify:validation` with `valid: false` and
  the engine's message, and `ezclassify:coverage-error`. A part without it is
  valid as far as its whole goes, whatever the whole's coverage check says
  about other parts.
- A part field shows the error with the rest of its rule errors, so it gets
  no notice beside it. A plain field with no component gets the notice.
- The whole's coverage (`checkCoverage(parts, whole)`, once per whole) still
  decides the whole's own state and notice, including findings no single part
  causes.

### A proposed fix is a whole marking

The engine proposes each way to fix a marking as a complete, valid marking:
`rendered` (the result), `keeps` (concepts of the author's marking it keeps),
`adds` (concepts an error requires), `removes` (concepts of the author's
marking an error names) and `message`. It carries no rule id, because one fix
answers every error on the list. What the engine changed on its own while
processing is a separate `Change` in `appliedFixes` (`ruleId`, `action`,
`add`, `remove`, `message`).

- The error list shows the rule errors, then one "Ways to fix" group. Each
  button reads the fix's message without its closing period; two fixes with
  the same `rendered` appear once.
- Pressing a fix states `keeps` and `adds` as the author's marking, source
  `user`, in one write. The engine derives everything else from them when the
  field reprocesses. The UI never adds or removes concepts on its own to apply
  a fix, and it keeps no record of what the engine read to propose it.
- The status mark, the marked-textarea's load check and the inline editor's
  announcement read `Change`s, never proposed fixes.
- A store state from a publish carries the reading's `appliedFixes` and
  `proposedFixes`, judged as the marking the store holds (see "Marking state
  is a display of the engine result"). A field that takes the state as it is
  (an invalid marking, or one with unread text) shows that state's errors and
  ways to fix, so every field bound to the marking offers the same fixes.
- The list sits inside the field's own wrapper, after the editable surface and
  before its chrome (the ★ drawer, or the marked fields' hint row), so Tab goes
  field, fixes, chrome. MarkingField's drawer moves to the top edge while the
  list is showing, so it never covers it. TagInput keeps its chrome inside the
  chip box, so its list still follows the box.
- The status mark's "EzClassify fixed this marking" popover closes when the
  field's value is rendered again or when focus or a press goes outside the
  field, and it moves above the mark (or closes) rather than cover the list.

### Whole-over-parts coverage has one source

An authored whole is checked against its parts when one or more fields name
it with `data-ezclassify-part-of="<whole-id>"`. No second annotation is
required. A writable controller can represent the whole directly with that id
or through `data-ezclassify-bound-to="<whole-id>"`. Each whole gets its
coverage finding from exactly one place:

- A whole field that judges its parts itself (the runtime gave it
  `resolveParts`; see below) shows the engine's `part-coverage` error and its
  fix paths under the field, with the rest of its rule errors. The rollup adds
  nothing beside it: no notice and no correction action. It still dispatches
  `ezclassify:validation` on the whole and records the whole's coverage state.
- Any other whole, one the rollup is the only judge of, gets the rollup's
  notice ("Whole marking does not cover part content: missing X") and, when a
  writable element represents it, a correction action with the
  engine-computed required whole. Applying it is always an explicit user
  action and routes through the component's ordinary `setValue()` path, and
  `ezclassify:coverage-applied` is emitted afterwards with the group id,
  previous marking, and applied marking in `detail`.
- The authored field remains the source of truth for the whole marking. The
  parts are aggregated and checked by the engine; UI code never derives
  marking semantics.
- A part that exceeds its whole is flagged on the part itself, from the
  part's own result (see "A part's excess over its whole is the part's own
  result").

### A whole is processed with its parts

The engine takes the part markings a whole has to cover as `parts` on
`process`. When they are present it judges the whole against them and every
fix it proposes, so a raise never lands below what a part needs.

- The runtime gives a field bound to a whole a `resolveParts` option. It reads
  the current markings of the same contributors the store rolls up for that
  whole (every registered marking whose `part-of` names it), at call time:
  the store's committed value for a part the store holds, the field's
  rendering for any other. Blank parts are left out; none at all means no
  `parts` key.
- `ComponentBase.callProcess`, MarkedInput's reads of its own mark and its
  inline editor add them to every `process` call, so the rule errors and the
  fix paths under the field already account for the parts.
- The runtime subscribes the field to the whole's rollup and calls its
  `refreshParts()` when a part commits, and once when it mounts. The field
  reads its value again and shows what that finds; the value itself is not
  rewritten or republished. An empty whole is judged as soon as a part is
  marked, so it is offered the level the parts need.
- Such a field reports `coversParts: true`, which is how the rollup knows to
  leave coverage to it.
- MarkedTextArea never sends a whole's parts. Its marks are portions, and
  judging each paragraph against the others would be wrong.
- A facet is one category of a marking, not the whole, and never receives
  parts.

### A part reads whatever state its whole is in

A problem in the whole has no bearing on a part's ability to mount or read.
It only means the part cannot be compared with the whole.

- A field whose read raises (the engine could not resolve the part's whole,
  a connection dropped) still mounts. It keeps the text it was given, shows
  the thrown message where its rule errors go, and publishes nothing. It
  reads again on its next edit, and the runtime makes it read again when its
  whole or its parts change (`refreshWhole()`, `refreshParts()`).
  MarkedTextArea does the same per mark: a mark that raises keeps what the
  scan found and is flagged with the message, and the other marks read.
- MarkedInput reads its leading mark as a part the same way MarkedTextArea
  reads its portions: with the whole's context when it is `part-of` a whole.
  A MarkedInput that is its own marking host tells the store which whole it
  belongs to when it registers, so its commits reach the whole's rollup
  listeners and the whole field reads again.
- A field that reads in its whole's context (`resolveContext`) is subscribed
  to the whole's marking. When the whole's value or validity changes, the
  field judges its value against it again and shows what that finds; the
  value itself is not rewritten or republished. The context is the whole's
  host text, except that a store commit the host has not shown yet is newer
  than the host and is read instead.
- While the whole is not a valid marking the engine returns each part's
  result with a warning (reserved rule id `_whole_unverified`). A part with
  no whole at all reads the same way: a rule that asks about the whole is
  unresolved, so the part is valid and carries the warning. Engine
  warnings show after the rule errors in the warning color, set
  `data-ezclassify-warning` on the field, and never set
  `data-ezclassify-invalid` or offer a fix. In MarkedTextArea the chip is
  underlined in the warning color and the caret tooltip gives the reason.
- Parts are compared with a whole only while the whole reads as valid. An
  invalid whole gets no coverage check, and the engine compares no part with
  it, so no part is flagged as exceeding it. The parts are compared again as
  soon as it is valid.

### A field torn down mid-edit keeps what was typed

A host can remove a field, or rebuild the whole runtime, while focus is still
in it: a dialog closing, a route change, a policy switch that recreates the
fields. No blur has run, so nothing has committed what was typed.

- A field with an uncommitted draft commits it through its ordinary commit
  path in `destroy()` and finishes tearing down once that write has landed
  (`teardown-write.ts`). MarkingField commits its typed text; the marked
  fields close an open editor the way a press outside the field does.
- The runtime keeps a removed field's store wiring until that write has
  settled, so the value reaches the store.
- Before a field goes away the runtime also puts its draft
  (`pendingDraft()`) into the marking host it is bound to. A runtime rebuilt
  in the same turn seeds from that host, so the typed value survives even
  though the old store goes with the old runtime.

### Clearing an editable field

Editable fields expose a keyboard and touch accessible × at the right edge
of their existing chrome. CategoryChecklist retains its existing Clear all
action instead of duplicating it. MarkingField and TagInput keep × inside the
field in both focus states, independently of the status icon's helper tray.
Marking controls clear their value through the ordinary host/store write path;
a facet clears only its category. MarkedInput and MarkedTextArea clear their
entire text, including embedded markings. Clearing discards any open draft,
invalidates pending reads, and returns a click or tap to the resting state.
Keyboard activation retains focus on the action. Neither opens the editor or
the on-screen keyboard. Disabled and read-only hosts cannot be
cleared. Empty controls retain the action's place and expose `aria-disabled`.
Read-only displays and headless fields have no clear control.

### No Cascading

Avoid unrelated component reprocessing. Bound views coordinate through the
marking store and rollup; whole/part changes deliberately refresh dependent
fields through `refreshWhole()` and `refreshParts()`, as described above.

## Rules for Contributors

### Engine API Call Budget

The design budget for the basic field path remains:

| Action                        | `process()` | `aggregate()` | `suggest()`         |
| ----------------------------- | ----------- | ------------- | ------------------- |
| Init (N pre-populated fields) | N           | 1             | 0                   |
| Init (empty fields)           | 0           | 0             | 0                   |
| User opens the composer       | 1           | 0             | 1 (first open only) |
| User types                    | 1           | 0             | 1 (gated rows only) |
| User commits                  | 1           | 1             | 0                   |

This is the intended baseline, not a claim that every current component meets
it. Whole/part validation, dependent-field refresh, and remote metadata
resolution can add calls. The following describes current implementation paths
and their differences from that budget; it does not relax the budget or the
lazy-suggestion and render-purity rules.

| Path                            | Engine work                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Shared-base initial read        | Nonempty text uses `validate()` for read-only components or `process()` for editable components; empty text skips that read. |
| Whole-marking composer draft    | `process()` reads the draft with committed render-suppressed facts carried forward.                                          |
| Additive composer draft         | Nonempty text uses `validate()` before `process()` to combine it with committed assertions.                                  |
| Facet composer draft            | Sibling assertions can require a second `process()` to judge the combined marking.                                           |
| Composer offerings              | Cached base catalog, contextual refresh when draft assertions change, and gated-query requests.                              |
| DecisionFlow/DualPane offerings | Shared catalog and contextual offerings loaded or refreshed by user interaction; rendering uses cached results.              |
| DOM form rollup                 | `aggregate()` per contributing scheme, plus facet-group aggregation and cached validation reads where needed.                |
| Marking-store rollup            | `aggregateAssertions()` over committed contributors; subscribed facets can also refresh availability.                        |

Whole/part validation, dependent-field refresh, and remote metadata resolution
can add calls. A commit may reuse a settled composer reading; it does not always
issue a new `process()` request.

### Do

- Skip writes when `input.value === rendered`: prevents unnecessary events and rollup cascades
- Use the component's cached `getRendered()` and `getAssertions()` instead of re-calling `process()`
- Gate composer engine calls behind the composer being open
- Debounce `updateRollup` to collapse synchronous bursts
- Set `initializing = true` during component setup, `false` after all inits complete
- Compare rendered strings directly when possible instead of making API calls

### Do Not

- Reparse a cached marking unnecessarily. A changed whole/part context or
  validation requirement can require a new read even when rendering is unchanged.
- Call `suggest()` during init or background renders
- Call `updateRollup()` from inside a loop over fields; use `onFlush` to run once after the batch
- Dispatch `input` events on native elements when the value hasn't changed
- Add engine API calls to `render()` methods; render should be pure DOM manipulation
- Assume the engine is local; all calls may be HTTP round-trips via `EzClassifyClient`

### Component Lifecycle

#### Marking state is a display of the engine result

The UI decides no marking semantics. A marking field shows what the engine
returned: its rendering, its errors and ways to fix, the fixes it applied, its
assertions with their sources, the render assessment, and the recognition of
the value. Where a fact the field needs is not in the result, the result or the
contract changes; the UI does not work it out from the text, the scheme's
format declaration or anything else.

Every read of a marking value, at initialization, through `setValue`, through
the plain-input path, through a category edit or a pressed fix, and through the
store, goes through `loaded-value.ts`:

- `acceptedValue` gives the value the field holds: the engine's rendering,
  verbatim, with every fix and addition the engine applied, valid or not. Text
  the engine could not read stays where the engine wrote it. The author's text
  stands only where the result says the rendering is not a reading of it: a
  text read with no recognition, or a rendering the engine refused to write
  (its assessment names conflicts or facts it could not write). The state then
  has no render assessment.
- `judgedAsHeld` preserves the engine's judgment of its resulting value.
  Only unread text moved by rendering triggers another read: recognition spans
  refer to the input, so the held text is read once to obtain its current
  offsets. That reading supplies its judgment and recognition. The value,
  assertions with their sources, and applied fixes stay from the first read.
  `assertionsBeforeRepair` is diagnostic history and never seeds an edit or
  triggers another read.
- The status mark lists the fixes the first read applied (see "Enhancement
  Status Indicator") and keeps them while the field holds that value, through
  echoes of it from the store; a different value starts the list over.
- The recognition of the held value (`recognition.unmatched`, offsets into the
  value) is what MarkingField flags in place and what TagInput shows as a
  flagged pill after the chips.

The store holds the same accepted value. Fields publish and seed what they
hold; nothing hands the store the author's original text in its place.

Render-suppressed assertions remain in structured state independently of the
text shown in the field. TagInput shows them as chips drawn faded, from the
reading's render assessment (`omitted`), which is the engine's own declaration
of what the written marking leaves out; it never decides that from a concept
id. A chip the engine derived (`infer`, `default`, `context`, or `repair` with
a `sourceRule`) is dashed and has no remove button, and the chip keys skip it;
a solid chip is a fact the author stated.

This does not authorize rewriting prose: MarkedInput and MarkedTextArea
separately scan their embedded markings and manage their own body-text editors.

```
init(container, engine, options)
  ├── Resolve adapter, scheme, format and native input
  ├── Read explicit initial value or native value
  ├── If nonempty: validate() (read-only) or process() (editable)
  │   ├── Hold acceptedValue(source, result): the engine's rendering, verbatim
  │   └── Seed assertions, applied fixes and the judgment of that value
  │       (judgedAsHeld)
  ├── setup() → build the component DOM
  └── Synchronize the enhanced input with the initial rendering

onAssertionEdit()
  ├── Update assertions (add/remove/toggle)
  ├── reprocess() → engine.process('', { assertions })
  └── onAssertionsChanged()
      ├── render() → update DOM
      └── onChange(assertions, rendered)
          ├── Synchronize the native value when changed
          ├── Schedule the DOM form rollup
          └── Publish structured state when bound to the marking store

DOM updateRollup()
  ├── Debounce (skip while initializing)
  ├── Collect native values, component renderings and nested-scope wholes
  ├── Aggregate contributions by scheme
  ├── Update per-scheme attributes and publish wholes to the parent scope
  ├── If native rollup value changed: write it and emit input/change
  ├── Emit ezclassify:rollup, including when its primary value is unchanged
  └── Validate parent-child relationships even when rendering is unchanged
```

### Viewport overlays

Dropdowns, inline marking pickers, tooltips, and popovers are component-owned
viewport overlays. They portal to `document.body`, use fixed positioning,
inherit the anchor field's documented `--ez-*` presentation tokens, clamp to
the viewport, and react to nested scrolling or viewport changes. A host must
not need to relax `overflow`, stacking, table, dialog, or card layout merely to
make an EzClassify UI component usable.

### Display-color precedence

Display surfaces must resolve colors in this order:

1. the host `colorMap` entry for the displayed concept;
2. the display color the adapter reported on the last `ProcessResult`;
3. the scheme `color_from` category default, read from published scheme data;
4. the generic accessible category palette.

The engine is the color authority. A scheme may drive its display color from a
single category or from an ordered condition list, and only the runtime that
owns the scheme can evaluate the second form: the conditions are scheme policy
and never appear in the public scheme a client receives. That runtime reports
its answer as `ProcessResult.displayColor`, which is why step 2 sits above the
local lookup. Step 3 exists for the paths that set assertions without a fresh
process call; it is a lookup over published data, not an evaluation.

Current implementations do not all follow that shared precedence:

- AssertionCard and StatusBanner's boundary mode use the host override before
  the adapter color, then the declared scheme color and category palette.
- StatusBanner's full-marking mode takes the adapter's `displayColor` before
  consulting the host `colorMap`, and stays neutral when neither the adapter,
  host, nor scheme declares a color instead of using the category palette.
- TagInput chips use each concept's declared category-driven color and fall back
  to the category palette; they do not use the whole-marking `displayColor` or
  the display components' `colorMap` precedence.

These are implementation differences against the shared rule above; whether
individual chips and full-marking banners should have separate color contracts
requires a design decision.

Host-supplied color rules are not part of this surface: matching them would
mean running the scheme condition evaluator in the browser, and that evaluator
is not public. A host that needs conditional coloring uses `colorMap`.
Per-component declarative options override runtime-wide options, and
CSS design tokens remain the final styling seam for surrounding application
chrome.

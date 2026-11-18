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
not need a hidden field or a `data-ezclassify-marking` attribute. Explicit
`data-ezclassify-bound-to` still selects a separate marking when the host
application needs one; a marking with no controller, hidden or plain, declares
itself with `data-ezclassify-marking`.

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

### Keyboard Navigation

DecisionFlow and CategorySelector share the private choice controls extracted
from DecisionFlow. The shared layer owns native button activation, accepted
selection semantics, inferred presentation, blocked-option interaction and
common focus styling. Controllers supply canonical state and explanations;
DecisionFlow retains step progression and CategorySelector retains category
grouping. A choice never changes its accepted state optimistically.

Custom option grids use `focus-grid.ts` to follow physical rows: Left/Right
moves within a row, and Up/Down chooses the nearest horizontal center in the
adjacent row. An option-grid edge stays put unless its controller supplies a
neighbor. Native text controls keep interior caret movement, Space, selections
and modifier keys. Card arrows move focus; activation chooses the
radio value. Checklist Enter and Space toggle its native checkbox.

Each nonempty CategorySelector category and Checklist list has one native Tab
stop, initially its first item. DecisionFlow starts on the current step's first
selected item or first available item. Each group remembers its current working
control through redraws. Working controls precede header actions in native DOM
order, while the header remains visually above them. Tab enters the choices or
list; a collapsed DecisionFlow uses its own field entry to open and focus the
current step's selected/default control.

`field-chrome.ts` owns Left/Right between the branding and clear buttons;
Checklist's header includes its bulk actions in that physical path. Up from the
top CategorySelector or Checklist row reaches branding, and Down from its
header returns to the working group. DecisionFlow keeps its option-to-current-dot
Up path, its dot-to-branding header path and its Clear-to-Next Down path. A
focused dot previews its step, and Tab reaches branding. Down on branding never
opens tools: it returns to the working area in CategorySelector, Checklist,
DecisionFlow and MarkedTextArea, and leaves focus in place on other controls.
Enter, Space, click and the field shortcut activate the tools.

`text-caret-edge.ts` handles only collapsed, unmodified native text boundaries.
The field's end hands focus to branding, whose Left returns to that editor's
end. TagInput's start reaches the last tag while preserving its search draft.
DecisionFlow value fields use their physical option or navigation neighbor;
its Clear button's Down opens the step and reaches Next. MarkedInput retains
inline-to-body traversal before its whole-field end; MarkedTextArea keeps
native body navigation. Date controls and composition retain native handling.
Navigation instruction strips are not rendered. MarkedInput and MarkedTextArea
retain a platform shortcut keycap in their Set/Add Marking action on fine
pointers; touch layouts keep the plain action. Action names, shortcut titles
and `aria-keyshortcuts` remain available.

`concept-hint.ts` shares DecisionFlow's plain name, definition and reason
formatting. CategorySelector choices, TagInput chips, MarkingField annotations
and shared composer suggestions use native titles with accessible descriptions.
Concept hints do not mount a separate interactive popup or change editor focus.
Composer definition nodes stay available to assistive technology without a
visible detail pane; error reports and fix actions remain visible.

A redraw preserves the identity of a focused option, including a temporarily
blocked but natively enabled option while its catalog refreshes. A removed
option uses an available/default group target. Checklist and card groups can
recover their own parked focus when options return; a refresh never reclaims
focus from another field.

The private `marking-target.ts` registry associates a controller with its full
store entry, independently of a Favorites provider. Favorites use that entry's
value. Canonical remedies use the same association to publish structured facts:
`fixAssertions` resolves kept references against the current entry so captured
values survive, and dependent-category changes are applied together. A facet
can display errors for its categories while obtaining remedies from an automatic
whole-marking judgment, preserving context, parts and every marking scope.
Proofs and actions are invalidated when their input changes.

### Enhancement Status Indicator

Every enhanced input and textarea, including a data-only field, has one EzClassify status mark: the 3-bar-plus-sparkle brand glyph. MarkingField, TagInput, MarkedInput and MarkedTextArea put it in their inline chrome (`field-chrome.ts`): one row inside the field's trailing edge holding the mark and clear. Editable marking controls open tabbed Corrections and Favorites from the mark. Favorites appears when a host provider or scheme presets are available. Opening the tools suspends suggestions and focuses the selected tab. Tools line up with the control's leading edge and choose above or below from the available space when opened. That side stays fixed as tabs, counts, or saved entries change; the active section scrolls within its available height. Internal text-field caret scrolling leaves the tools open while their anchor stays in place; page or ancestor scrolling still closes them. When the control fills the viewport, the focused dialog stays inside the viewport. The row sits in the same place at rest and while the field is focused, centered on a single-line field and pinned to the first line of a text area. It measures how far it reaches into the field and publishes that as `--ez-field-chrome-inline-size` on the field's wrap; the field's text layers reserve that much trailing padding, so text, wrapped lines and chips never run under it, and the reserve follows the row when its contents change. The one remaining absolutely-positioned placement (an input's right edge) belongs to the plain, chrome-less `<input>` binding path in `ezclassify-ui.ts`: a bare field with no chrome row of its own to fold the mark into.

- **Quiet** is the default: the whole glyph sits muted (`--ez-status-mark-color`). It means the field is enhanced by EzClassify and nothing has been fixed. A proposed fix does not change the mark; only an applied fix does.
- The glyph is the logo, so its bars and sparkle always share one color; a state never colors the sparkle on its own.
- Every other state means the field has a message for the user, and the glyph turns strong (`--ez-status-mark-strong-color`): the field's text color on a light palette, gold on a dark one. The accessible label then carries the message too.
- **Unseen**: a marking rule changed the marking and the user has not yet been shown what. The whole mark is strong and the number of changes stands on the icon's leading side, so the icon keeps its place when the number goes and never moves out from under the pointer that opened the list. Its label says so: "1 change made by a marking rule, not yet reviewed", or "{n} changes made by marking rules, not yet reviewed".
- **Seen**: the changes were actually presented. Editable controls show them
  in Corrections; marks without tools can preview them by hover or focus. The
  number goes, the strong mark persists as "done and known", and the label
  drops ", not yet reviewed".
- **Error**: the field could not check all of its text, as when a
  MarkedTextArea's scan stops before the end of the body. The whole mark takes
  the error color and the popover and accessible label lead with the reason, ahead
  of any fixes. It overrides the fix states and needs no acknowledgment: it
  clears when its cause does. The tooltip opt-out never hides it.
- A fix not yet shown re-arms unseen even if the field was previously seen. Clearing the fix set (a clean reprocess) returns to quiet and forgets what was shown, so the next fix starts unseen again. State is per-field, in-memory only.
- A field always has one status mark. Multiple fixes never create a stack of icons.
- On a passive status mark, hovering (past hover-intent) or focusing it explains every change EzClassify made to what the author chose, one line per change to the marking: "Added {value} to {Category}.", "Removed {value} from {Category}." or "Replaced {old} with {new} in {Category}.", where a value is its concept as the field writes it (see "How a field names a concept") and a category is its label, with "Rule: {rule}" small and muted under it. A change that adds or removes nothing (a spelling or order the reading went through) keeps the engine's `message`, and an engine-owned id (one beginning with `_`) names no rule. Two rules that add the same concept made one change and list one line, under the first rule; one rule that removes three concepts made three changes and lists three lines; reading the same text again does not repeat a line. Seen and unseen follow the same identity, so a change already shown stays seen when another rule makes it again.
- A field that holds several markings (MarkedTextArea) still has one mark and counts every change in it, and its list puts each marking's changes under a small muted heading naming that marking as the text now writes it, in the order of the text. The same change made to two markings is two changes. Only a marking with changes gets a heading, and a list of changes to one marking needs none.
- While the marking offers the undo of the author's last edit (see "Undo"), the list ends with one button, "Undo last edit", described as "Puts the marking back to what it was before your last edit." Tab from the pressed mark reaches it.
- A value a rule added that the author has not reviewed yet is drawn in the family's inferred style wherever the field shows the marking as text: MarkingField's painted text and DecisionFlow's value line put it in italics over a dashed rule until the mark's list has been shown. TagInput's chips and DecisionFlow's options draw every derived fact that way for good (see "Marking state is a display of the engine result"); an option another choice includes is described "Included by {choice}".
- The mark lists only what the field's scopes write or what it changed: a change to a category of a scope the field does not write is left out, and so is an applied change the value has moved on from, an addition the field no longer holds or a removal whose concept it holds again.
- The author signs what the marking writes, so the mark lists only changes to what it writes. Which facts it writes is read from the engine's render assessments (`emitted`, `omitted`, `collapsed`; see `written-facts.ts`), never from concept ids: a fact a rule derived that the marking does not write (a member collapsed into its group's written name, a default no output prints) changed nothing the author sees and is not listed, even when `appliedFixes` names it. A result whose only changes are such facts leaves the mark quiet, so it offers no undo either. A value a rule added that the marking does write is listed and counted whether or not the author wrote it. A field that shows its marking in several forms (DecisionFlow writes each scope in that scope's own output) counts a change to any of them; a form speaks only for the categories of its own surface.
- A field that shows each fact (TagInput's chips, DecisionFlow's dots, a picker's rows) also explains a written fact a rule filled in that no applied change names, as one more change worded as an addition like any other. A text field (MarkedInput, MarkedTextArea, MarkingField) shows only its text, so it lists only the engine's applied changes. A category's default and a value a part takes from its whole are not changes.
- Popovers prefer space outside the field's box (the suite frame, or the text field's wrap) and its error list: below them, above them, or beside them, judged inside any ancestor that clips the field before the viewport alone. A passive explanation closes when no side has room. Explicit tools align with the control's leading edge, keep the same opening side during content changes, and use a viewport-bounded dialog with a fixed header and scrolling content when a tall control leaves no exterior space. In DecisionFlow the open step and its options are part of the field.

Favorites save the full value of the controller's associated store marking and replace that marking through `publishRendered`. Existing store subscriptions project the update into every category control. The persistence provider does not own category filtering or field binding. MarkedTextArea resolves the caret's existing entry identity; its parent aggregate and body text are never a Favorite. In plain body text, choosing a Favorite inserts a new marking entry through the editor's normal insertion path.

Targeted entry applications suspend automatic caret entry through publication and the owning binding's queued projection, so returning focus cannot reopen the discarded marking. They reuse the ordinary store projection and release their owned guard on settlement or failure.

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

`forms/rollup.ts` reads native input values, component renderings and nested
roots' wholes, and passes each level's contributions to the store as facts.
Changes schedule a debounced pass. The store (`store/base-ezclassify-store.ts`)
computes every level from committed assertion sets with
`aggregateAssertions()`. It does not reparse rendered strings, so
render-suppressed assertions and captured values survive aggregation.

- The binding classifier (`binding-model.ts`) places each element: a part in
  its whole, a whole in its collection, a collection in its parent, a view
  nowhere. It reads structure and element attributes, never marking text.
- A view never contributes. An `aggregate` output's own value is never read
  back into a rollup, so a rollup can always go down.
- A level combines its member wholes (each one's value and its parts rollup)
  and its child collections' rollups, in document order. Parts reach a level
  only through their whole.
- `scope` never excludes a field. Alternate-scope assertions stay out of the
  whole-marking rollup because the store splits each assertion set by the
  categories' declared scopes.
- `no-rollup` keeps a live non-content control, such as a filter picker, out of
  every level. It is refused on a part and on a whole with parts.
- Each output the host placed (a controller-less `aggregate` element) gets its
  level's value in its bucket: a hidden input holds it and any other element
  shows it as text. The library adds no input of its own.
- Each change emits `ezclassify:rollup` on the level's element (the instance
  root for the page, a collection's container, a whole's host). `detail.level`
  names the level (`null` for the page) and `detail.buckets` lists each bucket
  as `{ context, scheme, rendered, assertions, stale }`, with `null` for the
  only Context and for a Context's primary scheme.

#### Multi-Context rollup contract

One instance holds every Context on the page: `new EzClassifyUI(context)` for
one, and `new EzClassifyUI({ contexts })` for several, keyed by the names the
markup uses. Each marking is read in one bucket, the pair
(Context key, Context-local scheme selector), written as
`${contextKey}\u001f${schemeSelector}`.

1. The Context is `data-ezclassify-context` on the host or its nearest
   ancestor. With one Context it is that Context. With several and no ancestor
   attribute it is a host error; no key is a default by position.
2. The scheme is `data-ezclassify-scheme` on the host or its nearest ancestor:
   the selector the Context's `describeSchemes` and REST `?scheme=` use, not a
   global scheme id. Without it, the Context's primary scheme. Each bucket is
   read by the Context's view of its scheme (`context.scheme` for the
   primary, `context.schemes.get(selector)` for another), and a selector the
   Context does not hold is a host error.
3. A part is read in its whole's bucket. A `part-of` that crosses Contexts or
   schemes is a host error.
4. Every level keeps one rollup per bucket and never produces a merged
   rendering across buckets. Two Contexts that carry the same scheme stay
   separate, and the process cache is partitioned by adapter for the same
   reason.
5. A level view shows every non-empty or stale bucket, labeled whenever the
   level can hold more than one, unless its own
   `context` or `scheme` attribute picks one. It never filters by an inherited
   attribute. An output that holds one value names its bucket with its own
   attributes when the level has several, or it is a host error; the decision
   is static at mount.
6. A collection's `context` is the default for fields inside it, never a
   membership filter.
7. Guides and access policies need no selector. A Context holds at most one
   access policy, and its guides side by side: a scan across guides tags each
   hit with its `guideId`, the guidebook shows one section per guide, and the
   guide helper evaluates selections qualified by guide, so a hit and its
   outcome always name the guide they came from.

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
  page aggregate's, and each collection's, are its member wholes (each one's
  value and its whole rollup) and its child collections. A rollup of a contributor set with a read still pending is never
  sent; the answer that settles the last contributor computes it. Contributor
  sets go to `aggregateAssertions` in document order. A contributor whose
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
- A rollup on display says when it may be missing markings. A banner showing a
  `stale` rollup keeps its value and adds a visible, announced statement that it
  may be incomplete. An `aggregate` output the host placed is invalid (custom
  validity and `aria-invalid`) while its level has an incomplete MarkedTextArea,
  the store holds the level as stale, or a nested root's whole is incomplete; a
  level built from an incomplete inner level is incomplete too. The flag is
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

DecisionFlow shares the composer's suggestion catalog and Context
binding. It loads or refresh cached offerings on focus, query and navigation
input, pointer interaction, and completion of a user edit. Setup, rendering, and
external assertion updates do not request suggestions; rendering consumes the
cache. A changed Context invalidates the cache for the next interaction.

Store-backed facets still refresh availability when subscribers arrive and
markings commit. That current path does not meet the lazy-suggestion requirement
above; it does not authorize adding eager calls.

### How a field names a concept

A field names a concept the way its marking writes it, and one function,
`writtenConcept` in `src/written-concept.ts`, decides that for DecisionFlow's
options, its dots and every status mark's change list. The concept is written
in the output the field writes for the concept's scope: the output the field
names, when that output writes the scope, else the scheme's default output for
the scope and the field's role (whole or part). That output writes the category
in the view it names for it, and a concept with no spelling in that view in its
`default` view, as the engine does. A concept that output gives no spelling
reads as the scheme's default output for the scope writes it, and failing that
as its name, so no option is ever empty. A value-taking concept's views are
templates, so it reads as its name. Everything comes from the scheme: a short
form for a concept whose spelling is a sentence is scheme data, not a UI rule.

A DecisionFlow option carries the concept's name, when it differs from the
label, and its definition as its tooltip and description. An option too long
for its row takes a row of its own and wraps.

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
  before what follows it (the inline chrome, or the marked input's action row),
  so Tab goes field, fixes, chrome. The chrome sits inside the field's trailing
  edge, so it never covers the list. TagInput keeps its chrome inside the chip
  box, so its list still follows the box.
- The status mark's list of changes closes when the
  field's value is rendered again or when focus or a press goes outside the
  field. In DecisionFlow, whose presses open steps without changing the value,
  a press anywhere but its chrome closes it too. It opens clear of the field and the list together, and closes rather
  than cover the list when no side has room.

### Whole-over-parts coverage has one source

An authored whole is checked against its parts when it has any: fields inside
its `data-ezclassify-whole` container, or naming it with
`data-ezclassify-part-of`. No second annotation is required. A writable controller can represent the whole directly with that id
or through `data-ezclassify-bound-to="<whole-id>"`. Each whole gets its
coverage finding from exactly one place:

- A whole field that judges its parts itself (the runtime gave it
  `resolveParts`; see below) shows the engine's `_part-coverage` error and its
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
  whole (every registered part of it), at call time:
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
  reads its portions: with the whole's context when it is a part of a whole.
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
  unresolved, so the part is valid and carries the warning. A part that
  writes a stand-in for its whole's values is the exception: without a valid
  whole the engine refuses it (`_stand_in_requires_whole`), the field shows
  that error like any other, and the part reads again once a valid whole
  arrives. Engine warnings show after the rule errors in the warning color, set
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
invalidates pending reads, and returns a click or tap to the resting state,
opening neither the editor nor the on-screen keyboard. Keyboard activation puts
focus in the field. Disabled and read-only hosts cannot be cleared. Empty controls retain the action's place and expose `aria-disabled`.
Read-only displays and headless fields have no clear control.

DecisionFlow's × is named and titled "Clear the whole marking": it clears
every scope the flow writes, and the flow stays on its step. There is no clear
for one step. Pressing a chosen option again un-chooses it, on a single-choice
step too, whose options are toggle buttons with at most one pressed; a value
step is cleared by emptying its box. Un-choosing a required step is allowed,
and the step then shows under "Missing:".

After a clear the × becomes the undo of that clear, in the same place and at
the same size, named and titled "Undo clear". No toast, line or text in the
field says so. A keyboard clear leaves focus in the field, not on the undo,
which is the next Tab stop; an undo returns focus to the field. The live region
says "Marking cleared. Undo is available." and then "Marking restored." When
the offer ends (see "Undo") the slot is the × again. A second click of a
double click is not an undo.

### Undo

`components/marking-undo.ts` is one marking's one-level undo. "Undo" always
means: put the marking back to what it was before the author's last action. A
clear is one such action; every other edit (a pick, a removed chip, a commit,
a pressed fix, a favorite applied) is another. Undoing one rule's change on its
own is not offered.

- The offer belongs to the marking. Every field the runtime binds to a store
  marking shares that marking's `MarkingUndo` (`shareUndo`), so all of them show
  it: the × of each turns to undo after a clear, and each status mark's list
  ends with "Undo last edit". A field with no store marking keeps its own.
- The field that acted keeps the snapshot, because only it knows what it took:
  the facts it held (put back as facts, so the engine derives and explains the
  same changes again), or the text when the engine could not read all of it,
  and for a clear, a draft typed into it, which comes back as typed.
- The offer lasts until the marking next changes, from that field or any
  other bound to it, or until the field that made it is destroyed. There is no
  timer and no expiry on blur. An action's own consequences (the engine's
  answer, the store's commit, a step it made irrelevant) arrive before the
  author does anything else, so the value is followed until the author next
  presses a key or a pointer; after that any different value ends the offer.
  A shared undo hears the store's commits; a field's own hears its values.
  The next action replaces it.
- Ctrl+Z or Cmd+Z anywhere in the field performs it while it is offered,
  unless the author has typed text not yet committed, which the platform's own
  undo takes. Otherwise the platform's undo is untouched. An undo of an edit
  says "Last edit undone."

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

| Path                         | Engine work                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Shared-base initial read     | Nonempty text uses `validate()` for read-only components or `process()` for editable components; empty text skips that read. |
| Whole-marking composer draft | `process()` reads the draft with committed render-suppressed facts carried forward.                                          |
| Additive composer draft      | Nonempty text uses `validate()` before `process()` to combine it with committed assertions.                                  |
| Facet composer draft         | Sibling assertions can require a second `process()` to judge the combined marking.                                           |
| Composer offerings           | Cached base catalog, contextual refresh when draft assertions change, and gated-query requests.                              |
| DecisionFlow offerings       | Shared catalog and contextual offerings loaded or refreshed by user interaction; rendering uses cached results.              |
| DOM form rollup              | `aggregate()` per contributing scheme, plus facet-group aggregation and cached validation reads where needed.                |
| Marking-store rollup         | `aggregateAssertions()` over committed contributors; subscribed facets can also refresh availability.                        |

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
- The status mark lists the fixes the first read applied (see "Enhancement
  Status Indicator") and keeps them while the field holds that value, through
  echoes of it from the store; a different value starts the list over.
- The recognition of the held value (`recognition.unmatched`, offsets into the
  value) is what MarkingField flags in place and what TagInput shows as a
  flagged pill after the chips.

The store holds the same accepted value. Fields publish and seed what they
hold; nothing hands the store the author's original text in its place. A field
bound to a whole marking publishes its facts when the engine read its value in
full, so who stated each fact reaches every other view: read back from its text,
a value a rule added would read as the author's own and no view could explain
it. A value with text the engine could not read is published as its text, the
only place that text is kept.

Render-suppressed assertions remain in structured state independently of the
text shown in the field. TagInput reads what the written marking leaves out
from the render assessment (`omitted`, `collapsed`), the engine's own
declaration of it; it never decides that from a concept id. A fact the engine
derived that the marking does not write, such as a member collapsed into its
group's written name or a default no output prints, is drawn faded, and its
tooltip and accessible name say why the marking holds it: "Included by
{choice}" for a collapsed member, naming the value it is written under, and
"Default {category}, not written in the marking" for a default. It is never a
change on the status mark. A fact the author stated that the marking leaves
out is drawn faded too. A chip the engine derived (`infer`, `default`,
`context`, or `repair` with a `sourceRule`) is dashed and has no remove button,
and the chip keys skip it; a solid chip is a fact the author stated.

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
  ├── Collect native values, component renderings and nested-root wholes
  ├── Hand each level's contributions to the store as facts, per bucket
  ├── Write each host-placed output; emit input/change when its value changed
  ├── Emit ezclassify:rollup on each level whose rollup changed
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

- StatusBanner's boundary mode uses the host override before
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

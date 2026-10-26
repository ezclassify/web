# @ezclassify/ui

The forms library enhances native HTML inputs with interactive marking components. It is the shared UI layer used by every framework integration (React, Angular, Vue), and it mounts over plain markup with no framework at all.

## Architecture

The marking store holds structured assertions, rendered values and validity
for each marking. Controls publish edits to that store and subscribe to its
updates, so editors and previews share one state. Native form controls retain
their text values; marked-text controls retain both their inline markings and
prose. Persist structured assertions when your document needs categories or
capture values that its display format does not show. See
[ARCHITECTURE.md](https://github.com/ezclassify/web/blob/main/libs/ui/ARCHITECTURE.md) for the binding and engine API contracts.

Every `data-ezclassify-*` attribute the runtime reads or stamps is tabled in [docs/attributes.md](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md); the binding/view seam is described in [docs/binding-model.md](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md). Teams keeping Angular Material, MUI, React Select, Vue libraries, jQuery/Select2, or other preferred controls should use the framework-neutral [third-party control contract](https://github.com/ezclassify/web/blob/main/libs/ui/docs/third-party-controls.md).

## Boundary

This package ships components, not policy. There is no classification engine
in the tarball and no EzClassify-maintained scheme content. `EzClassifyUI`
takes an engine-compatible adapter and calls it; whatever you hand it decides
what a marking means. Opening, modifying, or redistributing this UI code grants
no right to use the engine or EzClassify-maintained content.

The adapter you use is `@ezclassify/rest-client`, the thin REST client. The
document form below runs it against a replay server that needs no license. In
production the same client points at your EzClassify runtime.

## Install

```bash
npm install @ezclassify/ui @ezclassify/rest-client
```

`@ezclassify/rest-client` ships from
[ezclassify/client-js](https://github.com/ezclassify/client-js). It is a
separate install, not a dependency of this package, so an application that
brings its own adapter does not pull it in.

## Mark a document and its parts

You can see the controls working before you have a runtime. The conformance
server replays recorded answers for Cedar Valley, a fictional school district's
teaching policy, over real HTTP. Your page talks to it through the same client
and components it will use in production.

Start the server. A browser app on a different origin from the server needs
`--cors-origin` with that exact origin (no wildcard). `5173` is the Vite
default, so use your dev server's own origin if it differs.

```bash
npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 \
  --cors-origin http://localhost:5173
```

The form below connects one document marking to the parts inside it. The
document's MarkingField edits its authored whole marking. The attachment
MarkingField, the summary TagInput, the title MarkedInput and the portions
inside the body MarkedTextArea are parts of that whole. One store holds them
all, a preview reads the authored whole, and a second banner shows what the
parts require. The complete app is in
[`examples/vanilla-example`](https://github.com/ezclassify/web/tree/main/examples/vanilla-example).

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Mark a document and its parts</title>
        <link rel="stylesheet" href="/src/styles.css" />
    </head>
    <body>
        <form id="document-form">
            <label for="document">Document marking</label>
            <input
                id="document"
                type="text"
                name="documentMarking"
                value="INTERNAL"
                data-ezclassify-controller="marking" />

            <label for="attachment">Attachment marking (MarkingField)</label>
            <input
                id="attachment"
                name="attachmentMarking"
                type="text"
                data-ezclassify-controller="marking"
                data-ezclassify-part-of="document"
                value="PUBLIC" />
            <label for="summary">Summary marking (TagInput)</label>
            <input
                id="summary"
                name="summaryMarking"
                value="CONFIDENTIAL"
                data-ezclassify-controller="tags"
                data-ezclassify-part-of="document" />
            <label for="title">Title (MarkedInput)</label>
            <input
                id="title"
                name="title"
                type="text"
                data-ezclassify-controller="marked-input"
                data-ezclassify-part-of="document"
                value="(PUBLIC) District report" />
            <label for="body">Body (MarkedTextArea)</label>
            <textarea
                id="body"
                name="body"
                data-ezclassify-controller="marked-textarea"
                data-ezclassify-part-of="document">
(INTERNAL) Planning notes.
(PUBLIC) Published background.</textarea>

            <p>Document preview</p>
            <div
                data-ezclassify-controller="banner"
                data-ezclassify-source="document"></div>
            <p>Computed parts</p>
            <div
                data-ezclassify-controller="banner"
                data-ezclassify-aggregate="document"></div>
            <button id="set-document" type="button">
                Set document to CONFIDENTIAL
            </button>
            <output id="save-status" aria-live="polite"></output>
        </form>
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

```ts
// src/main.ts
import { connectContext } from '@ezclassify/rest-client';
import { EzClassifyUI, VanillaEzClassifyStore } from '@ezclassify/ui';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const store = new VanillaEzClassifyStore(client.scheme);
const root = document.querySelector<HTMLElement>('#document-form')!;
const forms = new EzClassifyUI(client, { root, store });
const status = document.querySelector<HTMLOutputElement>('#save-status')!;
document
    .querySelector<HTMLButtonElement>('#set-document')!
    .addEventListener('click', () => {
        void store.publishRendered('document', 'CONFIDENTIAL').then(
            () => {
                status.value = `Document marking: ${store.get('document').rendered}`;
            },
            (error: unknown) => {
                status.value = String(error);
            },
        );
    });
```

The example adds a small page stylesheet, [`src/styles.css`](https://github.com/ezclassify/web/blob/main/examples/vanilla-example/src/styles.css), for layout and a plain style for the page's inputs and its button. The controls take their edge, padding and font from the input or textarea they enhance, so they match the rest of your form.
`VITE_EZCLASSIFY_URL` names the server when you start Vite; without it, the page
connects to the replay server above.

The authored whole starts at INTERNAL. The CONFIDENTIAL summary part changes
what that whole must cover; it does not silently replace the whole. The whole
MarkingField shows its contextual errors and fixes. The store's `valid` and
`errors` describe each marking itself; they do not include the whole's
coverage of its parts. The read-only `source` banner shows the authored whole,
while `aggregate="document"` shows only its parts. The button publishes a real
store edit, which updates the same whole editor and preview. A bare
`data-ezclassify-aggregate` instead reads the page aggregate, including the
whole itself and every other marking in this store.

The replay records this form used as written: focus each control, browse each
picker, open the marking popup in the title and body (Ctrl+Enter, or Cmd+Enter
on macOS), select **Set document to CONFIDENTIAL**, then change the title to
`(PUBLIC) District report card` and the body's first line to
`(CONFIDENTIAL) Planning notes.` The whole ends at CONFIDENTIAL and covers its
parts. Other values need your runtime; the
[scenario catalog](https://github.com/ezclassify/contracts/tree/main/packages/conformance-server/scenarios/cedar-valley)
lists everything the replay records. By default the server does not check
credentials. Add `--auth simulated` to exercise yours with the published test
bearer; the
[conformance server guide](https://github.com/ezclassify/contracts/tree/main/packages/conformance-server#testing-an-application-integration)
covers that, the failure profiles and the other scenarios.

### Switch to your runtime

When the integration works, change the connection and nothing else. Point
`baseUrl` at your runtime (or set `VITE_EZCLASSIFY_URL`), name your provisioned
Context, and supply real credentials. `getAccessToken` and `getContextToken` are
your application's session helpers; a deployment that does not use Context
tokens leaves `contextToken` out.

```ts
const client = await connectContext({
    baseUrl: 'https://api.example.com',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
    contextToken: await getContextToken(),
    auth: { token: getAccessToken },
});
```

The markup, the store and the rest of `main.ts` stay as they are.

### Load, read and save the form's state

Use `await store.seedAssertions(id, savedAssertions)` to load a document's
structured marking baseline when opening its form. User and application edits
then use `publishRendered` or `publishAssertions`; later seeding keeps those
edits on top of the baseline. For example, serialize the authored whole as
`JSON.stringify(store.get('document').assertions)` alongside your document's
content and other marking assertion sets. Restore the native marked text
values too, so the body and title retain their prose and inline markings.

Use `store.get(id)` for a snapshot, `store.subscribe(id, listener)` for committed
changes, and `store.subscribeWholeRollup(wholeId, listener)` for the parts-only
rollup. Subscriptions return unsubscribe functions. Render `stale` rollups with
an unresolved treatment; the built-in banner says such a rollup may be
incomplete. Persist structured `state.assertions` alongside the
host document, rather than expecting every category/capture value in a rendered
string. Keep the marked textarea/input prose in their native form values.

At document close, unsubscribe host listeners, call `forms.destroy()` and
`store.destroy()`. Destroy the application-owned client once at application or
session teardown. The configured store and client remain host-owned.

See the [React document-form example](https://github.com/ezclassify/web/blob/main/integrations/react/README.md) for
the same controls backed by a form-scoped React store. The
[binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) defines the full graph and lifecycle.

## Browser support

Every stylesheet this library applies at runtime goes through a constructable
`CSSStyleSheet` and the target root's `adoptedStyleSheets`. Nothing is injected
as a `<style>` element, so a host page can serve `style-src 'self'` in its
Content Security Policy and does not need `'unsafe-inline'`.

That sets the floor at Chrome 73+, Edge 79+, Firefox 101+, and Safari 16.4+.
There is no fallback to inline styles on an older browser. A fallback would put
the `'unsafe-inline'` requirement back without anyone noticing, so the library
throws on first use instead.

## There is no local-engine path

`@ezclassify/ui` accepts any engine-compatible adapter, and the one you can get
is `@ezclassify/rest-client`. The engine itself is not distributed as a library. It
runs inside an EzClassify deployment, which is what the client connects to, so
there is no package to install and no in-process alternative to write.

That is a product boundary, not a packaging accident. Scheme content in the
browser puts the rules in the client, where they can be read and edited. The
REST path keeps them on the server and sends back answers.

## Key exports

| Export                                              | Purpose                                          |
| --------------------------------------------------- | ------------------------------------------------ |
| `EzClassifyUI`                                      | Main class; mounts all components on a container |
| `getDefaultStyles()` / `injectDefaultStyles()`      | CSS string / adopt a stylesheet                  |
| `EZ_CSS_VARIABLES`                                  | Raw CSS tokens for custom theming                |
| `captureFormState` / `restoreFormState`             | Serialize and re-hydrate form values             |
| `exportFormState` / `importFormState`               | JSON round-trip for save/load workflows          |
| `THEMES` / `applyTheme`                             | Built-in visual themes                           |
| `initComparison` / `compareRenderings`              | Side-by-side profile comparison helper           |
| `defaultLocale` / `setLocale` / `resetLocale` / `t` | i18n support                                     |
| `buildCategoryColorMap`                             | Map each scheme category id to its color         |
| `assembleWithConcept` / `findUnambiguousMatch`      | Autocomplete helpers                             |
| `groupSuggestionsWithDepth` / `getConceptDepth`     | Suggestion grouping utilities                    |

## Form state serialization

```ts
import {
    captureFormState,
    restoreFormState,
    exportFormState,
    importFormState,
} from '@ezclassify/ui';

// forms is the mounted EzClassifyUI instance from the document form above.

// In-memory snapshot: every field's value plus its structured assertions,
// so alternate-scope categories and capture values survive the round-trip.
const state = await captureFormState(forms);
// ... user edits ...
restoreFormState(forms, state);

// JSON round-trip for save/load workflows. importFormState fails closed:
// it throws on a shape-version, structure, or scheme mismatch instead of
// restoring a snapshot it cannot read.
localStorage.setItem('draft', await exportFormState(forms));

const draft = localStorage.getItem('draft');
if (draft) importFormState(forms, draft);
```

## Whole-marking fields

Use `data-ezclassify-controller="marking"` on an `<input type="text">` whose
value is the whole marking. The controller registers its DOM `id` in the store;
standalone `tags` and `marked-input` controls register the same way. An input keeps its original
`id`, `name`, value, form submission and native events; EzClassify hides it and
owns an unnamed wrapping textarea. Current draft text remains available through
the original input even when invalid. On load, a fully recognized value that resolves to a valid result may normalize;
otherwise its exact text stays available with validation feedback. The visible editor is
`.marking-field-host` inside the original control's `.marking-field-wrap`.
Labels and `input.focus()` reach that editor. Destroying the enhancement restores
the original control with its current value.

## Browse marking categories

A MarkedTextArea exposes each portion through a stable store entry ID. Edit an
entry to update only its marking token; add/remove IDs through the store's
optional ordered-entry capability. Body prose stays with its source span, and
ambiguous parent updates preserve the text. See
[variable entries in a marked body](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md#variable-entries-in-a-marked-body)
for membership, removal, concurrency and custom-store behavior.

The shared picker used by `marking`, `tags`, `marked-input` and `marked-textarea`
lists categories in the active format's declared order. Categories omitted from
that order follow in scheme order. Required choices remain visible in the Needs
strip; they do not reorder the browse list.

Use the small up/down arrows on each pinned category heading to jump to the
previous or next available category. The full list stays present, so you can
also scroll normally. Category names and eligibility come from the scheme.
The same controls are available in the phone sheet.

With suggestions open, **Option+Up/Down (⌥↑↓) on macOS**, or **Alt+Up/Down** on
Windows and Linux, jumps between categories. Focus stays in the marking field.
These shortcuts and the heading arrows do not change or save the marking.
The field's normal Tab, Enter and Escape behavior is unchanged.

## Rule errors

A form field (`marking`, `tags`, `marked-input` and the other editable
controllers) lists each rule its value breaks directly under the field, starting
at the field's left edge. Under the errors, "Ways to fix" lists the fixes the
engine proposed in `ProcessResult.proposedFixes` as buttons. Each fix is one
whole valid marking: the concepts of the author's marking it keeps, the ones it
adds, the ones it removes, the marking that results, and a message that says
what it does. The button reads that message without its closing period, such
as "Replace LOW with HIGH" or "Remove HOLD". Two fixes that end in the same
marking are listed once. Pressing one makes what the fix keeps and adds the
field's value in one write, the same way picking from its list does. The
engine words the message; the heading comes from the `fix.heading` locale key.

A field bound to a whole that other fields name with
`data-ezclassify-part-of` is judged against those parts. The runtime sends the
parts' current markings to the engine as `parts` on every `process` call the
field makes, so a whole below its parts gets an error for what it is missing,
and every fix it is offered lands no lower than the parts need. When a part
changes, the field reads its value again. A whole with no marked parts sends no
`parts` at all. That field is the only place the coverage finding shows: the
runtime adds no notice or correction action of its own beside it. Nothing extra
goes in the markup: the `part-of` attributes that already feed the whole's
rollup are what the runtime reads.

Engine warnings for the value (`ProcessResult.warnings`) follow the errors in
the warning color. A warning never makes the field invalid and never offers a
fix. A part whose whole is not a valid marking, for example, reads and commits
as usual and carries a warning that it could not be compared with the whole;
the warning clears once the whole is valid. If the engine raises instead of
answering, the field still mounts and shows the message where its errors go.

The marked fields report on each mark. MarkedInput lists its leading mark's
report under the field. In a MarkedTextArea each portion reports on itself: a
portion that breaks a rule or carries a warning is marked in the text and is a
button, whose tooltip gives the reason. Opening it shows the same report in the
editor's list: the broken rules, the warnings, then the ways to fix, and a fix
rewrites that portion's mark and no other.

Read-only views report state and do not judge it. `banner` shows the marking,
or its empty state when there is nothing to render, and never a rule error.

## Theming

`applyTheme` returns a CSS rule scoped to `[data-theme="<name>"]`. Adopt it as a
stylesheet and set the attribute on the subtree it should style:

```ts
import { applyTheme, THEMES } from '@ezclassify/ui';

const sheet = new CSSStyleSheet();
sheet.replaceSync(applyTheme(THEMES.dark));
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
document.body.dataset.theme = 'dark';
```

## CSS custom properties

Theme tokens and component layout properties are configurable via CSS variables. Inject the defaults and override what you need:

```ts
import { injectDefaultStyles } from '@ezclassify/ui';

injectDefaultStyles();
```

```css
.ez-root,
[data-ezclassify] {
    --ez-font-size: 0.875rem;
    --ez-border-radius: 0.25rem;
    --ez-color-success: #2e7d32;
    --ez-color-error: #c62828;
}
```

## Adapter capabilities used by the UI

| UI behavior                            | Adapter capability                                                  |
| -------------------------------------- | ------------------------------------------------------------------- |
| Parse, validate, and fix marking edits | `process`, `validate`                                               |
| Store page/whole rollups               | `aggregateAssertions`                                               |
| Native rendered-string rollups         | `aggregate`                                                         |
| Interactive choices                    | `suggest`, with optional `suggestForCategories` batching for facets |
| Output views                           | `render` and scheme format metadata                                 |
| Inline markings in MarkedTextArea      | `scan`                                                              |
| Guide controls and reference views     | Context guide adapter                                               |
| Access policy reference                | Context access adapter (`AccessHandbook`)                           |

The REST client supplies the remote Context adapter. Its complete API includes
operations beyond those the UI calls; see the
[REST client guide](https://github.com/ezclassify/client-js).

# @ezclassify/ui

The forms library enhances native HTML inputs with interactive marking components. It is the shared UI layer used by every framework integration (React, Angular, Vue), and it mounts over plain markup with no framework at all.

You initialize it once. Everything after that is HTML attributes.

## Architecture

The marking store holds structured assertions, rendered values and validity
for each marking. Controls publish edits to that store and subscribe to its
updates, so editors and previews share one state. Native form controls retain
their text values; marked-text controls retain both their inline markings and
prose. Persist structured assertions when your document needs categories or
capture values that its display format does not show. See
[ARCHITECTURE.md](https://github.com/ezclassify/web/blob/main/libs/ui/ARCHITECTURE.md) for the binding and engine API contracts.

Every `data-ezclassify-*` attribute the runtime reads or stamps is tabled in [docs/attributes.md](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md); wholes, parts, collections and views are defined in [docs/binding-model.md](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md). Teams keeping Angular Material, MUI, React Select, Vue libraries, jQuery/Select2, or other preferred controls should use the framework-neutral [third-party control contract](https://github.com/ezclassify/web/blob/main/libs/ui/docs/third-party-controls.md).

## Boundary

This package ships components, not policy. There is no classification engine
in the tarball and no EzClassify-maintained scheme content. `EzClassifyUI`
takes a Context adapter and calls it; whatever you hand it decides what a
marking means. Opening, modifying, or redistributing this UI code grants no
right to use the engine or EzClassify-maintained content.

The adapter you use is `@ezclassify/rest-client`, the thin REST client. The
document form below runs it against a replay server that needs no license. In
production the same client points at your EzClassify runtime.

## Install

```bash
npm install @ezclassify/ui @ezclassify/rest-client
```

`@ezclassify/rest-client` ships from
[ezclassify/sdk-js](https://github.com/ezclassify/sdk-js). It is a
separate install, not a dependency of this package, so an application that
brings its own adapter does not pull it in.

## Mark one field

One attribute and one line of code:

```html
<input name="marking" data-ezclassify-controller="marking" />
```

```ts
import { connectContext } from '@ezclassify/rest-client';
import { EzClassifyUI } from '@ezclassify/ui';

const client = await connectContext({
    baseUrl: 'https://api.example.com',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
new EzClassifyUI(client);
```

The instance enhances every marked field under `document.body` and creates
the store they share. Pass `{ root }` to enhance one part of the page instead.

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

`data-ezclassify-whole="document"` on the form says the form holds the
`document` marking and its parts. The field with `id="document"` is the whole.
Every other marked field inside the form is a part: the attachment
MarkingField, the summary TagInput, the title MarkedInput and each portion in
the body MarkedTextArea. A `source` banner shows the authored whole, and an
`aggregate` banner shows what the parts require. The complete app is in
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
        <form data-ezclassify-whole="document">
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
                value="PUBLIC"
                data-ezclassify-controller="marking" />
            <label for="summary">Summary marking (TagInput)</label>
            <input
                id="summary"
                name="summaryMarking"
                value="CONFIDENTIAL"
                data-ezclassify-controller="tags" />
            <label for="title">Title (MarkedInput)</label>
            <input
                id="title"
                name="title"
                type="text"
                value="(PUBLIC) District report"
                data-ezclassify-controller="marked-input" />
            <label for="body">Body (MarkedTextArea)</label>
            <textarea
                id="body"
                name="body"
                data-ezclassify-controller="marked-textarea">
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
import { EzClassifyUI } from '@ezclassify/ui';
import { showDocumentState } from './document-state';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const forms = new EzClassifyUI(client);
showDocumentState(forms);
```

The example adds a small page stylesheet, [`src/styles.css`](https://github.com/ezclassify/web/blob/main/examples/vanilla-example/src/styles.css), for layout and a plain style for the page's inputs and its button. The controls take their edge, padding and font from the input or textarea they enhance, so they match the rest of your form.
`VITE_EZCLASSIFY_URL` names the server when you start Vite; without it, the page
connects to the replay server above.

The authored whole starts at INTERNAL. The CONFIDENTIAL summary part changes
what that whole must cover; it does not silently replace the whole. The whole
MarkingField shows its contextual errors and fixes. The store's `valid` and
`errors` describe each marking itself; they do not include the whole's
coverage of its parts. `aggregate="document"` shows only the parts. A bare
`data-ezclassify-aggregate` shows the page: every whole on it.

### Read and write the state in code

The form needs no code beyond `new EzClassifyUI(client)`. The button and the
status line show how code reads and writes the same store the controls use,
through `forms.store`:

```ts
// src/document-state.ts
import type { EzClassifyUI } from '@ezclassify/ui';

/** Writes the document marking from code and reports what the store holds. */
export function showDocumentState(forms: EzClassifyUI): void {
    const { store } = forms;
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
}
```

The button publishes a real store edit, which updates the whole editor and its
preview.

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

The markup and the rest of `main.ts` stay as they are.

## Larger pages

Each case below adds attributes only where the page's structure cannot say it.
They need your runtime; the replay records only the document form above.

### Several independent fields and a page marking

A marked field outside any `whole` container is a whole of its own. A bare
`aggregate` view shows the page, which is every whole on it:

```html
<input name="a" data-ezclassify-controller="marking" />
<input name="b" data-ezclassify-controller="marking" />
<div data-ezclassify-controller="banner" data-ezclassify-aggregate></div>
<input type="hidden" name="pageMarking" data-ezclassify-aggregate />
```

The library adds no input of its own to your form. If the page marking has to
be submitted, place a hidden input with `data-ezclassify-aggregate` where you
want it, and it holds the rendered value. Any other element with no controller
shows the value as text. A view never feeds back into a rollup.

### A part outside its whole's container

When a part cannot sit inside its whole's container, name the whole on it:

```html
<input
    data-ezclassify-controller="marking"
    data-ezclassify-part-of="document" />
```

`part-of` only ever names a whole. A field that carries it always reads as a
part.

### Folders

`data-ezclassify-collection="<id>"` declares a collection. The wholes and child
collections nested inside it are its members, and `aggregate="<id>"` shows
their rollup:

```html
<main>
    <div data-ezclassify-controller="banner" data-ezclassify-aggregate></div>
    <section data-ezclassify-collection="folderA">
        <div
            data-ezclassify-controller="banner"
            data-ezclassify-aggregate="folderA"></div>
        <article data-ezclassify-whole="memo1">
            <input id="memo1" data-ezclassify-controller="marking" />
            <textarea data-ezclassify-controller="marked-textarea"></textarea>
        </article>
        <input id="memo2" data-ezclassify-controller="marking" />
    </section>
</main>
```

| Where a marked field sits                | It reads as                               |
| ---------------------------------------- | ----------------------------------------- |
| Inside a `whole` container               | a part of that whole                      |
| Inside a collection, outside any `whole` | a whole, member of the nearest collection |
| In neither                               | a whole, member of the page               |

A whole or collection that cannot nest inside its collection names it with
`data-ezclassify-member-of="<id>"`. One instance holds the whole tree.

### Several Contexts on one page

Pass every Context at initialization, each under a key you choose, and mark
each section with the key it uses:

```ts
new EzClassifyUI({ contexts: { district, records } });
```

```html
<body data-ezclassify-context="district">
    <!-- district fields -->
    <section data-ezclassify-context="records">
        <!-- records fields -->
    </section>
    <div data-ezclassify-controller="banner" data-ezclassify-aggregate></div>
</body>
```

A field takes its Context from the nearest ancestor that names one. There is no
implicit default: with several Contexts, a marked field that resolves none
stays unenhanced and reports a host error. Markings from different Contexts
never merge. The page banner shows one labeled marking per Context, and a
hidden input that holds a rollup names the one it holds with its own
`data-ezclassify-context`.

### A Context with two schemes

A crosswalk Context holds a second scheme. `data-ezclassify-scheme` selects it
by the Context's own selector, on the field or an ancestor:

```html
<div data-ezclassify-scheme="tier">
    <input id="doc-tier" data-ezclassify-controller="marking" />
</div>
<div
    data-ezclassify-controller="banner"
    data-ezclassify-aggregate
    data-ezclassify-scheme="tier"></div>
```

To show a marking translated through the crosswalk, add
`data-ezclassify-translate` to a view. It takes the crosswalk id, and needs no
value when the Context holds exactly one crosswalk from its primary scheme:

```html
<div
    data-ezclassify-controller="banner"
    data-ezclassify-source="document"
    data-ezclassify-translate></div>
```

### Text that quotes other markings

The library reads only elements that carry `data-ezclassify-*` attributes, so
ordinary page text is never read as a marking. Inside an enhanced area, fence a
region with `data-ezclassify-ignore`:

```html
<ul data-ezclassify-ignore>
    <li>Source: Report 12, marked CONFIDENTIAL</li>
</ul>
```

A marked field inside an ignored region is a host error, not a silent skip.

### Guides, access policies and crosswalks

The `handbook`, `guidebook`, `access-handbook`, `crosswalk-handbook` and
`context-reference` controllers need only the controller attribute. They read
the guides, access policy and crosswalks the Context holds. A Context with
several crosswalks needs the one to show named:

```html
<div
    data-ezclassify-controller="crosswalk-handbook"
    data-ezclassify-crosswalk-handbook-crosswalk-id="cvss-31-to-40"></div>
```

The `context-reference` drawer shows every Context the page loaded, each with
its own handbook tabs, so it never needs `data-ezclassify-context`.

### Pages you can't edit

On a page whose HTML you don't control, such as a SharePoint or Jira page, a
script marks up the elements it finds. `ui.add(element, controller,
attributes)` writes the attributes the markup would have carried and reads the
element right away. `ui.remove(element)` takes them off again and tears the
field down:

```ts
const ui = new EzClassifyUI(context);

const summary = document.querySelector<HTMLInputElement>('#summary');
const details = document.querySelector<HTMLInputElement>('#details');
if (summary && details) {
    ui.add(summary, 'marking');
    ui.add(details, 'marking', { partOf: 'summary' });
}
```

The controller is the `data-ezclassify-controller` value. Attribute keys are
the names after `data-ezclassify-` in camelCase, so `{ partOf: 'summary' }`
writes `data-ezclassify-part-of="summary"`, and `true` writes a presence-only
attribute such as `{ noRollup: true }`. The element then reads exactly as the
markup would: inside a `whole` container it is a part, and inside an ignored
region it is a host error. `remove` leaves the page's own attributes alone.

Attributes a script sets directly after initialization are read the same way,
so a script can also declare a container with
`form.setAttribute('data-ezclassify-whole', 'issue')`. When the host page
replaces an element, as single-page apps do, call `add` on the new one.

In the framework integrations the runtime is `useEzClassifyUI()` in React,
`useEzClassifyUI()` (a ref) in Vue and `injectEzClassifyUI()` (a signal) in
Angular.

SharePoint Online doesn't run script pasted into a page. Package yours as your
own SharePoint Framework (SPFx) extension and deploy it through your tenant's
app catalog.

## Load, read and save the form's state

Use `await forms.store.seedAssertions(id, savedAssertions)` to load a
document's structured marking baseline when opening its form. User and
application edits then use `publishRendered` or `publishAssertions`; later
seeding keeps those edits on top of the baseline. For example, serialize the
authored whole as `JSON.stringify(forms.store.get('document').assertions)`
alongside your document's content and other marking assertion sets. Restore the
native marked text values too, so the body and title retain their prose and
inline markings. A marking that code seeds or saves needs an `id` on its field.

Use `store.get(id)` for a snapshot and `store.subscribe(id, listener)` for
committed changes. Subscriptions return unsubscribe functions. Render `stale`
rollups with an unresolved treatment; the built-in banner says such a rollup
may be incomplete. Persist structured `state.assertions` alongside the host
document, rather than expecting every category/capture value in a rendered
string. Keep the marked textarea/input prose in their native form values.

At document close, unsubscribe host listeners, then call `forms.destroy()` and
`forms.store.destroy()`. Destroy the application-owned client once at
application or session teardown.

See the [React document-form example](https://github.com/ezclassify/web/blob/main/integrations/react/README.md) for
the same controls in React. The
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

`@ezclassify/ui` accepts any Context adapter, and the one you can get is
`@ezclassify/rest-client`. The engine itself is not distributed as a library. It
runs inside an EzClassify deployment, which is what the client connects to, so
there is no package to install and no in-process alternative to write.

That is a product boundary, not a packaging accident. Scheme content in the
browser puts the rules in the client, where they can be read and edited. The
REST path keeps them on the server and sends back answers.

## Highlight components while you build

`@ezclassify/ui/devtools` outlines every region of a page EzClassify reads or
drives: components, bound markings, wholes and collections, views and
handbooks, ignored regions, and anything you tag `data-ezclassify-powered`
because your own code fills it from EzClassify data. Hidden inputs have no box,
so its legend lists them instead. It is a separate entry, so a production
bundle never carries it unless you import it.

```ts
import { createComponentLocator } from '@ezclassify/ui/devtools';

const locator = createComponentLocator();
document.body.append(locator.element);
// later: locator.destroy();
```

On a page with no build step, load the entry as a module and type
`ezclassify.devtools()` in the browser console. `ezclassify.devtools(false)`
turns it off.

## Key exports

| Export                                              | Purpose                                          |
| --------------------------------------------------- | ------------------------------------------------ |
| `EzClassifyUI`                                      | Main class; mounts all components on a container |
| `getDefaultStyles()` / `injectDefaultStyles()`      | CSS string / adopt a stylesheet                  |
| `EZ_CSS_VARIABLES`                                  | Raw CSS tokens for custom theming                |
| `captureFormState` / `restoreFormState`             | Serialize and re-hydrate form values             |
| `exportFormState` / `importFormState`               | JSON round-trip for save/load workflows          |
| `THEMES` / `applyTheme`                             | Built-in visual themes                           |
| `initComparison` / `compareRenderings`              | Side-by-side rendering comparison helper         |
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

A whole with parts, the fields inside its `data-ezclassify-whole` container or
naming it with `data-ezclassify-part-of`, is judged against those parts. The
runtime sends the
parts' current markings to the engine as `parts` on every `process` call the
field makes, so a whole below its parts gets an error for what it is missing,
and every fix it is offered lands no lower than the parts need. When a part
changes, the field reads its value again. A whole with no marked parts sends no
`parts` at all. That field is the only place the coverage finding shows: the
runtime adds no notice or correction action of its own beside it. Nothing extra
goes in the markup: the structure that already feeds the whole's rollup is what
the runtime reads.

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
| Interactive choices                    | `suggest`, with optional `suggestForCategories` batching for facets |
| Output views                           | `render` and scheme format metadata                                 |
| Inline markings in MarkedTextArea      | `scan`                                                              |
| Guide controls and reference views     | Context guide adapter                                               |
| Access policy reference                | Context access adapter (`AccessHandbook`)                           |

The REST client supplies the remote Context adapter. Its complete API includes
operations beyond those the UI calls; see the
[REST client guide](https://github.com/ezclassify/sdk-js).

# @ezclassify/react

React component library for security markings and sensitivity labels: validate, combine portion marks into an overall marking, show the banner. Rules come from your EzClassify runtime: IC Classification and Control Markings (CAPCO), Controlled Unclassified Information (CUI), Traffic Light Protocol (TLP) 2.0, Common Vulnerability Scoring System (CVSS), or schemes you write yourself. This package needs a running EzClassify runtime. The free developer runtime includes TLP 2.0, CVSS and demo subsets of CAPCO and CUI. The full CAPCO and CUI schemes are licensed content.

## Install

```bash
npm install @ezclassify/react @ezclassify/ui @ezclassify/rest-client
```

## Mark one field

Provide the client once, at the root of the app:

```tsx
createRoot(el).render(
    <EzClassifyProvider context={client}>
        <App />
    </EzClassifyProvider>,
);
```

Wrap each document in `<EzClassify>` and mark its fields with attributes:

```tsx
<EzClassify>
    <form>
        <input name="marking" data-ezclassify-controller="marking" />
    </form>
</EzClassify>
```

Each `<EzClassify>` owns the store for the fields inside it and releases it
when it unmounts.

## Mark a Document and Its Parts

`data-ezclassify-whole="document"` on the form says the form holds the
`document` marking and its parts. The field with `id="document"` is the whole.
Every other marked field inside the form is a part: the attachment
MarkingField, the summary TagInput, the title MarkedInput and each portion in
the body MarkedTextArea. A `source` banner shows the authored whole, and an
`aggregate` banner shows what the parts require.

This example uses the public `cedar-valley@1.0.0` Context, including its
parenthesized inline markings. Its whole and part formats are chosen from
Context metadata.

Start the free developer runtime first. It serves the public demo Contexts,
Cedar Valley (a fictional school district's teaching policy) among them, over
real HTTP, so the form works before you have a runtime of your own.
`EZCLASSIFY_DEMO_ALLOWED_ORIGINS` is your dev server's exact origin; `http://localhost:5173` is the Vite default.

```bash
docker run --rm -p 3000:8080 \
  -e EZCLASSIFY_DEMO_ALLOWED_ORIGINS=http://localhost:5173 \
  ghcr.io/ezclassify/developer-runtime
```

The complete app is in [`examples/react-example`](https://github.com/ezclassify/web/tree/main/examples/react-example).

Create the client once during application startup and hand it to
`EzClassifyProvider`:

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client';
import { connectContext } from '@ezclassify/rest-client';
import { EzClassifyProvider } from '@ezclassify/react';
import { DocumentForm } from './DocumentForm';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://localhost:3000',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
createRoot(document.getElementById('app')!).render(
    <EzClassifyProvider context={client}>
        <DocumentForm />
    </EzClassifyProvider>,
);
```

The page contains `<div id="app"></div>`. Show startup failures through your
application's error UI. `VITE_EZCLASSIFY_URL` names the server when you start
Vite; without it, the app connects to the developer runtime above.

```tsx
// src/DocumentForm.tsx
import { EzClassify } from '@ezclassify/react';
import { DocumentState } from './DocumentState';

export function DocumentForm() {
    return (
        <EzClassify>
            <form data-ezclassify-whole="document">
                <label htmlFor="document">Document marking</label>
                <input
                    type="text"
                    id="document"
                    name="documentMarking"
                    defaultValue="INTERNAL"
                    data-ezclassify-controller="marking"
                />

                <label htmlFor="attachment">
                    Attachment marking (MarkingField)
                </label>
                <input
                    type="text"
                    id="attachment"
                    name="attachmentMarking"
                    defaultValue="PUBLIC"
                    data-ezclassify-controller="marking"
                />
                <label htmlFor="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    defaultValue="CONFIDENTIAL"
                    data-ezclassify-controller="tags"
                />
                <label htmlFor="title">Title (MarkedInput)</label>
                <input
                    type="text"
                    id="title"
                    name="title"
                    defaultValue="(PUBLIC) District report"
                    data-ezclassify-controller="marked-input"
                />
                <label htmlFor="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    defaultValue={
                        '(INTERNAL) Planning notes.\n(PUBLIC) Published background.'
                    }
                    data-ezclassify-controller="marked-textarea"
                />

                <p>Document preview</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-source="document"
                />
                <p>Computed parts</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-aggregate="document"
                />
                <DocumentState />
            </form>
        </EzClassify>
    );
}
```

The initial whole is INTERNAL while the summary part is CONFIDENTIAL. The
computed parts rollup consequently differs from the authored whole. The whole
MarkingField checks its current value against its parts and displays the
engine's errors and proposed fixes. The engine determines whether any chosen
whole covers all current parts.

The `whole` container creates the part relationship; it does not replace the
author's document marking with the computed rollup. The MarkedTextArea
registers its individual portions beneath that whole. Its body text stays in
the textarea's value. MarkedInput enhances a text input with one logical line
of marked text.

### Try the capco-demo Context

This one uses the `capco-demo` Context on the free developer runtime (the start command is in the section above). Against that runtime the engine reads `SECRET//NOFORN` as a valid marking, and rolls the portion marks `S//NF`, `C` and `U` up to the overall marking `SECRET//NOFORN`, which is what the aggregate banner shows.

```tsx
const client = await connectContext({
    baseUrl: 'http://localhost:3000',
    contextId: 'capco-demo',
    contextVersion: '1.0.0',
});
// <EzClassifyProvider context={client}> at the app root, then:
<EzClassify>
    <form data-ezclassify-whole="document">
        <input
            id="document"
            name="document"
            defaultValue="SECRET//NOFORN"
            data-ezclassify-controller="marking"
        />
        <input
            name="part1"
            defaultValue="S//NF"
            data-ezclassify-controller="marking"
        />
        <input
            name="part2"
            defaultValue="C"
            data-ezclassify-controller="marking"
        />
        <input
            name="part3"
            defaultValue="U"
            data-ezclassify-controller="marking"
        />
        <div
            data-ezclassify-controller="banner"
            data-ezclassify-source="document"
        />
        <div
            data-ezclassify-controller="banner"
            data-ezclassify-aggregate="document"
        />
    </form>
</EzClassify>;
```

### Read and Write the State in Code

The form needs no code. `DocumentState` shows how a component inside
`<EzClassify>` reads and writes the same store the controls use.
`useEzClassify(id)` returns a marking's state and a setter, and
`useEzClassifyRollup(id)` returns the rollup of a whole's parts:

```tsx
// src/DocumentState.tsx
import { useEzClassify, useEzClassifyRollup } from '@ezclassify/react';

export function DocumentState() {
    const [whole, setWhole] = useEzClassify('document');
    const parts = useEzClassifyRollup('document');
    return (
        <aside aria-label="Document marking state">
            <p>Authored document: {whole.rendered || 'Not marked'}</p>
            <p>
                Computed parts: {parts.rendered || 'No marked parts'}
                {parts.stale ? ' (refresh failed)' : ''}
            </p>
            <button type="button" onClick={() => setWhole('CONFIDENTIAL')}>
                Set document to CONFIDENTIAL
            </button>
        </aside>
    );
}
```

Changing the whole to CONFIDENTIAL through the button writes the same store
that its MarkingField and preview read.

Try this form as written: focus each control, browse each
picker, open the marking popup in the title and body (Ctrl+Enter, or Cmd+Enter
on macOS), select **Set document to CONFIDENTIAL**, then change the title to
`(PUBLIC) District report card` and the body's first line to
`(CONFIDENTIAL) Planning notes.` The whole ends at CONFIDENTIAL and covers its
parts. The runtime applies the Context's real rules, so other values work too.

### Switch to Your Runtime

When the form works, change the connection and nothing else. Point the client at
your runtime (`baseUrl`, or `VITE_EZCLASSIFY_URL`), name your provisioned
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

## Larger Pages

Folders, several Contexts, a crosswalk's second scheme, a part outside its
whole's container and a submitted page marking are all attributes. The
[`@ezclassify/ui` README](https://github.com/ezclassify/web/blob/main/libs/ui/README.md#larger-pages)
shows each one; the markup is the same in React.

For several Contexts, pass them all to the provider under keys you choose, and
name the key on each section with `data-ezclassify-context`:

```tsx
<EzClassifyProvider contexts={{ district, records }}>
    <App />
</EzClassifyProvider>
```

On a page whose markup you can't edit, a component inside `<EzClassify>` marks
up the elements it finds through the runtime, as the
[pages you can't edit](https://github.com/ezclassify/web/blob/main/libs/ui/README.md#pages-you-cant-edit) section shows:

```tsx
const ui = useEzClassifyUI();
useEffect(() => {
    const summary = document.getElementById('summary');
    if (!ui || !summary) return;
    ui.add(summary, 'marking');
    return () => ui.remove(summary);
}, [ui]);
```

## Read, Write, and Save State

`useEzClassify(id)` supplies a marking snapshot and rendered-text setter.
`useEzClassifyStore()` exposes the store of the nearest `<EzClassify>` for
subscriptions and asynchronous writes: `publishRendered(id, text)` edits the
default scope; `publishAssertions(id, assertions)` edits structured assertions.
`seedAssertions(id, assertions)` loads a document's baseline; subsequent edits
stay on top of that baseline. Seed when opening a document, then publish user
and application edits. For a document whose state your application already
owns, pass its `ReactEzClassifyStore` through the `store` prop of
`<EzClassify>`. UI outside the form that needs the same state belongs inside
the same `<EzClassify>`.

For example, persist a marking's full assertion set with your document:

```ts
const markingToSave = store.get('document').assertions;
const savedJson = JSON.stringify(markingToSave);
```

On opening that document with its fresh form store, load those assertions with
`await store.seedAssertions('document', savedAssertions)`. `savedAssertions` is
the assertion array loaded from your document persistence. Save the native
marked text fields as document content too, so their prose and inline markings
remain available when rebuilding the form. Keep assertions when persisting
structured marking state: a displayed format may omit alternate-scope
categories or captured values. Native form values retain the editable text,
including the full prose in marked input/textarea controls. A marking that
code seeds or saves needs an `id` on its field.

`useEzClassifyRollup(id)` reads the rollup of the whole or collection `id`;
with no id it reads the page. A rolled-up state with `stale: true` retains its
last successful value after a failed refresh; show that uncertainty rather than
treating it as fresh. `useEzClassifyUI()` returns the mounted instance for code
that needs it directly, such as `add` and `remove` above.

The store's `valid` and `errors` describe the marking itself; they do not
include the whole's coverage of its parts. The whole MarkingField's contextual
comparison with its parts also owns its own errors and fixes; a preview or
plain string comparison does not replace it.

At application/session teardown, unmount the React root and then destroy the
shared client. Each `<EzClassify>` releases its store when it unmounts. Closing
an individual control releases its UI subscriptions while the rest of the form
keeps its store and client.

## Presentation

Control options choose colors, tooltips and favorites. Omit `format` to use
the Context default, or select a format declared by your Context through
`data-ezclassify-format`. The [attribute reference](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md)
and [binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) describe the complete
control and store contracts.

A root restarts its runtime when `options.colorMap` or `options.favorites` is a
new object. Define them once, as a module constant or with `useMemo`, instead
of writing them inline in a component that re-renders.

## License

Apache-2.0.

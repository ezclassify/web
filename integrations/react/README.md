# @ezclassify/react

React marking controls backed by one application-owned EzClassify REST client.

## Install

```bash
npm install @ezclassify/react @ezclassify/ui @ezclassify/rest-client
```

## Mark a Document and Its Parts

Use one form store to connect the document marking, individual part markings,
and marked text. The document's MarkingField edits its authored whole marking.
Other MarkingFields, TagInputs, MarkedInputs and the portions inside a
MarkedTextArea contribute as parts of that whole. A preview reads the authored
whole; a separate rollup shows what the parts require.

This example uses the public `cedar-valley@1.0.0` Context, including its
parenthesized inline markings. Its whole and part formats are chosen from
Context metadata.

Start the Cedar Valley replay server first. It answers recorded requests for
Cedar Valley, a fictional school district's teaching policy, over real HTTP, so
the form works before you have a runtime. `--cors-origin` is your dev server's
exact origin; `http://localhost:5173` is the Vite default.

```bash
npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 \
  --cors-origin http://localhost:5173
```

The complete app is in [`examples/react-example`](https://github.com/ezclassify/web/tree/main/examples/react-example).

Create the client once during application startup and share it through
ordinary React context:

```ts
// src/client-context.ts
import { createContext, useContext } from 'react';
import type { EzClassifyClient } from '@ezclassify/rest-client';

export const ClientContext = createContext<EzClassifyClient | null>(null);
export function useClient(): EzClassifyClient {
    const client = useContext(ClientContext);
    if (!client) throw new Error('Missing EzClassify client');
    return client;
}
```

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client';
import { connectContext } from '@ezclassify/rest-client';
import { App } from './App';
import { ClientContext } from './client-context';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const root = createRoot(document.getElementById('app')!);
root.render(
    <ClientContext.Provider value={client}>
        <App />
    </ClientContext.Provider>,
);
```

```tsx
// src/App.tsx
import { DocumentEditor } from './DocumentEditor';
export function App() {
    return <DocumentEditor />;
}
```

The page contains `<div id="app"></div>`. Show startup failures through your
application's error UI. `VITE_EZCLASSIFY_URL` names the server when you start
Vite; without it, the app connects to the replay server above.

Each document editor scopes one `ReactEzClassifyStore` to its controls through
`EzClassifyProvider`. Closing this document releases its store; other features keep using the
application client.

```tsx
// src/DocumentEditor.tsx
import { EzClassifyProvider } from '@ezclassify/react';
import { useClient } from './client-context';
import { DocumentForm } from './DocumentForm';

export function DocumentEditor() {
    const client = useClient();
    return (
        <EzClassifyProvider engine={client}>
            <DocumentForm />
        </EzClassifyProvider>
    );
}
```

`useSchemeEngine()` reuses that document store. `Container` scopes the controls
to this form and makes the same store available to its descendants.

```tsx
// src/DocumentForm.tsx
import { useSyncExternalStore } from 'react';
import {
    useEzClassify,
    useEzClassifyStore,
    useSchemeEngine,
} from '@ezclassify/react';

function DocumentSummary() {
    const [document, setDocument] = useEzClassify('document');
    const store = useEzClassifyStore();
    const parts = useSyncExternalStore(
        (notify) => store.subscribeWholeRollup('document', () => notify()),
        () => store.getWholeRollup('document'),
        () => store.getWholeRollup('document'),
    );
    return (
        <aside aria-label="Document marking state">
            <p>Authored document: {document.rendered || 'Not marked'}</p>
            <p>
                Computed parts: {parts.rendered || 'No marked parts'}
                {parts.stale ? ' (refresh failed)' : ''}
            </p>
            <button type="button" onClick={() => setDocument('CONFIDENTIAL')}>
                Set document to CONFIDENTIAL
            </button>
        </aside>
    );
}

export function DocumentForm() {
    const { Container } = useSchemeEngine();
    return (
        <Container>
            <form>
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
                    data-ezclassify-part-of="document"
                />
                <label htmlFor="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    defaultValue="CONFIDENTIAL"
                    data-ezclassify-controller="tags"
                    data-ezclassify-part-of="document"
                />
                <label htmlFor="title">Title (MarkedInput)</label>
                <input
                    type="text"
                    id="title"
                    name="title"
                    defaultValue="(PUBLIC) District report"
                    data-ezclassify-controller="marked-input"
                    data-ezclassify-part-of="document"
                />
                <label htmlFor="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    defaultValue={
                        '(INTERNAL) Planning notes.\n(PUBLIC) Published background.'
                    }
                    data-ezclassify-controller="marked-textarea"
                    data-ezclassify-part-of="document"
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
                <DocumentSummary />
            </form>
        </Container>
    );
}
```

The initial whole is INTERNAL while the summary part is CONFIDENTIAL. The
computed parts rollup consequently differs from the authored whole. The whole
MarkingField checks its current value against its parts and displays the
engine's errors and proposed fixes. Changing the whole to CONFIDENTIAL through
the custom button writes the same store that its MarkingField and preview read.
The engine determines whether any chosen whole covers all current parts.

`data-ezclassify-part-of="document"` creates the part relationship; it does not
replace the author's document marking with the computed rollup. The
MarkedTextArea registers its individual portions beneath that whole. Its body
text stays in the textarea's value. MarkedInput enhances a text input with one logical line of marked text.

The replay records this form used as written: focus each control, browse each
picker, open the marking popup in the title and body (Ctrl+Enter, or Cmd+Enter
on macOS), select **Set document to CONFIDENTIAL**, then change the title to
`(PUBLIC) District report card` and the body's first line to
`(CONFIDENTIAL) Planning notes.` The whole ends at CONFIDENTIAL and covers its
parts. Other values need your runtime.

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

## Read, Write, and Save State

`useEzClassify(id)` supplies a marking snapshot and rendered-text setter.
`useEzClassifyStore()` exposes the same store for subscriptions and asynchronous
writes: `publishRendered(id, text)` edits the default scope;
`publishAssertions(id, assertions)` edits structured assertions.
`seedAssertions(id, assertions)` loads a document's baseline; subsequent edits
stay on top of that baseline. Seed when opening a document, then publish user
and application edits. For a document whose state your application already
owns, pass its `ReactEzClassifyStore` through the provider's `store` prop.

For example, persist a marking's full assertion set with your document:

```ts
const markingToSave = store.get('document').assertions;
const savedJson = JSON.stringify(markingToSave);
```

On opening that document with its fresh form store, load those assertions with
`await store.seedAssertions('document', savedAssertions)`. `savedAssertions` is
the assertion array loaded from your document persistence. Save the native
marked text fields as document content too, so their prose and inline markings
remain available when rebuilding the form.
Keep assertions
when persisting structured marking state: a displayed format may omit
alternate-scope categories or captured values. Native form values retain the
editable text, including the full prose in marked input/textarea controls.

`getWholeRollup('document')` and `subscribeWholeRollup('document', listener)`
read only that document's parts. `getAggregate()` and `subscribeAggregate()`
combine every marking in the store, including the authored whole and unrelated
markings; this page-wide aggregate answers a different question. A rolled-up
state with `stale: true` retains its last successful value after a failed
refresh; show that uncertainty rather than treating it as fresh.

The store's `valid` and `errors` describe the marking itself; they do not
include the whole's coverage of its parts. The
whole MarkingField's contextual comparison with its parts also owns its own
errors and fixes; a preview or plain string comparison does not replace it.

At application/session teardown, unmount the React root and then destroy the
shared client. The document provider releases its store when it unmounts. Closing an individual
control releases its UI subscriptions while the rest of the form keeps its
store and client.

## Presentation

Control options choose colors, tooltips and favorites. Omit `format` to use
the Context default, or select a format declared by your Context through
`data-ezclassify-format`. The [attribute reference](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md)
and [binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) describe the complete
control and store contracts.

## License

Apache-2.0.

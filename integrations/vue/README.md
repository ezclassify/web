# @ezclassify/vue

Vue 3.3+ marking controls backed by a shared EzClassify REST client.

## Install

```bash
npm install @ezclassify/vue @ezclassify/ui @ezclassify/rest-client
```

## Mark One Field

Install the plugin once, with the client:

```ts
createApp(App)
    .use(createEzClassify({ context: client }))
    .mount('#app');
```

Wrap each document in `<EzClassify>` and mark its fields with attributes:

```vue
<EzClassify>
    <form>
        <input name="marking" data-ezclassify-controller="marking" />
    </form>
</EzClassify>
```

Each `<EzClassify>` owns the store for the fields inside it, provides it to its
descendants, and releases it when it unmounts.

## Mark a Document and Its Parts

`data-ezclassify-whole="document"` on the form says the form holds the
`document` marking and its parts. The field with `id="document"` is the whole.
Every other marked field inside the form is a part: the attachment
MarkingField, the summary TagInput, the title MarkedInput and each portion in
the body MarkedTextArea. A `source` banner shows the authored whole, and an
`aggregate` banner shows what the parts require. `connectContext` loads public
vocabulary and UI metadata before returning. Rule evaluation stays on the REST
deployment.

Start the Cedar Valley replay server first. It answers recorded requests for
Cedar Valley, a fictional school district's teaching policy, over real HTTP, so
the form works before you have a runtime. `--cors-origin` is your dev server's
exact origin; `http://localhost:5173` is the Vite default.

```bash
npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 \
  --cors-origin http://localhost:5173
```

The complete app is in [`examples/vue-example`](https://github.com/ezclassify/web/tree/main/examples/vue-example).
It uses the full `cedar-valley@1.0.0` Context, which declares parenthesized
inline markings for its title and body fields.

```ts
// src/main.ts
import { createApp } from 'vue';
import { connectContext } from '@ezclassify/rest-client';
import { createEzClassify } from '@ezclassify/vue';
import DocumentForm from './DocumentForm.vue';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
createApp(DocumentForm)
    .use(createEzClassify({ context: client }))
    .mount('#app');
```

The page contains `<div id="app"></div>`. Show startup failures through your
application's error UI. At application/session teardown, unmount the app and
then destroy the shared client. `VITE_EZCLASSIFY_URL` names the server when you
start Vite; without it, the app connects to the replay server above.

```vue
<!-- src/DocumentForm.vue -->
<script setup lang="ts">
import { EzClassify } from '@ezclassify/vue';
import DocumentState from './DocumentState.vue';
</script>
<template>
    <EzClassify>
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
            <DocumentState />
        </form>
    </EzClassify>
</template>
```

The initial whole is INTERNAL while the summary part is CONFIDENTIAL. The
whole field shows the engine's coverage error and proposed fix. Editing a
part changes what the whole must cover without silently replacing its authored
value. MarkedInput enhances a text input for one logical line; MarkedTextArea
registers its individual portions beneath the whole.

### Read and Write the State in Code

The form needs no code. `DocumentState` shows how a component inside
`<EzClassify>` reads and writes the same store the controls use.
`useEzClassify(id)` returns a writable ref of the marking's rendered text:

```vue
<!-- src/DocumentState.vue -->
<script setup lang="ts">
import { inject } from 'vue';
import { useEzClassify, VueRefStoreKey } from '@ezclassify/vue';
const whole = useEzClassify('document');
const store = inject(VueRefStoreKey);
if (!store) throw new Error('DocumentState belongs inside <EzClassify>');
const parts = store.wholeRollupRef('document');
</script>
<template>
    <aside aria-label="Document marking state">
        <p>Authored document: {{ whole || 'Not marked' }}</p>
        <p>
            Computed parts: {{ parts.rendered || 'No marked parts'
            }}{{ parts.stale ? ' (refresh failed)' : '' }}
        </p>
        <button type="button" @click="whole = 'CONFIDENTIAL'">
            Set document to CONFIDENTIAL
        </button>
    </aside>
</template>
```

The button writes the same store as the whole field and preview.

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

## Larger Pages

Folders, several Contexts, a crosswalk's second scheme, a part outside its
whole's container and a submitted page marking are all attributes. The
[`@ezclassify/ui` README](https://github.com/ezclassify/web/blob/main/libs/ui/README.md#larger-pages)
shows each one; the markup is the same in Vue.

For several Contexts, pass them all to the plugin under keys you choose, and
name the key on each section with `data-ezclassify-context`:

```ts
app.use(createEzClassify({ contexts: { district, records } }));
```

On a page whose markup you can't edit, a component inside `<EzClassify>` marks
up the elements it finds through the runtime, as the
[pages you can't edit](https://github.com/ezclassify/web/blob/main/libs/ui/README.md#pages-you-cant-edit) section shows. `useEzClassifyUI()` returns a ref that holds it once
the root has mounted:

```ts
const ui = useEzClassifyUI();
watchEffect(() => {
    const summary = document.getElementById('summary');
    if (ui.value && summary) ui.value.add(summary, 'marking');
});
```

## Load, Read, Write, and Save Markings

`store.seedAssertions(id, savedAssertions)` loads a document's marking baseline;
`publishRendered` and `publishAssertions` apply user/application edits on top.
`useEzClassify(id)` and `useEzClassifyState(id)` read a marking reactively
inside `<EzClassify>`. On the store, use `get(id)` for a snapshot and
`subscribe(id, listener)` for committed changes; subscriptions return an
unsubscribe function. `wholeRollupRef(wholeId)` reads the parts only. Show a
rolled-up state's `stale` flag as unresolved after a failed refresh.

Persist structured assertions with your document, for example
`JSON.stringify(store.get('document').assertions)`. A display format may omit
alternate-scope categories or captured values. Save native title/body values
too, preserving their prose and inline markings. A marking that code seeds or
saves needs an `id` on its field. The store's `valid` and `errors` describe the
marking itself, not whole-versus-parts coverage. The whole MarkingField owns
that contextual comparison and displays its errors and proposed fixes.

## Presentation

Omit `format` to use the Context's whole and part defaults. A control may use
another Context-defined format through `data-ezclassify-format`. Options also
choose colors, tooltips and favorites. See the
[attribute reference](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md) and
[binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) for the complete contracts.

## License

Apache-2.0.

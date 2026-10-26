# @ezclassify/vue

Vue 3.3+ marking controls backed by a shared EzClassify REST client.

## Install

```bash
npm install @ezclassify/vue @ezclassify/ui @ezclassify/rest-client
```

## Mark a Document and Its Parts

This form connects one document marking to the parts inside it through one form
store. `connectContext` loads public vocabulary and UI metadata before
returning. Rule evaluation stays on the REST deployment.

Start the Cedar Valley replay server first. It answers recorded requests for
Cedar Valley, a fictional school district's teaching policy, over real HTTP, so
the form works before you have a runtime. `--cors-origin` is your dev server's
exact origin; `http://localhost:5173` is the Vite default.

```bash
npx @ezclassify/conformance-server --scenario cedar-valley --port 4010 \
  --cors-origin http://localhost:5173
```

The complete app is in [`examples/vue-example`](https://github.com/ezclassify/web/tree/main/examples/vue-example).

Create one client at application startup and share it through an application
injection key. This complete form uses the full `cedar-valley@1.0.0` Context,
which declares parenthesized inline markings for its title/body fields.

```ts
// src/client-key.ts
import type { InjectionKey } from 'vue';
import type { EzClassifyClient } from '@ezclassify/rest-client';
export const ClientKey: InjectionKey<EzClassifyClient> =
    Symbol('EzClassify client');
```

```ts
// src/main.ts
import { createApp } from 'vue';
import { connectContext } from '@ezclassify/rest-client';
import App from './App.vue';
import { ClientKey } from './client-key';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const app = createApp(App);
app.provide(ClientKey, client);
app.mount('#app');
```

The page contains `<div id="app"></div>`. Show startup failures through your
application's error UI. At application/session teardown, unmount the app and
then destroy the shared client. `VITE_EZCLASSIFY_URL` names the server when you
start Vite; without it, the app connects to the replay server above.

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import DocumentEditor from './DocumentEditor.vue';
</script>
<template><DocumentEditor /></template>
```

Each document editor scopes one `VueRefStore` to its controls through
`provideEzClassify`. A child mounts the scanner after the actual root exists.
The provider destroys this document's store when it closes, leaving the
application client available to other features.

```vue
<!-- src/DocumentEditor.vue -->
<script setup lang="ts">
import { inject, ref } from 'vue';
import { provideEzClassify } from '@ezclassify/vue';
import { ClientKey } from './client-key';
import DocumentForm from './DocumentForm.vue';
const client = inject(ClientKey);
if (!client) throw new Error('Missing EzClassify client');
provideEzClassify({ engine: client });
const host = ref<HTMLElement | null>(null);
</script>
<template>
    <section ref="host"><DocumentForm v-if="host" :root="host" /></section>
</template>
```

```vue
<!-- src/DocumentForm.vue -->
<script setup lang="ts">
import { useEzClassify, useEzClassifyProvision } from '@ezclassify/vue';
const props = defineProps<{ root: HTMLElement }>();
useEzClassify(undefined, { root: props.root });
const whole = useEzClassify('document');
const store = useEzClassifyProvision()?.store;
if (!store) throw new Error('Missing document store');
const parts = store.wholeRollupRef('document');
</script>
<template>
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
    </form>
</template>
```

The document MarkingField authors the whole. The other MarkingField, TagInput,
MarkedInput and the portions in MarkedTextArea are parts of that whole through
`data-ezclassify-part-of="document"`. A `source` banner reads the authored whole;
`aggregate="document"` reads only its computed parts. A bare `aggregate` reads
all markings in this store, including the whole itself: the page aggregate
answers a different question.

The initial whole is INTERNAL while the summary part is CONFIDENTIAL. The
whole field shows the engine's coverage error and proposed fix. Editing a
part changes what the whole must cover without silently replacing its authored
value. The custom button writes the same store as the whole field and preview.
MarkedInput enhances a text input for one logical line; MarkedTextArea registers
its individual portions beneath the whole.

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

## Load, Read, Write, and Save Markings

`store.seedAssertions(id, savedAssertions)` loads a document's marking baseline;
`publishRendered` and `publishAssertions` apply user/application edits on top.
Use `get(id)` for a snapshot and `subscribe(id, listener)` for committed changes;
subscriptions return an unsubscribe function. `getWholeRollup(wholeId)` and
`subscribeWholeRollup` read the parts only; `getAggregate` and
`subscribeAggregate` read the page aggregate. Show a rolled-up state's `stale`
flag as unresolved after a failed refresh.

Persist structured assertions with your document, for example
`JSON.stringify(store.get('document').assertions)`. A display format may omit
alternate-scope categories or captured values. Save native title/body values
too, preserving their prose and inline markings. The store's `valid` and
`errors` describe the marking itself, not whole-versus-parts coverage. The
whole MarkingField owns that contextual comparison and displays its errors
and proposed fixes.

## Presentation

Omit `format` to use the Context's whole and part defaults. A control may use
another Context-defined format through `data-ezclassify-format`. Options also
choose colors, tooltips and favorites. See the
[attribute reference](https://github.com/ezclassify/web/blob/main/libs/ui/docs/attributes.md) and
[binding model](https://github.com/ezclassify/web/blob/main/libs/ui/docs/binding-model.md) for the complete contracts.

## License

Apache-2.0.

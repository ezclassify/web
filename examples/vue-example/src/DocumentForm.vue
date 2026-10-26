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

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

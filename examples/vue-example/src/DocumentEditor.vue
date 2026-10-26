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

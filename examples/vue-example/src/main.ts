import { createApp } from 'vue';
import { connectContext } from '@ezclassify/rest-client';
import { createEzClassify } from '@ezclassify/vue';
import DocumentForm from './DocumentForm.vue';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://localhost:3000',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
createApp(DocumentForm)
    .use(createEzClassify({ context: client }))
    .mount('#app');

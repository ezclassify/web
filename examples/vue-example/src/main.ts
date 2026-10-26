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

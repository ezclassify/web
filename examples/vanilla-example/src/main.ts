import { connectContext } from '@ezclassify/rest-client';
import { EzClassifyUI, VanillaEzClassifyStore } from '@ezclassify/ui';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const store = new VanillaEzClassifyStore(client.scheme);
const root = document.querySelector<HTMLElement>('#document-form')!;
const forms = new EzClassifyUI(client, { root, store });
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

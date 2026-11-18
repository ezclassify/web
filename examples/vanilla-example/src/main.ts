import { connectContext } from '@ezclassify/rest-client';
import { EzClassifyUI } from '@ezclassify/ui';
import { showDocumentState } from './document-state';
import { createVisitFavorites } from './favorites';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://localhost:3000',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const forms = new EzClassifyUI(client, { favorites: createVisitFavorites() });
showDocumentState(forms);

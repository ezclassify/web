import { createRoot } from 'react-dom/client';
import { connectContext } from '@ezclassify/rest-client';
import { EzClassifyProvider } from '@ezclassify/react';
import { DocumentForm } from './DocumentForm';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
createRoot(document.getElementById('app')!).render(
    <EzClassifyProvider context={client}>
        <DocumentForm />
    </EzClassifyProvider>,
);

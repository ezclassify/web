import { createRoot } from 'react-dom/client';
import { connectContext } from '@ezclassify/rest-client';
import { App } from './App';
import { ClientContext } from './client-context';

const client = await connectContext({
    baseUrl: import.meta.env.VITE_EZCLASSIFY_URL ?? 'http://127.0.0.1:4010',
    contextId: 'cedar-valley',
    contextVersion: '1.0.0',
});
const root = createRoot(document.getElementById('app')!);
root.render(
    <ClientContext.Provider value={client}>
        <App />
    </ClientContext.Provider>,
);

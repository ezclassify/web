import { EzClassifyProvider } from '@ezclassify/react';
import { useClient } from './client-context';
import { DocumentForm } from './DocumentForm';

export function DocumentEditor() {
    const client = useClient();
    return (
        <EzClassifyProvider engine={client}>
            <DocumentForm />
        </EzClassifyProvider>
    );
}

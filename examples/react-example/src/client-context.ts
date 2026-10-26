import { createContext, useContext } from 'react';
import type { EzClassifyClient } from '@ezclassify/rest-client';

export const ClientContext = createContext<EzClassifyClient | null>(null);
export function useClient(): EzClassifyClient {
    const client = useContext(ClientContext);
    if (!client) throw new Error('Missing EzClassify client');
    return client;
}

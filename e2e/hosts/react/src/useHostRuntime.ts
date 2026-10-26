/**
 * React lifetime for the host's runtime connection.
 *
 * Connecting is asynchronous and the client owns a background health poll and a
 * request cache, so it is a resource with a lifetime rather than a value to
 * memoize. This hook holds exactly that lifetime: one connection per mount,
 * torn down on unmount, and torn down immediately when a connection lands after
 * the component that asked for it is already gone (React's strict-mode double
 * mount makes that the ordinary case, not the rare one).
 */

import { useEffect, useState } from 'react';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import { connectHost } from '../../session';

/** What the hook reports while, and after, it connects. */
export interface HostRuntimeState {
    /** The connected client, or null until it lands. */
    client: EzClassifyClient | null;
    /** Why the connection failed, or null. */
    error: string | null;
}

/**
 * Connect to the runtime for the lifetime of the calling component.
 *
 * @returns The client once it lands, or the failure that stopped it.
 */
export function useHostRuntime(): HostRuntimeState {
    const [client, setClient] = useState<EzClassifyClient | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let canceled = false;
        let connected: EzClassifyClient | null = null;
        void (async () => {
            try {
                const result = await connectHost();
                if (canceled) {
                    result.destroy();
                    return;
                }
                connected = result;
                setClient(result);
            } catch (failure) {
                if (!canceled) {
                    setError(
                        failure instanceof Error
                            ? failure.message
                            : String(failure),
                    );
                }
            }
        })();
        return () => {
            canceled = true;
            connected?.destroy();
            setClient(null);
        };
    }, []);

    return { client, error };
}

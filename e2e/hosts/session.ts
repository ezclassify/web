/**
 * How a test host connects: ask its backend for a session, then connect the
 * REST client with both credentials that session carries.
 *
 * Two credentials go out with every request, and they answer different
 * questions:
 *
 * - The caller bearer, minted by the identity provider, says who the person is;
 * - The Context token, held by the application's backend, says this application
 *   is entitled to this Context.
 *
 * The bearer is supplied as a FUNCTION rather than a captured string. Identity
 * providers issue short-lived tokens, and a supplier is the only shape that can
 * answer a refused token with a fresh one: the client re-resolves through it
 * and replays once when a request comes back as an authentication failure.
 */

import { connectContext, type EzClassifyClient } from '@ezclassify/rest-client';

/** What the host's backend hands a browser session. */
export interface HostSession {
    /** Context the application is registered against. */
    contextId: string;
    /** Published version, or absent to let the server decide. */
    contextVersion?: string;
    /** The application's Context authorization envelope. */
    contextToken: string;
    /** The signed-in person's access token. */
    accessToken: string;
}

/**
 * Ask the backend for the current session.
 *
 * @returns The credentials and the Context they authorize.
 * @throws {Error} When the backend does not answer with a session.
 */
export async function fetchHostSession(): Promise<HostSession> {
    const response = await fetch('/session', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(
            `the host backend refused to issue a session (HTTP ${response.status})`,
        );
    }
    return (await response.json()) as HostSession;
}

/**
 * Connect to the runtime the backend relays to.
 *
 * @returns A client bound to the session's Context.
 */
export async function connectHost(): Promise<EzClassifyClient> {
    let session = await fetchHostSession();
    return connectContext({
        // Same origin: the browser talks to its own backend, which relays to
        // the runtime.
        baseUrl: window.location.origin,
        contextId: session.contextId,
        ...(session.contextVersion === undefined
            ? {}
            : { contextVersion: session.contextVersion }),
        contextToken: session.contextToken,
        auth: {
            /**
             * Resolve the caller bearer for one request.
             *
             * @param request - Why the client is asking.
             * @returns The token to send.
             */
            async token({ forceRefresh }) {
                if (forceRefresh) session = await fetchHostSession();
                return session.accessToken;
            },
        },
    });
}

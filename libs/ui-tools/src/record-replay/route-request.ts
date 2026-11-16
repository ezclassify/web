/**
 * What a browser request is keyed by: its path and query, as the fetch
 * transport keys a request, and its body parsed as JSON.
 */

/** The parts of a request a recording is looked up by. */
export interface RouteRequest {
    path: string;
    body: unknown;
}

/**
 * Read a request the way the recordings key it.
 *
 * @param url - The request URL, absolute
 * @param postData - The request body as sent, or `null` when it has none
 * @returns The path with its query, and the body parsed as JSON; a body that is
 *   not JSON reads as `null`
 */
export function routeRequest(
    url: string,
    postData: string | null,
): RouteRequest {
    const parsed = new URL(url);
    let body: unknown = null;
    if (postData !== null) {
        try {
            body = JSON.parse(postData) as unknown;
        } catch {
            body = null;
        }
    }
    return { path: parsed.pathname + parsed.search, body };
}

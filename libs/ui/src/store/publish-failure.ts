/**
 * One place to handle a rejected store publish.
 *
 * `publishRendered` and `publishAssertions` reject on any engine failure, which
 * over a REST client includes a transient 5xx, an expired session, and a
 * dropped connection. A binding that fires one and ignores the promise leaks an
 * unhandled rejection, and a host that treats those as fatal (Node, and SSR
 * renderers built on it) takes the process down over a failed keystroke.
 *
 * The publish itself is fire-and-forget by contract: the setters a framework
 * binding hands a component return void, and the committed state is whatever
 * the store last accepted, so a failed publish leaves the previous value in
 * place. This writes one line naming the marking so a failure is diagnosable
 * instead of silent.
 */

/**
 * Report a failed publish without letting the rejection escape.
 *
 * @param label - Which binding published, for the log line
 * @param markingId - The marking whose publish failed
 * @param error - The rejection value
 */
export function reportPublishFailure(
    label: string,
    markingId: string,
    error: unknown,
): void {
    console.error(
        `[ezclassify] ${label}: publishing marking "${markingId}" failed; ` +
            'the previous value stands.',
        error,
    );
}

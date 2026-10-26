/**
 * The React integration host: a marking field and the banner that mirrors it,
 * bound to whatever Context the host's backend names.
 *
 * One authoring loop, end to end: an author types in a marking field, the field
 * asks the server for suggestions, the author commits concepts, and a banner
 * shows what the server made of them. Every one of those steps is a round trip.
 * Nothing on this page evaluates a scheme.
 *
 * The two EzClassify surfaces are declared as attributes on ordinary HTML,
 * which is the whole integration: `@ezclassify/react` names the runtime once at
 * the root, and `useSchemeEngine()` enhances whatever carries
 * `data-ezclassify-*` inside its container.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { EzClassifyProvider, useSchemeEngine } from '@ezclassify/react';
import type { EzClassifyClient } from '@ezclassify/rest-client';
import { useHostRuntime } from './useHostRuntime';

/** The store key the field publishes to and the banner reads from. */
const DOCUMENT_MARKING = 'document-marking';

/**
 * The application root: connect once, then name the connection for the tree.
 *
 * @returns The authoring page, or the state that stands in for it.
 */
export function App(): ReactElement {
    const { client, error } = useHostRuntime();

    if (error) {
        return (
            <main className="page">
                <h1>React integration host</h1>
                <p className="failure" data-testid="connection-error">
                    {error}
                </p>
            </main>
        );
    }

    return (
        <EzClassifyProvider engine={client}>
            <main className="page">
                <h1>React integration host</h1>
                <CompositionSummary client={client} />
                {client ? (
                    <AuthoringSurface />
                ) : (
                    <p data-testid="connection-state" data-state="connecting">
                        Connecting to the runtime…
                    </p>
                )}
            </main>
        </EzClassifyProvider>
    );
}

/**
 * What the runtime says this application is bound to.
 *
 * Worth showing on the page rather than hiding in a console line: the version
 * an author's markings were made under is the first thing anyone reviewing the
 * document later needs, and here it is the runtime's answer rather than a
 * constant compiled into the bundle.
 *
 * @param props - The connected client, or null while connecting.
 * @returns The composition line.
 */
function CompositionSummary({
    client,
}: {
    client: EzClassifyClient | null;
}): ReactElement {
    const [summary, setSummary] = useState<string>('');

    useEffect(() => {
        if (!client) {
            setSummary('');
            return;
        }
        let canceled = false;
        void client.describeContext().then((description) => {
            if (canceled) return;
            setSummary(
                `${description.id}@${description.version} · scheme ${description.scheme.id}@${description.scheme.resolvedVersion}`,
            );
        });
        return () => {
            canceled = true;
        };
    }, [client]);

    return (
        <p className="composition" data-testid="composition">
            {summary}
        </p>
    );
}

/**
 * The marking field and the banner that mirrors it.
 *
 * `Container` mounts the scanner's root and provides the binding store to
 * everything under it, so the two surfaces below share one marking without
 * either of them being told about the other.
 *
 * @returns The authoring controls.
 */
function AuthoringSurface(): ReactElement {
    const { Container } = useSchemeEngine();
    return (
        <Container>
            {/* The document's marking. The field writes it, the banner reads it. */}
            <input
                id={DOCUMENT_MARKING}
                type="hidden"
                data-ezclassify-rendered
            />

            <div
                className="banner-slot"
                data-testid="marking-banner"
                data-ezclassify-controller="banner"
                data-ezclassify-source={DOCUMENT_MARKING}
                data-ezclassify-banner-show-current-data
                data-ezclassify-banner-current-label="Marking"
            />

            <label className="field-label" htmlFor="marking-editor">
                Document marking
            </label>
            <input
                type="text"
                id="marking-editor"
                data-testid="marking-editor"
                data-ezclassify-controller="marking"
                data-ezclassify-bound-to={DOCUMENT_MARKING}
            />
        </Container>
    );
}

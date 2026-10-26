import { useSyncExternalStore } from 'react';
import {
    useEzClassify,
    useEzClassifyStore,
    useSchemeEngine,
} from '@ezclassify/react';

function DocumentSummary() {
    const [document, setDocument] = useEzClassify('document');
    const store = useEzClassifyStore();
    const parts = useSyncExternalStore(
        (notify) => store.subscribeWholeRollup('document', () => notify()),
        () => store.getWholeRollup('document'),
        () => store.getWholeRollup('document'),
    );
    return (
        <aside aria-label="Document marking state">
            <p>Authored document: {document.rendered || 'Not marked'}</p>
            <p>
                Computed parts: {parts.rendered || 'No marked parts'}
                {parts.stale ? ' (refresh failed)' : ''}
            </p>
            <button type="button" onClick={() => setDocument('CONFIDENTIAL')}>
                Set document to CONFIDENTIAL
            </button>
        </aside>
    );
}

export function DocumentForm() {
    const { Container } = useSchemeEngine();
    return (
        <Container>
            <form>
                <label htmlFor="document">Document marking</label>
                <input
                    type="text"
                    id="document"
                    name="documentMarking"
                    defaultValue="INTERNAL"
                    data-ezclassify-controller="marking"
                />

                <label htmlFor="attachment">
                    Attachment marking (MarkingField)
                </label>
                <input
                    type="text"
                    id="attachment"
                    name="attachmentMarking"
                    defaultValue="PUBLIC"
                    data-ezclassify-controller="marking"
                    data-ezclassify-part-of="document"
                />
                <label htmlFor="summary">Summary marking (TagInput)</label>
                <input
                    id="summary"
                    name="summaryMarking"
                    defaultValue="CONFIDENTIAL"
                    data-ezclassify-controller="tags"
                    data-ezclassify-part-of="document"
                />
                <label htmlFor="title">Title (MarkedInput)</label>
                <input
                    type="text"
                    id="title"
                    name="title"
                    defaultValue="(PUBLIC) District report"
                    data-ezclassify-controller="marked-input"
                    data-ezclassify-part-of="document"
                />
                <label htmlFor="body">Body (MarkedTextArea)</label>
                <textarea
                    id="body"
                    name="body"
                    defaultValue={
                        '(INTERNAL) Planning notes.\n(PUBLIC) Published background.'
                    }
                    data-ezclassify-controller="marked-textarea"
                    data-ezclassify-part-of="document"
                />

                <p>Document preview</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-source="document"
                />
                <p>Computed parts</p>
                <div
                    data-ezclassify-controller="banner"
                    data-ezclassify-aggregate="document"
                />
                <DocumentSummary />
            </form>
        </Container>
    );
}

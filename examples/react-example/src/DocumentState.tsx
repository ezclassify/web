import { useEzClassify, useEzClassifyRollup } from '@ezclassify/react';

export function DocumentState() {
    const [whole, setWhole] = useEzClassify('document');
    const parts = useEzClassifyRollup('document');
    return (
        <aside aria-label="Document marking state">
            <p>Authored document: {whole.rendered || 'Not marked'}</p>
            <p>
                Computed parts: {parts.rendered || 'No marked parts'}
                {parts.stale ? ' (refresh failed)' : ''}
            </p>
            <button type="button" onClick={() => setWhole('CONFIDENTIAL')}>
                Set document to CONFIDENTIAL
            </button>
        </aside>
    );
}

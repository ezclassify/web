import { Component, inject, signal } from '@angular/core';
import { EZCLASSIFY_STORE_SIGNAL } from '@ezclassify/angular';
@Component({
    selector: 'app-document-summary',
    template: `
        @if (store(); as current) {
            <p>
                Authored document:
                {{ current.get('document').rendered || 'Not marked' }}
            </p>
            <p>
                Computed parts:
                {{
                    current.getWholeRollup('document').rendered ||
                        'No marked parts'
                }}
                {{
                    current.getWholeRollup('document').stale
                        ? ' (refresh failed)'
                        : ''
                }}
            </p>
            <button (click)="setDocument()" type="button">
                Set document to CONFIDENTIAL
            </button>
        }
        <p role="status">{{ error() }}</p>
    `,
})
export class DocumentSummaryComponent {
    readonly store = inject(EZCLASSIFY_STORE_SIGNAL);
    readonly error = signal('');
    setDocument() {
        const store = this.store();
        if (!store) return;
        void store
            .publishRendered('document', 'CONFIDENTIAL')
            .catch((error: unknown) => this.error.set(String(error)));
    }
}

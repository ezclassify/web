import type { EzClassifyUI } from '@ezclassify/ui';

/** Writes the document marking from code and reports what the store holds. */
export function showDocumentState(forms: EzClassifyUI): void {
    const { store } = forms;
    const status = document.querySelector<HTMLOutputElement>('#save-status')!;
    document
        .querySelector<HTMLButtonElement>('#set-document')!
        .addEventListener('click', () => {
            void store.publishRendered('document', 'CONFIDENTIAL').then(
                () => {
                    status.value = `Document marking: ${store.get('document').rendered}`;
                },
                (error: unknown) => {
                    status.value = String(error);
                },
            );
        });
}

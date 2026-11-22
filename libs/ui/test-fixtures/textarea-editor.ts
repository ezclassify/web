/**
 * User interaction target for an enhanced textarea, or the raw field after
 * teardown.
 */
export function textareaEditor(
    field: HTMLTextAreaElement,
): HTMLTextAreaElement {
    return (
        field.parentElement?.querySelector<HTMLTextAreaElement>(
            ':scope > .marked-textarea-input',
        ) ?? field
    );
}

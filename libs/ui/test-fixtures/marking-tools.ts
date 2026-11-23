/** Open a field's tools and return the portaled popup that belongs to it. */
export function openFieldTools(scope: ParentNode): HTMLElement | null {
    const mark = scope.querySelector<HTMLButtonElement>(
        '.ez-status-mark--tools',
    );
    if (!mark) return null;
    if (mark.getAttribute('aria-expanded') !== 'true') mark.click();
    return mark.ownerDocument.getElementById(
        mark.getAttribute('aria-describedby') ?? '',
    );
}

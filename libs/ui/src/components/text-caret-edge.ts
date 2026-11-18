/** Native text boundaries that can hand focus to an adjacent field control. */
export type TextCaretEdge = 'left' | 'right';
/** Native editor types considered for caret-boundary navigation. */
export type TextCaretInput = HTMLInputElement | HTMLTextAreaElement;

/** Leave ordinary caret movement, selections, native date fields and IME alone. */
export function textCaretEdge(event: KeyboardEvent): TextCaretEdge | null {
    if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        event.keyCode === 229
    )
        return null;
    const input = event.target;
    if (!(
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
    ))
        return null;
    if (
        input.disabled ||
        input.selectionStart === null ||
        input.selectionStart !== input.selectionEnd
    )
        return null;
    if (event.key === 'ArrowLeft' && input.selectionStart === 0) return 'left';
    if (
        event.key === 'ArrowRight' &&
        input.selectionStart === input.value.length
    )
        return 'right';
    return null;
}

/**
 * Focus only an available neighbor; a missing neighbor leaves native keys
 * alone.
 */
export function focusTextCaretNeighbor(
    event: KeyboardEvent,
    neighbor: (edge: TextCaretEdge) => HTMLElement | null | undefined,
): boolean {
    const edge = textCaretEdge(event);
    if (!edge) return false;
    const target = neighbor(edge);
    if (
        !target?.isConnected ||
        target.matches(':disabled, [aria-disabled="true"], [hidden]')
    )
        return false;
    event.preventDefault();
    event.stopPropagation();
    target.focus({ preventScroll: true });
    return true;
}

/** Pair a text field's end with its branding button without opening tools. */
export function bindTextToolsEdges(
    root: HTMLElement,
    input: () => TextCaretInput | null,
    tools: () => HTMLElement | null,
    canLeaveEnd: () => boolean = () => true,
    startNeighbor?: () => HTMLElement | null,
): () => void {
    const keydown = (event: KeyboardEvent) => {
        const text = input();
        if (!text) return;
        if (event.target === text) {
            focusTextCaretNeighbor(event, (edge) =>
                edge === 'right'
                    ? canLeaveEnd()
                        ? tools()
                        : null
                    : startNeighbor?.(),
            );
            return;
        }
        if (
            event.target !== tools() ||
            event.key !== 'ArrowLeft' ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            event.keyCode === 229 ||
            !text.isConnected ||
            text.disabled ||
            text.selectionStart === null
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        text.focus({ preventScroll: true });
        text.setSelectionRange(text.value.length, text.value.length);
    };
    root.addEventListener('keydown', keydown, true);
    return () => root.removeEventListener('keydown', keydown, true);
}

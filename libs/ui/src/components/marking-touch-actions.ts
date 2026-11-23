import { SHEET_BREAKPOINT } from './composer/composer-view';
import { t } from '../i18n';

export interface MarkingSpan {
    start: number;
    end: number;
}

let graphemes: Intl.Segmenter | undefined;
const extendsGrapheme = /[\p{Grapheme_Extend}\u200d]/u;

function codePointStart(value: string, offset: number): number {
    const at = value.charCodeAt(offset);
    const previous = value.charCodeAt(offset - 1);
    return at >= 0xdc00 &&
        at <= 0xdfff &&
        previous >= 0xd800 &&
        previous <= 0xdbff
        ? offset - 1
        : offset;
}

function characterSpan(value: string, offset: number): MarkingSpan | undefined {
    if (offset < 0 || offset >= value.length) return;
    if (typeof Intl.Segmenter === 'function') {
        graphemes ??= new Intl.Segmenter(undefined, {
            granularity: 'grapheme',
        });
        const unit = graphemes.segment(value).containing(offset)!;
        return { start: unit.index, end: unit.index + unit.segment.length };
    }
    // Older browsers can still delete combining marks together with the
    // preceding delimiter. Include it when the previous code point extends it.
    let start = codePointStart(value, offset);
    const end = start + String.fromCodePoint(value.codePointAt(start)!).length;
    while (
        start > 0 &&
        extendsGrapheme.test(String.fromCodePoint(value.codePointAt(start)!))
    ) {
        start = codePointStart(value, start - 1);
    }
    return { start, end };
}

export function usesPhoneMarkingActions(element: HTMLElement): boolean {
    const view = element.ownerDocument.defaultView;
    return (
        !!view?.matchMedia?.('(pointer: coarse)').matches &&
        view.innerWidth < SHEET_BREAKPOINT
    );
}

/** The range a native edit could replace, before the browser writes it. */
export function markingEditRange(
    host: HTMLTextAreaElement,
    inputType: string,
): MarkingSpan | undefined {
    if (!/^(?:insert|delete)/.test(inputType)) return;
    const { selectionStart, selectionEnd, value } = host;
    if (selectionStart !== selectionEnd)
        return { start: selectionStart, end: selectionEnd };
    const caret = selectionStart;
    if (
        inputType === 'deleteContentBackward' ||
        inputType === 'deleteContentForward'
    ) {
        const offset =
            inputType === 'deleteContentBackward' ? caret - 1 : caret;
        return characterSpan(value, offset);
    }
    if (inputType === 'deleteWordBackward') {
        let start = caret;
        while (start > 0 && /\s/.test(value[start - 1])) start--;
        while (start > 0 && /\S/.test(value[start - 1])) start--;
        return { start, end: caret };
    }
    if (inputType === 'deleteWordForward') {
        let end = caret;
        while (end < value.length && /\s/.test(value[end])) end++;
        while (end < value.length && /\S/.test(value[end])) end++;
        return { start: caret, end };
    }
    if (
        inputType === 'deleteEntireSoftLine' ||
        inputType === 'deleteSoftLineBackward' ||
        inputType === 'deleteHardLineBackward'
    ) {
        const start = caret === 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
        const newline = value.indexOf('\n', caret);
        const end = newline < 0 ? value.length : newline;
        return {
            start,
            end: inputType === 'deleteEntireSoftLine' ? end : caret,
        };
    }
    if (
        inputType === 'deleteSoftLineForward' ||
        inputType === 'deleteHardLineForward'
    ) {
        const newline = value.indexOf('\n', caret);
        return { start: caret, end: newline < 0 ? value.length : newline };
    }
    return inputType.startsWith('insert')
        ? { start: caret, end: caret }
        : undefined;
}

/** A collapsed insertion at either edge is outside the marking. */
export function editTouchesMark(edit: MarkingSpan, mark: MarkingSpan): boolean {
    return edit.start < mark.end && edit.end > mark.start;
}

export function removeMarkingText(
    value: string,
    { start, end }: MarkingSpan,
): string {
    const after = value[end] === ' ' ? end + 1 : end;
    return value.slice(0, start) + value.slice(after);
}

export function showMarkingActions(
    owner: HTMLElement,
    chip: HTMLElement,
    edit: (event: MouseEvent) => void,
    remove: () => void,
    focus: boolean,
): () => void {
    const { ownerDocument: doc } = owner;
    const view = doc.defaultView!;
    const anchor = chip.getBoundingClientRect();
    const popup = doc.createElement('div');
    popup.className = 'ez-marking-touch-actions';
    popup.setAttribute('role', 'group');
    popup.setAttribute('aria-label', t('mark.touchActions'));
    const listeners = new AbortController();
    const close = () => {
        listeners.abort();
        chip.setAttribute('aria-expanded', 'false');
        popup.remove();
    };
    for (const [label, action] of [
        [t('mark.editMarking'), edit],
        [t('mark.removeMarking'), remove],
    ] as const) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', (event) => {
            action(event);
            close();
        });
        popup.append(button);
    }
    chip.setAttribute('aria-expanded', 'true');
    owner.append(popup);
    const { width, height } = popup.getBoundingClientRect();
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? view.innerWidth);
    const bottom = top + (viewport?.height ?? view.innerHeight);
    const desiredTop = anchor.top - height - 6;
    popup.style.left = `${Math.max(left + 8, Math.min(anchor.left, right - width - 8))}px`;
    popup.style.top = `${desiredTop >= top + 8 ? desiredTop : Math.max(top + 8, Math.min(anchor.bottom + 6, bottom - height - 8))}px`;
    const { signal } = listeners;
    doc.addEventListener(
        'pointerdown',
        (event) => {
            if (!event.composedPath().includes(popup)) close();
        },
        { capture: true, signal },
    );
    doc.addEventListener(
        'keydown',
        (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            const returnToChip = popup.contains(doc.activeElement);
            close();
            if (returnToChip) chip.focus({ preventScroll: true });
        },
        { signal },
    );
    view.addEventListener('resize', close, { signal });
    doc.addEventListener('scroll', close, { capture: true, signal });
    if (focus) popup.querySelector('button')?.focus({ preventScroll: true });
    return close;
}

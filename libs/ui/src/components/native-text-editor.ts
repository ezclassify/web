import { accessibleLabel } from './composer/composer-view';

interface EditorHooks {
    label: () => string;
    onNativeInput: (changed: boolean) => void;
    onReset: () => void;
    onLocked: () => void;
    describe?: () => string;
}

/** Route edits through an unnamed editor while the original owns the form value. */
export function bindNativeTextEditor(
    native: HTMLInputElement | HTMLTextAreaElement,
    editor: HTMLTextAreaElement,
    hooks: EditorHooks,
): { release: () => void; syncValidity: () => void } {
    let active = true;
    const cleanups: Array<() => void> = [];
    const on = (
        target: EventTarget,
        type: string,
        listener: EventListener,
        capture = false,
    ) => {
        target.addEventListener(type, listener, capture);
        cleanups.push(() =>
            target.removeEventListener(type, listener, capture),
        );
    };
    const hidden = native.hidden;
    native.hidden = true;
    const focus = Object.getOwnPropertyDescriptor(native, 'focus');
    Object.defineProperty(native, 'focus', {
        configurable: true,
        value: (options?: FocusOptions) => editor.focus(options),
    });
    const attributes = [
        'disabled',
        'readonly',
        'required',
        'placeholder',
        'tabindex',
        'title',
        'minlength',
        'maxlength',
        'form',
        'rows',
        'cols',
        'wrap',
        'dir',
        'inputmode',
        'aria-describedby',
        'aria-required',
        'aria-label',
        'aria-labelledby',
    ];
    const sync = () => {
        for (const name of attributes) {
            const value =
                name === 'aria-describedby'
                    ? (hooks.describe?.() ?? native.getAttribute(name))
                    : native.getAttribute(name);
            if (value === null) editor.removeAttribute(name);
            else editor.setAttribute(name, value);
        }
        const label = accessibleLabel(native, hooks.label());
        editor.removeAttribute('aria-label');
        editor.removeAttribute('aria-labelledby');
        editor.setAttribute(
            label.id ? 'aria-labelledby' : 'aria-label',
            native.getAttribute('aria-labelledby') ?? label.id ?? label.text,
        );
        if (editor.matches(':disabled') || editor.readOnly) hooks.onLocked();
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(native, {
        attributes: true,
        attributeFilter: attributes,
    });
    for (
        let parent = native.parentElement;
        parent;
        parent = parent.parentElement
    )
        if (parent.tagName === 'FIELDSET')
            observer.observe(parent, {
                attributes: true,
                attributeFilter: ['disabled'],
            });
    cleanups.push(() => observer.disconnect());
    let forwarding = false;
    let hostValidity = native.validity.customError
        ? native.validationMessage
        : '';
    const validity = Object.getOwnPropertyDescriptor(
        native,
        'setCustomValidity',
    );
    const writeValidity = native.setCustomValidity.bind(native);
    const syncValidity = () =>
        writeValidity(
            editor.validity.customError
                ? editor.validationMessage
                : hostValidity,
        );
    Object.defineProperty(native, 'setCustomValidity', {
        configurable: true,
        value: (message: string) => {
            hostValidity = String(message);
            syncValidity();
        },
    });
    const validityObserver = new MutationObserver(syncValidity);
    validityObserver.observe(editor, {
        attributes: true,
        attributeFilter: ['aria-invalid'],
    });
    cleanups.push(() => {
        validityObserver.disconnect();
        if (validity)
            Object.defineProperty(native, 'setCustomValidity', validity);
        else delete (native as Partial<typeof native>).setCustomValidity;
        writeValidity(hostValidity);
    });
    on(
        editor,
        'input',
        () => {
            native.value = editor.value;
            if (editor.value !== native.value) editor.value = native.value;
        },
        true,
    );
    for (const type of ['input', 'change']) {
        on(editor, type, (event) => {
            event.stopPropagation();
            native.value = editor.value;
            forwarding = true;
            try {
                native.dispatchEvent(new Event(type, { bubbles: true }));
            } finally {
                forwarding = false;
            }
        });
        on(native, type, () => {
            if (forwarding) return;
            const changed = native.value !== editor.value;
            if (changed) editor.value = native.value;
            hooks.onNativeInput(changed);
        });
    }
    on(
        editor,
        'keydown',
        (event) => {
            if (editor.matches(':disabled') || editor.readOnly)
                event.stopImmediatePropagation();
        },
        true,
    );
    for (const label of Array.from(native.labels ?? []))
        on(label, 'click', (event) => {
            if (
                event.target instanceof Element &&
                event.target.closest(
                    'a[href], button, input, select, textarea, [contenteditable]',
                )
            )
                return;
            event.preventDefault();
            editor.focus();
        });
    on(native, 'invalid', (event) => {
        event.preventDefault();
        editor.focus();
    });
    if (native.form)
        on(native.form, 'reset', (event) =>
            queueMicrotask(() => {
                if (!active || event.defaultPrevented) return;
                hooks.onReset();
            }),
        );
    return {
        syncValidity,
        release: () => {
            active = false;
            for (const cleanup of cleanups) cleanup();
            native.hidden = hidden;
            if (focus) Object.defineProperty(native, 'focus', focus);
            else delete (native as unknown as { focus?: unknown }).focus;
        },
    };
}

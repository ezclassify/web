import { t } from '../i18n';

/** Options for the internal, stateless native choice button. */
export interface ChoiceButtonOptions {
    /** Toggle semantics for a flow, or radio/checkbox semantics for a group. */
    readonly mode: 'toggle' | 'radio' | 'checkbox';
    /** The caller's visible label, including an existing label node if needed. */
    readonly label: string | Node;
    /** The canonical identity; row placement remains the controller's concern. */
    readonly reference: {
        readonly conceptId: string;
        readonly categoryId: string;
    };
    /** Accepted selected state, never changed optimistically by the button. */
    readonly selected: boolean;
    /** Native disabled state, distinct from an explainable policy block. */
    readonly disabled?: boolean;
    /** A policy-blocked choice remains focusable so the caller can explain it. */
    readonly blocked?: boolean;
    /** Provenance presentation supplied explicitly by the owning controller. */
    readonly inferred?: boolean;
    /** Canonical explanation and dismissal, without committing a blocked choice. */
    readonly onExplainBlocked?: () => void;
    /** Dismiss the caller's explanation when pointer or focus leaves. */
    readonly onHideExplanation?: () => void;
    /** The controller owns roving focus and independently focusable groups. */
    readonly tabIndex: 0 | -1;
    /**
     * Context class for layout, selected palette and existing controller
     * selectors.
     */
    readonly className: string;
    /**
     * Native click, including Enter/Space activation; the caller decides the
     * edit.
     */
    readonly onActivate: (event: MouseEvent) => void;
}

/** Create a native choice without owning selection, validation or navigation. */
export function createChoiceButton(
    document: Document,
    options: ChoiceButtonOptions,
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ez-choice-button ${options.className}`;
    if (options.mode !== 'toggle') button.setAttribute('role', options.mode);
    button.setAttribute(
        options.mode === 'toggle' ? 'aria-pressed' : 'aria-checked',
        String(options.selected),
    );
    button.disabled = options.disabled ?? false;
    button.tabIndex = options.tabIndex;
    button.dataset.conceptId = options.reference.conceptId;
    button.dataset.categoryId = options.reference.categoryId;
    if (options.blocked) {
        button.setAttribute('aria-disabled', 'true');
        button.dataset.blocked = '';
    }
    button.append(options.label);
    if (options.inferred) {
        button.classList.add('ez-choice-button--inferred');
        button.setAttribute(
            'aria-label',
            `${button.textContent ?? ''}${t('aria.inferredSuffix')}`,
        );
    }
    button.addEventListener('click', (event) => {
        if (options.blocked) options.onExplainBlocked?.();
        else options.onActivate(event);
    });
    if (options.blocked) {
        button.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') options.onExplainBlocked?.();
        });
        button.addEventListener('pointerleave', (event) => {
            if (event.pointerType !== 'touch') options.onHideExplanation?.();
        });
        button.addEventListener('focus', () => options.onExplainBlocked?.());
        button.addEventListener('blur', () => options.onHideExplanation?.());
    }
    return button;
}

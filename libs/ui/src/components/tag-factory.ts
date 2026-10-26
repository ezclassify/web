/**
 * Factory functions for creating chip/tag/pill DOM elements used by form
 * components to display selected concepts.
 */

import { t } from '../i18n';
import type { ConceptTextInput } from '@ezclassify/types';
import { applyTextInputAttributes } from './text-input-attributes';

/** Create a removable tag element */
export function createTag(opts: {
    label: string;
    /**
     * Full concept name used for accessible label. When omitted, `label` is
     * used.
     */
    fullName?: string;
    conceptId: string;
    categoryId: string;
    color: string;
    textColor?: string;
    /** The engine derived the fact: dashed, with no remove button. */
    inferred?: boolean;
    /** The rendered marking leaves the fact out: drawn faded. */
    unprinted?: boolean;
    /**
     * When false, the chip is not category-colored: it stays a neutral
     * `.proto-tag` surface with inherited text, no filled background. Defaults
     * to true (filled pill: category-color background with the caller's
     * pre-resolved contrast-checked text color painted on top).
     */
    colorCoding?: boolean;
    onRemove?: () => void;
    editable?: {
        value: string;
        placeholder?: string;
        config: ConceptTextInput;
        onChange: (value: string) => void;
    };
}): HTMLSpanElement {
    const accessibleName = opts.fullName ?? opts.label;
    const hasRemove = !!opts.onRemove && !opts.inferred;
    const tag = document.createElement('span');
    tag.className =
        'proto-tag' +
        (opts.inferred ? ' proto-tag--inferred' : '') +
        (opts.unprinted ? ' proto-tag--unprinted' : '') +
        (opts.editable ? ' proto-tag--editable' : '') +
        // The base padding's smaller right edge assumes a trailing ✕ button
        // fills it. A pill with no remove control (inferred chips, or any
        // future non-removable chip) has nothing there, so it needs the
        // symmetric padding modifier instead of a lopsided trailing edge.
        (!hasRemove ? ' proto-tag--no-remove' : '');
    // No role="listitem": chips share the `.tag-input-wrap` group with the
    // search input (role="group"), not a list container, so a listitem role
    // fails aria-required-parent. The aria-label names each chip for AT.
    tag.setAttribute(
        'aria-label',
        accessibleName +
            (opts.inferred ? t('aria.inferredSuffix') : '') +
            (opts.unprinted ? t('aria.unprintedSuffix') : ''),
    );
    tag.dataset.conceptId = opts.conceptId;
    tag.dataset.categoryId = opts.categoryId;
    // A real pill: filled background in the category color, with the caller's
    // pre-resolved WCAG-contrast text color painted on top of it (getCategoryTextColor
    // / a scheme color rule's `text`, chosen by the caller same as every other
    // chrome that paints a concept). When color coding is disabled, neither
    // property is set and `.proto-tag`'s CSS defaults (a neutral surface,
    // inherited text) apply instead.
    if (opts.colorCoding !== false) {
        tag.style.setProperty('--ez-tag-bg', opts.color);
        if (opts.textColor)
            tag.style.setProperty('--ez-tag-color', opts.textColor);
    }

    const label = document.createElement('span');
    label.textContent = opts.label;
    tag.appendChild(label);

    // Editable text field for text-input concepts (e.g., declass date)
    if (opts.editable) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'proto-tag-edit';
        input.value = opts.editable.value;
        if (opts.editable.placeholder)
            input.placeholder = opts.editable.placeholder;
        applyTextInputAttributes(input, opts.editable.config);
        input.setAttribute('aria-label', `${opts.label} value`);
        input.size = Math.max(
            opts.editable.value.length,
            opts.editable.placeholder?.length ?? 6,
            6,
        );
        input.addEventListener('input', () => {
            input.size = Math.max(input.value.length, 6);
            opts.editable!.onChange(input.value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            e.stopPropagation(); // don't let tag keyboard handler intercept
        });
        input.addEventListener('click', (e) => e.stopPropagation());
        tag.appendChild(input);
    }

    if (hasRemove) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'proto-tag-remove';
        btn.textContent = '\u00d7';
        btn.setAttribute(
            'aria-label',
            t('aria.removeTag').replace('{name}', accessibleName),
        );
        btn.tabIndex = -1;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            opts.onRemove!();
        });
        tag.appendChild(btn);
    }

    return tag;
}

/**
 * A pill for author text the engine could not read. It carries the text as
 * written, flagged, with no category color and no remove button: correcting it
 * means editing the text, which the field's filter does.
 */
export function createUnreadTag(text: string): HTMLSpanElement {
    const tag = document.createElement('span');
    tag.className = 'proto-tag proto-tag--unread proto-tag--no-remove';
    tag.textContent = text;
    tag.setAttribute('aria-label', text + t('aria.unreadSuffix'));
    return tag;
}

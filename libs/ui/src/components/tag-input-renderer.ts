/**
 * Chip rendering pipeline for TagInput.
 *
 * One pill per assertion, in the print order the engine returned, including
 * facts omitted from print. The UI does not reconstruct marking order from
 * category or header metadata.
 *
 * A chip's style says who stated the fact. A solid chip is the author's; a fact
 * the engine derived (a default, an inference, a value taken from the whole) is
 * dashed and has no remove button, because removing it would only have the
 * engine derive it again. A fact the rendered marking leaves out, such as one
 * the scheme suppresses from print, is drawn faded: the field holds it, the
 * marking does not show it. Text the engine could not read follows the chips as
 * flagged pills of its own, so the chips hold everything the field does.
 */

import type {
    Assertion,
    AssertionRef,
    SchemePublicView,
} from '@ezclassify/types';
import { resolveMarkingColor } from '../color-resolver';
import {
    getPublicFormatLayout,
    type FormatLayoutSource,
} from '../format-layout';
import {
    createTag,
    createUnreadTag,
    reconcileChildren,
} from './component-utils';
import { derivedAssertion } from '../assertion-identity';

/** State and callbacks the chip rendering pipeline needs. */
export interface TagChipRenderContext {
    scheme: SchemePublicView;
    /** Scheme metadata carrying the projected render-format layouts. */
    schemeMeta: FormatLayoutSource;
    assertions: Assertion[];
    formatId: string;
    inputWrap: HTMLDivElement;
    filterInput: HTMLInputElement;
    getCategoryColor: (categoryId: string) => string;
    getCategoryTextColor: (categoryId: string) => string;
    /**
     * Category that drives the scheme-default display color
     * (`render.color_from`). When set, a chip whose concept carries a mandated
     * color tints its accent with that color instead of the generic palette.
     */
    colorFrom?: string;
    /** When false, chips are not category-colored. Defaults to true. */
    colorCoding?: boolean;
    /**
     * Facts the rendered marking leaves out (its render assessment's
     * `omitted`).
     */
    unprinted?: readonly AssertionRef[];
    /** Author text the engine could not read, one entry per fragment. */
    unread?: readonly string[];
    onRemoveAssertion: (conceptId: string, categoryId: string) => void;
    onReprocess: () => void;
    onChipClick: (el: HTMLElement, index: number) => void;
    onChipKeydown: (e: KeyboardEvent, el: HTMLSpanElement) => void;
    onChipBlur: (el: HTMLElement) => void;
    /**
     * Called after a chip element is created, so the caller can attach its
     * concept dwell tooltip.
     */
    onChipCreated?: (
        el: HTMLElement,
        conceptId: string,
        categoryId: string,
    ) => void;
}

/**
 * Build and reconcile chip elements inside the input wrap. Returns the ordered
 * list of tag elements.
 */
export function renderTagChips(ctx: TagChipRenderContext): HTMLElement[] {
    const { scheme, assertions, inputWrap, filterInput } = ctx;

    if (!scheme.concepts || scheme.concepts.length === 0) {
        while (inputWrap.firstChild && inputWrap.firstChild !== filterInput) {
            inputWrap.removeChild(inputWrap.firstChild);
        }
        if (!inputWrap.contains(filterInput))
            inputWrap.appendChild(filterInput);
        return [];
    }

    const conceptMap = new Map(scheme.concepts.map((c) => [c.id, c]));
    const layout = getPublicFormatLayout(ctx.schemeMeta, ctx.formatId);
    const fmt = layout.format;

    const unprinted = new Set(
        (ctx.unprinted ?? []).map(
            (ref) => `${ref.categoryId}::${ref.conceptId}`,
        ),
    );
    const isUnprinted = (a: Assertion) =>
        unprinted.has(`${a.categoryId}::${a.conceptId}`);
    // Text nobody could read rides between the chips and the filter, rebuilt
    // on every render: it has no assertion identity to reconcile by.
    for (const stale of inputWrap.querySelectorAll(
        ':scope > .proto-tag--unread',
    ))
        stale.remove();
    const unreadEls = (ctx.unread ?? []).map((text) => createUnreadTag(text));
    // In place ahead of the filter, so the chips reconcile in front of them.
    if (inputWrap.contains(filterInput))
        for (const el of unreadEls) inputWrap.insertBefore(el, filterInput);

    const tagElsList: HTMLElement[] = [];
    const newEls = reconcileChildren<Assertion>(
        inputWrap,
        assertions,
        // The style is part of the key: a chip whose authorship or print
        // state changed is drawn again, not reused.
        (a) =>
            `${ctx.formatId}::${a.conceptId}::${a.categoryId}::` +
            `${derivedAssertion(a) ? 'derived' : 'stated'}::` +
            `${isUnprinted(a) ? 'unprinted' : 'printed'}`,
        (a) => {
            const concept = conceptMap.get(a.conceptId);
            const isInferred = derivedAssertion(a);
            // Match the active format's concept view without adding marking
            // separators or wrappers to individual assertion chips.
            const label =
                concept?.views?.[fmt.view ?? 'default'] ??
                concept?.views?.['default'] ??
                concept?.name ??
                a.conceptId;
            const authority = resolveMarkingColor(
                { colorFrom: ctx.colorFrom },
                [
                    {
                        conceptId: a.conceptId,
                        categoryId: a.categoryId,
                        color: concept?.color,
                    },
                ],
            );
            const color =
                authority?.background ?? ctx.getCategoryColor(a.categoryId);
            // Follow the same authority-first precedence as `color` above: a
            // scheme color rule can mandate a specific text color alongside
            // its background (render.color_from), and the chip is a filled
            // pill where the two colors must actually pair for contrast.
            const textColor =
                authority?.text ?? ctx.getCategoryTextColor(a.categoryId);
            const isTextInput = !!(concept?.textInput && !isInferred);
            const editableOpts = isTextInput
                ? {
                      value: a.value ?? '',
                      placeholder:
                          concept!.textInput!.placeholder ?? concept!.name,
                      config: concept!.textInput!,
                      onChange: (value: string) => {
                          const target = assertions.find(
                              (x) =>
                                  x.conceptId === a.conceptId &&
                                  x.categoryId === a.categoryId,
                          );
                          if (target) target.value = value;
                          ctx.onReprocess();
                      },
                  }
                : undefined;
            const el = createTag({
                label,
                fullName: concept?.name ?? label,
                conceptId: a.conceptId,
                categoryId: a.categoryId,
                color,
                textColor,
                inferred: isInferred,
                unprinted: isUnprinted(a),
                colorCoding: ctx.colorCoding,
                onRemove: !isInferred
                    ? () => ctx.onRemoveAssertion(a.conceptId, a.categoryId)
                    : undefined,
                editable: editableOpts,
            });
            el.tabIndex = -1;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                ctx.onChipClick(el, tagElsList.indexOf(el));
            });
            el.addEventListener('keydown', (e) =>
                ctx.onChipKeydown(e, el as HTMLSpanElement),
            );
            el.addEventListener('blur', () => ctx.onChipBlur(el));
            ctx.onChipCreated?.(el, a.conceptId, a.categoryId);
            return el;
        },
        undefined,
        [...unreadEls, filterInput],
    );

    tagElsList.push(...newEls);

    if (!inputWrap.contains(filterInput)) inputWrap.appendChild(filterInput);

    return tagElsList;
}

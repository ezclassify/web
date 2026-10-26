/**
 * TagInput: chip-based multi-select for discrete-tag schemes.
 *
 * Each selected concept renders as a pill chip in the input wrap; a trailing
 * text input is the shared composer's input (see
 * `composer/composer-controller.ts`). What the user types there adds to the
 * chips: the composer reads it over the committed set, shows the result, and
 * Enter or leaving the field commits it, exactly as in every other field.
 * Left/Right roving focus moves between chips; Delete/Backspace on a focused
 * chip removes it; Backspace in an empty filter removes the last chip.
 *
 * The successor to ConceptAutocomplete's chip-multi-select role: same assertion
 * pipeline (addAssertion/toggleSuggestion/reprocess/getSuggestions), same Host
 * Form Contract (the native input holds the rendered marking string and
 * dispatches native `input` events on commit), but no separator or
 * marking-syntax rendering between chips. ConceptAutocomplete's chip row
 * reconstructed the rendered string's punctuation so a chip's position and
 * abbreviation matched what actually appeared in the marking; TagInput's chips
 * represent assertions directly; ordering follows the render format's category
 * order (see tag-input-renderer.ts), never the rendered string's character
 * offsets. A field that needs the marking's own syntax visible belongs on
 * MarkingField instead.
 */

import type { SchemeMetaView } from '@ezclassify/types';
import { teardownAfterWrite } from './teardown-write';
import { heightAtLeastFloor } from './dom-helpers';
import { ComponentBase, type ComponentOptions } from './component-base';
import { createKeyboardHints, COMPONENT_CSS } from './component-utils';
import tagInputCss from './tag-input.css?inline';
import { t } from '../i18n';
import { getMountHost } from '../mount-host-registry';
import {
    handleChipKeydown,
    handleFilterChipKeys,
    type ChipKeyboardContext,
} from './tag-input-keyboard';
import { renderTagChips } from './tag-input-renderer';
import { ensureStatusMark, setStatusMarkFixes } from './status-mark';
import {
    ensureFieldDrawer,
    setFieldDrawerOrientation,
    syncFieldDrawerTheme,
} from './field-chrome-drawer';
import {
    ensureFavoritesButton,
    schemeOffersPresets,
    type FavoritesConfig,
    type FavoritesPanel,
    type FavoritesPanelHost,
} from './favorites-panel';
import { ComposerController } from './composer/composer-controller';
import { ComposerView, accessibleLabel } from './composer/composer-view';

/**
 * Chip-based multi-select: typing composes additions to the chips, the result
 * row shows what will be stored, and the roving chip focus supports
 * keyboard-only removal.
 */
export class TagInput extends ComponentBase {
    private inputWrap!: HTMLDivElement;
    private filterInput!: HTMLInputElement;
    /** The ★ drawer hosting the status mark + favorites button. */
    private drawer!: HTMLElement;
    private favoritesPanel: FavoritesPanel | null = null;
    private hintsEl!: HTMLElement;
    private wrapOuter!: HTMLDivElement;
    /**
     * Rendered-string preview bar, shared with every other field component;
     * only appended to the DOM when the host opts in via `showPreview`.
     */
    private preview!: HTMLDivElement;
    private tagEls: HTMLSpanElement[] = [];
    /**
     * After async reprocess, focus the chip with this concept ID (set during
     * keyboard delete)
     */
    private _pendingFocusConceptId: string | null = null;
    private controller!: ComposerController;
    private view!: ComposerView;
    /** Whether the composer is open below the field (drawer goes on top). */
    private composerBelow = false;
    /** Filter-input prompt shown once a marking is present (search hint). */
    private searchPlaceholder = '';
    /**
     * Filter-input prompt shown when the field is empty: a consumer-set
     * placeholder (e.g. the whole-marking base) when present, else the search
     * hint.
     */
    private emptyPlaceholder = '';
    private hostStyleObserver: MutationObserver | null = null;

    /** CSS for TagInput (exported for external injection) */
    static readonly CSS: string = COMPONENT_CSS + tagInputCss;

    /** The value is the WHOLE marking: same format role as MarkingField. */
    protected override resolveDefaultFormatId(meta: SchemeMetaView): string {
        return meta.defaultWholeRenderFormat ?? meta.defaultRenderFormat ?? '';
    }

    protected override clearButtonMount(): HTMLElement {
        this.inputWrap.classList.add('ez-has-clear');
        return this.inputWrap;
    }

    protected override hasClearValue(): boolean {
        return (
            super.hasClearValue() ||
            !!this.filterInput.value ||
            this.controller.isDirty()
        );
    }

    protected override discardDraft(): void {
        this.controller.discard();
    }

    protected setup(): void {
        this.injectComponentStyles(tagInputCss);

        // Rendered-string preview, off by default; every field component
        // shares this convention.
        this.preview = this.createPreviewBar();

        // Input wrapper (chips + filter input)
        this.inputWrap = document.createElement('div');
        this.inputWrap.className = 'tag-input-wrap';
        this.inputWrap.setAttribute('role', 'group');
        this.inputWrap.setAttribute(
            'aria-label',
            t('aria.selectedMarkingsAndSearch'),
        );
        // A press anywhere on the field is an explicit request for the
        // composer, including a re-tap on an already focused field where no
        // focus event fires.
        this.inputWrap.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.proto-tag')) return;
            this.filterInput.focus();
            if (!this.controller.isOpen) void this.view.open('pointer');
        });
        this.container.appendChild(this.inputWrap);

        this.filterInput = document.createElement('input');
        this.filterInput.type = 'text';
        this.filterInput.className = 'tag-input-filter';
        const coarsePointer =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(pointer: coarse)').matches;
        this.searchPlaceholder = coarsePointer
            ? t('placeholder.searchInputTouch')
            : t('placeholder.searchInput');
        // A consumer-set placeholder on the enhanced input is the EMPTY-field
        // prompt (it conveys the field's default value); it is shown only
        // while there are no chips (see updateFilterPlaceholder).
        this.emptyPlaceholder =
            this.enhancedInput?.placeholder?.trim() || this.searchPlaceholder;
        this.updateFilterPlaceholder();
        this.filterInput.setAttribute('aria-label', t('aria.searchMarkings'));
        this.filterInput.setAttribute('autocomplete', 'off');

        // WCAG 2.5.3 (Label in Name): a consumer <label> on the original input
        // names the rendered combobox.
        {
            const labels = this.enhancedInput?.labels;
            const consumerLabel =
                labels && labels.length > 0
                    ? (labels[0] as HTMLLabelElement)
                    : null;
            if (consumerLabel) {
                if (!consumerLabel.id) {
                    consumerLabel.id =
                        'ez-tag-input-label-' +
                        Math.random().toString(36).slice(2, 8);
                }
                this.filterInput.removeAttribute('aria-label');
                this.filterInput.setAttribute(
                    'aria-labelledby',
                    consumerLabel.id,
                );
            }
        }
        this.filterInput.addEventListener('keydown', (e) =>
            handleFilterChipKeys(e, {
                filterInput: this.filterInput,
                tagEls: this.tagEls,
                assertions: this.assertions,
                focusChip: (i) => this.focusChip(i),
            }),
        );
        this.filterInput.addEventListener('focus', () => {
            this.unfocusAllChips();
            void this.editUnresolvedValue();
        });
        // An input event can arrive without focus (an assistive or host edit).
        // It adds to the unresolved source rather than silently replacing it.
        this.filterInput.addEventListener(
            'input',
            () => {
                if (this.editsHeldSource()) {
                    const addition = this.filterInput.value;
                    void this.controller.startOver(
                        [this._lastRendered, addition]
                            .filter(Boolean)
                            .join(' '),
                    );
                }
            },
            true,
        );
        this.filterInput.addEventListener('paste', (e) =>
            this.onFilterPaste(e),
        );

        // Keyboard hints for the chips. Built here (once) but mounted by
        // renderField() into the ★ drawer, at the drawer's LEFT edge. The
        // data-ezclassify-no-hints opt-out keeps it hidden.
        this.hintsEl = createKeyboardHints([
            { keys: '←→', action: t('hint.navigateTags') },
            { keys: 'Del', action: t('hint.removeTag') },
        ]);
        if (this.options.hints === false) this.hintsEl.style.display = 'none';

        // Keep the field in normal flow; the composer portals to
        // document.body and positions in viewport coordinates.
        this.wrapOuter = document.createElement('div');
        this.wrapOuter.style.position = 'relative';
        this.wrapOuter.appendChild(this.inputWrap);
        this.container.appendChild(this.wrapOuter);
        this.followHostAppearance();

        this.controller = new ComposerController({
            port: this.composerPort('additive'),
            shape: 'additive',
            announce: (text) => this.view?.announce(text),
        });
        this.view = new ComposerView({
            controller: this.controller,
            committedValidity: () => this.valueValidationMessage,
            input: this.filterInput,
            anchor: this.inputWrap,
            bounds: this.wrapOuter,
            label: () =>
                accessibleLabel(this.filterInput, t('aria.searchMarkings')),
            css:
                this.options.injectStyles === false
                    ? undefined
                    : COMPONENT_CSS + tagInputCss,
            placeholder: this.searchPlaceholder,
            describeConcept: this.shouldShowTooltip()
                ? (conceptId, categoryId) =>
                      this.resolveConceptDescription(conceptId, categoryId)
                : undefined,
            onPlacement: (open, side) => {
                this.composerBelow = open && side === 'below';
                this.setEditorOpen(open);
                this.syncDrawerOrientation();
            },
        });
        this.container.appendChild(this.view.announcer);
        this.wrapOuter.insertAdjacentElement('afterend', this.view.note);

        this.render();
    }

    /** Also read an open draft again, so its fix rows account for the parts. */
    override refreshParts(): void {
        super.refreshParts();
        if (this.coversParts && !this._destroyed)
            void this.controller?.refreshContext();
    }

    destroy(): void {
        teardownAfterWrite(
            this,
            this.controller?.isDirty() ? () => this.controller.commit() : null,
            () => this.teardown(),
        );
    }

    private teardown(): void {
        this.destroyClearButton();
        this.removeRuleErrors();
        this._destroyed = true;
        this.hostStyleObserver?.disconnect();
        this.hostStyleObserver = null;
        this.view.destroy();
        this.controller.dispose();
        this.favoritesPanel?.destroy();
        this.favoritesPanel = null;
        this.container.innerHTML = '';
    }

    protected render(): void {
        if (!this.engine || !this.scheme) {
            return;
        }
        this.renderField();
    }

    private renderField(): void {
        const hadFocus =
            this.inputWrap?.contains(document.activeElement) ||
            this.filterInput === document.activeElement;

        this.tagEls = renderTagChips({
            scheme: this.scheme,
            schemeMeta: this.schemeMeta,
            assertions: this.assertions,
            formatId: this.formatId,
            inputWrap: this.inputWrap,
            filterInput: this.filterInput,
            getCategoryColor: (id) => this.getCategoryColor(id),
            getCategoryTextColor: (id) => this.getCategoryTextColor(id),
            colorFrom: this.colorFrom,
            colorCoding: this.options.colorCoding,
            unprinted: this.unprinted,
            unread: this.unreadText,
            onRemoveAssertion: (c, f) => this.removeAssertion(c, f),
            onReprocess: () => this.reprocess(),
            onChipClick: (_el, i) => this.focusChip(i),
            onChipKeydown: (e, el) => this.onChipKeydown(e, el),
            onChipBlur: () => {
                setTimeout(() => {
                    if (!this.inputWrap.contains(document.activeElement)) {
                        this.unfocusAllChips();
                    }
                }, 150);
            },
            onChipCreated: (el, conceptId, categoryId) =>
                this.attachConceptTooltip(el, conceptId, categoryId),
        });

        this.updateFilterPlaceholder();
        this.preview.textContent = this.getRendered();
        // A commit or an external change landed: a clean draft follows it.
        this.controller.syncCommitted();

        // One status mark per field, mutated in place (Enhancement Status
        // Indicator contract). ensure() is idempotent and re-mounts after any
        // render pass that wiped the wrap, so marks can never stack. The mark +
        // ★ favorites button live in a small drawer attached to the field's
        // bottom-right edge rather than floating over the chips, mirroring to
        // the top when the field's own dropdown flips open above (see
        // syncDrawerOrientation). Host appearance and the drawer's attached
        // surface are synchronized together by followHostAppearance().
        this.drawer = ensureFieldDrawer(this.inputWrap, {
            root: this.options.root,
        });
        this.syncDrawerAppearance();
        // Hints (built in init()) sit at the drawer's LEFT edge, status mark
        // + ★ button at the right: DOM order alone gets that in a
        // shrink-wrapped flex row, so this just has to run before the mark/★
        // are appended below. insertBefore no-ops when hintsEl is already the
        // first child, so this is safe to repeat on every render pass.
        if (this.drawer.firstChild !== this.hintsEl) {
            this.drawer.insertBefore(this.hintsEl, this.drawer.firstChild);
        }
        ensureStatusMark(this.drawer, {
            shape: 'chrome',
            root: this.options.root,
            shouldShowTooltip: () => this.shouldShowTooltip(),
        });
        setStatusMarkFixes(this.drawer, this.getAppliedFixes());
        // The ★ mounts on host favorites wiring OR scheme-declared presets
        // (ensureFavoritesButton owns the OR); favoritesHost tolerates an
        // undefined config, running the panel read-only in that case.
        if (
            this.options.favorites ||
            schemeOffersPresets(this.scheme, this.options.scope)
        ) {
            this.favoritesPanel = ensureFavoritesButton(
                this.drawer,
                this.favoritesHost(this.options.favorites),
            );
            this.favoritesPanel?.syncStar();
        }

        if (hadFocus && !this.inputWrap.contains(document.activeElement)) {
            if (this._pendingFocusConceptId) {
                const targetIdx = this.tagEls.findIndex(
                    (el) =>
                        (el as HTMLElement).dataset.conceptId ===
                        this._pendingFocusConceptId,
                );
                this._pendingFocusConceptId = null;
                if (targetIdx >= 0) {
                    this.focusChip(targetIdx);
                } else if (this.tagEls.length > 0) {
                    this.focusChip(this.tagEls.length - 1);
                } else {
                    this.filterInput.focus();
                }
            } else {
                this.filterInput.focus();
            }
        } else {
            this._pendingFocusConceptId = null;
        }
    }

    /** Keep native form styling on its replacement, including nested themes. */
    private followHostAppearance(): void {
        const host = getMountHost(this.container) ?? this.enhancedInput;
        // A hidden data field has no visual contract to preserve. Explicit
        // styled-input opt-in keeps the library's own field palette/sizing.
        if (
            !(host instanceof HTMLInputElement) ||
            host.type === 'hidden' ||
            this.options.styleInputs
        )
            return;
        const sync = () => {
            const styles = window.getComputedStyle(host);
            // The wrap's own stylesheet floor, read before the host's values
            // are written over it: the field family's single-line height.
            this.inputWrap.style.minHeight = '';
            const floor = window.getComputedStyle(this.inputWrap).minHeight;
            const explicitPalette =
                !!this.options.theme ||
                this.container.hasAttribute('data-color-scheme');
            for (const property of [
                'boxSizing',
                'backgroundColor',
                'color',
                'font',
                'lineHeight',
                'borderWidth',
                'borderStyle',
                'borderColor',
                'borderRadius',
                'marginTop',
                'marginBottom',
                'minHeight',
                'paddingTop',
                'paddingBottom',
                'paddingLeft',
            ] as const) {
                this.inputWrap.style[property] =
                    explicitPalette &&
                    ['backgroundColor', 'color', 'borderColor'].includes(
                        property,
                    )
                        ? ''
                        : styles[property];
            }
            // The floor is the wrap's outer height; a content-box wrap
            // measures min-height inside the host padding and border it
            // just took on.
            const wrap = window.getComputedStyle(this.inputWrap);
            const chrome =
                wrap.boxSizing === 'border-box'
                    ? 0
                    : [
                          wrap.paddingTop,
                          wrap.paddingBottom,
                          wrap.borderTopWidth,
                          wrap.borderBottomWidth,
                      ].reduce(
                          (sum, length) => sum + (parseFloat(length) || 0),
                          0,
                      );
            this.inputWrap.style.minHeight = heightAtLeastFloor(
                styles.minHeight,
                `${Math.max(0, (parseFloat(floor) || 0) - chrome)}px`,
            );
            // The native padding remains the baseline; the status mark must
            // still have its own lane beside wrapping chips and the filter.
            this.inputWrap.style.paddingRight = `max(${styles.paddingRight || '0px'}, 2.5rem)`;
            this.syncDrawerAppearance();
        };
        sync();
        if (typeof MutationObserver === 'undefined') return;
        this.hostStyleObserver = new MutationObserver(sync);
        this.hostStyleObserver.observe(this.container, {
            attributes: true,
            attributeFilter: ['data-color-scheme'],
        });
        for (
            let ancestor: HTMLElement | null = host;
            ancestor;
            ancestor = ancestor.parentElement
        ) {
            this.hostStyleObserver.observe(ancestor, {
                attributes: true,
                attributeFilter: [
                    'style',
                    'class',
                    'data-theme',
                    'data-bs-theme',
                    'data-color-scheme',
                ],
            });
        }
    }

    private syncDrawerAppearance(): void {
        if (!this.drawer) return;
        if (!this.inputWrap.style.backgroundColor) {
            this.drawer.style.backgroundColor = '';
            this.drawer.style.removeProperty('--ez-field-drawer-border-color');
            return;
        }
        const styles = window.getComputedStyle(this.inputWrap);
        syncFieldDrawerTheme(this.drawer, {
            backgroundColor: styles.backgroundColor,
            borderColor: styles.borderColor,
        });
    }

    /**
     * Show the empty-field prompt (a consumer default like the whole-marking
     * base) only while no chips are present; once a marking is set, revert to
     * the search hint so the default never sits misleadingly beside real
     * chips.
     */
    private updateFilterPlaceholder(): void {
        if (this.tagEls.length === 0) {
            this.filterInput.placeholder = this.emptyPlaceholder;
            return;
        }
        // The filter shares its row with the chips and stops short of the
        // chrome lane, so on a narrow field the full hint would run under the
        // status mark. Use the short hint there; the filter's ellipsis covers
        // a field too narrow even for that. The row never wraps for it: the
        // single-line fields keep one height.
        const short = t('placeholder.searchInputTouch');
        this.filterInput.placeholder =
            this.searchPlaceholder !== short &&
            !this.fitsFilter(this.searchPlaceholder)
                ? short
                : this.searchPlaceholder;
    }

    /**
     * Whether `text` fits the filter as laid out, in the filter's own font.
     * Where the page lays nothing out it is taken to fit.
     */
    private fitsFilter(text: string): boolean {
        const room = this.filterInput.clientWidth;
        if (room === 0) return true;
        const style = getComputedStyle(this.filterInput);
        const probe = document.createElement('span');
        probe.textContent = text;
        probe.style.cssText =
            'position:absolute;visibility:hidden;white-space:pre;';
        probe.style.font = style.font;
        probe.style.letterSpacing = style.letterSpacing;
        this.inputWrap.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        const padding =
            (parseFloat(style.paddingLeft) || 0) +
            (parseFloat(style.paddingRight) || 0);
        return width + padding <= room;
    }

    /**
     * Whether the chips cannot stand for the held value: it failed to read, or
     * reading left part of it unresolved. A fully read value that breaks a rule
     * is not one of these. That includes a part that exceeds its whole, which
     * can appear or clear as the other fields settle, so the filter and the
     * requests it makes never depend on that timing.
     */
    private holdsUnresolvedSource(): boolean {
        return (
            !!this.valueValidationMessage &&
            (this.failedRead !== null || this.sourceUnresolved)
        );
    }

    /** Editing starts over from the held text instead of adding to the chips. */
    private editsHeldSource(): boolean {
        return this.holdsUnresolvedSource() && !this.controller.isDirty();
    }

    /** An unresolved loaded value is edited whole, as a pasted marking is. */
    private async editUnresolvedValue(): Promise<void> {
        if (this.editsHeldSource())
            await this.controller.startOver(this._lastRendered);
    }

    protected override removeAssertion(
        conceptId: string,
        categoryId: string,
    ): void {
        if (!this.holdsUnresolvedSource()) {
            super.removeAssertion(conceptId, categoryId);
            return;
        }
        this.filterInput.focus();
        void this.editUnresolvedValue().then(() =>
            this.controller.remove({ conceptId, categoryId }),
        );
    }

    private focusChip(index: number): void {
        this.unfocusAllChips();
        if (index < 0 || index >= this.tagEls.length) {
            return;
        }
        const chip = this.tagEls[index] as HTMLSpanElement;
        chip.classList.add('active');
        chip.tabIndex = 0;
        // Make the delete button Tab-reachable while this chip is active so
        // keyboard users can explicitly activate it (in addition to Backspace/Delete).
        const delBtn =
            chip.querySelector<HTMLButtonElement>('.proto-tag-remove');
        if (delBtn) delBtn.tabIndex = 0;
        chip.focus();
        this.view.close();
    }

    private unfocusAllChips(): void {
        for (const chip of this.tagEls) {
            chip.classList.remove('active');
            chip.tabIndex = -1;
            const delBtn =
                chip.querySelector<HTMLButtonElement>('.proto-tag-remove');
            if (delBtn) delBtn.tabIndex = -1;
        }
    }

    private onChipKeydown(e: KeyboardEvent, chip: HTMLSpanElement): void {
        handleChipKeydown(e, chip, this.chipKeyboardContext());
    }

    private chipKeyboardContext(): ChipKeyboardContext {
        return {
            tagEls: this.tagEls,
            filterInput: this.filterInput,
            assertions: this.assertions,
            focusChip: (i) => this.focusChip(i),
            unfocusAllChips: () => this.unfocusAllChips(),
            removeAssertion: (c, f) => this.removeAssertion(c, f),
            closeList: () => this.view.close(),
            setPendingFocusConceptId: (id) => {
                this._pendingFocusConceptId = id;
            },
        };
    }

    /**
     * Paste into an empty filter: a pasted marking stands for the whole value,
     * so the draft starts over from it rather than adding to the chips. The
     * composer shows what that stores (with the chips it drops marked) and
     * Enter commits it. A paste into text already typed is ordinary typing.
     */
    private onFilterPaste(e: ClipboardEvent): void {
        const pasted = e.clipboardData?.getData('text')?.trim();
        if (!pasted || this.filterInput.value.trim()) return;
        e.preventDefault();
        this.filterInput.value = pasted;
        void this.controller.startOver(pasted);
        if (!this.controller.isOpen) void this.view.open('typing');
    }

    /**
     * Mirror the ★ drawer to the edge OPPOSITE the composer, so the two never
     * occupy the same space. A visible validation error also occupies the
     * bottom edge: the drawer must never hide the message the user is being
     * asked to fix.
     */
    private syncDrawerOrientation(): void {
        if (!this.drawer) return;
        setFieldDrawerOrientation(
            this.drawer,
            this.composerBelow || this.hasVisibleValidationErrors()
                ? 'top'
                : 'bottom',
        );
    }

    protected override onRuleErrorsChanged(): void {
        this.view?.refreshValidity();
        // Errors can arrive before setup() builds the drawer (initial value
        // processing); orientation syncs on first render then.
        if (this.drawer) this.syncDrawerOrientation();
    }

    /**
     * Favorites context for this field: apply REPLACES the whole chip set,
     * exactly `setValue()` (process the favorite through this field's own
     * scheme/format, adopt the resulting assertions). Rebuilt on every render
     * so the panel's closures never capture stale assertions/rendered state.
     * `config` is undefined for a presets-only mount (no host favorites
     * wiring); the panel itself tolerates that and runs read-only.
     */
    private favoritesHost(
        config: FavoritesConfig | undefined,
    ): FavoritesPanelHost {
        return {
            root: this.options.root,
            schemeId: this.schemeId,
            scope: this.options.scope,
            formatId: this.formatId,
            scheme: this.scheme,
            config,
            read: (marking) =>
                Promise.resolve(
                    this.callValidate(marking, {
                        outputFormat: this.formatId,
                        context: this.getProcessingContext(),
                    }),
                ),
            applyPreset: (presetId) =>
                this.callApplyPreset(presetId, this.formatId),
            getCurrent: () => ({
                rendered: this._lastRendered,
                valid:
                    this.assertions.length > 0 &&
                    !this.container.hasAttribute('data-ezclassify-invalid'),
            }),
            onApply: (marking) => void this.setValue(marking),
            focusField: () => this.filterInput.focus(),
        };
    }
}

/** Options accepted by TagInput (no additions beyond the shared surface). */
export type TagInputOptions = ComponentOptions;

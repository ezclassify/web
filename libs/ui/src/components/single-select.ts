/**
 * Single-Select Component
 *
 * Two rendering modes, controlled by the `data-ezclassify-select-mode`
 * attribute:
 *
 * - **dropdown** (default): a conventional native `<select>` populated with
 *   scheme concepts. Concepts that require a value reveal a normal companion
 *   field below the select.
 * - **cards** (opt-in): a compact radio selector. Choices stay label-first, while
 *   one shared detail panel explains the selected choice (or the choice being
 *   hovered/focused). This keeps policy help available without repeating
 *   paragraphs inside every option.
 *
 * Works with single-category schemes or schemes where the primary category has
 * `single: true`.
 */

import { ComponentBase } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import { resolveMarkingColor } from '../color-resolver';
import type {
    Assertion,
    ConceptTextInput,
    Suggestion,
    ValidationError,
    Fix,
    Warning,
} from '@ezclassify/types';
import { applyTextInputAttributes } from './text-input-attributes';
import singleSelectCss from './single-select.css?inline';

const SINGLE_SELECT_CSS: string = singleSelectCss;

/** Compare complete assertion DTO state; host provenance changes are edits. */
function sameAssertionState(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (
        !left ||
        !right ||
        typeof left !== 'object' ||
        typeof right !== 'object'
    )
        return false;
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right))
        return false;
    if (
        !Array.isArray(left) &&
        Object.getPrototypeOf(left) !== Object.prototype
    )
        return false;
    if (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length !== right.length
    )
        return false;
    const leftFields = left as Record<string, unknown>;
    const rightFields = right as Record<string, unknown>;
    const keys = Object.keys(leftFields);
    return (
        keys.length === Object.keys(rightFields).length &&
        keys.every(
            (key) =>
                Object.hasOwn(rightFields, key) &&
                sameAssertionState(leftFields[key], rightFields[key]),
        )
    );
}

/**
 * Native select (or opt-in card group) for choosing exactly one concept from a
 * single-select category.
 */
export class SingleSelect extends ComponentBase {
    protected override clearButtonMount(): HTMLElement | null {
        return this.isDropdownMode
            ? (this.dropdownEl?.parentElement ?? null)
            : this.clearButtonFrame(this.cardsContainer);
    }
    private preview!: HTMLDivElement;
    private cardsContainer!: HTMLDivElement;
    private detailPanel!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    private focusIndex = -1;
    private previewConceptId: string | null = null;
    /** Dropdown is the ordinary default; cards are an explicit host choice. */
    private isDropdownMode = true;
    /** The native <select> element used in dropdown mode. */
    private dropdownEl: HTMLSelectElement | null = null;
    /** Companion field region for concepts that require an entered value. */
    private dropdownSupplement: HTMLDivElement | null = null;
    /**
     * An incomplete text choice stays in the control until it is a valid engine
     * fact.
     */
    private pendingText: { conceptId: string; value: string } | null = null;
    /** The current supplemental draft's canonical errors, never accepted facts. */
    private pendingTextErrors: readonly ValidationError[] = [];
    private textFocusSequence = 0;
    /** The primary category used for selection */
    private primaryCategory!: {
        id: string;
        label: string;
        single: boolean;
        required: boolean;
    };
    /** Full concept list for this category (never filtered) */
    private cardConcepts: Array<{
        conceptId: string;
        categoryId: string;
        name: string;
        description: string;
        textInput?: ConceptTextInput;
    }> = [];
    /**
     * Concept IDs currently allowed by the store's facet subscription. null =
     * show all.
     */
    private _allowedConceptIds: Set<string> | null = null;
    /**
     * Per-instance salt for aria-labelledby IDs. Without this, every
     * SingleSelect on the same page produces `select-card-label-0`,
     * `select-card-label-1`, etc., which collide when two instances render
     * simultaneously, a WCAG ID uniqueness violation. The salt is stable across
     * re-renders so aria-labelledby references stay valid after each
     * renderCards() call.
     */
    private _labelIdPrefix = Math.random().toString(36).slice(2, 8);

    protected override hasClearValue(): boolean {
        return super.hasClearValue() || this.pendingText !== null;
    }

    protected setup(): void {
        // Identify the primary category: explicit categoryId > first matching single-select category
        const singleCategory = this.resolveCategory(
            this.options.categoryId,
            this.options.scope,
        );
        if (!singleCategory) return;
        this.primaryCategory = {
            ...singleCategory,
            single: singleCategory.single === true,
            required: singleCategory.required === true,
        };

        // Build concept list, shared by both modes
        const categoryConcepts = this.scheme.concepts
            .filter((c) => c.categories.includes(singleCategory.id))
            .sort((a, b) => a.position - b.position);

        this.cardConcepts = categoryConcepts.map((c) => ({
            conceptId: c.id,
            categoryId: singleCategory.id,
            name: c.textInput ? c.name : (c.views['default'] ?? c.name),
            description: c.definition ?? c.name,
            textInput: c.textInput,
        }));

        // Inject styles (shared: dropdown rules live in the same sheet)
        this.injectComponentStyles(SINGLE_SELECT_CSS);

        // Check rendering mode
        const mode = (this.options as unknown as Record<string, unknown>)[
            'mode'
        ] as string | undefined;
        if (mode !== 'cards') {
            this.setupDropdown();
            return;
        }

        this.isDropdownMode = false;
        // Cards mode (explicit opt-in)

        // Preview bar
        this.preview = this.createPreviewBar();

        // Cards container
        this.cardsContainer = document.createElement('div');
        this.cardsContainer.className = 'select-cards';
        this.cardsContainer.setAttribute('role', 'radiogroup');
        this.cardsContainer.setAttribute(
            'aria-label',
            `Select ${singleCategory.label ?? 'option'}`,
        );
        this.container.appendChild(this.cardsContainer);

        // One stable explanation region replaces repeated prose in every
        // option. Its value follows hover/focus, then returns to the selection.
        this.detailPanel = document.createElement('div');
        this.detailPanel.className = 'select-detail';
        this.detailPanel.id = `select-detail-${this._labelIdPrefix}`;
        this.detailPanel.setAttribute('aria-live', 'polite');
        this.container.appendChild(this.detailPanel);

        // Announcer
        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        // Keyboard hints
        this.appendKeyboardHints([
            { keys: '\u2191/\u2193', action: 'navigate' },
            { keys: 'Enter/ ', action: 'select' },
            { keys: 'Esc', action: 'deselect' },
        ]);

        // Set initial focus index based on current assertions
        const selectedId = this.assertions.find(
            (a) => a.categoryId === this.primaryCategory.id,
        )?.conceptId;
        if (selectedId) {
            this.focusIndex = this.cardConcepts.findIndex(
                (c) => c.conceptId === selectedId,
            );
        }

        this.render();
    }

    /** Build the compact dropdown UI (mode="dropdown"). */
    private setupDropdown(): void {
        const select = document.createElement('select');
        select.className = 'select-dropdown';
        select.setAttribute(
            'aria-label',
            `Select ${this.primaryCategory.label ?? 'tier'}`,
        );

        // Blank placeholder option
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = `Select ${this.primaryCategory.label ?? 'tier'}\u2026`;
        select.appendChild(placeholder);

        // One option per concept (filtered list will be updated by _refreshAllowed later)
        for (const c of this._visibleConcepts) {
            const opt = document.createElement('option');
            opt.value = c.conceptId;
            opt.textContent = c.name;
            select.appendChild(opt);
        }

        // Reflect any pre-existing assertion
        const existing = this.assertions.find(
            (a) => a.categoryId === this.primaryCategory.id,
        );
        if (existing) select.value = existing.conceptId;

        select.addEventListener('change', () => {
            const val = select.value;
            if (!val) {
                this.deselectCurrent();
            } else {
                const entry = this.cardConcepts.find(
                    (concept) => concept.conceptId === val,
                );
                if (entry) this.selectEntry(entry);
            }
        });

        this.dropdownEl = select;
        const field = document.createElement('div');
        field.className = 'select-dropdown-field';
        field.appendChild(select);
        this.container.appendChild(field);
        this.dropdownSupplement = document.createElement('div');
        this.dropdownSupplement.className = 'select-dropdown-supplement';
        this.container.appendChild(this.dropdownSupplement);
        this.renderDropdown();
    }

    /**
     * Concepts that may be displayed, after applying the allow-list from the
     * store.
     */
    private get _visibleConcepts() {
        if (this._allowedConceptIds === null) return this.cardConcepts;
        return this.cardConcepts.filter((c) =>
            this._allowedConceptIds!.has(c.conceptId),
        );
    }

    /**
     * Apply the allowable concept set pushed from the store's facet
     * subscription. Called by the runtime after each marking commit, the store
     * runs suggest once for the whole marking and distributes per-category
     * slices here.
     *
     * `null`: engine has no suggest; fall back to showing all concepts. `[]`,
     * engine ran but this category has no available concepts (gated); show only
     * already-selected concepts so they remain deselectable.
     *
     * Single-select special case: when all returned suggestions have `selected:
     * true`; the engine is signaling "this category is committed, nothing new
     * to add" (the single-select restriction). That doesn't mean the options
     * are gated; it means the user already picked one. Treat this as show-all
     * so the user can still switch their selection.
     */
    applyAllowableOptions(options: Suggestion[] | null): void {
        // setup() bails early when no matching category exists in the current scheme.
        // Nothing to render; skip rather than crash on undefined cardsContainer / primaryCategory.
        if (!this.primaryCategory) return;
        if (options === null) {
            // Engine has no suggest: show all concepts unchanged.
            if (this._allowedConceptIds !== null) {
                this._allowedConceptIds = null;
                this.isDropdownMode
                    ? this.renderDropdown()
                    : this.renderCards();
            }
            return;
        }
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === this.primaryCategory.id)
                .map((a) => a.conceptId),
        );
        if (this.pendingText) selectedIds.add(this.pendingText.conceptId);
        const ownCatOptions = options.filter(
            (s) => s.categoryId === this.primaryCategory.id,
        );

        // When every returned suggestion for this category is marked selected:true,
        // the engine is saying "this concept is already committed, nothing new to add"
        // (the single-select restriction at work). Show all concepts so the user can
        // still switch their selection to an alternative.
        if (
            ownCatOptions.length > 0 &&
            ownCatOptions.every((s) => s.selected)
        ) {
            if (this._allowedConceptIds !== null) {
                this._allowedConceptIds = null;
                this.isDropdownMode
                    ? this.renderDropdown()
                    : this.renderCards();
            }
            return;
        }

        const newAllowed = new Set([
            ...ownCatOptions.map((s) => s.conceptId),
            ...selectedIds, // always keep selected visible so the user can deselect it
        ]);
        // Diff: skip re-render if the allowed set is identical.
        const prev = this._allowedConceptIds;
        if (
            prev !== null &&
            prev.size === newAllowed.size &&
            [...newAllowed].every((id) => prev.has(id))
        )
            return;
        this._allowedConceptIds = newAllowed;
        // Re-align focusIndex to the new visible list; reset if the focused concept disappeared.
        const focusedConceptId = this.cardConcepts[this.focusIndex]?.conceptId;
        this.focusIndex = focusedConceptId
            ? this._visibleConcepts.findIndex(
                  (c) => c.conceptId === focusedConceptId,
              )
            : -1;
        this.isDropdownMode ? this.renderDropdown() : this.renderCards();
    }

    destroy(): void {
        this.destroyClearButton();
        this.removeRuleErrors();
        this.pendingText = null;
        this.pendingTextErrors = [];
        this.dropdownEl = null;
        this.dropdownSupplement = null;
        this.container.innerHTML = '';
    }

    /** Reflect accepted host facts without replacing an unfinished text draft. */
    override setAssertions(assertions: Assertion[]): void {
        if (
            this.pendingText &&
            assertions.length === this.assertions.length &&
            assertions.every((assertion, index) =>
                sameAssertionState(this.assertions[index], assertion),
            )
        ) {
            // Only a complete state echo leaves the current read active. A
            // host provenance or metadata edit must invalidate it normally.
            this.assertions = [...assertions];
            this.render();
            return;
        }
        this.pendingText = null;
        this.pendingTextErrors = [];
        super.setAssertions(assertions);
    }

    /** Retain the canonical report for the supplemental input's own draft. */
    override updateValidationErrors(
        errors: ValidationError[],
        proposedFixes: readonly Fix[] = [],
        warnings: readonly Warning[] = [],
    ): void {
        this.pendingTextErrors = this.pendingText ? [...errors] : [];
        super.updateValidationErrors(errors, proposedFixes, warnings);
    }

    override async setValue(value: string): Promise<void> {
        this.pendingText = null;
        this.pendingTextErrors = [];
        await super.setValue(value);
    }

    protected render(): void {
        if (this.isDropdownMode) {
            this.renderDropdown();
            return;
        }
        this.preview.textContent = this.getRendered();
        this.renderCards();
    }

    protected override onAssertionsChanged(): void {
        if (!this.primaryCategory) {
            super.onAssertionsChanged();
            return;
        }
        const selected = this.assertions.find(
            (assertion) => assertion.categoryId === this.primaryCategory.id,
        );
        if (
            this.pendingText &&
            selected?.conceptId === this.pendingText.conceptId &&
            selected.value !== undefined
        ) {
            this.pendingText = null;
            this.pendingTextErrors = [];
        }
        super.onAssertionsChanged();
    }

    private selectedConceptId(): string | undefined {
        return (
            this.pendingText?.conceptId ??
            this.assertions.find(
                (assertion) => assertion.categoryId === this.primaryCategory.id,
            )?.conceptId
        );
    }

    private selectEntry(entry: (typeof this.cardConcepts)[number]): void {
        if (!entry.textInput) {
            this.pendingText = null;
            this.pendingTextErrors = [];
            this.addAssertion(entry.conceptId, this.primaryCategory.id);
            return;
        }
        const selected = this.assertions.find(
            (assertion) => assertion.categoryId === this.primaryCategory.id,
        );
        if (selected?.conceptId === entry.conceptId) {
            this.render();
            return;
        }
        this.pendingTextErrors = [];
        this.pendingText = { conceptId: entry.conceptId, value: '' };
        if (selected)
            this.removeAssertion(selected.conceptId, selected.categoryId);
        else this.render();
    }

    /**
     * Rebuild dropdown options from the current visible (allowed) concept list
     * and sync selected value.
     */
    private renderDropdown(): void {
        if (!this.dropdownEl) return;
        const selected = this.assertions.find(
            (a) => a.categoryId === this.primaryCategory.id,
        );

        // Rebuild options so filtered-out concepts disappear.
        const existingValues = new Set(
            Array.from(this.dropdownEl.options)
                .slice(1)
                .map((o) => o.value),
        );
        const visibleValues = new Set(
            this._visibleConcepts.map((c) => c.conceptId),
        );
        const needsRebuild =
            existingValues.size !== visibleValues.size ||
            [...existingValues].some((v) => !visibleValues.has(v));
        if (needsRebuild) {
            this.dropdownEl.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = `Select ${this.primaryCategory.label ?? 'tier'}…`;
            this.dropdownEl.appendChild(placeholder);
            for (const c of this._visibleConcepts) {
                const opt = document.createElement('option');
                opt.value = c.conceptId;
                opt.textContent = c.name;
                this.dropdownEl.appendChild(opt);
            }
        }
        this.dropdownEl.value =
            this.pendingText?.conceptId ?? selected?.conceptId ?? '';

        this.dropdownSupplement?.replaceChildren();
        const entry = this.cardConcepts.find(
            (concept) => concept.conceptId === this.dropdownEl?.value,
        );
        if (entry?.textInput && this.dropdownSupplement) {
            this.appendTextInput(entry, this.dropdownSupplement, true);
        }
    }

    private renderCards(): void {
        this.cardsContainer.innerHTML = '';

        const selectedConceptId = this.selectedConceptId();
        const categoryColor = this.getCategoryColor(this.primaryCategory.id);
        const visible = this._visibleConcepts;

        visible.forEach((entry, i) => {
            const isSelected = entry.conceptId === selectedConceptId;
            const isFocused = i === this.focusIndex;

            const card = document.createElement('div');
            card.className = 'select-card';
            card.setAttribute('role', 'radio');
            card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            // Roving tabindex: follow the explicit focus position when set; otherwise
            // land on the selected card so a keyboard user tabs directly to their
            // current value. Fall back to card 0 when nothing is selected yet.
            const isDefaultTabStop =
                this.focusIndex === -1 &&
                (selectedConceptId
                    ? entry.conceptId === selectedConceptId
                    : i === 0);
            card.tabIndex = isFocused || isDefaultTabStop ? 0 : -1;
            card.dataset.index = String(i);
            const labelId = `select-card-label-${this._labelIdPrefix}-${i}`;

            // The host owns presentation, so its per-concept override precedes
            // the portable scheme default.
            const concept = this.scheme.concepts.find(
                (c) => c.id === entry.conceptId,
            );
            const authority = resolveMarkingColor(
                { colorFrom: this.colorFrom },
                [
                    {
                        conceptId: entry.conceptId,
                        categoryId: entry.categoryId,
                        color: concept?.color,
                    },
                ],
                this.scheme,
            );
            const colors:
                | { background: string; text: string; border?: string }
                | undefined =
                this.options.colorMap?.[entry.conceptId] ?? authority;
            if (colors) {
                card.dataset.color = '';
                card.style.setProperty('--card-bg', colors.background);
                card.style.setProperty('--card-text', colors.text);
                if (colors.border) {
                    card.style.setProperty('--card-border', colors.border);
                }
            }

            // Color indicator
            const indicator = document.createElement('div');
            indicator.className = 'select-card-indicator';
            if (isSelected) {
                indicator.style.setProperty(
                    '--ez-indicator-bg',
                    colors?.border ??
                        colors?.background ??
                        'var(--ez-color-primary, ' + categoryColor + ')',
                );
                indicator.classList.add('select-card-indicator--active');
            }
            card.appendChild(indicator);

            // Content
            const content = document.createElement('div');
            content.className = 'select-card-content';

            const label = document.createElement('div');
            label.className = 'select-card-label';
            label.id = labelId;
            label.textContent = entry.name;
            content.appendChild(label);

            // Keep a per-option accessible description while rendering the
            // prose only once in the shared detail panel.
            const descText = this.getShortDescription(entry);
            const descId = `select-card-desc-${this._labelIdPrefix}-${i}`;
            if (descText) {
                const desc = document.createElement('div');
                desc.className = 'select-card-sr-desc';
                desc.id = descId;
                desc.textContent = descText;
                content.appendChild(desc);
                card.setAttribute('aria-labelledby', labelId);
                card.setAttribute('aria-describedby', descId);
            } else {
                card.setAttribute('aria-labelledby', labelId);
            }

            card.appendChild(content);

            // Checkmark
            const check = document.createElement('div');
            check.className = 'select-card-check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '\u2713';
            card.appendChild(check);

            // Events
            card.addEventListener('click', () => this.selectCard(i));
            card.addEventListener('keydown', (e) => this.onCardKeydown(e, i));
            card.addEventListener('mouseenter', () => {
                if (isSelected) return;
                this.previewConceptId = entry.conceptId;
                this.renderDetail();
            });
            card.addEventListener('mouseleave', () => {
                if (this.previewConceptId !== entry.conceptId) return;
                this.previewConceptId = null;
                this.renderDetail();
            });
            card.addEventListener('focus', () => {
                if (isSelected) return;
                this.previewConceptId = entry.conceptId;
                this.renderDetail();
            });
            card.addEventListener('blur', () => {
                if (this.previewConceptId !== entry.conceptId) return;
                this.previewConceptId = null;
                this.renderDetail();
            });

            this.cardsContainer.appendChild(card);
        });

        this.renderDetail();
    }

    /** Render the selected choice's help, temporarily overridden by hover/focus. */
    private renderDetail(): void {
        this.detailPanel.replaceChildren();
        const selectedConceptId = this.selectedConceptId();
        const detailConceptId = this.previewConceptId ?? selectedConceptId;
        const entry = this._visibleConcepts.find(
            (concept) => concept.conceptId === detailConceptId,
        );

        if (!entry) {
            const prompt = document.createElement('div');
            prompt.className = 'select-detail-prompt';
            prompt.textContent = `Select ${this.primaryCategory.label ?? 'an option'} to see its details.`;
            this.detailPanel.appendChild(prompt);
            this.detailPanel.dataset.state = 'empty';
            return;
        }

        this.detailPanel.dataset.state =
            entry.conceptId === selectedConceptId ? 'selected' : 'preview';

        const heading = document.createElement('div');
        heading.className = 'select-detail-heading';
        heading.textContent = entry.name;
        this.detailPanel.appendChild(heading);

        const description = this.getShortDescription(entry);
        if (description) {
            const body = document.createElement('div');
            body.className = 'select-detail-description';
            body.textContent = description;
            this.detailPanel.appendChild(body);
        }

        // A text value belongs to the selected choice, including its local
        // draft, not a transient hover preview.
        if (entry.textInput && entry.conceptId === selectedConceptId) {
            this.appendTextInput(entry, this.detailPanel);
        }
    }

    private appendTextInput(
        entry: (typeof this.cardConcepts)[number],
        target: HTMLElement,
        showLabel = false,
    ): void {
        if (!entry.textInput) return;
        const inputWrap = document.createElement('div');
        inputWrap.className = 'select-card-text-input';

        const inputId = `select-text-${this._labelIdPrefix}`;
        if (showLabel) {
            const label = document.createElement('label');
            label.className = 'select-card-text-label';
            label.htmlFor = inputId;
            label.textContent = entry.textInput.label ?? entry.name;
            inputWrap.appendChild(label);
        }

        const textField = document.createElement('input');
        textField.type = 'text';
        textField.id = inputId;
        textField.className = 'select-card-text-field';
        textField.placeholder = entry.textInput.placeholder ?? '';
        textField.setAttribute(
            'aria-label',
            entry.textInput.label ?? entry.name,
        );
        applyTextInputAttributes(textField, entry.textInput);

        const existingAssertion = this.assertions.find(
            (a) => a.conceptId === entry.conceptId,
        );
        if (this.pendingText?.conceptId === entry.conceptId)
            textField.value = this.pendingText.value;
        else if (existingAssertion?.value)
            textField.value = existingAssertion.value;

        const errorEl = document.createElement('div');
        errorEl.className = 'select-card-text-error';
        errorEl.setAttribute('role', 'alert');
        errorEl.id = `${inputId}-error`;
        textField.setAttribute('aria-describedby', errorEl.id);

        const isRequired = entry.textInput.required !== false;
        const formEl = this.container.closest('[data-ezclassify-mount]')
            ?.previousElementSibling as
            HTMLSelectElement | HTMLInputElement | null;

        const validateField = () => {
            const value = textField.value.trim();
            let error = '';
            if (isRequired && !value) {
                error = 'Required';
            } else if (value && !textField.validity.valid) {
                error = `Invalid format. Expected: ${entry.textInput!.placeholder ?? 'the required value format'}`;
            }
            // Parent marking reports stay on the parent. A facet's unfinished
            // input has its own canonical reading, which cannot be published.
            const draftErrors =
                this.pendingText?.conceptId === entry.conceptId
                    ? this.pendingTextErrors
                    : [];
            const canonicalError = draftErrors
                .map((item) => item.message)
                .join('\n');
            const message =
                this.options.facetOf && canonicalError ? canonicalError : error;
            textField.classList.toggle(
                'select-card-text-field--invalid',
                Boolean(message || canonicalError),
            );
            if (message || canonicalError) {
                textField.setAttribute('aria-invalid', 'true');
            } else {
                textField.removeAttribute('aria-invalid');
            }
            errorEl.textContent = message;
            errorEl.classList.toggle(
                'select-card-text-error--visible',
                Boolean(message),
            );
            if (
                formEl &&
                'setCustomValidity' in formEl &&
                typeof formEl.setCustomValidity === 'function'
            ) {
                formEl.setCustomValidity(message || canonicalError);
            }
            return !error;
        };

        textField.addEventListener('input', () => {
            const focusSequence = ++this.textFocusSequence;
            const hadFocus = document.activeElement === textField;
            this.pendingTextErrors = [];
            this.pendingText = {
                conceptId: entry.conceptId,
                value: textField.value,
            };
            const valid = validateField();
            const caret = textField.selectionStart;
            const assertion = this.assertions.find(
                (a) => a.conceptId === entry.conceptId,
            );
            if (valid) {
                if (assertion) {
                    const edited: Assertion = {
                        ...assertion,
                        value: textField.value,
                        source: 'user',
                        confidence: 'certain',
                    };
                    delete edited.sourceRule;
                    this.assertions = this.assertions.map((current) =>
                        current === assertion ? edited : current,
                    );
                    this.reprocess();
                } else {
                    this.addAssertion(
                        entry.conceptId,
                        this.primaryCategory.id,
                        textField.value,
                    );
                }
            } else if (assertion) {
                this.removeAssertion(assertion.conceptId, assertion.categoryId);
            }
            // Synchronous engines can replace the field as soon as a complete
            // value is processed or a committed value is cleared.
            const focusAfterEdit = document.activeElement;
            requestAnimationFrame(() => {
                if (
                    !hadFocus ||
                    focusSequence !== this.textFocusSequence ||
                    document.activeElement !== focusAfterEdit
                ) {
                    return;
                }
                const next = target.querySelector<HTMLInputElement>(
                    '.select-card-text-field',
                );
                if (!next) return;
                next.focus();
                if (caret !== null) next.setSelectionRange(caret, caret);
            });
        });
        textField.addEventListener('blur', validateField);
        inputWrap.append(textField, errorEl);
        if (
            existingAssertion?.value ||
            this.pendingText?.conceptId === entry.conceptId
        )
            validateField();
        target.appendChild(inputWrap);
    }

    /** Extract a short user-facing description for a concept */
    private getShortDescription(entry: {
        conceptId: string;
        description: string;
    }): string {
        // Delegate to base class for standard description resolution
        const baseDesc = this.getConceptDescription(entry.conceptId);
        if (baseDesc) return baseDesc;

        // Check label presets for a matching description (SingleSelect-specific)
        const concept = this.scheme.concepts.find(
            (c) => c.id === entry.conceptId,
        );
        const defaultView = concept?.views['default'] ?? '';
        const match = this.scheme.labelPresets.find(
            (p) =>
                p.id === entry.conceptId.toLowerCase().replace(/_/g, '-') ||
                p.label === defaultView,
        );
        if (match?.description) return match.description;

        return '';
    }

    private selectCard(index: number): void {
        const entry = this._visibleConcepts[index];
        if (!entry) return;

        this.focusIndex = index;
        if (this.selectedConceptId() === entry.conceptId) {
            // Already selected; clicking again does nothing (use Escape to deselect)
            this.renderCards();
            return;
        }

        this.selectEntry(entry);
        announce(this.announcer, `Selected ${entry.name}`);

        // Focus the newly selected card
        const cardEl = this.cardsContainer.querySelector(
            `[data-index="${index}"]`,
        ) as HTMLElement;
        cardEl?.focus();
    }

    private deselectCurrent(): void {
        if (this.primaryCategory.required) return; // Cannot deselect if category is required

        this.pendingText = null;
        this.pendingTextErrors = [];
        const current = this.assertions.find(
            (a) => a.categoryId === this.primaryCategory.id,
        );
        if (current) {
            this.removeAssertion(current.conceptId, current.categoryId);
            announce(this.announcer, 'Selection cleared');
        } else this.render();
    }

    private onCardKeydown(e: KeyboardEvent, currentIndex: number): void {
        const total = this._visibleConcepts.length;
        let handled = true;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowRight': {
                const next = (currentIndex + 1) % total;
                this.selectCard(next);
                break;
            }
            case 'ArrowUp':
            case 'ArrowLeft': {
                const prev = (currentIndex - 1 + total) % total;
                this.selectCard(prev);
                break;
            }
            case 'Enter':
            case ' ':
            case 'Spacebar': // legacy key name for older browsers
                this.selectCard(currentIndex);
                break;
            case 'Escape':
                this.deselectCurrent();
                break;
            case 'Home': {
                this.focusIndex = 0;
                this.renderCards();
                const el = this.cardsContainer.querySelector(
                    '[data-index="0"]',
                ) as HTMLElement;
                el?.focus();
                break;
            }
            case 'End': {
                this.focusIndex = total - 1;
                this.renderCards();
                const el = this.cardsContainer.querySelector(
                    `[data-index="${total - 1}"]`,
                ) as HTMLElement;
                el?.focus();
                break;
            }
            default:
                handled = false;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
}

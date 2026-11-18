/**
 * Category Checklist Component
 *
 * For a specific category, shows a list of checkboxes (one per concept).
 * Multi-select. Shows a count of selected items ("7 of 18"). Think "which of
 * these 18 identifiers are present?"
 *
 * Supports filtering/searching via a search input at the top, and a "select all
 * / clear all" toggle. The search input shows when the list is longer than the
 * room it is given (it scrolls), or while it holds a filter.
 */

import { ComponentBase, type ComponentOptions } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import type { ConceptView, Suggestion } from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import categoryChecklistCss from './category-checklist.css?inline';
import { focusGridNeighbor } from './focus-grid';

const CATEGORY_CHECKLIST_CSS: string = categoryChecklistCss;

/** Options accepted by category checklist operations. */
export interface CategoryChecklistOptions extends ComponentOptions {
    /** Which category to display. Required. */
    categoryId: string;
    /**
     * Show a search/filter input: always (true) or never (false). Default: when
     * the list is longer than its room, and while a filter is typed.
     */
    showSearch?: boolean;
    /** Show a "select all / clear all" toggle. Default: true */
    showToggleAll?: boolean;
    /**
     * Show only the category's concepts that list this concept id among their
     * parents, for a checklist of one branch of a category tree. Set from
     * `data-ezclassify-checklist-parent-concept="<concept id>"`. Default: every
     * concept in the category.
     */
    parentConcept?: string;
}

/**
 * Checkbox list for a single category, allowing multi-select of its concepts
 * with optional search filtering.
 */
export class CategoryChecklist extends ComponentBase {
    protected override clearButtonMount(): null {
        // The category header already owns its Clear all action.
        return null;
    }
    private preview!: HTMLDivElement;
    private headerEl!: HTMLDivElement;
    private countEl!: HTMLSpanElement;
    private searchInput!: HTMLInputElement;
    private listEl!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    /** Full concept list for this category (never filtered by availability) */
    private categoryConcepts: ConceptView[] = [];
    /** The category ID being displayed */
    private categoryId!: string;
    /** Current filter text */
    private filterText = '';
    /** The checkbox reached by the author; unset until the first interaction. */
    private activeConceptId: string | null = null;
    /**
     * Whether the search input shows: always, never, or when the list
     * overflows.
     */
    private searchMode: 'always' | 'never' | 'overflow' = 'overflow';
    /** Rechecks the list's overflow when its box changes size. */
    private listResize: ResizeObserver | null = null;
    /**
     * Concept IDs currently allowed by the store's facet subscription. null =
     * show all.
     */
    private _allowedConceptIds: Set<string> | null = null;

    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: CategoryChecklistOptions,
    ): Promise<void> {
        await super.init(container, engineOrContext, options);
    }

    protected setup(): void {
        const opts = this.options as CategoryChecklistOptions;

        if (!opts.categoryId) {
            throw new Error('CategoryChecklist requires a categoryId option');
        }
        this.categoryId = opts.categoryId;

        const category = this.scheme.categories.find(
            (f) => f.id === this.categoryId,
        );
        if (!category) {
            throw new Error(
                `Category "${this.categoryId}" not found in profile`,
            );
        }

        // Build concept list for this category, optionally filtered by parent concept
        const parentFilter = opts.parentConcept;
        this.categoryConcepts = this.scheme.concepts
            .filter((c) => {
                if (!c.categories.includes(this.categoryId)) return false;
                if (parentFilter && !c.parents.includes(parentFilter))
                    return false;
                return true;
            })
            .sort((a, b) => a.position - b.position);

        // Inject styles
        this.injectComponentStyles(CATEGORY_CHECKLIST_CSS);

        // Preview bar
        this.preview = this.createPreviewBar();

        // The control sits in the suite's field frame. Its first row: the
        // category's name, then the count, Select all and Clear all, and the
        // suite's status mark at the end. On a narrow field the name keeps its
        // line and the rest wraps beneath it as one unit.
        const frame = document.createElement('div');
        frame.className = 'category-checklist-frame';
        this.applySuiteFrame(frame);
        this.container.appendChild(frame);

        this.headerEl = document.createElement('div');
        this.headerEl.className = 'category-checklist-header';
        this.headerEl.addEventListener('keydown', this.onHeaderKeydown, true);

        const name = document.createElement('span');
        name.className = 'category-checklist-name';
        name.textContent = category.label;
        this.headerEl.appendChild(name);

        const controls = document.createElement('div');
        controls.className = 'category-checklist-controls';

        this.countEl = document.createElement('span');
        this.countEl.className = 'category-checklist-count';
        this.countEl.setAttribute('aria-live', 'polite');
        this.countEl.setAttribute('aria-atomic', 'true');
        controls.appendChild(this.countEl);

        // Toggle buttons
        const showToggle = opts.showToggleAll !== false;
        if (showToggle) {
            const toggleEl = document.createElement('div');
            toggleEl.className = 'category-checklist-toggle';

            const selectAll = document.createElement('button');
            selectAll.type = 'button';
            selectAll.textContent = 'Select all';
            selectAll.setAttribute(
                'aria-label',
                `Select all ${category.label}`,
            );
            selectAll.addEventListener('click', () => this.selectAll());
            toggleEl.appendChild(selectAll);

            const clearAll = document.createElement('button');
            clearAll.type = 'button';
            clearAll.textContent = 'Clear all';
            clearAll.setAttribute('aria-label', `Clear all ${category.label}`);
            clearAll.addEventListener('click', () => this.clearAll());
            toggleEl.appendChild(clearAll);

            controls.appendChild(toggleEl);
        }
        this.headerEl.appendChild(controls);
        // Clear all is this control's clear, so the chrome carries the mark.
        this.mountSuiteChrome(controls);

        // Search input
        this.searchMode =
            opts.showSearch === true
                ? 'always'
                : opts.showSearch === false
                  ? 'never'
                  : 'overflow';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.className = 'category-checklist-search';
        this.searchInput.placeholder = 'Filter\u2026';
        this.searchInput.setAttribute('aria-label', `Filter ${category.label}`);
        this.searchInput.addEventListener('input', () => {
            this.filterText = this.searchInput.value;
            this.renderList();
        });

        // Checkbox list
        this.listEl = document.createElement('div');
        this.listEl.className = 'category-checklist-list';
        this.listEl.setAttribute('role', 'group');
        this.listEl.tabIndex = -1;
        this.listEl.setAttribute('aria-label', category.label);
        frame.appendChild(this.listEl);
        if (this.searchMode !== 'never') frame.appendChild(this.searchInput);
        frame.appendChild(this.headerEl);
        if (
            this.searchMode === 'overflow' &&
            typeof ResizeObserver === 'function'
        ) {
            this.listResize = new ResizeObserver(() =>
                this.updateSearchVisibility(),
            );
            this.listResize.observe(this.listEl);
        }

        // Announcer
        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        this.render();
    }

    /**
     * Apply the allowable concept set pushed from the store's facet
     * subscription. The store runs suggest once per marking commit and calls
     * this with the filtered results for this component's category.
     *
     * `null`: engine has no suggest; show all. `[]`: engine ran, nothing
     * available for this category (gated); show only selected.
     */
    applyAllowableOptions(options: Suggestion[] | null): void {
        if (options === null) {
            if (this._allowedConceptIds !== null) {
                this._allowedConceptIds = null;
                this.renderList();
                this.updateCount();
            }
            return;
        }
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === this.categoryId)
                .map((a) => a.conceptId),
        );
        const newAllowed = new Set([
            ...options
                .filter((s) => s.categoryId === this.categoryId)
                .map((s) => s.conceptId),
            ...selectedIds, // always keep selected visible so the user can deselect it
        ]);
        const prev = this._allowedConceptIds;
        if (
            prev !== null &&
            prev.size === newAllowed.size &&
            [...newAllowed].every((id) => prev.has(id))
        )
            return;
        this._allowedConceptIds = newAllowed;
        this.renderList();
        this.updateCount();
    }

    destroy(): void {
        this._destroyed = true;
        this.headerEl?.removeEventListener(
            'keydown',
            this.onHeaderKeydown,
            true,
        );
        this.listResize?.disconnect();
        this.listResize = null;
        this.destroyClearButton();
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    /** Header actions share physical horizontal navigation, before chrome. */
    private readonly onHeaderKeydown = (event: KeyboardEvent): void => {
        if (
            event.key === 'ArrowDown' &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.isComposing &&
            !event.defaultPrevented &&
            (event.target ===
                this.suiteChrome?.status.querySelector('.ez-status-mark') ||
                event.target ===
                    this.suiteChrome?.element.querySelector(
                        '.ez-clear-button',
                    ) ||
                event.target ===
                    this.headerEl.querySelector(
                        '.category-checklist-toggle button:last-child',
                    ))
        ) {
            event.preventDefault();
            event.stopPropagation();
            (
                this.checkboxes().find((checkbox) => checkbox.tabIndex === 0) ??
                this.listEl
            ).focus({ preventScroll: true });
            return;
        }
        if (
            !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            event.keyCode === 229
        )
            return;
        const target =
            event.target instanceof Element
                ? event.target.closest('button')
                : null;
        const buttons = [
            ...this.headerEl.querySelectorAll<HTMLButtonElement>('button'),
        ].filter((button) => {
            if (
                button.disabled ||
                button.getAttribute('aria-disabled') === 'true'
            )
                return false;
            for (
                let node: HTMLElement | null = button;
                node;
                node = node.parentElement
            ) {
                const style = getComputedStyle(node);
                if (
                    node.hidden ||
                    style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse'
                )
                    return false;
                if (node === this.headerEl) break;
            }
            return true;
        });
        if (!buttons.includes(target as HTMLButtonElement)) return;
        event.preventDefault();
        event.stopPropagation();
        focusGridNeighbor(
            buttons,
            target as HTMLButtonElement,
            event.key as 'ArrowLeft' | 'ArrowRight',
        )?.focus();
    };

    protected render(): void {
        // Update preview
        if (this.options.showPreview) {
            this.preview.textContent = this.getRendered();
        }

        // A selected concept must always be visible, even when a prior
        // allowability push gated it out (same rule applyAllowableOptions
        // applies in the other order). Without this, an external publish that
        // selects a gated-out concept renders unchecked-and-hidden.
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === this.categoryId)
                .map((a) => a.conceptId),
        );
        if (this._allowedConceptIds !== null) {
            for (const id of selectedIds) this._allowedConceptIds.add(id);
        }

        // Update count badge
        this.updateCount();

        // If the list is already built and every selected concept has a
        // checkbox in the DOM, do a lightweight sync instead of a full rebuild
        // to preserve focus. A selected concept missing from the DOM (it was
        // filtered out before being selected externally) forces the rebuild.
        const domConceptIds = new Set(
            [
                ...this.listEl.querySelectorAll<HTMLInputElement>(
                    '.category-checklist-checkbox',
                ),
            ].map((cb) => cb.dataset.conceptId),
        );
        const domHasAllSelected = [...selectedIds].every((id) =>
            domConceptIds.has(id),
        );
        if (
            this.listEl.children.length > 0 &&
            !this.filterText &&
            domHasAllSelected
        ) {
            this.syncCheckboxStates();
            this.updateTabStop();
        } else {
            this.renderList();
        }
    }

    /** Sync checkbox checked states and item classes without rebuilding the DOM */
    private syncCheckboxStates(): void {
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === this.categoryId)
                .map((a) => a.conceptId),
        );
        const checkboxes = this.listEl.querySelectorAll<HTMLInputElement>(
            '.category-checklist-checkbox',
        );
        for (const cb of checkboxes) {
            const conceptId = cb.dataset.conceptId;
            if (!conceptId) continue;
            const shouldBeChecked = selectedIds.has(conceptId);
            if (cb.checked !== shouldBeChecked) cb.checked = shouldBeChecked;
            const item = cb.closest('.category-checklist-item');
            if (item) {
                item.classList.toggle(
                    'category-checklist-item--checked',
                    shouldBeChecked,
                );
            }
        }
    }

    /** Update the count */
    private updateCount(): void {
        const visible =
            this._allowedConceptIds !== null
                ? this.categoryConcepts.filter((c) =>
                      this._allowedConceptIds!.has(c.id),
                  )
                : this.categoryConcepts;
        const total = visible.length;
        const selected = this.assertions.filter(
            (a) =>
                a.categoryId === this.categoryId &&
                visible.some((c) => c.id === a.conceptId),
        ).length;
        this.countEl.textContent = `${selected} of ${total}`;
    }

    /**
     * Show the search input when it helps: always or never when the host says
     * so, else while the list is longer than its room (it scrolls) or the input
     * is in use.
     */
    private updateSearchVisibility(): void {
        if (this._destroyed || this.searchMode !== 'overflow') return;
        const list = this.listEl;
        // A filter being typed or cleared keeps its input, and its focus.
        this.searchInput.hidden = !(
            this.filterText !== '' ||
            this.searchInput.ownerDocument.activeElement === this.searchInput ||
            list.scrollHeight > list.clientHeight + 1
        );
    }

    /** Render the checkbox list, filtered by search text and engine allowability */
    private renderList(): void {
        const before = this.checkboxes();
        const focused = before.find(
            (checkbox) => checkbox === document.activeElement,
        );
        const index = focused ? before.indexOf(focused) : -1;
        const groupFocused = document.activeElement === this.listEl;
        try {
            this.fillList();
            const after = this.checkboxes();
            const target = focused
                ? (after.find(
                      (checkbox) =>
                          checkbox.dataset.conceptId ===
                          focused.dataset.conceptId,
                  ) ?? after[Math.min(index, after.length - 1)])
                : undefined;
            if (target) this.activeConceptId = target.dataset.conceptId ?? null;
            this.updateTabStop();
            if (focused) (target ?? this.listEl).focus();
            else if (groupFocused)
                after.find((checkbox) => checkbox.tabIndex === 0)?.focus();
        } finally {
            this.updateSearchVisibility();
        }
    }

    private checkboxes(): HTMLInputElement[] {
        return [
            ...this.listEl.querySelectorAll<HTMLInputElement>(
                '.category-checklist-checkbox:not(:disabled)',
            ),
        ];
    }

    /** One native Tab stop, initially the first item, then the author's item. */
    private updateTabStop(): void {
        const checkboxes = this.checkboxes();
        const target =
            checkboxes.find(
                (checkbox) =>
                    checkbox.dataset.conceptId === this.activeConceptId,
            ) ?? checkboxes[0];
        for (const checkbox of checkboxes)
            checkbox.tabIndex = checkbox === target ? 0 : -1;
    }

    /** This checklist is a vertical list; horizontal arrows have no neighbor. */
    private onCheckboxKeydown(
        event: KeyboardEvent,
        checkbox: HTMLInputElement,
    ): void {
        if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            event.keyCode === 229
        )
            return;
        if (
            ![
                'Enter',
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
            ].includes(event.key)
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') {
            if (
                !this._destroyed &&
                !this.enhancedInput?.matches(':disabled, [readonly]')
            )
                checkbox.click();
            return;
        }
        const checkboxes = this.checkboxes();
        const index = checkboxes.indexOf(checkbox);
        if (event.key === 'ArrowUp' && index === 0) {
            this.suiteChrome?.status
                .querySelector<HTMLElement>('.ez-status-mark')
                ?.focus({ preventScroll: true });
            return;
        }
        const next =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? checkboxes.length - 1
                  : event.key === 'ArrowUp'
                    ? Math.max(0, index - 1)
                    : event.key === 'ArrowDown'
                      ? Math.min(checkboxes.length - 1, index + 1)
                      : index;
        checkboxes[next]?.focus();
    }

    private fillList(): void {
        this.listEl.innerHTML = '';

        // Apply engine availability filter first, then user text filter
        const available =
            this._allowedConceptIds !== null
                ? this.categoryConcepts.filter((c) =>
                      this._allowedConceptIds!.has(c.id),
                  )
                : this.categoryConcepts;
        const filtered = this.filterText
            ? available.filter(
                  (c) =>
                      this.fuzzyMatch(this.filterText, c.name) > 0 ||
                      this.fuzzyMatch(
                          this.filterText,
                          c.views['default'] ?? '',
                      ) > 0 ||
                      this.fuzzyMatch(this.filterText, c.id) > 0,
              )
            : available;

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'category-checklist-empty';
            empty.textContent = 'No matching items.';
            this.listEl.appendChild(empty);
            return;
        }

        // Selected concept IDs
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === this.categoryId)
                .map((a) => a.conceptId),
        );

        for (const concept of filtered) {
            const isChecked = selectedIds.has(concept.id);

            // The whole row is the checkbox's label, so a press anywhere on
            // it toggles the box. It labels the box it holds, not one found
            // by id: two checklists of a category share their ids. The native input keeps the semantics and
            // the focus; the box beside it is the library's own drawing, which
            // a host's input rules cannot repaint.
            const item = document.createElement('label');
            item.className =
                'category-checklist-item' +
                (isChecked ? ' category-checklist-item--checked' : '');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'category-checklist-checkbox';
            checkbox.id = `checklist-${this.categoryId}-${concept.id}`;
            checkbox.checked = isChecked;
            checkbox.dataset.conceptId = concept.id;
            checkbox.addEventListener('focus', () => {
                this.activeConceptId = concept.id;
                this.updateTabStop();
            });
            checkbox.addEventListener('keydown', (event) =>
                this.onCheckboxKeydown(event, checkbox),
            );

            checkbox.addEventListener('change', () => {
                this.activeConceptId = concept.id;
                if (checkbox.checked) {
                    this.addAssertion(concept.id, this.categoryId);
                    announce(
                        this.announcer,
                        `Selected ${concept.views['default'] ?? concept.name}`,
                    );
                } else {
                    this.removeAssertion(concept.id, this.categoryId);
                    announce(
                        this.announcer,
                        `Deselected ${concept.views['default'] ?? concept.name}`,
                    );
                }
                item.classList.toggle(
                    'category-checklist-item--checked',
                    checkbox.checked,
                );
                this.updateCount();
                this.updateTabStop();
            });

            const box = document.createElement('span');
            box.className = 'category-checklist-box';
            box.setAttribute('aria-hidden', 'true');
            box.innerHTML =
                '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';

            const label = document.createElement('span');
            label.className = 'category-checklist-label';
            label.textContent = concept.views['default'] ?? concept.name;
            this.attachConceptTitle(
                checkbox,
                concept.id,
                this.categoryId,
                undefined,
                label.textContent,
            );
            if (checkbox.title) item.title = checkbox.title;

            item.append(checkbox, box, label);
            this.listEl.appendChild(item);
        }
    }

    /** Select all currently-visible (allowed) concepts */
    private selectAll(): void {
        this.beginUserEdit();
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === this.categoryId)
                .map((a) => a.conceptId),
        );
        const available =
            this._allowedConceptIds !== null
                ? this.categoryConcepts.filter((c) =>
                      this._allowedConceptIds!.has(c.id),
                  )
                : this.categoryConcepts;

        for (const concept of available) {
            if (!selectedIds.has(concept.id)) {
                this.assertions.push({
                    conceptId: concept.id,
                    categoryId: this.categoryId,
                    confidence: 'certain',
                    source: 'user',
                });
            }
        }

        this.reprocess();
        announce(this.announcer, `Selected all ${available.length} items`);
    }

    /** Clear all selected concepts in this category */
    private clearAll(): void {
        this.beginUserEdit();
        this.assertions = this.assertions.filter(
            (a) => a.categoryId !== this.categoryId,
        );

        void this.reprocessNow(true);
        announce(this.announcer, 'Cleared all selections');
    }
}

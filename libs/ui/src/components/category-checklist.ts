/**
 * Category Checklist Component
 *
 * For a specific category, shows a list of checkboxes (one per concept).
 * Multi-select. Shows a count of selected items ("7 of 18"). Think "which of
 * these 18 identifiers are present?"
 *
 * Supports filtering/searching via an optional search input at the top, and a
 * "select all / clear all" toggle.
 */

import { ComponentBase, type ComponentOptions } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import type { ConceptView, Suggestion } from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import categoryChecklistCss from './category-checklist.css?inline';

const CATEGORY_CHECKLIST_CSS: string = categoryChecklistCss;

/** Options accepted by category checklist operations. */
export interface CategoryChecklistOptions extends ComponentOptions {
    /** Which category to display. Required. */
    categoryId: string;
    /** Show a search/filter input. Default: true */
    showSearch?: boolean;
    /** Show a "select all / clear all" toggle. Default: true */
    showToggleAll?: boolean;
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
        const parentFilter = (opts as unknown as Record<string, unknown>)
            .parentConcept as string | undefined;
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

        // Header: category label + count badge + toggle buttons
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'category-checklist-header';

        const heading = document.createElement('h3');
        heading.textContent = category.label;
        this.headerEl.appendChild(heading);

        this.countEl = document.createElement('span');
        this.countEl.className = 'category-checklist-count';
        this.countEl.setAttribute('aria-live', 'polite');
        this.countEl.setAttribute('aria-atomic', 'true');
        this.headerEl.appendChild(this.countEl);

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

            this.headerEl.appendChild(toggleEl);
        }

        this.container.appendChild(this.headerEl);

        // Search input
        const showSearch = opts.showSearch !== false;
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.className = 'category-checklist-search';
        this.searchInput.placeholder = 'Filter\u2026';
        this.searchInput.setAttribute('aria-label', `Filter ${category.label}`);
        this.searchInput.addEventListener('input', () => {
            this.filterText = this.searchInput.value;
            this.renderList();
        });
        if (showSearch) {
            this.container.appendChild(this.searchInput);
        }

        // Checkbox list
        this.listEl = document.createElement('div');
        this.listEl.className = 'category-checklist-list';
        this.listEl.setAttribute('role', 'group');
        this.listEl.setAttribute('aria-label', category.label);
        this.container.appendChild(this.listEl);

        // Progress bar
        const progress = document.createElement('div');
        progress.className = 'category-checklist-progress';
        const progressFill = document.createElement('div');
        progressFill.className = 'category-checklist-progress-fill';
        progress.appendChild(progressFill);
        this.container.appendChild(progress);

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
        this.destroyClearButton();
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

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

    /** Update the count badge and progress bar */
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
        this.countEl.classList.toggle(
            'category-checklist-count--zero',
            selected === 0,
        );

        // Update progress bar if present
        const fill = this.container.querySelector(
            '.category-checklist-progress-fill',
        ) as HTMLDivElement | null;
        if (fill) {
            fill.style.width =
                total > 0 ? `${(selected / total) * 100}%` : '0%';
        }
    }

    /** Render the checkbox list, filtered by search text and engine allowability */
    private renderList(): void {
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

            const item = document.createElement('div');
            item.className =
                'category-checklist-item' +
                (isChecked ? ' category-checklist-item--checked' : '');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'category-checklist-checkbox';
            checkbox.id = `checklist-${this.categoryId}-${concept.id}`;
            checkbox.checked = isChecked;
            checkbox.setAttribute(
                'aria-label',
                concept.views['default'] ?? concept.name,
            );
            checkbox.dataset.conceptId = concept.id;

            checkbox.addEventListener('change', () => {
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
                this.updateCount();
            });

            const label = document.createElement('label');
            label.className = 'category-checklist-label';
            label.htmlFor = checkbox.id;
            label.textContent = concept.views['default'] ?? concept.name;

            item.appendChild(checkbox);
            item.appendChild(label);
            this.listEl.appendChild(item);
        }
    }

    /** Select all currently-visible (allowed) concepts */
    private selectAll(): void {
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
        this.assertions = this.assertions.filter(
            (a) => a.categoryId !== this.categoryId,
        );

        void this.reprocessNow(true);
        announce(this.announcer, 'Cleared all selections');
    }
}

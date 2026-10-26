/**
 * Category Selector Component
 *
 * For multi-category composition profiles, shows a row of buttons per category.
 * Each row is labeled with the category name and has one button per concept in
 * that category. Single-select categories enforce radio behavior (one selection
 * per row). Multi-select categories allow multiple selections (toggle
 * behavior).
 *
 * Supports grouping categories under headings via `categoryGroups` option, and
 * an optional preview bar showing the rendered marking string.
 */

import { ComponentBase, type ComponentOptions } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import type { CategoryView, ConceptView, Suggestion } from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import categorySelectorCss from './category-selector.css?inline';

const CATEGORY_SELECTOR_CSS: string = categorySelectorCss;

/** Options accepted by category selector operations. */
export interface CategorySelectorOptions extends ComponentOptions {
    /**
     * Group categories under headings. Map of group label to category IDs.
     * Ungrouped categories appear at the end.
     */
    categoryGroups?: Record<string, string[]>;
    /**
     * Concept property to use for button labels. Default: 'label', fallback to
     * 'default'
     */
    labelProperty?: string;
    /** If true, show metric codes (short views) next to labels */
    showCodes?: boolean;
}

/** Internal representation of a category row */
interface CategoryRow {
    category: CategoryView;
    concepts: ConceptView[];
}

/**
 * Button-group component that lets users pick one concept per category,
 * rendered as rows of toggle buttons.
 */
export class CategorySelector extends ComponentBase {
    protected override clearButtonMount(): HTMLElement {
        return this.clearButtonFrame(this.bodyEl);
    }
    private preview!: HTMLDivElement;
    private bodyEl!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    /** Ordered category rows */
    private categoryRows: CategoryRow[] = [];
    /** Focus tracking: [rowIndex, buttonIndex] */
    private focusRow = 0;
    private focusCol = 0;
    /**
     * Concept IDs currently allowed by the store's facet subscription. null =
     * show all.
     */
    private _allowedConceptIds: Set<string> | null = null;

    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: CategorySelectorOptions,
    ): Promise<void> {
        await super.init(container, engineOrContext, options);
    }

    protected setup(): void {
        const _opts = this.options as CategorySelectorOptions;

        // Build category rows. When a specific categoryId is bound (facet-of usage), scope
        // to that one category only. Out-of-facet rows are never rendered and never commit.
        const boundCategoryId = _opts.categoryId;
        this.categoryRows = this.scheme.categories
            .filter((cat) => !boundCategoryId || cat.id === boundCategoryId)
            .map((category) => ({
                category,
                concepts: this.scheme.concepts
                    .filter((c) => c.categories.includes(category.id))
                    .sort((a, b) => a.position - b.position),
            }))
            .filter((row) => row.concepts.length > 0);

        // Inject styles
        this.injectComponentStyles(CATEGORY_SELECTOR_CSS);

        // Preview bar
        this.preview = this.createPreviewBar();

        // Body container
        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'category-selector-body';
        this.container.appendChild(this.bodyEl);

        // Announcer
        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        // Keyboard hints
        this.appendKeyboardHints([
            { keys: '\u2190/\u2192', action: 'navigate options' },
            { keys: '\u2191/\u2193', action: 'navigate rows' },
            { keys: 'Enter/ ', action: 'toggle' },
        ]);

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
                this.render();
            }
            return;
        }
        const selectedIds = new Set(this.assertions.map((a) => a.conceptId));
        const newAllowed = new Set([
            ...options.map((s) => s.conceptId),
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
        this.render();
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

        this.bodyEl.innerHTML = '';

        const opts = this.options as CategorySelectorOptions;
        const groups = opts.categoryGroups;

        if (groups && Object.keys(groups).length > 0) {
            this.renderGrouped(groups);
        } else {
            this.renderFlat();
        }
    }

    /** Render all category rows without grouping */
    private renderFlat(): void {
        for (let rowIdx = 0; rowIdx < this.categoryRows.length; rowIdx++) {
            this.bodyEl.appendChild(
                this.renderCategoryRow(this.categoryRows[rowIdx], rowIdx),
            );
        }
    }

    /** Render category rows grouped under headings */
    private renderGrouped(groups: Record<string, string[]>): void {
        const assigned = new Set<string>();
        let globalRowIdx = 0;

        for (const [groupLabel, categoryIds] of Object.entries(groups)) {
            const groupRows = categoryIds
                .map((fid) =>
                    this.categoryRows.find((r) => r.category.id === fid),
                )
                .filter((r): r is CategoryRow => r != null);

            if (groupRows.length === 0) continue;

            // Group heading
            const heading = document.createElement('div');
            heading.className = 'category-selector-group-heading';
            heading.textContent = groupLabel;
            heading.setAttribute('role', 'heading');
            heading.setAttribute('aria-level', '3');
            this.bodyEl.appendChild(heading);

            for (const row of groupRows) {
                this.bodyEl.appendChild(
                    this.renderCategoryRow(row, globalRowIdx),
                );
                assigned.add(row.category.id);
                globalRowIdx++;
            }
        }

        // Ungrouped categories at the end
        for (const row of this.categoryRows) {
            if (!assigned.has(row.category.id)) {
                this.bodyEl.appendChild(
                    this.renderCategoryRow(row, globalRowIdx),
                );
                globalRowIdx++;
            }
        }
    }

    /** Render a single category row */
    private renderCategoryRow(
        row: CategoryRow,
        rowIndex: number,
    ): HTMLDivElement {
        const opts = this.options as CategorySelectorOptions;
        const isSingle = row.category.single === true;
        const rowRole = isSingle ? 'radiogroup' : 'group';

        const rowEl = document.createElement('div');
        rowEl.className = 'category-selector-row';
        rowEl.setAttribute('role', rowRole);
        rowEl.setAttribute('aria-label', row.category.label);
        rowEl.dataset.categoryId = row.category.id;
        rowEl.dataset.rowIndex = String(rowIndex);

        // Label
        const label = document.createElement('div');
        label.className = 'category-selector-label';
        label.textContent = row.category.label;
        label.id = `category-label-${row.category.id}`;
        rowEl.setAttribute('aria-labelledby', label.id);
        rowEl.appendChild(label);

        // Options container
        const optionsEl = document.createElement('div');
        optionsEl.className = 'category-selector-options';

        const categoryColor = this.getCategoryColor(row.category.id);

        // Selected concept IDs for this category
        const selectedIds = new Set(
            this.assertions
                .filter((a) => a.categoryId === row.category.id)
                .map((a) => a.conceptId),
        );

        // Filter concepts to those currently allowed by the engine.
        const visibleConcepts =
            this._allowedConceptIds !== null
                ? row.concepts.filter((c) => this._allowedConceptIds!.has(c.id))
                : row.concepts;

        for (let colIdx = 0; colIdx < visibleConcepts.length; colIdx++) {
            const concept = visibleConcepts[colIdx];
            const isSelected = selectedIds.has(concept.id);
            const isFocused =
                rowIndex === this.focusRow && colIdx === this.focusCol;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className =
                'category-selector-btn' +
                (isSelected ? ' category-selector-btn--selected' : '');

            // Role and ARIA
            if (isSingle) {
                btn.setAttribute('role', 'radio');
                btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            } else {
                btn.setAttribute('role', 'checkbox');
                btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            }

            btn.tabIndex =
                isFocused ||
                (this.focusRow === rowIndex &&
                    this.focusCol === 0 &&
                    colIdx === 0)
                    ? 0
                    : -1;
            btn.dataset.rowIndex = String(rowIndex);
            btn.dataset.colIndex = String(colIdx);
            btn.dataset.conceptId = concept.id;
            btn.dataset.categoryId = row.category.id;

            // Color for selected state
            if (isSelected) {
                btn.style.setProperty('--category-btn-color', categoryColor);
                btn.style.setProperty(
                    '--category-btn-bg',
                    categoryColor + '20',
                );
            }

            // Label text
            const labelProp = opts.labelProperty ?? 'label';
            const labelText =
                concept.views[labelProp] ??
                concept.views['default'] ??
                concept.name;

            const labelSpan = document.createElement('span');
            labelSpan.textContent = labelText;
            btn.appendChild(labelSpan);

            // Optional code badge
            if (opts.showCodes) {
                const codeView =
                    concept.views['code'] ?? concept.views['short'];
                if (codeView && codeView !== labelText) {
                    const code = document.createElement('span');
                    code.className = 'category-selector-code';
                    code.textContent = codeView;
                    btn.appendChild(code);
                }
            }

            // Tooltip
            this.attachConceptTooltip(btn, concept.id, row.category.id);

            // Click handler
            btn.addEventListener('click', () => {
                this.focusRow = rowIndex;
                this.focusCol = colIdx;
                this.handleSelection(concept.id, row.category.id, isSelected);
            });

            // Keyboard handler
            btn.addEventListener('keydown', (e) =>
                this.onButtonKeydown(e, rowIndex, colIdx, row),
            );

            optionsEl.appendChild(btn);
        }

        rowEl.appendChild(optionsEl);
        return rowEl;
    }

    /** Handle button selection */
    private handleSelection(
        conceptId: string,
        categoryId: string,
        isSelected: boolean,
    ): void {
        const concept = this.scheme.concepts.find((c) => c.id === conceptId);
        const name = concept?.views['default'] ?? concept?.name ?? conceptId;

        if (isSelected) {
            this.removeAssertion(conceptId, categoryId);
            announce(this.announcer, `Deselected ${name}`);
        } else {
            // addAssertion still enforces at most one item in a single category.
            this.addAssertion(conceptId, categoryId);
            announce(this.announcer, `Selected ${name}`);
        }

        // Re-focus after render
        this.refocusButton();
    }

    /** Keyboard navigation within a category row */
    private onButtonKeydown(
        e: KeyboardEvent,
        rowIndex: number,
        colIndex: number,
        row: CategoryRow,
    ): void {
        // Use the filtered concept list (same filter as renderCategoryRow) for accurate totals.
        const visibleConcepts =
            this._allowedConceptIds !== null
                ? row.concepts.filter((c) => this._allowedConceptIds!.has(c.id))
                : row.concepts;
        const totalCols = visibleConcepts.length;
        const totalRows = this.categoryRows.length;
        let handled = true;

        switch (e.key) {
            case 'ArrowRight': {
                this.moveFocus(rowIndex, (colIndex + 1) % totalCols);
                break;
            }
            case 'ArrowLeft': {
                this.moveFocus(
                    rowIndex,
                    (colIndex - 1 + totalCols) % totalCols,
                );
                break;
            }
            case 'ArrowDown': {
                const nextRow = (rowIndex + 1) % totalRows;
                if (nextRow === rowIndex) {
                    // Single-row component: ArrowDown navigates to the next option in the row,
                    // matching the ARIA radiogroup pattern where both axis keys move between items.
                    this.moveFocus(rowIndex, (colIndex + 1) % totalCols);
                } else {
                    const downRow = this.categoryRows[nextRow];
                    const downVisible =
                        downRow && this._allowedConceptIds !== null
                            ? downRow.concepts.filter((c) =>
                                  this._allowedConceptIds!.has(c.id),
                              )
                            : (downRow?.concepts ?? []);
                    this.moveFocus(
                        nextRow,
                        Math.min(colIndex, (downVisible.length || 1) - 1),
                    );
                }
                break;
            }
            case 'ArrowUp': {
                const prevRow = (rowIndex - 1 + totalRows) % totalRows;
                if (prevRow === rowIndex) {
                    // Single-row component: ArrowUp navigates to the previous option in the row.
                    this.moveFocus(
                        rowIndex,
                        (colIndex - 1 + totalCols) % totalCols,
                    );
                } else {
                    const upRow = this.categoryRows[prevRow];
                    const upVisible =
                        upRow && this._allowedConceptIds !== null
                            ? upRow.concepts.filter((c) =>
                                  this._allowedConceptIds!.has(c.id),
                              )
                            : (upRow?.concepts ?? []);
                    this.moveFocus(
                        prevRow,
                        Math.min(colIndex, (upVisible.length || 1) - 1),
                    );
                }
                break;
            }
            case 'Enter':
            case ' ': {
                const concept = visibleConcepts[colIndex];
                if (concept) {
                    const isSelected = this.assertions.some(
                        (a) =>
                            a.conceptId === concept.id &&
                            a.categoryId === row.category.id,
                    );
                    this.handleSelection(
                        concept.id,
                        row.category.id,
                        isSelected,
                    );
                }
                break;
            }
            case 'Home': {
                this.moveFocus(rowIndex, 0);
                break;
            }
            case 'End': {
                this.moveFocus(rowIndex, totalCols - 1);
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

    /**
     * Move keyboard focus to a button at [newRow, newCol] without rebuilding
     * the entire DOM. Swaps tabIndex on the old and new buttons, then focuses
     * the new one. Used for pure navigation (no state change) so we avoid the
     * full render cycle, rebuilding innerHTML during a keydown event handler
     * creates a focus race where the focused element is removed from the DOM
     * and programmatic re-focus can be unreliable across browsers.
     */
    private moveFocus(newRow: number, newCol: number): void {
        const oldBtn = this.bodyEl.querySelector<HTMLElement>(
            `[data-row-index="${this.focusRow}"][data-col-index="${this.focusCol}"]`,
        );
        if (oldBtn) oldBtn.tabIndex = -1;

        this.focusRow = newRow;
        this.focusCol = newCol;

        const newBtn = this.bodyEl.querySelector<HTMLElement>(
            `[data-row-index="${this.focusRow}"][data-col-index="${this.focusCol}"]`,
        );
        if (newBtn) {
            newBtn.tabIndex = 0;
            newBtn.focus();
        }
    }

    /** Re-focus the button at the current focus position after a full render. */
    private refocusButton(): void {
        const btn = this.bodyEl.querySelector<HTMLElement>(
            `[data-row-index="${this.focusRow}"][data-col-index="${this.focusCol}"]`,
        );
        btn?.focus();
    }
}

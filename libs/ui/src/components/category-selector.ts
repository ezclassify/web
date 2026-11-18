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
 * an optional preview bar showing the rendered marking string. A host that
 * lists several scopes in `data-ezclassify-scope` gets the categories of each,
 * grouped under the scope's label when they fall in more than one.
 */

import { ComponentBase, type ComponentOptions } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import type {
    Assertion,
    CategoryView,
    ConceptView,
    Fix,
    Suggestion,
    ValidationError,
    Warning,
} from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import { fieldSurfaces, ownedElsewhere } from './composer/composer-port';
import { categoriesByScope, scopeLabel } from '../scopes';
import {
    NO_RULE_ERRORS,
    ruleErrorsFrom,
    type RuleErrorReport,
} from './rule-errors';
import { markingTarget } from './marking-target';
import { statedAssertions } from './composer/composer-controller';
import { focusGridNeighbor, type FocusGridArrow } from './focus-grid';
import { getMountHost } from '../mount-host-registry';
import { createChoiceButton } from './choice-button';
import { orderChoiceOptions, choiceBlockReason } from './choice-options';
import { t } from '../i18n';
import choiceButtonCss from './choice-button.css?inline';
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
    private preview!: HTMLDivElement;
    private bodyEl!: HTMLDivElement;
    private announcer!: HTMLDivElement;
    /** Ordered category rows */
    private categoryRows: CategoryRow[] = [];
    private rowsReady = false;
    private initialReport: {
        errors: readonly ValidationError[];
        proposedFixes: readonly Fix[];
        warnings: readonly Warning[];
    } | null = null;
    /**
     * The rows' categories by scope label, for a host that lists several scopes
     * whose categories fall in more than one of them; else null.
     */
    private scopeGroups: Record<string, string[]> | null = null;
    /** Each category keeps its own native Tab stop and last focused choice. */
    private readonly rowFocus = new Map<string, string>();
    private lastCategory = '';
    private reasonEl!: HTMLDivElement;
    private reasonConcept = '';
    private reasonInput = '';
    private reasonSequence = 0;
    /**
     * Concept IDs currently allowed by the store's facet subscription. null =
     * show all.
     */
    private _allowedConceptIds: Set<string> | null = null;
    private categoryReport: RuleErrorReport = NO_RULE_ERRORS;
    private categoryReportInput = '';
    private liveAllowed: Set<string> | null = null;
    private availabilitySequence = 0;
    private availabilityInput = '';
    private availabilityLoading: Promise<void> = Promise.resolve();
    private fixSequence = 0;
    private fixLoading: Promise<void> = Promise.resolve();
    private fixApplyAbort: AbortController | null = null;
    private fixReturnFocus = false;

    private reportInput(): string {
        return JSON.stringify([
            this.assertions,
            this.options.resolveFacetSiblings?.() ?? [],
            this.getProcessingContext(),
            (this.options.resolveParts?.() ?? []).filter((part) => part.trim()),
        ]);
    }

    override setAssertions(assertions: Assertion[]): void {
        super.setAssertions(assertions);
        this.withdrawStaleFixes();
    }

    private withdrawStaleFixes(): void {
        if (
            this.categoryReportInput &&
            this.categoryReportInput !== this.reportInput()
        ) {
            this.refreshFacetRefusal();
        }
    }

    protected override onAssertionsChanged(): void {
        super.onAssertionsChanged();
        void this.refreshAvailability();
    }

    /**
     * Multi-choice options are offered beside the choices already held, as in
     * the composer.
     */
    private refreshAvailability(): Promise<void> {
        const input = this.reportInput();
        if (input === this.availabilityInput) return this.availabilityLoading;
        this.availabilityInput = input;
        const sequence = ++this.availabilitySequence;
        const hasMultipleChoice = this.categoryRows.some(
            (row) =>
                row.category.single !== true &&
                this.assertions.some(
                    (assertion) => assertion.categoryId === row.category.id,
                ),
        );
        if (!hasMultipleChoice) {
            const changed = this.liveAllowed !== null;
            this.liveAllowed = null;
            this.availabilityLoading = Promise.resolve();
            if (changed) this.render();
            return Promise.resolve();
        }
        this.availabilityLoading = this.composerSuggestions([
            ...(this.options.resolveFacetSiblings?.() ?? []),
            ...this.assertions,
        ])
            .then((suggestions) => {
                if (
                    this._destroyed ||
                    sequence !== this.availabilitySequence ||
                    input !== this.reportInput()
                )
                    return;
                this.liveAllowed = new Set(
                    suggestions
                        .filter((suggestion) => !suggestion.gated)
                        .map((suggestion) => suggestion.conceptId),
                );
                this.render();
            })
            .catch(() => {
                if (
                    this._destroyed ||
                    sequence !== this.availabilitySequence ||
                    input !== this.reportInput()
                )
                    return;
                this.liveAllowed = null;
                this.render();
            });
        return this.availabilityLoading;
    }

    /** A facet reports canonical errors attached to the categories it displays. */
    protected override facetReport(
        errors?: readonly ValidationError[],
        proposedFixes: readonly Fix[] = [],
        _warnings: readonly Warning[] = [],
    ): RuleErrorReport {
        if (!this.rowsReady) {
            if (errors !== undefined)
                this.initialReport = {
                    errors,
                    proposedFixes,
                    warnings: _warnings,
                };
            return super.facetReport();
        }
        if (errors !== undefined) {
            const local = this.localErrors(errors);
            if (local.length > 0) this.loadWholeReport(local);
            else {
                ++this.fixSequence;
                this.parkFixFocus();
                this.categoryReport = NO_RULE_ERRORS;
                this.categoryReportInput = this.reportInput();
            }
        }
        const report =
            this.categoryReportInput === this.reportInput()
                ? this.categoryReport
                : NO_RULE_ERRORS;
        const refusal = super.facetReport();
        return {
            ...report,
            messages: [...new Set([...report.messages, ...refusal.messages])],
        };
    }

    private localErrors(errors: readonly ValidationError[]): ValidationError[] {
        const owns = (categoryId: string) =>
            this.categoryRows.some((row) => row.category.id === categoryId);
        return errors.filter(
            (error) =>
                (error.categoryId !== undefined && owns(error.categoryId)) ||
                error.affectedConcepts?.some((id) =>
                    this.scheme.concepts.some(
                        (concept) =>
                            concept.id === id && concept.categories.some(owns),
                    ),
                ),
        );
    }

    /** Every store commit reaches this hook, including unchanged facet slices. */
    override refreshFacetRefusal(): void {
        if (
            this.options.facetOf &&
            this.rowsReady &&
            this.categoryReportInput !== this.reportInput()
        )
            this.loadWholeReport();
        else super.refreshFacetRefusal();
    }

    private loadWholeReport(knownErrors?: readonly ValidationError[]): void {
        const sequence = ++this.fixSequence;
        const input = this.reportInput();
        this.parkFixFocus();
        this.categoryReport = ruleErrorsFrom(knownErrors ?? [], []);
        this.categoryReportInput = input;
        super.refreshFacetRefusal();
        const full = statedAssertions([
            ...(this.options.resolveFacetSiblings?.() ?? []),
            ...this.assertions,
        ]);
        this.fixLoading = Promise.resolve()
            .then(() =>
                this._destroyed ||
                sequence !== this.fixSequence ||
                input !== this.reportInput()
                    ? null
                    : this.callWholeProcess(full),
            )
            .then((result) => {
                if (
                    !result ||
                    this._destroyed ||
                    sequence !== this.fixSequence ||
                    input !== this.reportInput()
                )
                    return;
                const fullTarget = markingTarget(this)?.applyFix;
                const fixes = (result.proposedFixes ?? []).filter(
                    (fix) =>
                        fullTarget ||
                        [...fix.adds, ...fix.removes].every((ref) =>
                            this.categoryRows.some(
                                (row) => row.category.id === ref.categoryId,
                            ),
                        ),
                );
                this.categoryReport = ruleErrorsFrom(
                    knownErrors ?? this.localErrors(result.errors ?? []),
                    fixes,
                );
                super.refreshFacetRefusal();
            })
            .catch(() => {
                // Keep the known canonical errors when the whole proof cannot be obtained.
            });
    }

    protected override ruleFixHandler(): (fix: Fix) => void {
        const apply = super.ruleFixHandler();
        return (fix) => {
            if (
                this._destroyed ||
                (getMountHost(this.container) ?? this.enhancedInput)?.matches(
                    ':disabled, [readonly]',
                )
            )
                return;
            const active = document.activeElement;
            this.fixReturnFocus =
                this.bodyEl.contains(active) ||
                !!this.container.nextElementSibling?.contains(active);
            if (!this.options.facetOf) {
                apply(fix);
                return;
            }
            if (this.categoryReportInput !== this.reportInput()) {
                this.withdrawStaleFixes();
                return;
            }
            const fullTarget = markingTarget(this)?.applyFix;
            if (fullTarget) {
                this.parkFixFocus();
                this.fixApplyAbort?.abort();
                const abort = new AbortController();
                this.fixApplyAbort = abort;
                this.categoryReport = { ...this.categoryReport, fixes: [] };
                this.refreshFacetRefusal();
                const failed = (error: unknown) => {
                    if (!this._destroyed && !abort.signal.aborted)
                        announce(
                            this.announcer,
                            error instanceof Error
                                ? error.message
                                : String(error),
                        );
                };
                try {
                    void Promise.resolve(fullTarget(fix, abort.signal)).catch(
                        failed,
                    );
                } catch (error) {
                    failed(error);
                }
                return;
            }
            const owns = (ref: Fix['keeps'][number]) =>
                this.categoryRows.some(
                    (row) => row.category.id === ref.categoryId,
                );
            // The runtime's facet binding publishes only these categories;
            // sibling facts remain owned by their existing store editors.
            apply({
                ...fix,
                keeps: fix.keeps.filter(owns),
                adds: fix.adds.filter(owns),
            });
        };
    }

    protected override focusAfterFix(pointerType?: string): void {
        const restore = this.fixReturnFocus;
        this.fixReturnFocus = false;
        if (restore && (!pointerType || pointerType === 'keyboard'))
            this.refocusButton();
    }

    private parkFixFocus(): void {
        const report = this.container?.nextElementSibling;
        if (
            report?.classList.contains('ez-validation-errors') &&
            report.contains(document.activeElement)
        )
            this.refocusButton();
    }

    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: CategorySelectorOptions,
    ): Promise<void> {
        await super.init(container, engineOrContext, options);
        await this.fixLoading;
        if (!this._destroyed) await this.refreshAvailability();
    }

    protected setup(): void {
        const _opts = this.options as CategorySelectorOptions;

        // Build category rows. A bound categoryId (facet-of usage) is that one
        // category, whose own declared scope decides where it lands. Otherwise
        // the rows are the categories of the scope the host writes: a category
        // of another scope has no place in this field's marking. A host that
        // lists several scopes gets each one's categories, scope by scope in
        // the scheme's declaration order, under the scope's label. Rows left
        // out are never rendered and never commit.
        const boundCategoryId = _opts.categoryId;
        const listed = _opts.scopes ?? [];
        const byScope =
            !boundCategoryId && listed.length > 1
                ? categoriesByScope(
                      this.scheme.categories,
                      listed,
                      this.schemeMeta,
                  )
                : null;
        this.scopeGroups =
            byScope && byScope.length > 1
                ? Object.fromEntries(
                      byScope.map((group) => [
                          scopeLabel(group.scope, this.schemeMeta),
                          group.categories.map((c) => c.id),
                      ]),
                  )
                : null;
        const { surface, defaultSurface } = fieldSurfaces(
            this.schemeMeta,
            this.formatId,
            _opts.scope,
        );
        const categories = byScope
            ? byScope.flatMap((group) => group.categories)
            : this.scheme.categories.filter((cat) =>
                  boundCategoryId
                      ? cat.id === boundCategoryId
                      : !ownedElsewhere(cat, surface, defaultSurface),
              );
        this.categoryRows = categories
            .map((category) => ({
                category,
                concepts: this.scheme.concepts
                    .filter((c) => c.categories.includes(category.id))
                    .sort((a, b) => a.position - b.position),
            }))
            .filter((row) => row.concepts.length > 0);
        this.rowsReady = true;

        // Inject styles
        this.injectComponentStyles(choiceButtonCss);
        this.injectComponentStyles(CATEGORY_SELECTOR_CSS);

        // Preview bar
        this.preview = this.createPreviewBar();

        // Body container
        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'category-selector-body';
        this.bodyEl.addEventListener('keydown', this.onHeaderKeydown, true);
        this.applySuiteFrame(this.bodyEl);
        this.container.appendChild(this.bodyEl);
        this.reasonEl = document.createElement('div');
        this.reasonEl.className = 'ez-choice-reason';
        this.reasonEl.setAttribute('role', 'status');
        this.reasonEl.hidden = true;
        this.container.appendChild(this.reasonEl);

        // Announcer
        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        this.render();
        if (this.initialReport) {
            const report = this.initialReport;
            this.initialReport = null;
            this.updateValidationErrors(
                [...report.errors],
                report.proposedFixes,
                report.warnings,
            );
        }
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
        this.bodyEl?.removeEventListener('keydown', this.onHeaderKeydown, true);
        this._destroyed = true;
        this.fixApplyAbort?.abort();
        this.destroyClearButton();
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    protected render(): void {
        if (this.reasonInput !== this.reportInput()) this.hideChoiceReason();
        const focused = document.activeElement;
        const option =
            focused instanceof HTMLButtonElement &&
            this.bodyEl.contains(focused) &&
            focused.classList.contains('category-selector-btn')
                ? focused
                : null;
        const chrome =
            focused instanceof HTMLButtonElement &&
            this.suiteChrome?.element.contains(focused)
                ? focused
                : null;
        // Update preview
        if (this.options.showPreview) {
            this.preview.textContent = this.getRendered();
        }

        this.bodyEl.innerHTML = '';

        const opts = this.options as CategorySelectorOptions;
        // The host's own grouping wins over the one by scope.
        const groups =
            opts.categoryGroups && Object.keys(opts.categoryGroups).length > 0
                ? opts.categoryGroups
                : this.scopeGroups;

        if (groups && Object.keys(groups).length > 0) {
            this.renderGrouped(groups);
        } else {
            this.renderFlat();
        }

        // The suite's chrome ends the control's first row, after the first
        // category's name (or the first group's heading).
        const firstRow = this.bodyEl.querySelector<HTMLElement>(
            '.category-selector-group-heading, .category-selector-head',
        );
        if (firstRow) {
            this.mountSuiteChrome(this.bodyEl, 'overlay', () =>
                this.bodyEl.querySelector<HTMLElement>(
                    '.category-selector-group-heading, .category-selector-head',
                ),
            );
            this.suiteChrome?.measure();
        }
        // Rebuilding the heading temporarily detaches the same chrome buttons.
        // Restore only the button whose native focus this render interrupted.
        if (
            chrome?.isConnected &&
            !chrome.matches(':disabled, [aria-disabled="true"]') &&
            (document.activeElement === document.body ||
                document.activeElement === chrome)
        )
            chrome.focus({ preventScroll: true });
        if (option) {
            const buttons = [
                ...this.bodyEl.querySelectorAll<HTMLButtonElement>(
                    '.category-selector-btn:not(:disabled)',
                ),
            ];
            const row = buttons.filter(
                (button) =>
                    button.dataset.categoryId === option.dataset.categoryId &&
                    button.getAttribute('aria-disabled') !== 'true',
            );
            const target =
                buttons.find(
                    (button) =>
                        button.dataset.conceptId === option.dataset.conceptId &&
                        button.dataset.categoryId === option.dataset.categoryId,
                ) ??
                row[
                    Math.min(Number(option.dataset.colIndex), row.length - 1)
                ] ??
                buttons.find(
                    (button) => button.getAttribute('aria-disabled') !== 'true',
                );
            if (target) {
                this.rememberOption(target);
                target.focus();
            }
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

        // The category's name, on its own line above its buttons. The control's
        // first line also carries the suite's chrome at its trailing end.
        const head = document.createElement('div');
        head.className = 'category-selector-head';
        const label = document.createElement('div');
        label.className = 'category-selector-label';
        label.textContent = row.category.label;
        label.id = `category-label-${row.category.id}`;
        rowEl.setAttribute('aria-labelledby', label.id);
        head.appendChild(label);
        rowEl.appendChild(head);

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
        const visibleConcepts = orderChoiceOptions(
            (this._allowedConceptIds !== null
                ? row.concepts.filter(
                      (concept) =>
                          this._allowedConceptIds!.has(concept.id) ||
                          this.liveAllowed?.has(concept.id),
                  )
                : row.concepts
            ).map((concept) => ({ concept })),
            this.scheme.concepts,
        ).map(({ concept }) => concept);
        const available = (concept: ConceptView) =>
            selectedIds.has(concept.id) ||
            isSingle ||
            this.liveAllowed === null ||
            this.liveAllowed.has(concept.id);
        const remembered = this.rowFocus.get(row.category.id);
        const current = visibleConcepts.find(
            (concept) => concept.id === remembered,
        );
        if (remembered && !current) this.rowFocus.delete(row.category.id);
        const stop =
            current ?? visibleConcepts.find(available) ?? visibleConcepts[0];

        for (let colIdx = 0; colIdx < visibleConcepts.length; colIdx++) {
            const concept = visibleConcepts[colIdx];
            const isSelected = selectedIds.has(concept.id);

            const labelProp = opts.labelProperty ?? 'label';
            const labelText =
                concept.views[labelProp] ??
                concept.views['default'] ??
                concept.name;
            const labelSpan = document.createElement('span');
            labelSpan.textContent = labelText;
            const btn = createChoiceButton(this.container.ownerDocument, {
                mode: isSingle ? 'radio' : 'checkbox',
                label: labelSpan,
                reference: {
                    conceptId: concept.id,
                    categoryId: row.category.id,
                },
                selected: isSelected,
                blocked: !available(concept),
                tabIndex: concept.id === stop?.id ? 0 : -1,
                className:
                    'category-selector-btn' +
                    (isSelected ? ' category-selector-btn--selected' : ''),
                onActivate: () =>
                    this.handleSelection(
                        concept.id,
                        row.category.id,
                        isSelected,
                    ),
                onExplainBlocked: () =>
                    void this.showChoiceReason(concept, row.category.id),
                onHideExplanation: () => {
                    if (this.reasonConcept === concept.id)
                        this.hideChoiceReason();
                },
            });
            btn.dataset.rowIndex = String(rowIndex);
            btn.dataset.colIndex = String(colIdx);
            if (isSelected) {
                btn.style.setProperty('--category-btn-color', categoryColor);
                btn.style.setProperty(
                    '--category-btn-bg',
                    categoryColor + '20',
                );
            }

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
            this.attachConceptTitle(
                btn,
                concept.id,
                row.category.id,
                undefined,
                labelText,
            );

            btn.addEventListener('focus', () => this.rememberOption(btn));

            // Keyboard handler
            btn.addEventListener('keydown', (e) =>
                this.onButtonKeydown(e, rowIndex, colIdx, row),
            );

            optionsEl.appendChild(btn);
        }

        rowEl.appendChild(optionsEl);
        return rowEl;
    }

    private hideChoiceReason(): void {
        ++this.reasonSequence;
        this.reasonConcept = '';
        if (this.reasonEl) this.reasonEl.hidden = true;
    }

    /**
     * Ask DecisionFlow's canonical what-if question without accepting the
     * blocked choice.
     */
    private async showChoiceReason(
        concept: ConceptView,
        categoryId: string,
    ): Promise<void> {
        const input = this.reportInput();
        const sequence = ++this.reasonSequence;
        this.reasonInput = input;
        this.reasonConcept = concept.id;
        this.reasonEl.hidden = false;
        this.reasonEl.textContent = '';
        let reason = t('composer.unavailable');
        try {
            const result = await this.callWholeProcess([
                ...(this.options.resolveFacetSiblings?.() ?? []),
                ...this.assertions,
                {
                    conceptId: concept.id,
                    categoryId,
                    source: 'user',
                    confidence: 'certain',
                },
            ]);
            reason = choiceBlockReason(
                result,
                concept.id,
                this.categoryReport.messages,
            );
        } catch {
            /* An unavailable explanation never authorizes a choice. */
        }
        if (
            this._destroyed ||
            sequence !== this.reasonSequence ||
            input !== this.reportInput()
        )
            return;
        this.reasonEl.textContent = `${concept.views[(this.options as CategorySelectorOptions).labelProperty ?? 'label'] ?? concept.views.default ?? concept.name} is not available: ${reason}`;
    }

    /** Handle button selection */
    private handleSelection(
        conceptId: string,
        categoryId: string,
        isSelected: boolean,
    ): void {
        if (
            this._destroyed ||
            this.enhancedInput?.matches(':disabled, [readonly]')
        )
            return;
        const row = this.categoryRows.find(
            (entry) => entry.category.id === categoryId,
        );
        const input = this.reportInput();
        const focused = document.activeElement;
        if (
            !isSelected &&
            row?.category.single !== true &&
            this.assertions.some(
                (assertion) => assertion.categoryId === categoryId,
            )
        ) {
            void this.refreshAvailability().then(() => {
                if (
                    this._destroyed ||
                    input !== this.reportInput() ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                if (
                    this.liveAllowed !== null &&
                    !this.liveAllowed.has(conceptId)
                )
                    return;
                this.applySelection(
                    conceptId,
                    categoryId,
                    false,
                    document.activeElement === focused,
                );
            });
            return;
        }
        this.applySelection(conceptId, categoryId, isSelected);
    }

    private applySelection(
        conceptId: string,
        categoryId: string,
        isSelected: boolean,
        restoreFocus = true,
    ): void {
        const button = [
            ...this.bodyEl.querySelectorAll<HTMLButtonElement>(
                '.category-selector-btn',
            ),
        ].find(
            (candidate) =>
                candidate.dataset.conceptId === conceptId &&
                candidate.dataset.categoryId === categoryId,
        );
        if (button) {
            this.rememberOption(button);
        }
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
        if (restoreFocus) this.refocusButton();
        this.withdrawStaleFixes();
    }

    /** Keyboard navigation within a category row */
    private onButtonKeydown(
        e: KeyboardEvent,
        rowIndex: number,
        _colIndex: number,
        row: CategoryRow,
    ): void {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing)
            return;
        const totalCols = this.bodyEl.querySelectorAll(
            `.category-selector-btn[data-category-id="${row.category.id}"]`,
        ).length;
        let handled = true;

        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
            case 'ArrowDown': {
                const current = e.currentTarget as HTMLButtonElement;
                const buttons = [
                    ...this.bodyEl.querySelectorAll<HTMLButtonElement>(
                        '.category-selector-btn:not(:disabled)',
                    ),
                ].filter(
                    (button) =>
                        button === current ||
                        button.getAttribute('aria-disabled') !== 'true',
                );
                const next = focusGridNeighbor(
                    buttons,
                    current,
                    e.key as FocusGridArrow,
                );
                if (!next && e.key === 'ArrowUp')
                    this.suiteChrome?.status
                        .querySelector<HTMLElement>('.ez-status-mark')
                        ?.focus({ preventScroll: true });
                if (next)
                    this.moveFocus(
                        Number(next.dataset.rowIndex),
                        Number(next.dataset.colIndex),
                    );
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
     * the entire DOM. Updates that category's Tab stop without removing the
     * other rows' stops, then focuses it. Used for pure navigation so we avoid
     * the full render cycle, rebuilding innerHTML during a keydown event
     * handler creates a focus race where the focused element is removed from
     * the DOM and programmatic re-focus can be unreliable across browsers.
     */
    private moveFocus(newRow: number, newCol: number): void {
        const newBtn = this.bodyEl.querySelector<HTMLButtonElement>(
            `[data-row-index="${newRow}"][data-col-index="${newCol}"]`,
        );
        if (newBtn) {
            this.rememberOption(newBtn);
            newBtn.focus();
        }
    }

    private rememberOption(target: HTMLButtonElement): void {
        const category = target.dataset.categoryId!;
        this.rowFocus.set(category, target.dataset.conceptId!);
        this.lastCategory = category;
        this.bodyEl
            .querySelectorAll<HTMLButtonElement>('.category-selector-btn')
            .forEach((button) => {
                if (button.dataset.categoryId === category)
                    button.tabIndex = button === target ? 0 : -1;
            });
    }

    /** Return to the last category's remembered or default Tab stop. */
    private readonly onHeaderKeydown = (event: KeyboardEvent): void => {
        if (
            event.key !== 'ArrowDown' ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            event.defaultPrevented
        )
            return;
        const target = event.target;
        if (
            target !==
                this.suiteChrome?.status.querySelector('.ez-status-mark') &&
            target !==
                this.suiteChrome?.element.querySelector('.ez-clear-button')
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        this.refocusButton();
    };

    private refocusButton(): void {
        const stops = [
            ...this.bodyEl.querySelectorAll<HTMLButtonElement>(
                '.category-selector-btn[tabindex="0"]',
            ),
        ];
        const btn =
            stops.find(
                (button) => button.dataset.categoryId === this.lastCategory,
            ) ?? stops[0];
        btn?.focus();
    }
}

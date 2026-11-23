/**
 * Category Checklist Component
 *
 * For a specific category, shows a list of checkboxes (one per concept).
 * Multi-select. Shows a count of selected items ("7 of 18"). Think "which of
 * these 18 identifiers are present?"
 *
 * Supports filtering/searching via a search input at the top and a bulk
 * checkbox. The search input shows when the list is longer than the room it is
 * given (it scrolls), or while it holds a filter.
 */

import {
    suspendNativeChoiceFallback,
    useAuthoredChoiceLabel,
} from '../native-control-host';
import { getMountHost } from '../mount-host-registry';
import { ComponentBase, type ComponentOptions } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import type { ConceptView, Suggestion } from '@ezclassify/types';
import type { ComponentEngineSource } from './component-base-readonly';
import categoryChecklistCss from './category-checklist.css?inline';
import {
    focusableFieldActions,
    focusGridNeighbor,
    focusGridRows,
    type FocusGridArrow,
} from './focus-grid';
import {
    ChoiceAvailability,
    choiceOrigins,
    type ChoiceOrigin,
} from './choice-options';
import { t } from '../i18n';
import { createFieldAction, type ToggleAction } from './clear-button';
import { chromeReach } from './field-chrome';

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
    private restoreFallback: (() => void) | null = null;

    protected override clearButtonMount(): null {
        // The bulk checkbox already clears selections.
        return null;
    }
    private preview!: HTMLDivElement;
    private headerEl!: HTMLDivElement;
    private countEl!: HTMLSpanElement;
    private bulkToggle?: ToggleAction;
    private actionsInline = false;
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
    private layoutResize: ResizeObserver | null = null;
    private readonly availability = new ChoiceAvailability();

    protected override onAssertionsChanged(): void {
        super.onAssertionsChanged();
        void this.refreshAvailability();
    }

    override refreshFacetRefusal(): void {
        super.refreshFacetRefusal();
        void this.refreshAvailability();
    }

    /** Ask the Runtime what it offers alongside the current checked choices. */
    private refreshAvailability(): Promise<void> {
        const needsLive =
            !this.availability.hasBaseline ||
            this.assertions.some((a) => a.categoryId === this.categoryId);
        const live = [
            ...(this.options.resolveFacetSiblings?.() ?? []),
            ...this.assertions,
        ];
        return this.availability.refresh(
            needsLive
                ? JSON.stringify([live, this.getProcessingContext()])
                : null,
            () => this.composerSuggestions(live),
            () => this.render(),
        );
    }

    private availableChoices() {
        return this.availability
            .choices(
                this.categoryId,
                this.categoryConcepts,
                (concept) => concept.id,
                choiceOrigins(this.assertions, this.categoryId),
            )
            .filter((choice) => !choice.blocked);
    }

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
        this.restoreFallback = suspendNativeChoiceFallback(
            this.container,
            this.options.resolveFacetJudgment,
            this.categoryId,
        );

        // Preview bar
        this.preview = this.createPreviewBar();

        // The title and the header actions can wrap onto separate lines.
        const frame = document.createElement('div');
        frame.className = 'category-checklist-frame';
        this.container.appendChild(frame);
        this.applySuiteFrame(frame, getMountHost(this.container));

        this.headerEl = document.createElement('div');
        this.headerEl.className = 'category-checklist-header';
        this.headerEl.addEventListener('keydown', this.onHeaderKeydown, true);

        const controls = document.createElement('div');
        controls.className = 'category-checklist-controls';

        this.countEl = document.createElement('span');
        this.countEl.className = 'category-checklist-count';
        this.countEl.setAttribute('aria-live', 'polite');
        this.countEl.setAttribute('aria-atomic', 'true');
        this.headerEl.appendChild(controls);
        const chrome = this.mountSuiteChrome(controls);
        if (opts.showToggleAll !== false) {
            const toggle = createFieldAction({
                mode: 'toggle',
                label: `Select all ${category.label}`,
                toggle: () => {
                    if (
                        !this._destroyed &&
                        !this.enhancedInput?.matches(':disabled, [readonly]')
                    ) {
                        if (this.bulkState() === 'all') this.clearAll();
                        else this.selectAll();
                    }
                    this.updateCount();
                },
            });
            toggle.element.classList.add('category-checklist-toggle');
            toggle.input.classList.add('category-checklist-master');
            chrome.element.appendChild(toggle.element);
            this.bulkToggle = toggle;
        }

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
        const hasHostLabel = useAuthoredChoiceLabel(
            this.listEl,
            this.container,
        );
        this.actionsInline = hasHostLabel;
        if (!hasHostLabel) {
            const name = document.createElement('span');
            name.className = 'category-checklist-name';
            name.textContent = category.label;
            this.headerEl.prepend(name);
        } else frame.classList.add('category-checklist-frame--host-label');
        frame.appendChild(this.listEl);
        if (this.searchMode !== 'never') frame.appendChild(this.searchInput);
        frame.appendChild(this.headerEl);
        frame.appendChild(this.countEl);
        const measureActions = () => {
            const size = `${chromeReach(this.listEl, chrome.element)}px`;
            const property = '--ez-checklist-actions-size';
            if (frame.style.getPropertyValue(property) !== size)
                frame.style.setProperty(property, size);
        };
        if (hasHostLabel) measureActions();
        if (
            (hasHostLabel || this.searchMode === 'overflow') &&
            typeof ResizeObserver === 'function'
        ) {
            this.layoutResize = new ResizeObserver(() => {
                if (hasHostLabel) measureActions();
                this.updateSearchVisibility();
            });
            if (hasHostLabel) this.layoutResize.observe(chrome.element);
            if (hasHostLabel || this.searchMode === 'overflow')
                this.layoutResize.observe(this.listEl);
        }

        // Announcer
        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        this.render();
        void this.refreshAvailability();
    }

    /**
     * Update the store's baseline. With a baseline, the checklist also asks
     * what the Runtime offers beside its checked items.
     *
     * `null` means the store has no answer, so show all metadata choices. `[]`
     * means no baseline choices, so show checked and live choices only.
     */
    applyAllowableOptions(options: Suggestion[] | null): void {
        if (!this.availability.updateBaseline(options)) return;
        void this.refreshAvailability();
        this.render();
    }

    destroy(): void {
        this.restoreFallback?.();
        this.restoreFallback = null;
        this._destroyed = true;
        this.availability.dispose();
        this.headerEl?.removeEventListener(
            'keydown',
            this.onHeaderKeydown,
            true,
        );
        this.layoutResize?.disconnect();
        this.layoutResize = null;
        this.destroyClearButton();
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    /** Header actions share physical horizontal navigation. */
    private readonly onHeaderKeydown = (event: KeyboardEvent): void => {
        if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.isComposing ||
            event.keyCode === 229
        )
            return;
        if (
            event.key === 'Enter' &&
            this.bulkToggle &&
            event.target === this.bulkToggle.input
        ) {
            event.preventDefault();
            this.bulkToggle.input.click();
            return;
        }
        if (
            event.key === 'ArrowDown' &&
            !this.actionsInline &&
            (event.target ===
                this.suiteChrome?.status.querySelector('.ez-status-mark') ||
                event.target === this.bulkToggle?.input)
        ) {
            event.preventDefault();
            event.stopPropagation();
            (
                this.checkboxes().find((checkbox) => checkbox.tabIndex === 0) ??
                this.listEl
            ).focus({ preventScroll: true });
            return;
        }
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const target = event.target as HTMLElement;
        const buttons = this.headerActions();
        if (!buttons.includes(target)) return;
        event.preventDefault();
        event.stopPropagation();
        const next = focusGridNeighbor(
            this.actionsInline ? [...this.choiceItems(), ...buttons] : buttons,
            target,
            event.key as 'ArrowLeft' | 'ArrowRight',
        );
        this.focusChoiceOrAction(next);
    };

    private headerActions(): HTMLElement[] {
        return focusableFieldActions(
            this.headerEl,
            'button, .category-checklist-master',
        );
    }

    private choiceItems(): HTMLElement[] {
        return this.checkboxes().map((input) => input.parentElement!);
    }

    private focusChoiceOrAction(target: HTMLElement | null): void {
        if (target?.matches('.category-checklist-item'))
            target.querySelector('input')?.focus();
        else target?.focus();
    }

    private lowestChoiceAboveToRight(
        items: HTMLElement[],
        current: HTMLElement,
    ): HTMLElement | null {
        const { left, top } = current.getBoundingClientRect();
        let next: HTMLElement | null = null;
        let columnLeft = Infinity;
        let choiceTop = -Infinity;
        for (const item of items) {
            if (item.parentElement === current.parentElement) continue;
            const rect = item.getBoundingClientRect();
            if (rect.left <= left || rect.top >= top) continue;
            if (
                rect.left < columnLeft ||
                (rect.left === columnLeft && rect.top > choiceTop)
            ) {
                next = item;
                columnLeft = rect.left;
                choiceTop = rect.top;
            }
        }
        return next;
    }

    protected render(): void {
        // Update preview
        if (this.options.showPreview) {
            this.preview.textContent = this.getRendered();
        }

        const available = this.availableChoices();
        this.updateCount(available);

        // Keep the existing inputs when only their checked state changes.
        const boxes = this.checkboxes();
        if (
            this.listEl.children.length > 0 &&
            !this.filterText &&
            available.length === boxes.length &&
            boxes.every(
                (box, index) =>
                    box.dataset.conceptId === available[index].concept.id &&
                    box.parentElement?.dataset.depth ===
                        String(available[index].depth ?? 0),
            )
        ) {
            boxes.forEach((box, index) =>
                this.updateChoiceState(box, available[index].origin),
            );
            this.updateTabStop();
        } else {
            this.renderList();
        }
    }

    private updateChoiceState(
        checkbox: HTMLInputElement,
        origin: ChoiceOrigin | undefined,
    ): void {
        checkbox.checked = origin === 'stated';
        const item = checkbox.closest('.category-checklist-item');
        item?.classList.toggle(
            'category-checklist-item--checked',
            checkbox.checked,
        );
        item?.classList.toggle(
            'category-checklist-item--inferred',
            origin === 'inferred',
        );
        if (origin === 'inferred') {
            const name =
                item?.querySelector('.category-checklist-label')?.textContent ??
                '';
            checkbox.setAttribute(
                'aria-label',
                name + t('aria.inferredSuffix'),
            );
        } else checkbox.removeAttribute('aria-label');
    }

    private updateCount(choices = this.availableChoices()): void {
        const selected = choices.filter(
            ({ origin }) => origin === 'stated',
        ).length;
        this.countEl.textContent = `${selected} of ${choices.length}`;
        if (this.bulkToggle) {
            const state = this.bulkState(choices);
            this.bulkToggle.update(
                state,
                (state === 'none' && choices.length === 0) ||
                    !!this.enhancedInput?.matches(':disabled, [readonly]'),
            );
        }
    }

    private bulkState(
        choices = this.availableChoices(),
    ): 'none' | 'some' | 'all' {
        const hasSelection = [
            ...choiceOrigins(this.assertions, this.categoryId).values(),
        ].includes('stated');
        if (!hasSelection) return 'none';
        return choices.every(({ origin }) => origin === 'stated')
            ? 'all'
            : 'some';
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

    /** Arrows follow the visual grid while focus keeps its native tab stop. */
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
        const items = this.choiceItems();
        const item = checkbox.parentElement!;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const neighbors = this.actionsInline
                ? [...items, ...this.headerActions()]
                : items;
            const next = focusGridNeighbor(neighbors, item, event.key);
            this.focusChoiceOrAction(
                next ??
                    (event.key === 'ArrowRight'
                        ? this.lowestChoiceAboveToRight(items, item)
                        : null),
            );
            return;
        }
        const rows =
            event.key === 'Home' || event.key === 'End'
                ? focusGridRows(items)
                : null;
        const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
        const hasBranches =
            vertical && items.some((choice) => choice.dataset.depth !== '0');
        const neighbors = hasBranches
            ? items.filter(
                  (choice) => choice.parentElement === item.parentElement,
              )
            : items;
        const next = rows
            ? event.key === 'Home'
                ? rows[0]?.[0]
                : rows.at(-1)?.at(-1)
            : focusGridNeighbor(neighbors, item, event.key as FocusGridArrow);
        if (!next && event.key === 'ArrowUp' && !this.actionsInline) {
            this.suiteChrome?.status
                .querySelector<HTMLElement>('.ez-status-mark')
                ?.focus({ preventScroll: true });
            return;
        }
        next?.querySelector('input')?.focus();
    }

    private fillList(): void {
        this.listEl.innerHTML = '';

        // Apply engine availability filter first, then user text filter
        const available = this.availableChoices();
        const filtered = this.filterText
            ? available.filter(
                  ({ concept: c }) =>
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

        const visible = new Set(filtered);
        let column: HTMLDivElement | null = null;
        for (const choice of available) {
            const { concept, depth = 0, origin } = choice;
            if (!depth) column = null;
            if (!visible.has(choice)) continue;
            if (!column) {
                column = document.createElement('div');
                column.className = 'category-checklist-column';
                this.listEl.appendChild(column);
            }
            // The whole row is the checkbox's label, so a press anywhere on
            // it toggles the box. It labels the box it holds, not one found
            // by id: two checklists of a category share their ids. The native input keeps the semantics and
            // the focus; the box beside it is the library's own drawing, which
            // a host's input rules cannot repaint.
            const item = document.createElement('label');
            item.className = 'category-checklist-item';
            item.dataset.depth = String(depth);
            if (depth > 0)
                item.style.setProperty(
                    '--ez-checklist-indent',
                    `${depth * 0.75}rem`,
                );

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'category-checklist-checkbox';
            checkbox.id = `checklist-${this.categoryId}-${concept.id}`;
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
            this.attachConceptTitle(checkbox, concept.id, this.categoryId);
            if (checkbox.title) item.title = checkbox.title;

            item.append(checkbox, box, label);
            this.updateChoiceState(checkbox, origin);
            column.appendChild(item);
        }
    }

    /** Select all currently-visible (allowed) concepts */
    private selectAll(): void {
        this.beginUserEdit();
        const available = this.availableChoices();
        const additions = available.filter(({ origin }) => origin !== 'stated');
        const replacing = new Set(additions.map(({ concept }) => concept.id));
        const held = new Map(
            this.assertions
                .filter(({ categoryId }) => categoryId === this.categoryId)
                .map((assertion) => [assertion.conceptId, assertion]),
        );
        const authored = additions.map(({ concept }) => {
            const previous = held.get(concept.id);
            return {
                conceptId: concept.id,
                categoryId: this.categoryId,
                confidence: 'certain' as const,
                source: 'user' as const,
                ...(previous?.value !== undefined
                    ? { value: previous.value }
                    : {}),
            };
        });
        this.reprocessEdit([
            ...this.assertions.filter(
                ({ categoryId, conceptId }) =>
                    categoryId !== this.categoryId || !replacing.has(conceptId),
            ),
            ...authored,
        ]);
        announce(this.announcer, `Selected all ${available.length} items`);
    }

    /** Clear all selected concepts in this category */
    private clearAll(): void {
        this.beginUserEdit();
        this.reprocessEdit(
            this.assertions.filter((a) => a.categoryId !== this.categoryId),
            { processEmpty: true, resetCorrections: true },
        );
        announce(this.announcer, 'Cleared all selections');
    }
}

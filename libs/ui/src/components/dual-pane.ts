/**
 * Dual-Pane Transfer List Component
 *
 * Two side-by-side panes: "Available" (left) and "Selected" (right). Available
 * shows all concepts grouped by category. Selected shows the current marking's
 * concepts in render order. Transfer items between panes with buttons,
 * double-click, or keyboard.
 */

import { SuggestionCatalog } from './composer/suggestion-catalog';
import { statedAssertions } from './composer/composer-controller';
import type { Suggestion } from '@ezclassify/types';
import { ComponentBase } from './component-base';
import { createAnnouncer, announce } from './component-utils';
import dualPaneCss from './dual-pane.css?inline';
import { observeNativeLock } from './dom-helpers';
import { t } from '../i18n';

/**
 * Two-column picker with an available-concepts pane and a selected-concepts
 * pane, supporting filter and keyboard navigation.
 */
export class DualPane extends ComponentBase {
    protected override clearButtonMount(): HTMLElement {
        const frame = this.clearButtonFrame(this.preview);
        frame.classList.add('ez-clear-preview');
        return frame;
    }
    private preview!: HTMLDivElement;
    private availablePane!: HTMLDivElement;
    private availableFilter!: HTMLInputElement;
    private availableList!: HTMLDivElement;
    private selectedPane!: HTMLDivElement;
    private selectedList!: HTMLDivElement;
    private addBtn!: HTMLButtonElement;
    private removeBtn!: HTMLButtonElement;
    private announcer!: HTMLDivElement;
    private availableHighlight = -1;
    private selectedHighlight = -1;
    private flatAvailable: Suggestion[] = [];
    private catalog!: SuggestionCatalog;
    private catalogReady = false;
    private userEdit = false;
    private locked = false;
    private stopObservingLock?: () => void;
    private readonly requestOptions = () => {
        if (
            this._destroyed ||
            this.enhancedInput?.matches(':disabled, [readonly]')
        )
            return;
        void this.refreshOptions();
    };

    private async refreshOptions(): Promise<void> {
        if (this.allowableOptions !== null) return;
        await this.catalog.load(
            JSON.stringify(this.getProcessingContext()) ?? '',
        );
        await this.catalog.refresh(statedAssertions(this.assertions));
    }

    protected override onAssertionsChanged(): void {
        this.catalog?.useContext(
            JSON.stringify(this.getProcessingContext()) ?? '',
        );
        this.catalog?.invalidateLive();
        const refresh = this.userEdit;
        this.userEdit = false;
        super.onAssertionsChanged();
        if (refresh) this.requestOptions();
    }
    /**
     * Store-pushed facet options for this category. `null` means the engine did
     * not supply allowability, so DualPane falls back to its own suggestion
     * query. A concrete array is authoritative for the unfiltered browse list.
     */
    private allowableOptions: Suggestion[] | null = null;

    protected setup(): void {
        this.injectComponentStyles(dualPaneCss);

        // Preview (DualPane always appends preview element to DOM)
        this.preview = this.createPreviewBar();
        if (!this.preview.parentElement) {
            this.container.appendChild(this.preview);
        }

        // Dual container
        const dual = document.createElement('div');
        dual.className = 'dual-container';

        // Available pane
        this.availablePane = document.createElement('div');
        this.availablePane.className = 'dual-pane';
        this.availablePane.setAttribute('role', 'region');
        this.availablePane.setAttribute(
            'aria-label',
            t('dualPane.availableRegion'),
        );

        const availHeader = document.createElement('div');
        availHeader.className = 'dual-pane-header';
        availHeader.id = 'ez-dual-avail-header';
        const availHeaderText = document.createElement('span');
        availHeaderText.textContent = t('dualPane.available');
        availHeader.appendChild(availHeaderText);
        this.availablePane.appendChild(availHeader);

        this.availableFilter = document.createElement('input');
        this.availableFilter.type = 'text';
        this.availableFilter.className = 'dual-filter';
        this.availableFilter.placeholder = t('dualPane.filterConcepts');
        this.availableFilter.setAttribute(
            'aria-label',
            'Filter available concepts',
        );
        this.availableFilter.setAttribute('autocomplete', 'off');
        this.availableFilter.addEventListener('input', () => {
            this.availableHighlight = -1;
            this.requestOptions();
            this.renderAvailable();
        });
        this.availableFilter.addEventListener('keydown', (e) =>
            this.onAvailableKeydown(e),
        );
        this.availableFilter.addEventListener('focus', () => {
            this.requestOptions();
        });
        this.availablePane.appendChild(this.availableFilter);

        this.availableList = document.createElement('div');
        this.availableList.className = 'dual-items';
        this.availableList.setAttribute('role', 'listbox');
        this.availableList.setAttribute(
            'aria-label',
            'Available concepts list',
        );
        // aria-multiselectable is intentionally absent: the DualPane is a single-item
        // transfer model (click or highlight+Enter moves one concept at a time). If
        // bulk multi-select is ever added, set aria-multiselectable="true" at that point.
        this.availableList.tabIndex = 0;
        this.availableList.addEventListener('keydown', (e) =>
            this.onAvailableListKeydown(e),
        );
        this.availableList.addEventListener('focus', () => {
            this.requestOptions();
        });
        this.availablePane.appendChild(this.availableList);

        // Transfer controls
        const controls = document.createElement('div');
        controls.className = 'dual-controls';

        this.addBtn = document.createElement('button');
        this.addBtn.type = 'button';
        this.addBtn.className = 'dual-btn';
        this.addBtn.innerHTML = '\u203a'; // ›
        this.addBtn.setAttribute(
            'aria-label',
            'Add highlighted concept to marking',
        );
        this.addBtn.addEventListener('click', () => this.transferToSelected());
        controls.appendChild(this.addBtn);

        this.removeBtn = document.createElement('button');
        this.removeBtn.type = 'button';
        this.removeBtn.className = 'dual-btn';
        this.removeBtn.innerHTML = '\u2039'; // ‹
        this.removeBtn.setAttribute(
            'aria-label',
            'Remove highlighted concept from marking',
        );
        this.removeBtn.addEventListener('click', () =>
            this.transferToAvailable(),
        );
        controls.appendChild(this.removeBtn);

        // Selected pane
        this.selectedPane = document.createElement('div');
        this.selectedPane.className = 'dual-pane';
        this.selectedPane.setAttribute('role', 'region');
        this.selectedPane.setAttribute(
            'aria-label',
            t('dualPane.currentMarkingRegion'),
        );

        const selHeader = document.createElement('div');
        selHeader.className = 'dual-pane-header';
        selHeader.id = 'ez-dual-sel-header';
        const selHeaderText = document.createElement('span');
        selHeaderText.textContent = t('dualPane.currentMarking');
        selHeader.appendChild(selHeaderText);
        this.selectedPane.appendChild(selHeader);

        this.selectedList = document.createElement('div');
        this.selectedList.className = 'dual-items';
        this.selectedList.setAttribute('role', 'listbox');
        this.selectedList.setAttribute(
            'aria-label',
            t('dualPane.selectedList'),
        );
        this.selectedList.tabIndex = 0;
        this.selectedList.addEventListener('keydown', (e) =>
            this.onSelectedKeydown(e),
        );
        this.selectedList.addEventListener('focus', () => {
            this.requestOptions();
        });
        this.selectedPane.appendChild(this.selectedList);

        dual.appendChild(this.availablePane);
        dual.appendChild(controls);
        dual.appendChild(this.selectedPane);
        this.container.appendChild(dual);

        this.announcer = createAnnouncer();
        this.container.appendChild(this.announcer);

        this.appendKeyboardHints([
            { keys: 'Tab', action: 'switch panes' },
            { keys: '\u2191\u2193', action: 'navigate items' },
            { keys: 'Enter', action: 'transfer' },
            { keys: '\u2192', action: 'add to marking' },
            { keys: '\u2190', action: 'remove from marking' },
            { keys: 'Type', action: 'filter available' },
        ]);

        this.catalog = new SuggestionCatalog(
            (live) => this.composerSuggestions(live),
            () => {
                this.catalogReady = true;
                this.renderAvailable();
            },
        );
        dual.addEventListener('click', this.requestOptions);
        this.stopObservingLock = observeNativeLock(
            this.enhancedInput,
            (locked) => {
                this.locked = locked;
                this.availableFilter.disabled = locked;
                this.availableList.setAttribute(
                    'aria-disabled',
                    String(locked),
                );
                this.selectedList.setAttribute('aria-disabled', String(locked));
                this.updateButtonStates();
            },
        );
        this.render();
    }

    destroy(): void {
        this._destroyed = true;
        this.catalog?.dispose();
        this.stopObservingLock?.();
        this.destroyClearButton();
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    protected render(): void {
        this.preview.textContent = this.getRendered();
        this.renderAvailable();
        this.renderSelected();
    }

    /**
     * Consume the shared facet allowability stream so a facet-bound DualPane
     * renders the parent marking's addable concepts even when its own category
     * slice is currently empty.
     */
    applyAllowableOptions(options: Suggestion[] | null): void {
        if (this._destroyed) return;
        this.catalog.invalidateLive();
        this.allowableOptions = options;
        this.renderAvailable();
    }

    private renderAvailable(): void {
        const filter = this.availableFilter.value.trim();
        let suggestions = (this.allowableOptions ?? this.catalog.rows()).filter(
            (s) =>
                !s.gated &&
                !s.conceptId.startsWith('preset:') &&
                (!this.options.categoryId ||
                    s.categoryId === this.options.categoryId),
        );

        if (filter) {
            const scored = suggestions
                .map((s) => ({
                    s,
                    score: Math.max(
                        this.fuzzyMatch(filter, s.label),
                        this.fuzzyMatch(filter, s.name),
                        this.fuzzyMatch(filter, s.conceptId),
                    ),
                }))
                .filter((x) => x.score > 0);
            scored.sort((a, b) => b.score - a.score);
            suggestions = scored.map((x) => x.s);
        }

        const selected = new Set(
            this.assertions.map((a) => `${a.conceptId}::${a.categoryId}`),
        );
        suggestions = suggestions.map((s) => ({
            ...s,
            selected: selected.has(`${s.conceptId}::${s.categoryId}`),
        }));

        this.flatAvailable = suggestions;
        this.availableList.innerHTML = '';

        if (suggestions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dual-empty';
            empty.setAttribute('role', 'option');
            empty.setAttribute('aria-disabled', 'true');
            empty.textContent = filter
                ? 'No matches'
                : this.allowableOptions === null && !this.catalogReady
                  ? 'Focus or tap to browse concepts'
                  : 'No concepts available';
            this.availableList.appendChild(empty);
            this.availableList.removeAttribute('aria-activedescendant');
            this.updateButtonStates();
            return;
        }

        let currentGroup = '';
        let currentGroupEl: HTMLDivElement | null = null;
        let groupIdx = 0;
        suggestions.forEach((s, i) => {
            if (s.group !== currentGroup) {
                currentGroup = s.group;
                const headerId = `ez-dual-group-hdr-${groupIdx++}`;

                currentGroupEl = document.createElement('div');
                currentGroupEl.setAttribute('role', 'group');
                currentGroupEl.setAttribute('aria-labelledby', headerId);

                const header = document.createElement('div');
                header.className = 'dual-group-header';
                header.id = headerId;
                header.textContent = currentGroup;
                header.style.borderLeftColor = this.getCategoryColor(
                    s.categoryId,
                );
                currentGroupEl.appendChild(header);

                this.availableList.appendChild(currentGroupEl);
            }

            const item = document.createElement('div');
            item.className =
                'dual-item' +
                (s.selected ? ' selected' : '') +
                (i === this.availableHighlight ? ' highlighted' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', s.selected ? 'true' : 'false');
            item.id = `ez-avail-item-${i}`;
            item.dataset.index = String(i);

            if (s.selected) {
                const check = document.createElement('span');
                check.className = 'check';
                check.textContent = '\u2713';
                item.appendChild(check);
            }

            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = s.label;
            item.appendChild(label);

            if (s.description) {
                const desc = document.createElement('span');
                desc.className = 'desc';
                desc.textContent = s.description;
                item.appendChild(desc);
            }

            item.addEventListener('click', (event) => {
                if (event.detail > 1) return;
                this.toggleAvailableItem(i);
            });
            currentGroupEl!.appendChild(item);
        });
        // Keep AT informed of keyboard cursor position within the listbox.
        if (
            this.availableHighlight >= 0 &&
            this.availableHighlight < this.flatAvailable.length
        ) {
            this.availableList.setAttribute(
                'aria-activedescendant',
                `ez-avail-item-${this.availableHighlight}`,
            );
        } else {
            this.availableList.removeAttribute('aria-activedescendant');
        }
        this.updateButtonStates();
    }

    private toggleAvailableItem(idx: number): void {
        const s = this.flatAvailable[idx];
        if (
            !s ||
            this._destroyed ||
            this.enhancedInput?.matches(':disabled, [readonly]')
        )
            return;
        this.userEdit = true;
        this.toggleSuggestion(s);
        announce(this.announcer, `${s.label} toggled`);
    }

    private transferToSelected(): void {
        if (
            this._destroyed ||
            this.enhancedInput?.matches(':disabled, [readonly]')
        )
            return;
        if (
            this.availableHighlight >= 0 &&
            this.availableHighlight < this.flatAvailable.length
        ) {
            const s = this.flatAvailable[this.availableHighlight];
            if (!s.selected) {
                this.userEdit = true;
                this.addAssertion(s.conceptId, s.categoryId);
                announce(this.announcer, `Added ${s.label}`);
            }
        }
    }

    private onAvailableKeydown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'ArrowDown':
                // Move focus into the available listbox. Highlight the first item if none
                // is already highlighted so the user sees cursor position immediately.
                e.preventDefault();
                if (
                    this.availableHighlight < 0 &&
                    this.flatAvailable.length > 0
                ) {
                    this.availableHighlight = 0;
                    this.renderAvailable();
                }
                this.availableList.focus();
                break;
            case 'Enter':
                // Convenience: transfer from filter when an item is already highlighted.
                e.preventDefault();
                if (this.availableHighlight >= 0) this.transferToSelected();
                break;
            case 'ArrowRight':
                // Move focus to selected pane
                e.preventDefault();
                this.selectedList.focus();
                break;
            // Tab is not intercepted: natural Tab order goes to availableList (tabIndex=0).
        }
    }

    private onAvailableListKeydown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (this.availableHighlight < 0) {
                    this.availableHighlight = 0;
                } else {
                    this.availableHighlight = Math.min(
                        this.availableHighlight + 1,
                        this.flatAvailable.length - 1,
                    );
                }
                this.renderAvailable();
                this.scrollHighlightIntoView(
                    this.availableList,
                    this.availableHighlight,
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (this.availableHighlight <= 0) {
                    // At first item or no item: return focus to the filter input.
                    this.availableHighlight = -1;
                    this.availableFilter.focus();
                } else {
                    this.availableHighlight--;
                    this.renderAvailable();
                    this.scrollHighlightIntoView(
                        this.availableList,
                        this.availableHighlight,
                    );
                }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (this.availableHighlight >= 0) this.transferToSelected();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.selectedList.focus();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.availableFilter.focus();
                break;
            // Tab: natural, goes to addBtn (next focusable element in DOM order).
        }
    }

    private renderSelected(): void {
        this.selectedList.innerHTML = '';

        if (this.assertions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dual-empty';
            empty.setAttribute('role', 'option');
            empty.setAttribute('aria-disabled', 'true');
            empty.textContent = t('dualPane.empty');
            this.selectedList.appendChild(empty);
            this.selectedList.removeAttribute('aria-activedescendant');
            this.updateButtonStates();
            return;
        }

        this.assertions.forEach((a, i) => {
            const concept = this.scheme.concepts.find(
                (c) => c.id === a.conceptId,
            );
            const category = this.scheme.categories.find(
                (f) => f.id === a.categoryId,
            );
            const color = this.getCategoryColor(a.categoryId);

            const itemId = `ez-sel-item-${i}`;
            const item = document.createElement('div');
            item.className =
                'dual-item' +
                (i === this.selectedHighlight ? ' highlighted' : '');
            item.setAttribute('role', 'option');
            // All items in the selected pane are selected (they are in the marking).
            // aria-selected tracks selection state, not keyboard cursor position;
            // the highlighted class handles visual focus indication.
            item.setAttribute('aria-selected', 'true');
            item.id = itemId;
            item.dataset.index = String(i);

            // Category tag
            const tag = document.createElement('span');
            tag.className = 'category-tag';
            tag.textContent = category?.label ?? a.categoryId;
            tag.style.setProperty('--ez-category-color', color);
            item.appendChild(tag);

            // Label
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = concept?.views['default'] ?? a.conceptId;
            item.appendChild(label);

            // Inferred badge
            if (a.confidence === 'inferred') {
                const badge = document.createElement('span');
                badge.style.cssText =
                    'font-size:0.5625rem;color:var(--ez-color-muted);font-style:italic;';
                badge.textContent = t('dualPane.auto');
                item.appendChild(badge);
            }

            item.addEventListener('click', () => {
                this.selectedHighlight = i;
                this.renderSelected();
            });
            item.addEventListener('dblclick', () => {
                if (
                    this._destroyed ||
                    this.enhancedInput?.matches(':disabled, [readonly]')
                )
                    return;
                this.userEdit = true;
                this.removeAssertion(a.conceptId, a.categoryId);
                announce(
                    this.announcer,
                    `Removed ${concept?.views['default'] ?? a.conceptId}`,
                );
            });

            this.selectedList.appendChild(item);
        });
        // Point aria-activedescendant at the highlighted item so AT announces focus position
        if (this.selectedHighlight >= 0) {
            this.selectedList.setAttribute(
                'aria-activedescendant',
                `ez-sel-item-${this.selectedHighlight}`,
            );
        } else {
            this.selectedList.removeAttribute('aria-activedescendant');
        }
        this.updateButtonStates();
    }

    /**
     * Disable/enable transfer buttons based on whether there is a highlighted
     * item to act on.
     */
    private updateButtonStates(): void {
        const locked = this.locked;
        this.addBtn.disabled =
            locked ||
            this.availableHighlight < 0 ||
            this.availableHighlight >= this.flatAvailable.length;
        this.removeBtn.disabled =
            locked ||
            this.selectedHighlight < 0 ||
            this.selectedHighlight >= this.assertions.length;
    }

    private transferToAvailable(): void {
        if (
            this._destroyed ||
            this.enhancedInput?.matches(':disabled, [readonly]')
        )
            return;
        if (
            this.selectedHighlight >= 0 &&
            this.selectedHighlight < this.assertions.length
        ) {
            const a = this.assertions[this.selectedHighlight];
            this.userEdit = true;
            this.removeAssertion(a.conceptId, a.categoryId);
            this.selectedHighlight = Math.min(
                this.selectedHighlight,
                this.assertions.length - 1,
            );
            announce(this.announcer, `Removed ${a.conceptId}`);
        }
    }

    private onSelectedKeydown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedHighlight = Math.min(
                    this.selectedHighlight + 1,
                    this.assertions.length - 1,
                );
                this.renderSelected();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectedHighlight = Math.max(
                    this.selectedHighlight - 1,
                    0,
                );
                this.renderSelected();
                break;
            case 'Enter':
            case ' ':
                // Transfer highlighted item back to available
                e.preventDefault();
                this.transferToAvailable();
                break;
            case 'Delete':
            case 'Backspace':
                e.preventDefault();
                this.transferToAvailable();
                break;
            case 'ArrowLeft':
                // Move focus back to available pane
                e.preventDefault();
                this.availableFilter.focus();
                break;
            // Tab / Shift+Tab: natural, DOM order puts removeBtn → addBtn → availableList → filter.
        }
    }

    private scrollHighlightIntoView(container: HTMLElement, idx: number): void {
        const el = container.querySelector(
            `[data-index="${idx}"]`,
        ) as HTMLElement;
        el?.scrollIntoView?.({ block: 'nearest' });
    }
}

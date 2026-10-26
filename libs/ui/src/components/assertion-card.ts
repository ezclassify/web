/**
 * AssertionCard Component
 *
 * A read-only structured display of current assertions, grouped by category.
 * Shows a card with the primary value prominently displayed and secondary
 * categories listed below as labeled rows. Driven by setAssertions(), typically
 * another component provides the data.
 */

import {
    ReadOnlyComponentBase,
    type ComponentOptions,
    type ComponentEngineSource,
} from './component-base-readonly';
import { resolveMarkingColor } from '../color-resolver';
import type { Assertion } from '@ezclassify/types';
import assertionCardCss from './assertion-card.css?inline';

const ASSERTION_CARD_CSS: string = assertionCardCss;

/** Options accepted by assertion card operations. */
export interface AssertionCardOptions extends ComponentOptions {
    /**
     * Which category is the "primary" one (displayed prominently). Auto-detects
     * first category if omitted.
     */
    primaryCategoryId?: string;
    /**
     * Map concept IDs to presentation colors. The background drives the card
     * accent, consistent with the other components.
     */
    /** Optional footer text or callback that generates footer from assertions */
    footer?: string | ((assertions: Assertion[]) => string);
    /** Title for the card. Default: profile name */
    title?: string;
}

/**
 * Compact card that summarizes current assertions, highlighting the primary
 * category value and listing details.
 */
export class AssertionCard extends ReadOnlyComponentBase {
    private cardEl!: HTMLDivElement;
    private primaryCategoryId!: string;
    private cardOptions!: AssertionCardOptions;

    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: ComponentOptions,
    ): Promise<void> {
        this.cardOptions = (options ?? {}) as AssertionCardOptions;
        await super.init(container, engineOrContext, options);
    }

    protected setup(): void {
        // Determine primary category
        const categories = this.scheme.categories;
        this.primaryCategoryId =
            this.cardOptions.primaryCategoryId ?? categories[0]?.id ?? '';

        // Inject styles
        this.injectComponentStyles(ASSERTION_CARD_CSS);

        // Card container
        this.cardEl = document.createElement('div');
        this.cardEl.className = 'assertion-card';
        this.cardEl.setAttribute('role', 'region');
        this.cardEl.setAttribute(
            'aria-label',
            this.cardOptions.title ?? this.scheme.name ?? 'Assertion card',
        );
        this.cardEl.tabIndex = 0;
        this.container.appendChild(this.cardEl);

        this.render();
    }

    destroy(): void {
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    protected render(): void {
        this.cardEl.innerHTML = '';

        // Find primary category assertion
        const primaryAssertion = this.assertions.find(
            (a) => a.categoryId === this.primaryCategoryId,
        );
        const primaryConcept = primaryAssertion
            ? this.scheme.concepts.find(
                  (c) => c.id === primaryAssertion.conceptId,
              )
            : null;

        // The marking's own color, by whichever route can produce it: the
        // adapter's whole-marking answer wins, and the local scheme lookup
        // covers the driving-category form for paths that set assertions
        // without a fresh process call. See ReadOnlyComponentBase.displayColor.
        // Not the category default, which is the step below this one.
        const markingColor =
            this.displayColor ??
            resolveMarkingColor(
                { colorFrom: this.colorFrom },
                this.assertions.map((a) => ({
                    conceptId: a.conceptId,
                    categoryId: a.categoryId,
                    color: this.scheme.concepts.find(
                        (c) => c.id === a.conceptId,
                    )?.color,
                })),
                this.scheme,
            );
        // Precedence per ARCHITECTURE.md "Display-color precedence": the host
        // override for the displayed concept, then what the adapter resolved,
        // then the published category default. A colorMap that has no entry
        // for this concept falls through; it does not suppress the steps under
        // it.
        let cardColor: string | null =
            (primaryAssertion
                ? this.cardOptions.colorMap?.[primaryAssertion.conceptId]
                      ?.background
                : undefined) ??
            markingColor?.background ??
            null;
        if (!cardColor && primaryAssertion) {
            cardColor = this.getCategoryColor(this.primaryCategoryId);
        }
        this.cardEl.style.setProperty(
            '--assertion-card-color',
            cardColor ?? 'var(--ez-color-primary, #666)',
        );

        // Empty state
        if (this.assertions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'assertion-card--empty';
            empty.textContent = 'No assertions';
            this.cardEl.appendChild(empty);
            return;
        }

        // Primary value
        if (primaryConcept) {
            const primaryEl = document.createElement('div');
            primaryEl.className = 'assertion-card-primary';
            primaryEl.textContent =
                primaryConcept.views['default'] ?? primaryConcept.name;
            this.cardEl.appendChild(primaryEl);
        }

        // Secondary categories
        const secondaryCategories = this.scheme.categories.filter(
            (f) => f.id !== this.primaryCategoryId,
        );
        for (const category of secondaryCategories) {
            const categoryAssertions = this.assertions.filter(
                (a) => a.categoryId === category.id,
            );
            if (categoryAssertions.length === 0) continue;

            const categoryEl = document.createElement('div');
            categoryEl.className = 'assertion-card-category';

            const labelEl = document.createElement('div');
            labelEl.className = 'assertion-card-category-label';
            labelEl.textContent = category.label ?? category.id;
            categoryEl.appendChild(labelEl);

            const valuesEl = document.createElement('div');
            valuesEl.className = 'assertion-card-category-values';
            const names = categoryAssertions.map((a) => {
                const c = this.scheme.concepts.find(
                    (c) => c.id === a.conceptId,
                );
                return c?.views['default'] ?? c?.name ?? a.conceptId;
            });
            valuesEl.textContent = names.join(', ');
            categoryEl.appendChild(valuesEl);

            this.cardEl.appendChild(categoryEl);
        }

        // Footer
        const footer = this.cardOptions.footer;
        if (footer) {
            const footerEl = document.createElement('div');
            footerEl.className = 'assertion-card-footer';
            footerEl.textContent =
                typeof footer === 'function'
                    ? footer(this.getAssertions())
                    : footer;
            this.cardEl.appendChild(footerEl);
        }
    }
}

import type { Assertion } from '@ezclassify/types';
import type {
    EzClassifyState,
    EzClassifyStore,
    FacetState,
    PublishSource,
} from './store/ezclassify-store';

/**
 * A framework-owned select option. The visual control may come from any UI
 * library; EzClassify only needs the selected concept id and optional captured
 * value.
 */
export interface EzClassifyFacetSelection {
    conceptId: string;
    value?: string;
}

export type EzClassifyFacetSelectionInput = string | EzClassifyFacetSelection;

/**
 * Framework-neutral state consumed by a single-select or multiselect widget. It
 * contains no DOM or framework types, so the same contract works for controlled
 * components, signals, refs, web components, and jQuery plugins.
 */
export interface EzClassifyFacetSnapshot extends FacetState {
    marking: EzClassifyState;
    selectedConceptIds: string[];
}

export interface EzClassifyFacetBinding {
    /**
     * Resolves once the facet's rule-filtered options have been computed for
     * the current marking.
     */
    readonly ready: Promise<void>;
    getSnapshot(): EzClassifyFacetSnapshot;
    subscribe(
        listener: (snapshot: EzClassifyFacetSnapshot) => void,
    ): () => void;
    setSelected(
        selected: readonly EzClassifyFacetSelectionInput[],
    ): Promise<void>;
    destroy(): void;
}

/**
 * Replace one category's authored assertions without disturbing the other
 * categories in the marking. {@link publishFacetSelection} and the facet binding
 * publish through it.
 */
export function replaceFacetAssertions(
    current: readonly Assertion[],
    categoryId: string,
    selected: readonly EzClassifyFacetSelectionInput[],
): Assertion[] {
    const next = current.filter((a) => a.categoryId !== categoryId);
    const seen = new Set<string>();

    for (const item of selected) {
        const selection = typeof item === 'string' ? { conceptId: item } : item;
        if (!selection.conceptId || seen.has(selection.conceptId)) continue;
        seen.add(selection.conceptId);
        next.push({
            conceptId: selection.conceptId,
            categoryId,
            confidence: 'certain',
            source: 'user',
            ...(selection.value ? { value: selection.value } : {}),
        });
    }

    return next;
}

/**
 * The concept ids a marking has committed in one category, in assertion order.
 *
 * The value a single- or multi-select control displays: the read side of
 * {@link publishFacetSelection}. Exported because every framework projection
 * needs it: a facet field reads the marking cell, not the binding's snapshot,
 * so each one would otherwise re-derive the same filter-and-map.
 *
 * @param assertions - The marking's committed assertions.
 * @param categoryId - The category the control owns.
 * @returns The selected concept ids for that category.
 */
export function selectedConceptIds(
    assertions: readonly Assertion[],
    categoryId: string,
): string[] {
    const selected: string[] = [];
    for (const assertion of assertions) {
        if (assertion.categoryId === categoryId)
            selected.push(assertion.conceptId);
    }
    return selected;
}

/**
 * Publish a single- or multi-select category selection through the shared
 * store. The engine re-renders and validates the complete marking, and every
 * bound view receives the resulting state. The publish names its category, so
 * selecting the value already shown is an edit too.
 */
export function publishFacetSelection(
    store: EzClassifyStore,
    markingId: string,
    categoryId: string,
    selected: readonly EzClassifyFacetSelectionInput[],
    source?: PublishSource,
): Promise<void> {
    return store.publishAssertions(
        markingId,
        replaceFacetAssertions(
            store.get(markingId).assertions,
            categoryId,
            selected,
        ),
        source,
        { categories: [categoryId] },
    );
}

/**
 * Create the universal third-party-control adapter.
 *
 * A library integration needs only three operations:
 *
 * - Read `getSnapshot()` to initialize its value and options;
 * - Call `setSelected()` from its normal change callback;
 * - Subscribe to refresh after rules, inference, or another bound view changes.
 *
 * This intentionally does not inspect or replace the control's DOM.
 */
export function createEzClassifyFacetBinding(
    store: EzClassifyStore,
    markingId: string,
    categoryId: string,
    source?: PublishSource,
): EzClassifyFacetBinding {
    let destroyed = false;
    // Seeded from the store rather than from null: the facet may already carry
    // a computed answer put there by an earlier control on the same category,
    // and a snapshot read before the first notification should show it.
    let allowableOptions: FacetState['allowableOptions'] = store.getFacet(
        markingId,
        categoryId,
    ).allowableOptions;
    const listeners = new Set<(snapshot: EzClassifyFacetSnapshot) => void>();
    let resolveFirstFacet!: () => void;
    const firstFacet = new Promise<void>((resolve) => {
        resolveFirstFacet = resolve;
    });

    const snapshot = (): EzClassifyFacetSnapshot => {
        const marking = store.get(markingId);
        const selectedAssertions = marking.assertions.filter(
            (assertion) => assertion.categoryId === categoryId,
        );
        // Mapped from the filtered list rather than through
        // `selectedConceptIds`, which would walk the whole assertion set again
        // for an answer already in hand.
        return {
            marking,
            allowableOptions,
            selectedAssertions,
            selectedConceptIds: selectedAssertions.map(
                (assertion) => assertion.conceptId,
            ),
        };
    };
    const notify = () => {
        if (destroyed) return;
        const next = snapshot();
        for (const listener of listeners) listener(next);
    };

    const unsubscribeMarking = store.subscribe(markingId, notify);
    const unsubscribeFacet = store.subscribeFacet(
        markingId,
        categoryId,
        (state) => {
            allowableOptions = state.allowableOptions;
            notify();
            resolveFirstFacet();
        },
    );
    // The store computes a facet nobody has computed yet as soon as its first
    // listener subscribes, so there is nothing to publish here.
    const ready = firstFacet;

    return {
        ready,
        getSnapshot: snapshot,
        subscribe(listener) {
            if (destroyed) {
                throw new Error(
                    '[ezclassify] facet binding has been destroyed',
                );
            }
            listeners.add(listener);
            listener(snapshot());
            return () => listeners.delete(listener);
        },
        setSelected(selected) {
            if (destroyed) {
                return Promise.reject(
                    new Error('[ezclassify] facet binding has been destroyed'),
                );
            }
            return publishFacetSelection(
                store,
                markingId,
                categoryId,
                selected,
                source,
            );
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            resolveFirstFacet();
            unsubscribeMarking();
            unsubscribeFacet();
            listeners.clear();
        },
    };
}

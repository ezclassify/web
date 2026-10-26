import { describe, expect, it, vi } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import {
    createEzClassifyFacetBinding,
    publishFacetSelection,
    replaceFacetAssertions,
} from './facet-binding';
import {
    EMPTY_FACET_STATE,
    type EzClassifyState,
    type EzClassifyStore,
} from './store/ezclassify-store';

const existing: Assertion[] = [
    {
        conceptId: 'SECRET',
        categoryId: 'level',
        confidence: 'certain',
        source: 'user',
    },
    {
        conceptId: 'ORCON',
        categoryId: 'controls',
        confidence: 'certain',
        source: 'user',
    },
];

describe('headless facet binding', () => {
    it('replaces only the category owned by a third-party control', () => {
        expect(
            replaceFacetAssertions(existing, 'controls', [
                'NOFORN',
                { conceptId: 'REL', value: 'USA, GBR' },
                'NOFORN',
            ]),
        ).toEqual([
            existing[0],
            {
                conceptId: 'NOFORN',
                categoryId: 'controls',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'REL',
                categoryId: 'controls',
                confidence: 'certain',
                source: 'user',
                value: 'USA, GBR',
            },
        ]);
    });

    it('publishes the merged assertions through the store', async () => {
        const publishAssertions = vi.fn().mockResolvedValue(undefined);
        const state: EzClassifyState = {
            rendered: 'SECRET//ORCON',
            renders: {},
            assertions: existing,
            valid: true,
            errors: [],
        };
        const store = {
            get: vi.fn(() => state),
            publishAssertions,
        } as unknown as EzClassifyStore;

        await publishFacetSelection(store, 'document', 'controls', ['NOFORN'], {
            token: 'material-select',
        });

        expect(publishAssertions).toHaveBeenCalledWith(
            'document',
            [
                existing[0],
                {
                    conceptId: 'NOFORN',
                    categoryId: 'controls',
                    confidence: 'certain',
                    source: 'user',
                },
            ],
            { token: 'material-select' },
            { categories: ['controls'] },
        );
    });

    it('exposes a DOM-free state/callback contract for controlled and jQuery-style widgets', async () => {
        let state: EzClassifyState = {
            rendered: 'SECRET//ORCON',
            renders: {},
            assertions: existing,
            valid: true,
            errors: [],
        };
        const markingListeners = new Set<(next: EzClassifyState) => void>();
        const facetListeners = new Set<
            (next: {
                allowableOptions: null;
                selectedAssertions: Assertion[];
            }) => void
        >();
        const store = {
            get: () => state,
            getFacet: () => EMPTY_FACET_STATE,
            subscribe: (
                _id: string,
                listener: (next: EzClassifyState) => void,
            ) => {
                markingListeners.add(listener);
                return () => markingListeners.delete(listener);
            },
            // A store computes a facet nobody has computed yet once its first
            // listener subscribes.
            subscribeFacet: (
                _id: string,
                _category: string,
                listener: (next: {
                    allowableOptions: null;
                    selectedAssertions: Assertion[];
                }) => void,
            ) => {
                facetListeners.add(listener);
                queueMicrotask(() =>
                    listener({
                        allowableOptions: null,
                        selectedAssertions: state.assertions.filter(
                            (a) => a.categoryId === 'controls',
                        ),
                    }),
                );
                return () => facetListeners.delete(listener);
            },
            publishAssertions: vi.fn(
                async (_id: string, assertions: Assertion[]) => {
                    state = {
                        ...state,
                        assertions,
                        rendered: 'SECRET//NOFORN',
                    };
                    for (const listener of markingListeners) listener(state);
                    for (const listener of facetListeners) {
                        listener({
                            allowableOptions: null,
                            selectedAssertions: assertions.filter(
                                (a) => a.categoryId === 'controls',
                            ),
                        });
                    }
                },
            ),
        } as unknown as EzClassifyStore;

        const binding = createEzClassifyFacetBinding(
            store,
            'document',
            'controls',
        );
        const updates: string[][] = [];
        binding.subscribe((next) => updates.push(next.selectedConceptIds));
        await binding.ready;

        // This is the only integration call a controlled component's onChange
        // or a jQuery plugin's `change` handler needs to make.
        await binding.setSelected(['NOFORN']);

        expect(binding.getSnapshot().selectedConceptIds).toEqual(['NOFORN']);
        expect(binding.getSnapshot().marking.rendered).toBe('SECRET//NOFORN');
        expect(updates).toContainEqual(['NOFORN']);

        binding.destroy();
        expect(markingListeners.size).toBe(0);
        expect(facetListeners.size).toBe(0);
    });

    it('does not report ready until the first governed choice snapshot arrives', async () => {
        let sendFacet:
            | ((state: {
                  allowableOptions: null;
                  selectedAssertions: Assertion[];
              }) => void)
            | undefined;
        const store = {
            get: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            getFacet: () => EMPTY_FACET_STATE,
            subscribe: () => () => {},
            subscribeFacet: (
                _id: string,
                _category: string,
                listener: typeof sendFacet,
            ) => {
                sendFacet = listener;
                return () => {};
            },
            publishAssertions: vi.fn().mockResolvedValue(undefined),
        } as unknown as EzClassifyStore;
        const binding = createEzClassifyFacetBinding(
            store,
            'document',
            'controls',
        );
        let ready = false;
        void binding.ready.then(() => {
            ready = true;
        });

        await Promise.resolve();
        expect(ready).toBe(false);

        sendFacet?.({ allowableOptions: null, selectedAssertions: [] });
        await binding.ready;
        expect(ready).toBe(true);
        binding.destroy();
    });

    it('settles a pending ready promise when destroyed before choices arrive', async () => {
        const store = {
            get: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            getFacet: () => EMPTY_FACET_STATE,
            subscribe: () => () => {},
            subscribeFacet: () => () => {},
            publishAssertions: vi.fn().mockResolvedValue(undefined),
        } as unknown as EzClassifyStore;
        const binding = createEzClassifyFacetBinding(
            store,
            'document',
            'controls',
        );

        binding.destroy();
        await expect(binding.ready).resolves.toBeUndefined();
    });
});

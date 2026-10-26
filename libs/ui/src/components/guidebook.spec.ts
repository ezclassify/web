/**
 * Tests for the Guidebook component.
 *
 * Covers basic rendering against a Context-bound guide and the
 * reference-surface vocabulary resolver: a guide with no `vocabulary` block
 * renders today's generic chrome byte-identically, while a guide that renames
 * its Guidebook is reflected in the panel's accessible name.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import type {
    GuideEngineAdapter,
    GuideStructuralView,
    LocalSchemeEngineAdapter,
    RemoteGuideEngineAdapter,
} from '@ezclassify/types';
import { Guidebook } from './guidebook';
import {
    loadCedarValley,
    loadCedarValleyGuide,
} from '@ezclassify/example-schemes/cedar-valley';
import {
    loadCedarValleyLevels,
    loadCedarValleyLevelsGuide,
} from '@ezclassify/example-schemes/cedar-valley-protection';

/**
 * Build a Context from a real scheme + guide engine pair. Context's guide slot
 * is populated only via `fromComponents` (raw YAML), so for pre-built engine
 * adapters we force-assign it directly, the same pattern
 * access-handbook.spec.ts uses for the access slot: safe at runtime, TypeScript
 * readonly is compile-time only.
 */
function contextWithGuide(
    scheme: LocalSchemeEngineAdapter,
    guide: GuideEngineAdapter,
): Context {
    const ctx = Context.fromSchemeEngine(scheme);
    (ctx as unknown as { guide: GuideEngineAdapter }).guide = guide;
    return ctx;
}

describe('Guidebook', () => {
    let container: HTMLDivElement;
    let guidebook: Guidebook;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        guidebook = new Guidebook();
    });

    it('renders a region with rule entries from the loaded guide', async () => {
        const ctx = contextWithGuide(loadCedarValley(), loadCedarValleyGuide());
        await guidebook.init(container, ctx);

        const region = container.querySelector('[role="region"]');
        expect(region).toBeTruthy();
        const entries = container.querySelectorAll('.ez-guidebook__entry');
        expect(entries.length).toBeGreaterThan(0);
    });

    describe('reference-surface vocabulary', () => {
        it('keeps the generic aria-label when the guide declares no vocabulary (byte-identical default)', async () => {
            const ctx = contextWithGuide(
                loadCedarValley(),
                loadCedarValleyGuide(),
            );
            await guidebook.init(container, ctx);

            const region = container.querySelector('[role="region"]');
            expect(region!.getAttribute('aria-label')).toBe('guide reference');
            const search = container.querySelector(
                '.ez-guidebook__search-input',
            );
            expect(search!.getAttribute('aria-label')).toBe(
                'Search guides rules',
            );
        });

        it('uses the generic Guidebook noun when the guide declares no reference vocabulary', async () => {
            const ctx = contextWithGuide(
                loadCedarValleyLevels(),
                loadCedarValleyLevelsGuide(),
            );
            await guidebook.init(container, ctx);

            const region = container.querySelector('[role="region"]');
            expect(region!.getAttribute('aria-label')).toBe('guide reference');
            // Regression: the search input must use the same resolved noun as
            // the region, not the generic "guides rules" chrome. Both surfaces
            // are read by a screen-reader user in the same pass; the renamed
            // artifact's word has to hold across the whole component.
            const search = container.querySelector(
                '.ez-guidebook__search-input',
            );
            expect(search!.getAttribute('aria-label')).toBe(
                'Search guides rules',
            );
        });

        it("prefers the guide engine's own getGuideMeta().referenceSurfaceLabel over re-deriving from the view's raw vocabulary map", async () => {
            const guideEngine = loadCedarValleyGuide();
            // Stub getGuideMeta to report a renamed surface even though the
            // underlying vocabulary the structural view carries declares none.
            // If Guidebook re-derives the label from the view instead of
            // consulting the engine's canonical field, this override is
            // silently ignored and the test fails.
            const originalGetGuideMeta =
                guideEngine.getGuideMeta.bind(guideEngine);
            guideEngine.getGuideMeta = ((guideId?: string) => {
                const meta = originalGetGuideMeta(guideId);
                return meta
                    ? {
                          ...meta,
                          referenceSurfaceLabel: {
                              singular: 'Stubbed Guide Meta',
                              plural: 'Stubbed Guide Metas',
                          },
                      }
                    : meta;
            }) as typeof guideEngine.getGuideMeta;

            const ctx = contextWithGuide(loadCedarValley(), guideEngine);
            await guidebook.init(container, ctx);

            const region = container.querySelector('[role="region"]');
            expect(region!.getAttribute('aria-label')).toBe(
                'Stubbed Guide Meta',
            );
        });
    });

    describe('against a guide engine that answers asynchronously', () => {
        /**
         * Wrap a real guide engine in the remote narrowing of the adapter
         * contract: `RemoteGuideEngineAdapter.buildGuideViews()` returns a
         * promise. Every other guide mock in this file is the local narrowing,
         * which never exercises a second turn of the loop.
         *
         * `release` hands the test the resolution moment, so it can assert what
         * the panel looks like before the views arrive as well as after.
         */
        function remoteGuide(local: GuideEngineAdapter): {
            guide: RemoteGuideEngineAdapter;
            release: () => void;
            fail: (error: Error) => void;
        } {
            let release!: () => void;
            let fail!: (error: Error) => void;
            const views = new Promise<GuideStructuralView[]>(
                (resolve, reject) => {
                    release = () =>
                        resolve(
                            local.buildGuideViews() as GuideStructuralView[],
                        );
                    fail = reject;
                },
            );
            const guide = Object.create(local) as RemoteGuideEngineAdapter;
            guide.buildGuideViews = () => views;
            return { guide, release, fail };
        }

        it('renders the rule entries once the views resolve', async () => {
            const { guide, release } = remoteGuide(loadCedarValleyGuide());
            const ctx = contextWithGuide(loadCedarValley(), guide);

            await guidebook.init(container, ctx);
            expect(container.querySelector('.ez-guidebook__entry')).toBeNull();

            release();
            await vi.waitFor(() =>
                expect(
                    container.querySelectorAll('.ez-guidebook__entry').length,
                ).toBeGreaterThan(0),
            );
            expect(
                container
                    .querySelector('[role="region"]')!
                    .getAttribute('aria-label'),
            ).toBe('guide reference');
        });

        it('paints an unavailable state when the views cannot be read', async () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const { guide, fail } = remoteGuide(loadCedarValleyGuide());
            const ctx = contextWithGuide(loadCedarValley(), guide);

            await guidebook.init(container, ctx);
            fail(new Error('guide fetch failed'));

            const failed = await vi.waitFor(() => {
                const el = container.querySelector<HTMLElement>(
                    '.ez-guidebook__error',
                );
                expect(el).not.toBeNull();
                return el!;
            });
            // A reference panel that renders blank on a failed fetch reads as
            // "this guide has no rules", which is the opposite of what is
            // known. Same distinction AccessHandbook draws.
            expect(failed.getAttribute('role')).toBe('alert');
            expect(failed.textContent).toContain('unavailable');
            expect(consoleError).toHaveBeenCalled();
            consoleError.mockRestore();
        });

        it('does not resurrect a panel destroyed while the views were in flight', async () => {
            const { guide, release } = remoteGuide(loadCedarValleyGuide());
            const ctx = contextWithGuide(loadCedarValley(), guide);

            await guidebook.init(container, ctx);
            guidebook.destroy();
            release();
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(container.innerHTML).toBe('');
        });
    });
});

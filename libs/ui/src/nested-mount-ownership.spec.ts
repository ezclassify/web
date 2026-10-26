/**
 * Nested-mount ownership invariants the characterization harness
 * (nested-mount-harness.spec.ts) does not cover: the outer-first construction
 * race (reclaim-on-register), the shared default-rollupId sink collision, the
 * synchronous depth-2 settle, the cross-family independence rule,
 * removed-subtree-descendant teardown, and the StrictMode mount/unmount/remount
 * cleanup path.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';
import { __resetMountRollupRegistry } from './mount-rollup-registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

function loadScheme(): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    );
}
function newEngine() {
    return Context.fromComponents({ scheme: loadScheme() });
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++)
        await new Promise<void>((r) => setTimeout(r, 25));
}

/**
 * Ref-scheme-1 with an embedded-marking pattern, so a marked text area finds
 * `(LOW)` and `(HIGH)` portions in its body text.
 */
function newMarkedEngine() {
    const document = loadScheme() as { scheme: Record<string, unknown> };
    return Context.fromComponents({
        scheme: {
            ...document,
            scheme: {
                ...document.scheme,
                embedded_marking: [
                    { pattern: '\\(([^)]+)\\)', template: '({marking}) ' },
                ],
            },
        },
    });
}

function mountSiblingsFor(host: HTMLElement): HTMLElement[] {
    const parent = host.parentElement;
    if (!parent) return [];
    return Array.from(
        parent.querySelectorAll<HTMLElement>(
            ':scope > [data-ezclassify-mount]',
        ),
    );
}
function rollupValueOf(root: HTMLElement, rollupId: string): string {
    return root.querySelector<HTMLInputElement>('#' + rollupId)?.value ?? '';
}
function fieldIdsOf(ui: EzClassifyUI): string[] {
    return (ui as unknown as { fields: HTMLElement[] }).fields.map((f) => f.id);
}
function mountedHosts(ui: EzClassifyUI): Map<HTMLElement, unknown> {
    return (ui as unknown as { mounted: Map<HTMLElement, unknown> }).mounted;
}

describe('nested-mount fix invariants', () => {
    let container: HTMLDivElement;
    const uis: EzClassifyUI[] = [];

    beforeEach(() => {
        __resetMountRollupRegistry();
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(() => {
        for (const ui of uis.splice(0)) {
            try {
                ui.destroy();
            } catch {
                /* torn down */
            }
        }
        container.remove();
        __resetMountRollupRegistry();
    });
    function track<T extends EzClassifyUI>(ui: T): T {
        uis.push(ui);
        return ui;
    }

    // -------------------------------------------------------------------------
    // Outer-first construction race, reclaim-on-register.
    // The OUTER instance is constructed FIRST (region mounts before field), so
    // it enhances the inner host before the inner root
    // is even stamped. When the inner instance then constructs, its reclaim
    // sweep must release the host from the outer and take sole ownership →
    // exactly one mount sibling, owned by the inner.
    // -------------------------------------------------------------------------
    it('reclaim-on-register: outer-first order still yields a single owner', async () => {
        const outer = container;
        const inner = document.createElement('div');
        outer.appendChild(inner);
        const field = document.createElement('input');
        field.id = 'race-field';
        field.setAttribute('data-ezclassify-controller', 'tags');
        inner.appendChild(field);

        // OUTER first, it enhances the field while no inner boundary exists yet.
        const outerUI = track(
            new EzClassifyUI(newEngine(), {
                root: outer,
                rollupId: 'race-outer',
            }),
        );
        await settle();
        // INNER second, its reclaim sweep must take the field away from outer.
        const innerUI = track(
            new EzClassifyUI(newEngine(), {
                root: inner,
                rollupId: 'race-inner',
            }),
        );
        await settle();

        expect(mountSiblingsFor(field).length).toBe(1);
        expect(fieldIdsOf(outerUI)).not.toContain('race-field');
        expect(fieldIdsOf(innerUI)).toContain('race-field');
    });

    // The text editor fields keep their host visible by moving it into a
    // wrapper, so the host is not its mount's previous sibling. The nested
    // scope still has to find and reclaim it, or the field's markings keep
    // feeding the outer scope's aggregate rather than the nested whole.
    it.each([
        {
            controller: 'marked-textarea',
            tag: 'textarea',
            value: '(HIGH) The plan.',
        },
        { controller: 'marked-input', tag: 'input', value: '(HIGH) The plan.' },
        { controller: 'marking', tag: 'input', value: 'HIGH' },
    ] as const)(
        'reclaim-on-register: a $controller field moves to the nested scope with its markings',
        async ({ controller, tag, value }) => {
            const outer = container;
            const outerField = document.createElement('input');
            outerField.id = 'nest-outer-field';
            outerField.setAttribute('data-ezclassify-controller', 'tags');
            outerField.value = 'LOW';
            outer.appendChild(outerField);
            const inner = document.createElement('div');
            outer.appendChild(inner);
            const body = document.createElement(tag);
            body.id = 'nest-body';
            body.setAttribute('data-ezclassify-controller', controller);
            body.value = value;
            inner.appendChild(body);

            const outerUI = track(
                new EzClassifyUI(newMarkedEngine(), {
                    root: outer,
                    rollupId: 'nest-outer',
                }),
            );
            await settle();
            expect(mountedHosts(outerUI).has(body)).toBe(true);

            const innerUI = track(
                new EzClassifyUI(newMarkedEngine(), {
                    root: inner,
                    rollupId: 'nest-inner',
                }),
            );
            await settle();

            expect(mountedHosts(outerUI).has(body)).toBe(false);
            expect(mountedHosts(innerUI).has(body)).toBe(true);
            expect(
                inner.querySelectorAll(':scope > [data-ezclassify-mount]'),
            ).toHaveLength(1);
            // The field's marking rolls up into the nested whole, and reaches the
            // outer scope only as that whole: the outer store holds its own field
            // alone.
            expect(rollupValueOf(inner, 'nest-inner')).toBe('HIGH');
            expect(innerUI.store.getAggregate().rendered).toBe('HIGH');
            expect(outerUI.store.getAggregate().rendered).toBe('LOW');
            expect(rollupValueOf(outer, 'nest-outer')).toBe('HIGH');
        },
    );

    // -------------------------------------------------------------------------
    // Default-rollupId sink collision. Both nested instances use the SHARED
    // default rollup id 'ezclassify-rollup'. Each
    // must get its OWN sink, the child must not hijack the parent's sink.
    // -------------------------------------------------------------------------
    it('default-rollupId: nested instances do not share one sink', async () => {
        const outer = container;
        const inner = document.createElement('div');
        outer.appendChild(inner);
        const field = document.createElement('input');
        field.id = 'def-field';
        field.setAttribute('data-ezclassify-controller', 'tags');
        field.value = 'HIGH';
        inner.appendChild(field);

        track(new EzClassifyUI(newEngine(), { root: outer })); // default 'ezclassify-rollup'
        track(new EzClassifyUI(newEngine(), { root: inner })); // default 'ezclassify-rollup'
        await settle();

        // Two distinct sink inputs exist (one per scope root).
        const outerSink = outer.querySelector(':scope > #ezclassify-rollup');
        const innerSink = inner.querySelector(':scope > #ezclassify-rollup');
        expect(outerSink).not.toBeNull();
        expect(innerSink).not.toBeNull();
        expect(outerSink).not.toBe(innerSink);
    });

    // -------------------------------------------------------------------------
    // Depth-2 synchronous settle. A leaf change in the inner scope must reach the
    // outer (page) banner within the settle window, the child notifies the
    // parent synchronously (flushRollupNow), bypassing the parent debounce.
    // -------------------------------------------------------------------------
    it('depth-2 settle: an inner field marking reaches the outer banner', async () => {
        const outer = container;
        const inner = document.createElement('div');
        outer.appendChild(inner);
        const field = document.createElement('input');
        field.id = 'd2-field';
        field.setAttribute('data-ezclassify-controller', 'tags');
        field.value = 'HIGH';
        inner.appendChild(field);

        track(
            new EzClassifyUI(newEngine(), {
                root: outer,
                rollupId: 'd2-outer',
            }),
        );
        track(
            new EzClassifyUI(newEngine(), {
                root: inner,
                rollupId: 'd2-inner',
            }),
        );
        await settle();

        expect(rollupValueOf(inner, 'd2-inner')).toContain('HIGH');
        expect(rollupValueOf(outer, 'd2-outer')).toContain('HIGH');
    });

    // -------------------------------------------------------------------------
    // Same-scheme co-aggregation is lossless. An outer field (LOW) and an inner
    // field (HIGH) on the SAME scheme compose: the outer banner reflects the
    // engine max-rollup of both (HIGH), not just one.
    // -------------------------------------------------------------------------
    it('same-scheme: outer banner co-aggregates own field + child whole', async () => {
        const outer = container;
        const outerField = document.createElement('input');
        outerField.id = 'ss-outer-field';
        outerField.setAttribute('data-ezclassify-controller', 'tags');
        outerField.value = 'LOW';
        outer.appendChild(outerField);

        const inner = document.createElement('div');
        outer.appendChild(inner);
        const innerField = document.createElement('input');
        innerField.id = 'ss-inner-field';
        innerField.setAttribute('data-ezclassify-controller', 'tags');
        innerField.value = 'HIGH';
        inner.appendChild(innerField);

        track(
            new EzClassifyUI(newEngine(), {
                root: outer,
                rollupId: 'ss-outer',
            }),
        );
        track(
            new EzClassifyUI(newEngine(), {
                root: inner,
                rollupId: 'ss-inner',
            }),
        );
        await settle();

        // ref-scheme-1 level is a max rollup → the higher marking wins.
        expect(rollupValueOf(outer, 'ss-outer')).toContain('HIGH');
    });

    // -------------------------------------------------------------------------
    // Removed-subtree descendant teardown. Remove a CONTAINER that holds an
    // enhanced host (not the host directly). The observer must recurse the
    // removed subtree and release the descendant host's component.
    // -------------------------------------------------------------------------
    it('removed subtree: descendants are torn down, not leaked', async () => {
        const root = container;
        const wrapper = document.createElement('div');
        const host = document.createElement('div');
        host.id = 'sub-host';
        host.setAttribute('data-ezclassify-controller', 'banner');
        wrapper.appendChild(host);
        root.appendChild(wrapper);

        const ui = track(
            new EzClassifyUI(newEngine(), { root, rollupId: 'sub-rollup' }),
        );
        await settle();
        const components = (
            ui as unknown as { components: Map<HTMLElement, unknown> }
        ).components;
        const before = components.size;
        expect(before).toBeGreaterThanOrEqual(1);

        // Remove the WRAPPER (the host is a descendant, not the removed node).
        wrapper.remove();
        await settle();

        expect(components.size).toBe(before - 1);
    });

    // -------------------------------------------------------------------------
    // StrictMode-style mount/unmount/remount. Construct, destroy, reconstruct on
    // the same root. The registry/owner state from the first instance must not
    // leak into the second, the field is enhanced exactly once after remount.
    // -------------------------------------------------------------------------
    it('strictmode: remount on the same root yields a single owner', async () => {
        const root = container;
        const field = document.createElement('input');
        field.id = 'sm-field';
        field.setAttribute('data-ezclassify-controller', 'tags');
        root.appendChild(field);

        const first = new EzClassifyUI(newEngine(), {
            root,
            rollupId: 'sm-rollup',
        });
        await settle();
        first.destroy();
        await settle();

        const second = track(
            new EzClassifyUI(newEngine(), { root, rollupId: 'sm-rollup' }),
        );
        await settle();

        expect(mountSiblingsFor(field).length).toBe(1);
        expect(fieldIdsOf(second)).toContain('sm-field');
    });
});

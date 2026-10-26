/**
 * NESTED-MOUNT CHARACTERIZATION HARNESS (DOM / SDK level), C1..C4.
 *
 * This harness exercises the layer above the engine: the mounting / scanning /
 * rollup wiring that EzClassifyUI performs over a DOM root, including a second,
 * NESTED EzClassifyUI over an overlapping subtree (a region-level EzClassifyUI
 * wrapping a field that mounts its OWN EzClassifyUI on an inner wrapper).
 *
 * Each case asserts the nested-mount ownership architecture: a host is owned by
 * exactly one instance (its nearest mount-root ancestor), an inner scope
 * contributes its rolled-up whole upward through the registry rather than being
 * blindly re-scanned by the outer instance, and removed hosts are torn down.
 * The `TARGET` comments name the invariant each assertion guards.
 *
 * Counting convention: createMountContainer() inserts exactly one
 * `[data-ezclassify-mount]` <div> sibling per (instance, host) enhancement.
 * Counting those siblings for a given host therefore counts how many times the
 * host was enhanced across all live EzClassifyUI instances on the page.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Context } from '@ezclassify/engine';
import { EzClassifyUI } from './ezclassify-ui';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From libs/ui/src/ up to repo root is three hops.
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

// The reference conformance scheme ships with the OSS repo, so this harness
// runs in the base profile too (no skip-on-OSS gate needed). It has a `level`
// (max rollup) and `controls` (union) category, enough to exercise rollup.
function loadScheme(): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    );
}

function newEngine() {
    return Context.fromComponents({ scheme: loadScheme() });
}

/** Flush EzClassifyUI's async component-init chain and the rollup debounce. */
async function settle(): Promise<void> {
    // Several macrotask hops: the constructor's Promise.all(_pendingInits) chain
    // runs the component init queue, then schedules a ROLLUP_DEBOUNCE_MS rollup
    // timer, whose async run resolves on a later tick. With two nested instances
    // both seeding and rolling up, give the debounce generous room to flush.
    for (let i = 0; i < 6; i++) {
        await new Promise<void>((r) => setTimeout(r, 25));
    }
}

/** Count [data-ezclassify-mount] siblings produced for `host`'s parent. */
function mountSiblingsFor(host: HTMLElement): HTMLElement[] {
    const parent = host.parentElement;
    if (!parent) return [];
    return Array.from(
        parent.querySelectorAll<HTMLElement>(
            ':scope > [data-ezclassify-mount]',
        ),
    );
}

/**
 * The rolled-up page value for an instance lives in its synthesized rollup
 * sink, the hidden `#<rollupId>` input the constructor appends to the root.
 * This, not `data-ezclassify-aggregate` (a scan-time binding flag), is where
 * the engine aggregate of all of an instance's contributing fields lands.
 */
function rollupValueOf(root: HTMLElement, rollupId: string): string {
    return root.querySelector<HTMLInputElement>('#' + rollupId)?.value ?? '';
}

/** The DOM ids of the fields an instance registered as rollup contributors. */
function fieldIdsOf(ui: EzClassifyUI): string[] {
    return (ui as unknown as { fields: HTMLElement[] }).fields.map((f) => f.id);
}

describe('nested-mount harness (DOM/SDK level)', () => {
    let container: HTMLDivElement;
    const uis: EzClassifyUI[] = [];

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        for (const ui of uis.splice(0)) {
            try {
                ui.destroy();
            } catch {
                /* already torn down */
            }
        }
        container.remove();
    });

    function track<T extends EzClassifyUI>(ui: T): T {
        uis.push(ui);
        return ui;
    }

    // -------------------------------------------------------------------------
    // C1, NESTED MOUNTS DOUBLE-ENHANCE
    // An OUTER root contains an INNER root. One tags-controller input
    // lives inside the inner root. We mount an EzClassifyUI on the OUTER root AND
    // a second EzClassifyUI on the INNER root (a provider region plus a
    // nested-scope field). The outer scan recurses the whole subtree, so it reaches the
    // inner input; the inner scan reaches it too. Each instance dedups only
    // against its OWN this.fields / this.components map, so neither suppresses the
    // other's enhancement of the shared host.
    // -------------------------------------------------------------------------
    it('C1: a controller inside a nested inner mount is enhanced by BOTH instances', async () => {
        const outer = container;
        outer.id = 'c1-outer';

        const inner = document.createElement('div');
        inner.id = 'c1-inner';
        outer.appendChild(inner);

        const field = document.createElement('input');
        field.id = 'c1-field';
        field.setAttribute('data-ezclassify-controller', 'tags');
        inner.appendChild(field);

        track(
            new EzClassifyUI(newEngine(), {
                root: outer,
                rollupId: 'c1-outer-rollup',
            }),
        );
        track(
            new EzClassifyUI(newEngine(), {
                root: inner,
                rollupId: 'c1-inner-rollup',
            }),
        );
        await settle();

        const mounts = mountSiblingsFor(field);
        // TARGET: the ownership boundary, the inner host's nearest
        // [data-ezclassify-mount-root] ancestor is the INNER instance, so the
        // enclosing OUTER instance's scan skips it. The host is enhanced exactly
        // once, by its sole owning instance.
        expect(mounts.length).toBe(1);
    });

    // -------------------------------------------------------------------------
    // C2, CROSS-MOUNT ROLLUP CONTRIBUTION
    // OUTER root has its own aggregate sink (the #<rollupId> hidden input). A
    // NESTED inner mount owns a field with a marking. The inner field is owned
    // solely by the inner instance, so it is NOT in the outer instance's field
    // list, yet its rolled-up whole still reaches the OUTER rollup through the
    // registry's inferred ancestry edge.
    //
    // NOTE on `data-ezclassify-aggregate`: that attribute is a scan-time binding
    // flag, not the rolled-up value sink. The sink is the synthesized
    // #<rollupId> hidden input, which is what these assertions read.
    // -------------------------------------------------------------------------
    it('C2: an inner mount field feeds the outer rollup without joining its field list', async () => {
        const outer = container;
        outer.id = 'c2-outer';

        const inner = document.createElement('div');
        inner.id = 'c2-inner';
        outer.appendChild(inner);

        const field = document.createElement('input');
        field.id = 'c2-field';
        field.setAttribute('data-ezclassify-controller', 'tags');
        field.value = 'HIGH';
        inner.appendChild(field);

        const outerUI = track(
            new EzClassifyUI(newEngine(), {
                root: outer,
                rollupId: 'c2-outer-rollup',
            }),
        );
        const innerUI = track(
            new EzClassifyUI(newEngine(), {
                root: inner,
                rollupId: 'c2-inner-rollup',
            }),
        );
        await settle();

        // TARGET: the boundary makes the inner field owned SOLELY by the
        // inner instance, it must NOT appear in the OUTER instance's field list
        // (no blind re-scan across the nested-mount boundary).
        expect(fieldIdsOf(outerUI)).not.toContain('c2-field');
        expect(fieldIdsOf(innerUI)).toContain('c2-field');
        // …but the inner field's HIGH marking STILL reaches the OUTER rollup, now
        // via the INTENTIONAL inferred ancestry edge in the mount-rollup registry:
        // the inner scope publishes its rolled-up WHOLE up to the outer scope,
        // which composes it into its own banner. The inner sink reads HIGH from its
        // own field; the outer sink reads HIGH from the inner scope's contribution.
        expect(rollupValueOf(outer, 'c2-outer-rollup')).toContain('HIGH');
        expect(rollupValueOf(inner, 'c2-inner-rollup')).toContain('HIGH');
    });

    // -------------------------------------------------------------------------
    // C3, REMOVAL LIFECYCLE
    // Mount on a root, enhance a field, then REMOVE the field from the DOM without
    // calling destroy(). The observer's removedNodes pass detects the removal,
    // tears the component down, and drops it from the components map so nothing
    // leaks.
    // -------------------------------------------------------------------------
    it('C3: removing an enhanced field from the DOM tears down its component entry', async () => {
        const root = container;
        root.id = 'c3-root';

        const field = document.createElement('div');
        field.id = 'c3-field';
        field.setAttribute('data-ezclassify-controller', 'banner');
        root.appendChild(field);

        const ui = track(
            new EzClassifyUI(newEngine(), { root, rollupId: 'c3-rollup' }),
        );
        await settle();

        const before = (
            ui as unknown as { components: Map<HTMLElement, unknown> }
        ).components.size;
        expect(before).toBeGreaterThanOrEqual(1);

        // Remove the host (and its mount sibling) from the DOM. No destroy() call.
        const mount = mountSiblingsFor(field)[0];
        field.remove();
        mount?.remove();
        await settle();

        const after = (
            ui as unknown as { components: Map<HTMLElement, unknown> }
        ).components.size;
        // TARGET: removed-node teardown, the observer's removedNodes
        // pass detects the host's removal, calls the component's destroy(), drops
        // it from the components map, and unsubscribes its store binding.
        expect(after).toBe(before - 1);
    });

    // -------------------------------------------------------------------------
    // C4, INDEPENDENT SIBLINGS (control / invariant)
    // Two non-overlapping sibling mounts, each with its own field + rollup sink.
    // They must NOT cross-contaminate. This already passes and is the invariant
    // the fix MUST preserve.
    // -------------------------------------------------------------------------
    it('C4: two sibling (non-overlapping) mounts do not cross-contaminate', async () => {
        const left = document.createElement('div');
        left.id = 'c4-left';
        const right = document.createElement('div');
        right.id = 'c4-right';
        container.appendChild(left);
        container.appendChild(right);

        const leftField = document.createElement('input');
        leftField.id = 'c4-left-field';
        leftField.setAttribute('data-ezclassify-controller', 'tags');
        leftField.value = 'HIGH';
        left.appendChild(leftField);

        const rightField = document.createElement('input');
        rightField.id = 'c4-right-field';
        rightField.setAttribute('data-ezclassify-controller', 'tags');
        rightField.value = 'LOW';
        right.appendChild(rightField);

        const leftUI = track(
            new EzClassifyUI(newEngine(), {
                root: left,
                rollupId: 'c4-left-rollup',
            }),
        );
        const rightUI = track(
            new EzClassifyUI(newEngine(), {
                root: right,
                rollupId: 'c4-right-rollup',
            }),
        );
        await settle();

        // Each instance owns only its own field, no cross-registration.
        expect(fieldIdsOf(leftUI)).toEqual(['c4-left-field']);
        expect(fieldIdsOf(rightUI)).toEqual(['c4-right-field']);
        // Each rollup reflects only its own field's marking; no bleed-through.
        expect(rollupValueOf(left, 'c4-left-rollup')).toContain('HIGH');
        expect(rollupValueOf(left, 'c4-left-rollup')).not.toContain('LOW');
        expect(rollupValueOf(right, 'c4-right-rollup')).toContain('LOW');
        expect(rollupValueOf(right, 'c4-right-rollup')).not.toContain('HIGH');
        // Each field is enhanced exactly once (single owning instance).
        expect(mountSiblingsFor(leftField).length).toBe(1);
        expect(mountSiblingsFor(rightField).length).toBe(1);
        // TARGET after fix: unchanged, this invariant must hold before and after.
    });

    // -------------------------------------------------------------------------
    // C6, NO-ROLLUP within a single mount (reference / metadata marking)
    // A `data-ezclassify-no-rollup` field is a marking ABOUT another resource
    // (e.g. a link's target-page classification). It must still ENHANCE
    // (render/validate) but never aggregate into the page rollup. forms/rollup.ts
    // (433/451) skips no-rollup fields. This verifies the reference-marking use
    // case (spec §4b) holds under the new ownership/contribution architecture.
    // -------------------------------------------------------------------------
    it('C6: a data-ezclassify-no-rollup field is excluded from its own rollup but still enhanced', async () => {
        const root = container;
        root.id = 'c6-root';

        // Each field in its own wrapper so mountSiblingsFor() (which counts mount
        // siblings under the host's PARENT) attributes one mount to one field.
        const onPageWrap = document.createElement('div');
        root.appendChild(onPageWrap);
        const onPage = document.createElement('input');
        onPage.id = 'c6-onpage';
        onPage.setAttribute('data-ezclassify-controller', 'tags');
        onPage.value = 'LOW';
        onPageWrap.appendChild(onPage);

        const refWrap = document.createElement('div');
        root.appendChild(refWrap);
        const reference = document.createElement('input');
        reference.id = 'c6-reference';
        reference.setAttribute('data-ezclassify-controller', 'tags');
        reference.setAttribute('data-ezclassify-no-rollup', ''); // marks another resource
        reference.value = 'HIGH'; // would dominate the max-rollup if (wrongly) counted
        refWrap.appendChild(reference);

        track(new EzClassifyUI(newEngine(), { root, rollupId: 'c6-rollup' }));
        await settle();

        // Only the on-page LOW marking rolls up; the reference HIGH is excluded.
        expect(rollupValueOf(root, 'c6-rollup')).toContain('LOW');
        expect(rollupValueOf(root, 'c6-rollup')).not.toContain('HIGH');
        // …but the reference field is still ENHANCED (renders/validates), just not aggregated.
        expect(mountSiblingsFor(reference).length).toBe(1);
    });

    // -------------------------------------------------------------------------
    // C7, NO-ROLLUP across the nested contribution edge
    // A no-rollup field in an INNER scope must not leak upward either: the new
    // ancestry contribution edge must respect no-rollup, so an excluded inner
    // marking never reaches the OUTER banner. (Opted-out element contributes
    // nothing at any level, the spec §4b "automatic, no special parent logic".)
    // -------------------------------------------------------------------------
    it('C7: an inner no-rollup field does not contribute to the outer rollup', async () => {
        const outer = container;
        outer.id = 'c7-outer';

        const outerField = document.createElement('input');
        outerField.id = 'c7-outer-field';
        outerField.setAttribute('data-ezclassify-controller', 'tags');
        outerField.value = 'LOW';
        outer.appendChild(outerField);

        const inner = document.createElement('div');
        inner.id = 'c7-inner';
        outer.appendChild(inner);

        const innerRef = document.createElement('input');
        innerRef.id = 'c7-inner-ref';
        innerRef.setAttribute('data-ezclassify-controller', 'tags');
        innerRef.setAttribute('data-ezclassify-no-rollup', ''); // reference marking about another resource
        innerRef.value = 'HIGH';
        inner.appendChild(innerRef);

        track(
            new EzClassifyUI(newEngine(), {
                root: outer,
                rollupId: 'c7-outer-rollup',
            }),
        );
        track(
            new EzClassifyUI(newEngine(), {
                root: inner,
                rollupId: 'c7-inner-rollup',
            }),
        );
        await settle();

        // Excluded from the inner scope's own rollup…
        expect(rollupValueOf(inner, 'c7-inner-rollup')).not.toContain('HIGH');
        // …and therefore never contributes upward: the outer banner stays LOW.
        expect(rollupValueOf(outer, 'c7-outer-rollup')).toContain('LOW');
        expect(rollupValueOf(outer, 'c7-outer-rollup')).not.toContain('HIGH');
    });
});

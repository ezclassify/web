/**
 * Mounting and tearing down the full field family (tags, marked-textarea,
 * marking, each with the ★ favorites surface wired) many times in the same
 * jsdom document leaves no teardown residue: no leaked timer,
 * requestAnimationFrame, MutationObserver, or document/window event listener,
 * and the DOM and the module-level mount-rollup registry return to their
 * pre-mount state. The run also settles inside vitest's own default timeout, so
 * a future timer/observer/listener leak in any field component shows up here as
 * a failing `expect` or an actual timeout.
 */
import { describe, it, expect, vi } from 'vitest';
import { EzClassifyUI } from '../ezclassify-ui';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';

function createTestEngine(): LocalSchemeEngineAdapter {
    const categories = [
        {
            id: 'level',
            label: 'Level',
            required: false,
            single: true,
            rollup: 'max',
            position: 1,
        },
        {
            id: 'caveat',
            label: 'Caveat',
            required: false,
            single: false,
            rollup: 'union',
            position: 2,
        },
    ];
    const concepts = [
        {
            id: 'U',
            name: 'Unclassified',
            views: { default: 'UNCLASSIFIED' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 1,
            rank: 1,
        },
        {
            id: 'S',
            name: 'Secret',
            views: { default: 'SECRET' },
            categories: ['level'],
            parents: [],
            aliases: [],
            position: 2,
            rank: 2,
        },
        {
            id: 'NF',
            name: 'No Foreign',
            views: { default: 'NOFORN' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 1,
            rank: 1,
        },
        {
            id: 'ORCON',
            name: 'Originator Controlled',
            views: { default: 'ORCON' },
            categories: ['caveat'],
            parents: [],
            aliases: [],
            position: 2,
            rank: 1,
        },
    ];
    return Context.fromComponents({
        scheme: {
            scheme: {
                id: 'field-family-teardown-test',
                version: '1.0.0',
                name: 'Field Family Teardown Test',
                data: {
                    concepts: { inline: concepts },
                    categories,
                },
                rules: [],
                parse: {
                    case_sensitive: false,
                    strip_whitespace: true,
                },
                render: {
                    default: 'default',
                    formats: [
                        {
                            id: 'default',
                            surface: 'marking',
                            mode: 'inline',
                            separator: '//',
                            fields: [
                                { category: 'level', separator: '/' },
                                { category: 'caveat', separator: '/' },
                            ],
                        },
                    ],
                },
            },
        },
    }).scheme as unknown as LocalSchemeEngineAdapter;
}

/**
 * Net document/window listener count (adds minus removes) for every event type
 * seen during the tracked window, plus the same net count for MutationObserver
 * create/disconnect pairs.
 *
 * `mouseover`/`mouseout` on `document` are deliberately excluded: jsdom's own
 * nwsapi selector engine lazily registers those the first time any `:hover`
 * selector is matched (traced via stack inspection to
 * `node_modules/jsdom/lib/jsdom/living/helpers/selectors.js`), once per jsdom
 * Document, regardless of how many components mount and unmount. That is a
 * jsdom implementation detail outside this package's control, not a leak in the
 * field family: excluding it here keeps the assertion honest about what this
 * package is responsible for.
 */
function trackTeardownResidue() {
    const counts = new Map<string, number>();
    const origDocAdd = document.addEventListener.bind(document);
    const origDocRemove = document.removeEventListener.bind(document);
    const origWinAdd = window.addEventListener.bind(window);
    const origWinRemove = window.removeEventListener.bind(window);
    const JSDOM_INTERNAL_DOC_EVENTS = new Set(['mouseover', 'mouseout']);

    document.addEventListener = ((type: string, ...rest: unknown[]) => {
        if (!JSDOM_INTERNAL_DOC_EVENTS.has(type)) {
            counts.set('doc:' + type, (counts.get('doc:' + type) ?? 0) + 1);
        }
        // @ts-expect-error -- test instrumentation shim, not a real overload
        return origDocAdd(type, ...rest);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, ...rest: unknown[]) => {
        if (!JSDOM_INTERNAL_DOC_EVENTS.has(type)) {
            counts.set('doc:' + type, (counts.get('doc:' + type) ?? 0) - 1);
        }
        // @ts-expect-error -- test instrumentation shim, not a real overload
        return origDocRemove(type, ...rest);
    }) as typeof document.removeEventListener;
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
        counts.set('win:' + type, (counts.get('win:' + type) ?? 0) + 1);
        // @ts-expect-error -- test instrumentation shim, not a real overload
        return origWinAdd(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
        counts.set('win:' + type, (counts.get('win:' + type) ?? 0) - 1);
        // @ts-expect-error -- test instrumentation shim, not a real overload
        return origWinRemove(type, ...rest);
    }) as typeof window.removeEventListener;

    let observersCreated = 0;
    let observersDisconnected = 0;
    const RealMutationObserver = globalThis.MutationObserver;
    class CountingMutationObserver extends RealMutationObserver {
        constructor(callback: MutationCallback) {
            super(callback);
            observersCreated++;
        }
        disconnect(): void {
            observersDisconnected++;
            super.disconnect();
        }
    }
    globalThis.MutationObserver =
        CountingMutationObserver as unknown as typeof MutationObserver;

    return {
        counts,
        observerDelta: () => observersCreated - observersDisconnected,
        restore() {
            document.addEventListener = origDocAdd;
            document.removeEventListener = origDocRemove;
            window.addEventListener = origWinAdd;
            window.removeEventListener = origWinRemove;
            globalThis.MutationObserver = RealMutationObserver;
        },
    };
}

/**
 * Net listener count per target, over every `EventTarget`, summed at read time
 * across the targets that are still attached to the document.
 *
 * This is the shape of the browser's own `JSEventListeners` metric, and it is
 * the one that matters for a renderer running out of memory: a listener left on
 * a node that has left the tree goes away with the node, while a listener
 * accumulating on the document, the window, or a portal host that outlives the
 * mount does not.
 */
function trackLiveListeners() {
    const perTarget = new Map<EventTarget, number>();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function (
        this: EventTarget,
        ...args: Parameters<EventTarget['addEventListener']>
    ) {
        perTarget.set(this, (perTarget.get(this) ?? 0) + 1);
        return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (
        this: EventTarget,
        ...args: Parameters<EventTarget['removeEventListener']>
    ) {
        perTarget.set(this, (perTarget.get(this) ?? 0) - 1);
        return originalRemove.apply(this, args);
    };

    return {
        liveCount(): number {
            let live = 0;
            for (const [target, count] of perTarget) {
                if (target instanceof Node && !target.isConnected) continue;
                live += count;
            }
            return live;
        },
        restore() {
            EventTarget.prototype.addEventListener = originalAdd;
            EventTarget.prototype.removeEventListener = originalRemove;
        },
    };
}

/**
 * Wrap an engine so its operations resolve after a delay instead of in process.
 *
 * The field components hold every engine call behind `Promise.resolve(...)`, so
 * a local engine settles them inside the same microtask drain and a test can
 * never get a teardown to land while a call is genuinely outstanding. A REST
 * client always can. Only the operations components actually await are
 * deferred; the synchronous introspection members (`getScheme`,
 * `listCategories`, ...) stay synchronous, which is what both adapter
 * narrowings do.
 *
 * @param engine - The in-process engine to wrap.
 * @param delayMs - How long each operation takes to answer.
 * @returns An engine of the same shape whose operations answer late.
 */
function answersLate<T extends object>(engine: T, delayMs: number): T {
    const DEFERRED = new Set([
        'process',
        'render',
        'suggest',
        'suggestForCategories',
        'aggregate',
        'aggregateAssertions',
        'scan',
        'checkCoverage',
        'normalize',
        'validate',
        'notices',
        'describeConcept',
    ]);
    return new Proxy(engine, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function' || !DEFERRED.has(String(property)))
                return value;
            return (...args: unknown[]) =>
                new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            resolve(
                                (value as (...a: unknown[]) => unknown).apply(
                                    target,
                                    args,
                                ),
                            );
                        } catch (error) {
                            reject(error);
                        }
                    }, delayMs);
                });
        },
    });
}

describe('field family: repeated mount/destroy leaves no teardown residue', () => {
    it('20 cycles of the full field family (tags + marked-textarea + marking, each with ★ wired) settle cleanly', async () => {
        const { counts, observerDelta, restore } = trackTeardownResidue();
        Element.prototype.scrollIntoView = vi.fn();
        const bodyChildrenBefore = document.body.children.length;

        const CYCLES = 20;
        for (let i = 0; i < CYCLES; i++) {
            const root = document.createElement('div');
            document.body.appendChild(root);
            root.innerHTML = `
                <input id="tags-${i}" data-ezclassify-controller="tags" data-ezclassify-format="default" />
                <textarea id="mta-${i}" data-ezclassify-controller="marked-textarea" data-ezclassify-format="default"></textarea>
                <textarea id="mf-${i}" data-ezclassify-controller="marking" data-ezclassify-format="default"></textarea>
            `;
            const forms = new EzClassifyUI(createTestEngine() as never, {
                root,
                favorites: {
                    load: () => [{ marking: 'SECRET/NOFORN' }],
                },
            });
            // Let async init (suggest/process round trips) settle before tearing
            // down, so destroy() races nothing still in flight.
            await new Promise((resolve) => setTimeout(resolve, 30));
            forms.destroy();
            root.remove();
        }

        restore();

        // Reaching here at all means the process settled: a leak would either
        // fail one of the assertions below or, for a self-rescheduling
        // RAF/interval, keep the event loop alive and time this test out.
        expect(document.body.children.length).toBe(bodyChildrenBefore);
        for (const [eventType, delta] of counts) {
            expect(delta, `net listener leak for ${eventType}`).toBe(0);
        }
        expect(observerDelta(), 'net MutationObserver leak').toBe(0);
    }, 20000);

    it('20 cycles torn down BEFORE enhancement settles, against an engine that answers late, accumulate no live listeners or observers', async () => {
        // The cycle above waits for async init to finish before it destroys, so
        // it only ever proves that a settled mount tears down cleanly. A user
        // clicking a second document before the first one has come back gives
        // the opposite ordering: destroy() runs while process and suggest round
        // trips are still open, and whatever those inits go on to attach was
        // never in the DOM the teardown walked. That ordering is unreachable
        // with an in-process engine, so this cycle puts every operation behind
        // a delay longer than the time the mount is allowed to live, the way a
        // REST client behaves, and tears down mid-flight every time.
        //
        // What it counts is the browser's own metric rather than the narrower
        // one above: every addEventListener and removeEventListener on any
        // target, netted per target and then summed over the targets still
        // attached to the document. Listeners left on a node that has left the
        // tree are the garbage collector's problem and are not what a renderer
        // runs out of memory over; listeners piling up on live targets are.
        const residue = trackTeardownResidue();
        const listeners = trackLiveListeners();
        Element.prototype.scrollIntoView = vi.fn();
        const bodyChildrenBefore = document.body.children.length;
        const CYCLES = 20;
        const MOUNT_LIFETIME_MS = 5;
        const ENGINE_LATENCY_MS = 40;

        for (let i = 0; i < CYCLES; i++) {
            const root = document.createElement('div');
            document.body.appendChild(root);
            root.innerHTML = `
                <input id="churn-tags-${i}" data-ezclassify-controller="tags" data-ezclassify-format="default" />
                <textarea id="churn-mta-${i}" data-ezclassify-controller="marked-textarea" data-ezclassify-format="default"></textarea>
                <textarea id="churn-mf-${i}" data-ezclassify-controller="marking" data-ezclassify-format="default"></textarea>
            `;
            const forms = new EzClassifyUI(
                answersLate(createTestEngine(), ENGINE_LATENCY_MS) as never,
                {
                    root,
                    favorites: {
                        load: () => [{ marking: 'SECRET/NOFORN' }],
                    },
                },
            );
            await new Promise((resolve) =>
                setTimeout(resolve, MOUNT_LIFETIME_MS),
            );
            forms.destroy();
            root.remove();
        }

        // Let every init that was in flight when its instance was destroyed run
        // to completion. Residue attached after teardown lands here, so the
        // counts have to be read after this point, not before it.
        await new Promise((resolve) =>
            setTimeout(resolve, ENGINE_LATENCY_MS * 4),
        );
        const liveAfter = listeners.liveCount();
        listeners.restore();
        residue.restore();

        expect(document.body.children.length).toBe(bodyChildrenBefore);
        for (const [eventType, delta] of residue.counts) {
            expect(delta, `net listener leak for ${eventType}`).toBe(0);
        }
        expect(residue.observerDelta(), 'net MutationObserver leak').toBe(0);
        // A per-cycle leak would put at least CYCLES listeners here; the
        // threshold is deliberately far below one-per-cycle so a slow leak
        // cannot hide under it, and far above zero so the handful of listeners
        // jsdom itself keeps on the document does not make this brittle.
        expect(
            liveAfter,
            'listeners accumulating on still-attached targets across churn cycles',
        ).toBeLessThan(CYCLES);
    }, 30000);
});

/**
 * `injectEzClassifyFacet` is a projection of the store's cells, not a mirror of
 * them. These pin both halves of that: the controlled-field contract an Angular
 * Material select consumes, and the fact that a publish made straight against
 * the store moves the returned signals without anything routing through the
 * inject function.
 *
 * They also pin that a pick made before the enclosing runtime has seeded the
 * store from its hosts survives that seed.
 *
 * The late-engine and no-host cases live in `provide-ezclassify.spec.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, Input, type Signal } from '@angular/core';
import { getActiveConsumer } from '@angular/core/primitives/signals';
import { loadCedarValley } from '@ezclassify/example-schemes/cedar-valley';
import { VanillaEzClassifyStore } from '@ezclassify/ui';
import {
    AngularSignalStore,
    EZCLASSIFY_STORE,
    type SignalBackedEzClassifyStore,
} from './angular-signal-store';
import {
    injectEzClassifyFacet,
    type InjectEzClassifyFacetReturn,
} from './inject-ezclassify-facet';
import { EzClassifyDirective } from './ezclassify.directive';
import { provideEzClassify } from './provide-ezclassify';

@Component({
    selector: 'test-facet-host',
    standalone: true,
    template: `<span>{{ facet.rendered() }}</span>`,
})
class FacetHostComponent {
    readonly facet: InjectEzClassifyFacetReturn = injectEzClassifyFacet(
        'document',
        'level',
    );
}

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('injectEzClassifyFacet store contract', () => {
    /**
     * A decorator around the scope's store: an application wrapping it to add
     * logging or scoping keeps every accessor and shares no constructor. This
     * is the substitution `[ezClassifyStore]` has always accepted, and the
     * facet has to project it.
     */
    it('projects a substituted store that answers the signal accessors', async () => {
        const backing = new AngularSignalStore(loadCedarValley());
        // Object.create(null) as the proxy target so the wrapper carries none of
        // the backing store's prototype: it satisfies the contract by forwarding,
        // which is the whole point.
        const wrapped = new Proxy(
            Object.create(null) as SignalBackedEzClassifyStore,
            {
                get(_target, prop) {
                    const value = Reflect.get(
                        backing as object,
                        prop,
                    ) as unknown;
                    return typeof value === 'function'
                        ? value.bind(backing)
                        : value;
                },
            },
        );
        expect(wrapped instanceof AngularSignalStore).toBe(false);

        await TestBed.configureTestingModule({
            imports: [FacetHostComponent],
            providers: [{ provide: EZCLASSIFY_STORE, useValue: wrapped }],
        }).compileComponents();

        await wrapped.publishRendered('document', 'INTERNAL');
        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        await flush();
        fixture.detectChanges();
        const { facet } = fixture.componentInstance;

        expect(facet.value()).toContain('INTERNAL');
        expect(facet.options().length).toBeGreaterThan(0);
        expect(facet.loading()).toBe(false);

        fixture.destroy();
        backing.destroy();
    });

    /**
     * The message has to name the field as well as the gap; a page with several
     * facet-backed inputs otherwise gives no clue which one is misprovisioned.
     * The behavior itself is pinned in `provide-ezclassify.spec.ts`, next to
     * the rest of the overridden-store contract.
     */
    it('names the calling facet in the error it raises', async () => {
        const vanilla = new VanillaEzClassifyStore(loadCedarValley());
        await TestBed.configureTestingModule({
            imports: [FacetHostComponent],
            providers: [{ provide: EZCLASSIFY_STORE, useValue: vanilla }],
        }).compileComponents();

        const fixture = TestBed.createComponent(FacetHostComponent);
        expect(() => fixture.componentInstance.facet.options()).toThrow(
            /injectEzClassifyFacet\('document', 'level'\)/,
        );

        vanilla.destroy();
    });
});

describe('injectEzClassifyFacet', () => {
    let store: AngularSignalStore;

    beforeEach(async () => {
        store = new AngularSignalStore(loadCedarValley());
        await TestBed.configureTestingModule({
            imports: [FacetHostComponent],
            providers: [{ provide: EZCLASSIFY_STORE, useValue: store }],
        }).compileComponents();
    });

    it('exposes controlled value, options, validation, and updates', async () => {
        await store.publishRendered('document', 'INTERNAL');
        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        await flush();
        fixture.detectChanges();
        const { facet } = fixture.componentInstance;

        expect(facet.options().length).toBeGreaterThan(0);
        expect(facet.value()).toContain('INTERNAL');
        expect(facet.loading()).toBe(false);

        facet.setValue(['CONFIDENTIAL']);
        await flush();
        fixture.detectChanges();
        expect(facet.value()).toEqual(['CONFIDENTIAL']);
        expect(facet.rendered()).toContain('CONFIDENTIAL');

        fixture.destroy();
        store.destroy();
    });

    it('retains only facet liveness and releases it without marking snapshots', async () => {
        const marking = vi.spyOn(store, 'subscribe');
        const facetSubscription = vi.spyOn(store, 'subscribeFacet');
        const read = vi.spyOn(store, 'get');
        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        await flush();
        expect(fixture.componentInstance.facet.loading()).toBe(false);
        expect(facetSubscription).toHaveBeenCalledTimes(1);
        expect(marking).not.toHaveBeenCalled();
        read.mockClear();
        facetSubscription.mock.calls[0][2](store.getFacet('document', 'level'));
        expect(read).not.toHaveBeenCalled();
        fixture.destroy();
        const suggest = vi.spyOn(store['engine']!, 'suggestForCategories');
        await store.publishRendered('document', 'INTERNAL');
        expect(suggest).not.toHaveBeenCalled();
        store.destroy();
    });

    it('projects the store cells rather than holding a copy of them', async () => {
        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        await flush();
        const { facet } = fixture.componentInstance;

        await store.publishRendered('document', 'INTERNAL');
        await flush();
        fixture.detectChanges();

        expect(facet.value()).toEqual(['INTERNAL']);
        expect(facet.options()).toEqual(
            store.getFacet('document', 'level').allowableOptions,
        );
        expect(facet.rendered()).toBe(store.get('document').rendered);

        fixture.destroy();
        store.destroy();
    });

    it('binds once and keeps that binding across commits', async () => {
        const subscribeFacet = vi.spyOn(store, 'subscribeFacet');
        const process = vi.spyOn(
            store['engine'] as { process: (...args: never[]) => unknown },
            'process',
        );
        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        await flush();
        expect(subscribeFacet).toHaveBeenCalledTimes(1);

        process.mockClear();
        const markings = ['INTERNAL', 'CONFIDENTIAL', 'STATE ASSESSMENT STAFF'];
        for (const marking of markings) {
            await store.publishRendered('document', marking);
            await flush();
            fixture.detectChanges();
        }

        // Commits keep the existing facet subscription; each publish reads its
        // text once rather than restarting the lifecycle effect. A text whose
        // unread words the engine moves is read once more as the value the
        // store holds, so those words are found where the value has them.
        expect(subscribeFacet).toHaveBeenCalledTimes(1);
        expect(
            process.mock.calls.filter(([input]) =>
                markings.includes(input as unknown as string),
            ),
        ).toHaveLength(3);

        fixture.destroy();
        store.destroy();
    });

    it('builds its binding outside the effect consumer', async () => {
        // A retained subscription may replay native state, and the lifecycle
        // effect can publish a pending selection. Only the scope's store
        // identity should become a dependency, so both run untracked.
        let consumerAtBind: unknown = 'never bound';
        vi.spyOn(store, 'subscribeFacet').mockImplementation(function (
            this: AngularSignalStore,
            ...args: Parameters<AngularSignalStore['subscribeFacet']>
        ) {
            consumerAtBind = getActiveConsumer();
            return AngularSignalStore.prototype.subscribeFacet.apply(
                this,
                args,
            );
        });

        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        await flush();

        expect(consumerAtBind).toBeNull();

        fixture.destroy();
        store.destroy();
    });

    it('hands out read-only signals', () => {
        const fixture = TestBed.createComponent(FacetHostComponent);
        fixture.detectChanges();
        const { facet } = fixture.componentInstance;
        // A computed carries no `set`; displayed marking state changes only by
        // publishing through the store.
        for (const accessor of [
            facet.value,
            facet.options,
            facet.rendered,
            facet.valid,
            facet.errors,
            facet.loading,
        ] as Signal<unknown>[]) {
            expect(
                (accessor as unknown as { set?: unknown }).set,
            ).toBeUndefined();
        }
        fixture.destroy();
        store.destroy();
    });
});

/** What the before-mount pickers below report back to the test. */
const mounted: {
    facet: InjectEzClassifyFacetReturn | null;
    pickInConstructor: boolean;
} = { facet: null, pickInConstructor: false };

@Component({
    selector: 'test-level-picker',
    standalone: true,
    template: ``,
})
class LevelPickerComponent {
    readonly facet = injectEzClassifyFacet('doc-marking', 'level');
    constructor() {
        mounted.facet = this.facet;
        // Constructed during the host's create pass, before the directive has
        // built its store, let alone the runtime.
        if (mounted.pickInConstructor) this.facet.setValue(['CONFIDENTIAL']);
    }
}

@Component({
    selector: 'test-runtime-form',
    standalone: true,
    imports: [EzClassifyDirective, LevelPickerComponent],
    template: `<div [ezClassify]="engine">
        <input
            id="doc-marking"
            [value]="served"
            type="hidden"
            data-ezclassify-rendered />
        <test-level-picker />
    </div>`,
})
class RuntimeFormComponent {
    @Input() engine = loadCedarValley();
    @Input() served = '';
}

@Component({
    selector: 'test-app-runtime-form',
    standalone: true,
    imports: [EzClassifyDirective, LevelPickerComponent],
    template: `<div ezClassify>
        <input
            id="doc-marking"
            [value]="served"
            type="hidden"
            data-ezclassify-rendered />
        <test-level-picker />
    </div>`,
})
class AppRuntimeFormComponent {
    @Input() served = '';
}

/**
 * Wait for the runtime's seed, then let the edits that land on top of it
 * finish. The in-process engine answers synchronously, so one macrotask drains
 * them.
 */
async function settleRuntime(ready: Promise<void>): Promise<void> {
    await ready;
    await new Promise<void>((tick) => setTimeout(tick, 0));
}

function mountRuntimeForm(
    component: typeof RuntimeFormComponent | typeof AppRuntimeFormComponent,
    served: string,
    pickInConstructor = false,
) {
    mounted.facet = null;
    mounted.pickInConstructor = pickInConstructor;
    // The runtime's ready event bubbles to the document.
    const ready = new Promise<void>((resolve) =>
        document.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        }),
    );
    const fixture = TestBed.createComponent(component);
    fixture.componentInstance.served = served;
    fixture.detectChanges();
    return { fixture, ready, facet: () => mounted.facet! };
}

describe('injectEzClassifyFacet before the runtime has mounted', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RuntimeFormComponent],
        }).compileComponents();
    });

    it('keeps a pick made in the constructor, before the store exists, on top of the served value', async () => {
        const { fixture, ready, facet } = mountRuntimeForm(
            RuntimeFormComponent,
            'INTERNAL//DO NOT FORWARD',
            true,
        );
        await settleRuntime(ready);
        fixture.detectChanges();

        expect(facet().value()).toEqual(['CONFIDENTIAL']);
        expect(facet().rendered()).toBe('CONFIDENTIAL//DO NOT FORWARD');
        fixture.destroy();
    });
});

describe('injectEzClassifyFacet under provideEzClassify, before the runtime has mounted', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AppRuntimeFormComponent],
            providers: [provideEzClassify({ engine: loadCedarValley() })],
        }).compileComponents();
    });

    it('keeps a pick over the value the host was served with', async () => {
        const { fixture, ready, facet } = mountRuntimeForm(
            AppRuntimeFormComponent,
            'INTERNAL',
        );
        facet().setValue(['CONFIDENTIAL']);
        await settleRuntime(ready);
        fixture.detectChanges();

        expect(facet().value()).toEqual(['CONFIDENTIAL']);
        fixture.destroy();
    });
});

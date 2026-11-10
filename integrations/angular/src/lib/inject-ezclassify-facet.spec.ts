/**
 * `injectEzClassifyFacet` is a projection of the store's cells, not a mirror of
 * them. These pin both halves of that: the controlled-field contract an Angular
 * Material select consumes, and the fact that a publish made straight against
 * the store moves the returned signals without anything routing through the
 * inject function.
 *
 * They also pin that a pick made before the enclosing runtime has seeded the
 * store from its hosts survives that seed, and that a facet outside any root
 * says what is missing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Component, Input, type Signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { getActiveConsumer } from '@angular/core/primitives/signals';
import { loadCedarValleyContext } from '@ezclassify/example-schemes/cedar-valley';
import { VanillaEzClassifyStore, type EzClassifyStore } from '@ezclassify/ui';
import {
    AngularSignalStore,
    type SignalBackedEzClassifyStore,
} from './angular-signal-store';
import {
    injectEzClassifyFacet,
    type InjectEzClassifyFacetReturn,
} from './inject-ezclassify-facet';
import { EzClassifyDirective } from './ezclassify.directive';
import { provideEzClassify } from './provide-ezclassify';
import { openOperations } from '../../../../libs/ui/test-fixtures/context-doubles';

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

/** A root handed a store it does not own, with one facet inside it. */
@Component({
    selector: 'test-store-root',
    standalone: true,
    imports: [EzClassifyDirective, FacetHostComponent],
    template: `<div [ezClassifyStore]="store" ezClassify>
        <test-facet-host />
    </div>`,
})
class StoreRootComponent {
    @Input() store!: EzClassifyStore;
}

function mountFacet(
    store: EzClassifyStore,
): ComponentFixture<StoreRootComponent> {
    const fixture = TestBed.createComponent(StoreRootComponent);
    fixture.componentInstance.store = store;
    return fixture;
}

function facetOf(
    fixture: ComponentFixture<StoreRootComponent>,
): InjectEzClassifyFacetReturn {
    return (
        fixture.debugElement.query(By.directive(FacetHostComponent))
            .componentInstance as FacetHostComponent
    ).facet;
}

async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

function configureRoot(): Promise<unknown> {
    return TestBed.configureTestingModule({
        imports: [StoreRootComponent],
        providers: [provideEzClassify({ context: loadCedarValleyContext() })],
    }).compileComponents();
}

describe('injectEzClassifyFacet store contract', () => {
    /**
     * A decorator around a root's store: an application wrapping it to add
     * logging keeps every accessor and shares no constructor.
     * `[ezClassifyStore]` accepts that substitution, and the facet has to
     * project it.
     */
    it('projects a substituted store that answers the signal accessors', async () => {
        const backing = new AngularSignalStore(loadCedarValleyContext().scheme);
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
        await configureRoot();

        await wrapped.publishRendered('document', 'INTERNAL');
        const fixture = mountFacet(wrapped);
        fixture.detectChanges();
        await flush();
        fixture.detectChanges();
        const facet = facetOf(fixture);

        expect(facet.value()).toContain('INTERNAL');
        expect(facet.options().length).toBeGreaterThan(0);
        expect(facet.loading()).toBe(false);

        fixture.destroy();
        backing.destroy();
    });

    /**
     * A store the facet cannot project is a wiring mistake, and it has to read
     * like one, naming the field: falling back to empty options would leave the
     * field looking like a marking with nothing allowable on it, and a page
     * with several facet-backed inputs would give no clue which one is wrong.
     */
    it('names the calling facet when the root binds a store it cannot project', async () => {
        const vanilla = new VanillaEzClassifyStore(
            loadCedarValleyContext().scheme,
        );
        await configureRoot();

        const fixture = mountFacet(vanilla);
        expect(() => fixture.detectChanges()).toThrow(
            /injectEzClassifyFacet\('document', 'level'\).*does not implement signalFor or facetSignalRef/,
        );

        fixture.destroy();
        vanilla.destroy();
    });

    it('says it needs a root when called outside one', async () => {
        await TestBed.configureTestingModule({
            imports: [FacetHostComponent],
            providers: [
                provideEzClassify({ context: loadCedarValleyContext() }),
            ],
        }).compileComponents();

        expect(() => TestBed.createComponent(FacetHostComponent)).toThrow(
            /injectEzClassifyFacet\('document', 'level'\) must be called from a component inside an ezClassify root/,
        );
    });
});

describe('injectEzClassifyFacet', () => {
    let store: AngularSignalStore;
    /** The scheme operations the store reads by, open for spying. */
    let engine: ReturnType<typeof loadCedarValleyContext>['scheme'];

    beforeEach(async () => {
        engine = openOperations(loadCedarValleyContext().scheme);
        store = new AngularSignalStore(engine);
        await configureRoot();
    });

    it('exposes controlled value, options, validation, and updates', async () => {
        await store.publishRendered('document', 'INTERNAL');
        const fixture = mountFacet(store);
        fixture.detectChanges();
        await flush();
        fixture.detectChanges();
        const facet = facetOf(fixture);

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
        const fixture = mountFacet(store);
        fixture.detectChanges();
        await flush();
        expect(facetOf(fixture).loading()).toBe(false);
        expect(facetSubscription).toHaveBeenCalledTimes(1);
        expect(marking).not.toHaveBeenCalled();
        read.mockClear();
        facetSubscription.mock.calls[0][2](store.getFacet('document', 'level'));
        expect(read).not.toHaveBeenCalled();
        fixture.destroy();
        const suggest = vi.spyOn(engine, 'suggestForCategories');
        await store.publishRendered('document', 'INTERNAL');
        expect(suggest).not.toHaveBeenCalled();
        store.destroy();
    });

    it('projects the store cells rather than holding a copy of them', async () => {
        const fixture = mountFacet(store);
        fixture.detectChanges();
        await flush();
        const facet = facetOf(fixture);

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
        const process = vi.spyOn(engine, 'process');
        const fixture = mountFacet(store);
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

        const fixture = mountFacet(store);
        fixture.detectChanges();
        await flush();

        expect(consumerAtBind).toBeNull();

        fixture.destroy();
        store.destroy();
    });

    it('hands out read-only signals', () => {
        const fixture = mountFacet(store);
        fixture.detectChanges();
        const facet = facetOf(fixture);
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
    template: `<div ezClassify>
        <input
            id="doc-marking"
            [value]="served"
            type="hidden"
            data-ezclassify-marking />
        <test-level-picker />
    </div>`,
})
class RuntimeFormComponent {
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

function mountRuntimeForm(served: string, pickInConstructor = false) {
    mounted.facet = null;
    mounted.pickInConstructor = pickInConstructor;
    // The runtime's ready event bubbles to the document.
    const ready = new Promise<void>((resolve) =>
        document.addEventListener('ezclassify:ready', () => resolve(), {
            once: true,
        }),
    );
    const fixture = TestBed.createComponent(RuntimeFormComponent);
    fixture.componentInstance.served = served;
    fixture.detectChanges();
    return { fixture, ready, facet: () => mounted.facet! };
}

describe('injectEzClassifyFacet before the runtime has mounted', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RuntimeFormComponent],
            providers: [
                provideEzClassify({ context: loadCedarValleyContext() }),
            ],
        }).compileComponents();
    });

    it('keeps a pick made in the constructor, before the store exists, on top of the served value', async () => {
        const { fixture, ready, facet } = mountRuntimeForm(
            'INTERNAL//DO NOT FORWARD',
            true,
        );
        await settleRuntime(ready);
        fixture.detectChanges();

        expect(facet().value()).toEqual(['CONFIDENTIAL']);
        expect(facet().rendered()).toBe('CONFIDENTIAL//DO NOT FORWARD');
        fixture.destroy();
    });

    it('keeps a pick over the value the root was served with', async () => {
        const { fixture, ready, facet } = mountRuntimeForm('INTERNAL');
        facet().setValue(['CONFIDENTIAL']);
        await settleRuntime(ready);
        fixture.detectChanges();

        expect(facet().value()).toEqual(['CONFIDENTIAL']);
        fixture.destroy();
    });
});

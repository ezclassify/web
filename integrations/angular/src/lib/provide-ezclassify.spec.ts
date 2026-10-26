/**
 * Provision defaults for `@ezclassify/angular`.
 *
 * The contract under test: an application names its engine once with
 * `provideEzClassify({ engine })`, and after that a host is `<div ezClassify>`
 * with nothing bound, a facet injects a working store with no host above it at
 * all, and a marking label finds an engine on its own. Inputs stay available as
 * overrides, including an overridden store, and a facet arms itself when the
 * engine turns up late instead of failing silently forever.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { ContextAdapter, SchemeEngineAdapter } from '@ezclassify/types';
import { VanillaEzClassifyStore } from '@ezclassify/ui';
import { EzClassifyDirective } from './ezclassify.directive';
import { AngularSignalStore, EZCLASSIFY_STORE } from './angular-signal-store';
import { injectEzClassifyFacet } from './inject-ezclassify-facet';
import { provideEzClassify } from './provide-ezclassify';
import { EzMarkingLabelComponent } from './ez-marking-label/ez-marking-label.component';

const MINIMAL_SCHEME = {
    scheme: {
        id: 'provision-test',
        version: '1.0.0',
        default_scope: 'marking',
        scopes: [{ id: 'marking', label: 'Marking' }],
        name: 'Provision Test',
        description: '',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                    hierarchy_root: true,
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'HIGH',
                        name: 'High',
                        views: { default: 'HIGH' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 0,
                        rank: 0,
                    },
                ],
            },
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
                    fields: [{ category: 'level', separator: '/' }],
                },
            ],
        },
    },
};

function buildEngine(): SchemeEngineAdapter {
    return Context.fromComponents({ scheme: MINIMAL_SCHEME })
        .scheme as SchemeEngineAdapter;
}

@Component({
    selector: 'test-inherited-host',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<div ezClassify></div>`,
})
class InheritedHostComponent {}

@Component({
    selector: 'test-store-override-host',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<div [ezClassifyStore]="store" ezClassify></div>`,
})
class StoreOverrideHostComponent {
    store!: AngularSignalStore;
}

@Component({
    selector: 'test-standalone-facet',
    standalone: true,
    template: `<span>{{ facet.rendered() }}</span>`,
})
class StandaloneFacetComponent {
    readonly facet = injectEzClassifyFacet('doc', 'level');
}

@Component({
    selector: 'test-label-host',
    standalone: true,
    imports: [EzMarkingLabelComponent],
    template: `<ez-marking-label [marking]="'HIGH'" />`,
})
class LabelHostComponent {}

describe('provideEzClassify: app-level defaults', () => {
    let engine: SchemeEngineAdapter;

    beforeEach(() => {
        engine = buildEngine();
    });

    it('lets a host inherit the engine with nothing bound', async () => {
        await TestBed.configureTestingModule({
            imports: [InheritedHostComponent],
            providers: [provideEzClassify({ engine })],
        }).compileComponents();

        const fixture = TestBed.createComponent(InheritedHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getEngine()).toBe(engine);
        expect(directive.getStore()).toBeInstanceOf(AngularSignalStore);
    });

    it('takes a composed context and binds the store to its scheme surface', async () => {
        const context = Context.fromComponents({ scheme: MINIMAL_SCHEME });
        await TestBed.configureTestingModule({
            imports: [InheritedHostComponent],
            providers: [provideEzClassify({ engine: context })],
        }).compileComponents();

        const fixture = TestBed.createComponent(InheritedHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getEngine()).toBe(context.scheme);

        const store = TestBed.inject(EZCLASSIFY_STORE);
        await store.publishRendered('doc', 'HIGH');
        expect(store.get('doc').rendered).toBe('HIGH');
    });

    it('binds a remote Context scheme without addressed lifecycle methods', async () => {
        const local = Context.fromComponents({ scheme: MINIMAL_SCHEME });
        const remoteScheme = new Proxy(local.scheme, {
            has(target, property) {
                if (
                    property === 'loadScheme' ||
                    property === 'loadLayer' ||
                    property === 'unloadScheme' ||
                    property === 'unloadLayer'
                ) {
                    return false;
                }
                return Reflect.has(target, property);
            },
            get(target, property, receiver) {
                if (
                    property === 'loadScheme' ||
                    property === 'loadLayer' ||
                    property === 'unloadScheme' ||
                    property === 'unloadLayer'
                ) {
                    return undefined;
                }
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const remoteContext = new Proxy(local, {
            get(target, property, receiver) {
                if (property === 'scheme') return remoteScheme;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as unknown as ContextAdapter;

        await TestBed.configureTestingModule({
            imports: [InheritedHostComponent],
            providers: [provideEzClassify({ engine: remoteContext })],
        }).compileComponents();

        const fixture = TestBed.createComponent(InheritedHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getEngine()).toBe(remoteScheme);
        expect('loadScheme' in directive.getEngine()!).toBe(false);

        const store = TestBed.inject(EZCLASSIFY_STORE);
        await store.publishRendered('doc', 'HIGH');
        expect(store.get('doc').rendered).toBe('HIGH');
    });

    it('merges the host options over the app-level options', async () => {
        @Component({
            selector: 'test-options-host',
            standalone: true,
            imports: [EzClassifyDirective],
            template: `<div
                [ezClassifyOptions]="{ format: 'default' }"
                ezClassify></div>`,
        })
        class OptionsHostComponent {}

        await TestBed.configureTestingModule({
            imports: [OptionsHostComponent],
            providers: [
                provideEzClassify({
                    engine,
                    options: { rollupId: 'app-rollup', format: 'other' },
                }),
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(OptionsHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getOptions()).toEqual({
            rollupId: 'app-rollup',
            format: 'default',
        });
    });

    it('takes an overridden store and leaves its lifetime to the owner', async () => {
        await TestBed.configureTestingModule({
            imports: [StoreOverrideHostComponent],
            providers: [provideEzClassify({ engine })],
        }).compileComponents();

        const owned = new AngularSignalStore(engine);
        const fixture = TestBed.createComponent(StoreOverrideHostComponent);
        fixture.componentInstance.store = owned;
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getStore()).toBe(owned);

        // Destroying the host must not destroy a store it did not build.
        fixture.destroy();
        expect(() => owned.subscribe('doc', () => {})).not.toThrow();
        owned.destroy();
    });

    it('gives a component outside any host a working store', async () => {
        await TestBed.configureTestingModule({
            imports: [StandaloneFacetComponent],
            providers: [provideEzClassify({ engine })],
        }).compileComponents();

        const fixture = TestBed.createComponent(StandaloneFacetComponent);
        fixture.detectChanges();
        const store = TestBed.inject(EZCLASSIFY_STORE);
        await store.publishRendered('doc', 'HIGH');
        fixture.detectChanges();

        expect(fixture.componentInstance.facet.rendered()).toBe('HIGH');
        expect(fixture.componentInstance.facet.value()).toEqual(['HIGH']);
    });

    it('resolves the label engine from the token, with no host above it', async () => {
        await TestBed.configureTestingModule({
            imports: [LabelHostComponent],
            providers: [
                provideEzClassify({
                    engine,
                    options: {
                        colorMap: {
                            HIGH: { background: '#900', text: '#fff' },
                        },
                    },
                }),
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(LabelHostComponent);
        fixture.detectChanges();
        const span: HTMLElement =
            fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.classList).toContain('ez-marking-label--colored');
    });

    it('lets a host shadow the app engine and color map for a label inside it', async () => {
        @Component({
            selector: 'test-label-override-host',
            standalone: true,
            imports: [EzClassifyDirective, EzMarkingLabelComponent],
            template: `<div
                [ezClassify]="hostEngine"
                [ezClassifyOptions]="{
                    colorMap: { HIGH: { background: '#111111', text: '#fff' } },
                }">
                <ez-marking-label [marking]="'HIGH'" />
            </div>`,
        })
        class LabelOverrideHostComponent {
            hostEngine!: SchemeEngineAdapter;
        }

        const hostEngine = buildEngine();
        await TestBed.configureTestingModule({
            imports: [LabelOverrideHostComponent],
            providers: [
                provideEzClassify({
                    engine,
                    options: {
                        colorMap: {
                            HIGH: { background: '#eeeeee', text: '#000' },
                        },
                    },
                }),
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(LabelOverrideHostComponent);
        fixture.componentInstance.hostEngine = hostEngine;
        const read = vi.spyOn(hostEngine, 'validate');
        fixture.detectChanges();

        const span: HTMLElement =
            fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.style.getPropertyValue('--ez-marking-bg')).toBe('#111111');
        expect(read).toHaveBeenCalled();
    });
});

describe('injectEzClassifyFacet: a late engine', () => {
    it('arms itself when the host engine arrives after the first pass', async () => {
        @Component({
            selector: 'test-late-facet-child',
            standalone: true,
            template: `<span>{{ facet.rendered() }}</span>`,
        })
        class LateFacetChildComponent {
            readonly facet = injectEzClassifyFacet('doc', 'level');
        }

        @Component({
            selector: 'test-late-engine-host',
            standalone: true,
            imports: [EzClassifyDirective, LateFacetChildComponent],
            template: `<div [ezClassify]="engine()">
                <test-late-facet-child />
            </div>`,
        })
        class LateEngineHostComponent {
            readonly engine = signal<SchemeEngineAdapter | null>(null);
        }

        await TestBed.configureTestingModule({
            imports: [LateEngineHostComponent],
        }).compileComponents();

        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const fixture = TestBed.createComponent(LateEngineHostComponent);
        // First pass with no engine: the child is constructed and must not throw.
        fixture.detectChanges();
        // Drain the microtask queue so a one-shot deferral would have spent its
        // only attempt here, on a scope that has no store yet.
        for (let i = 0; i < 4; i++) await Promise.resolve();
        const child = fixture.debugElement.children[0].children[0]
            .componentInstance as LateFacetChildComponent;
        expect(child.facet.rendered()).toBe('');

        // The engine arrives, the way a REST-backed adapter would.
        fixture.componentInstance.engine.set(buildEngine());
        fixture.detectChanges();
        await Promise.resolve();

        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        await directive.getStore()!.publishRendered('doc', 'HIGH');
        fixture.detectChanges();

        expect(child.facet.rendered()).toBe('HIGH');
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
    });

    /**
     * A store the facet cannot project is a wiring mistake, and it has to read
     * like one. Falling back to empty options and a blank value would leave the
     * field looking like a marking with nothing allowable on it, forever, with
     * nothing in the console to say why.
     */
    it('says so when the scope binds a store it cannot project', async () => {
        @Component({
            selector: 'test-foreign-store-facet',
            standalone: true,
            template: `<span>{{ facet.loading() }}</span>`,
        })
        class ForeignStoreFacetComponent {
            readonly facet = injectEzClassifyFacet('doc', 'level');
        }

        await TestBed.configureTestingModule({
            imports: [ForeignStoreFacetComponent],
            providers: [
                provideEzClassify({ engine: buildEngine() }),
                {
                    provide: EZCLASSIFY_STORE,
                    useValue: new VanillaEzClassifyStore(buildEngine()),
                },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForeignStoreFacetComponent);
        expect(() => fixture.componentInstance.facet.loading()).toThrow(
            /does not implement signalFor or facetSignalRef/,
        );
    });
});

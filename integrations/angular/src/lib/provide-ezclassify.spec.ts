/**
 * Provision for `@ezclassify/angular`.
 *
 * The contract under test: an application names its Context once with
 * `provideEzClassify({ context })`, and after that a root is a bare `<form
 * ezClassify>` that builds its own store against that Context, and a marking
 * label colors itself with no root above it. The two root inputs stay available
 * for the complex cases: options merged over the provided ones, and a store the
 * host owns.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { ContextAdapter } from '@ezclassify/types';
import { EzClassifyDirective } from './ezclassify.directive';
import { AngularSignalStore } from './angular-signal-store';
import { provideEzClassify } from './provide-ezclassify';
import { EzMarkingLabelComponent } from './ez-marking-label/ez-marking-label.component';
import { openContext } from '../../../../libs/ui/test-fixtures/context-doubles';

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

function buildContext(): ContextAdapter {
    return openContext(Context.fromComponents({ scheme: MINIMAL_SCHEME }));
}

@Component({
    selector: 'test-bare-root',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<form ezClassify></form>`,
})
class BareRootComponent {}

@Component({
    selector: 'test-store-override-root',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<form [ezClassifyStore]="store" ezClassify></form>`,
})
class StoreOverrideRootComponent {
    store!: AngularSignalStore;
}

@Component({
    selector: 'test-label-host',
    standalone: true,
    imports: [EzMarkingLabelComponent],
    template: `<ez-marking-label [marking]="'HIGH'" />`,
})
class LabelHostComponent {}

describe('provideEzClassify', () => {
    let context: ContextAdapter;

    beforeEach(() => {
        context = buildContext();
    });

    it('refuses anything that is not a Context', () => {
        expect(() =>
            provideEzClassify({
                context: context.scheme as unknown as ContextAdapter,
            }),
        ).toThrow(/needs a connected Context/);
    });

    it('lets a bare root mark against the provided Context', async () => {
        await TestBed.configureTestingModule({
            imports: [BareRootComponent],
            providers: [provideEzClassify({ context })],
        }).compileComponents();

        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getContext()).toBe(context);

        const store = directive.getStore()!;
        expect(store).toBeInstanceOf(AngularSignalStore);
        await store.publishRendered('doc', 'HIGH');
        expect(store.get('doc').rendered).toBe('HIGH');
    });

    it('binds a remote Context scheme without addressed lifecycle methods', async () => {
        const local = Context.fromComponents({ scheme: MINIMAL_SCHEME });
        const addressed = new Set([
            'loadScheme',
            'loadLayer',
            'unloadScheme',
            'unloadLayer',
        ]);
        const remoteScheme = new Proxy(local.scheme, {
            has(target, property) {
                if (addressed.has(property as string)) return false;
                return Reflect.has(target, property);
            },
            get(target, property, receiver) {
                if (addressed.has(property as string)) return undefined;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const remoteContext = new Proxy(openContext(local), {
            get(target, property, receiver) {
                if (property === 'scheme') return remoteScheme;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as unknown as ContextAdapter;

        await TestBed.configureTestingModule({
            imports: [BareRootComponent],
            providers: [provideEzClassify({ context: remoteContext })],
        }).compileComponents();

        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);

        const store = directive.getStore()!;
        await store.publishRendered('doc', 'HIGH');
        expect(store.get('doc').rendered).toBe('HIGH');
    });

    it('merges the root options over the provided options', async () => {
        @Component({
            selector: 'test-options-root',
            standalone: true,
            imports: [EzClassifyDirective],
            template: `<form
                [ezClassifyOptions]="{ format: 'default' }"
                ezClassify></form>`,
        })
        class OptionsRootComponent {}

        const colorMap = { HIGH: { background: '#900', text: '#fff' } };
        await TestBed.configureTestingModule({
            imports: [OptionsRootComponent],
            providers: [
                provideEzClassify({
                    context,
                    options: { colorMap, format: 'other' },
                }),
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(OptionsRootComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getOptions()).toEqual({
            colorMap,
            format: 'default',
        });
    });

    it('takes an overridden store and leaves its lifetime to the owner', async () => {
        await TestBed.configureTestingModule({
            imports: [StoreOverrideRootComponent],
            providers: [provideEzClassify({ context })],
        }).compileComponents();

        const owned = new AngularSignalStore(context.scheme);
        const fixture = TestBed.createComponent(StoreOverrideRootComponent);
        fixture.componentInstance.store = owned;
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getStore()).toBe(owned);

        // Destroying the root must not destroy a store it did not build.
        fixture.destroy();
        expect(() => owned.subscribe('doc', () => {})).not.toThrow();
        owned.destroy();
    });

    it('colors a label from the provided Context with no root above it', async () => {
        await TestBed.configureTestingModule({
            imports: [LabelHostComponent],
            providers: [
                provideEzClassify({
                    context,
                    options: {
                        colorMap: {
                            HIGH: { background: '#900', text: '#fff' },
                        },
                    },
                }),
            ],
        }).compileComponents();

        const read = vi.spyOn(context.scheme, 'validate');
        const fixture = TestBed.createComponent(LabelHostComponent);
        fixture.detectChanges();
        await Promise.resolve();
        fixture.detectChanges();
        const span: HTMLElement =
            fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.classList).toContain('ez-marking-label--colored');
        expect(read).toHaveBeenCalledWith('HIGH');
    });

    it('lets a root shadow the provided color map for a label inside it', async () => {
        @Component({
            selector: 'test-label-override-root',
            standalone: true,
            imports: [EzClassifyDirective, EzMarkingLabelComponent],
            template: `<div
                [ezClassifyOptions]="{
                    colorMap: { HIGH: { background: '#111111', text: '#fff' } },
                }"
                ezClassify>
                <ez-marking-label [marking]="'HIGH'" />
            </div>`,
        })
        class LabelOverrideRootComponent {}

        await TestBed.configureTestingModule({
            imports: [LabelOverrideRootComponent],
            providers: [
                provideEzClassify({
                    context,
                    options: {
                        colorMap: {
                            HIGH: { background: '#eeeeee', text: '#000' },
                        },
                    },
                }),
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(LabelOverrideRootComponent);
        fixture.detectChanges();
        await Promise.resolve();
        fixture.detectChanges();

        const span: HTMLElement =
            fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.style.getPropertyValue('--ez-marking-bg')).toBe('#111111');
    });
});

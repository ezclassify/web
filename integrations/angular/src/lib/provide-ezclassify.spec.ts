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
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { ContextAdapter } from '@ezclassify/types';
import { EzClassifyDirective } from './ezclassify.directive';
import { AngularSignalStore } from './angular-signal-store';
import { provideEzClassify } from './provide-ezclassify';
import { openContext } from '../../../../libs/ui/test-fixtures/context-doubles';
import { bucketKey } from '@ezclassify/ui';

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
            concepts: [
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
        rules: [],
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

    it('takes exactly one of { context } or { contexts }', () => {
        expect(() =>
            provideEzClassify({
                context,
                contexts: { a: context },
            } as never),
        ).toThrow(/exactly one of/);
        expect(() => provideEzClassify({} as never)).toThrow(/exactly one of/);
        expect(() => provideEzClassify({ contexts: {} })).toThrow(
            /at least one Context/,
        );
        expect(() =>
            provideEzClassify({
                contexts: {
                    a: context.scheme as unknown as ContextAdapter,
                },
            }),
        ).toThrow(/contexts\.a is not a connected Context/);
    });

    it('lets a bare root mark against several Contexts, one bucket each', async () => {
        const records = buildContext();
        await TestBed.configureTestingModule({
            imports: [BareRootComponent],
            providers: [
                provideEzClassify({ contexts: { district: context, records } }),
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        // No single Context speaks for a page that holds several.
        expect(directive.getContext()).toBeNull();

        const store = directive.getStore()!;
        const recordsBucket = bucketKey('records', '');
        store.setBucket('doc', recordsBucket);
        await store.publishRendered('doc', 'HIGH');
        const page = store.getAggregate().byBucket;
        expect(page.get(recordsBucket)?.rendered).toBe('HIGH');
        expect(page.has(bucketKey('district', ''))).toBe(false);
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

    it("lets a bare root mark in one Context's second scheme, in its own bucket", async () => {
        const fixtures = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../../../vendor/spec/fixtures/v1',
        );
        const read = (name: string): unknown =>
            JSON.parse(readFileSync(resolve(fixtures, `${name}.json`), 'utf8'));
        const crosswalking = openContext(
            Context.fromComponents({
                schemes: [
                    { key: 'first', scheme: read('ref-scheme-1') },
                    { key: 'second', scheme: read('ref-scheme-2') },
                ],
                primaryScheme: 'first',
            } as Parameters<typeof Context.fromComponents>[0]),
        );
        await TestBed.configureTestingModule({
            imports: [BareRootComponent],
            providers: [provideEzClassify({ context: crosswalking })],
        }).compileComponents();

        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);

        const store = directive.getStore()!;
        const second = bucketKey('', 'second');
        store.setBucket('note', second);
        await store.publishRendered('note', 'LOW//ALPHA');
        expect(store.get('note').rendered).toBe('LOW//ALPHA');
        expect(store.getAggregate().byBucket.get(second)?.rendered).toBe(
            'LOW//ALPHA',
        );
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
});

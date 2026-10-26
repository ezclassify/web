import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, SimpleChange } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { SchemeEngineAdapter } from '@ezclassify/types';
import type { SchemeEngine } from '@ezclassify/engine';
import { EzClassifyDirective } from './ezclassify.directive';

const MINIMAL_SCHEME = {
    scheme: {
        id: 'test',
        version: '1.0.0',
        default_scope: 'marking',
        scopes: [{ id: 'marking', label: 'Marking' }],
        name: 'Test',
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

function makeChange(
    cur: unknown,
    prev: unknown = null,
    first = false,
): SimpleChange {
    return {
        currentValue: cur,
        previousValue: prev,
        firstChange: first,
        isFirstChange: () => first,
    } as SimpleChange;
}

@Component({
    selector: 'test-simple-host',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<div [ezClassify]="engine"></div>`,
})
class SimpleDirectiveHostComponent {
    engine?: SchemeEngine | SchemeEngineAdapter | Context | null;
}

@Component({
    selector: 'test-context-host',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<div [ezClassify]="ctx"></div>`,
})
class ContextHostComponent {
    ctx!: Context;
}

describe('EzClassifyDirective: store lifecycle', () => {
    let engine: SchemeEngine;

    beforeEach(async () => {
        engine = Context.fromComponents({ scheme: MINIMAL_SCHEME })
            .scheme as SchemeEngine;
        await TestBed.configureTestingModule({
            imports: [SimpleDirectiveHostComponent, ContextHostComponent],
        }).compileComponents();
    });

    it('getStore returns null before engine input is applied', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getStore()).toBeNull();
    });

    it('getStore returns the store after engine input is applied', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getStore()).not.toBeNull();
    });

    it('getEngine returns null before engine is set', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getEngine()).toBeNull();
    });

    it('getEngine returns the engine adapter for a bare SchemeEngine input', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getEngine()).toBe(engine);
    });

    it('getEngine unwraps a Context input to its scheme adapter', () => {
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME });
        const fixture = TestBed.createComponent(ContextHostComponent);
        fixture.componentInstance.ctx = ctx;
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        expect(directive.getEngine()).toBe(ctx.scheme);
    });

    it('getEngine unwraps any composition, whoever built it', () => {
        // The check is structural, not branded: a host's own composition, or one
        // built by a second copy of the engine package, unwraps on the strength
        // of the surface it exposes. That is the whole point of typing against
        // the adapter contract instead of an engine class.
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME });
        const foreignContext = {
            scheme: ctx.scheme,
            audit: () => ({}),
        };
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        directive.engine = foreignContext as unknown as Context;

        expect(directive.getEngine()).toBe(ctx.scheme);
    });

    it('ngOnDestroy destroys the store so subscribe calls throw', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        const store = directive.getStore();
        fixture.destroy();
        expect(() => store?.subscribe('doc', () => {})).toThrow(/destroyed/);
    });

    it('ngOnChanges called directly with engine change creates store', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        directive.engine = engine;
        directive.ngOnChanges({ engine: makeChange(engine) });
        expect(directive.getStore()).not.toBeNull();
    });

    it('ngOnChanges called directly with null engine skips store creation', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        directive.ngOnChanges({ engine: makeChange(null) });
        expect(directive.getStore()).toBeNull();
    });

    it('ngOnChanges called with ezClassifyOptions re-triggers init', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);
        directive.engine = engine;
        directive.ngOnChanges({ engine: makeChange(engine) });
        const firstStore = directive.getStore();
        // options-only change with no engine set clears the store
        directive.engine = undefined!;
        directive.ngOnChanges({
            ezClassifyOptions: makeChange({ format: 'default' }),
        });
        expect(directive.getStore()).not.toBe(firstStore);
    });

    it('changing engine via direct ngOnChanges replaces the store', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);

        directive.engine = engine;
        directive.ngOnChanges({ engine: makeChange(engine) });
        const firstStore = directive.getStore();

        const engine2 = Context.fromComponents({ scheme: MINIMAL_SCHEME })
            .scheme as SchemeEngine;
        directive.engine = engine2;
        directive.ngOnChanges({ engine: makeChange(engine2, engine) });
        const secondStore = directive.getStore();

        expect(secondStore).not.toBe(firstStore);
        expect(secondStore).not.toBeNull();
    });

    it('new Context wrapper around the same components is a no-op (no teardown/rebuild)', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);

        // Two distinct Context wrappers around the SAME scheme engine instance.
        // contextSignature keys on the components (scheme/guide/access), not the
        // wrapper identity, so the second change must NOT rebuild.
        const ctx1 = Context.fromSchemeEngine(engine);
        const ctx2 = Context.fromSchemeEngine(engine);
        expect(ctx2).not.toBe(ctx1);

        directive.engine = ctx1;
        directive.ngOnChanges({ engine: makeChange(ctx1) });
        const firstStore = directive.getStore();
        expect(firstStore).not.toBeNull();

        directive.engine = ctx2;
        directive.ngOnChanges({ engine: makeChange(ctx2, ctx1) });

        expect(directive.getStore()).toBe(firstStore);
    });

    it('an options change still rebuilds even when the engine signature is unchanged', () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);

        const ctx1 = Context.fromSchemeEngine(engine);
        const ctx2 = Context.fromSchemeEngine(engine);

        directive.engine = ctx1;
        directive.ngOnChanges({ engine: makeChange(ctx1) });
        const firstStore = directive.getStore();

        directive.engine = ctx2;
        directive.ezClassifyOptions = { format: 'default' };
        directive.ngOnChanges({
            engine: makeChange(ctx2, ctx1),
            ezClassifyOptions: makeChange({ format: 'default' }),
        });

        expect(directive.getStore()).not.toBe(firstStore);
        expect(directive.getStore()).not.toBeNull();
    });

    it('rapid engine changes: only the final store is live after both deferreds run', async () => {
        const fixture = TestBed.createComponent(SimpleDirectiveHostComponent);
        fixture.detectChanges(false);
        const directive =
            fixture.debugElement.children[0].injector.get(EzClassifyDirective);

        directive.engine = engine;
        directive.ngOnChanges({ engine: makeChange(engine) });
        const firstStore = directive.getStore();

        const engine2 = Context.fromComponents({ scheme: MINIMAL_SCHEME })
            .scheme as SchemeEngine;
        directive.engine = engine2;
        directive.ngOnChanges({ engine: makeChange(engine2, engine) });

        // Flush both deferred Promise.resolve() callbacks
        await Promise.resolve();
        await Promise.resolve();

        // The live store is the second one; the stale first-deferred was skipped by token check
        const finalStore = directive.getStore();
        expect(finalStore).not.toBe(firstStore);
        expect(finalStore).not.toBeNull();
    });
});

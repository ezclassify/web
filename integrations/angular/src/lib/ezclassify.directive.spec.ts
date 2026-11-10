import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Context } from '@ezclassify/engine';
import {
    EzClassifyDirective,
    injectEzClassifyUI,
} from './ezclassify.directive';
import { provideEzClassify } from './provide-ezclassify';

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

@Component({
    selector: 'test-bare-root',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<form ezClassify></form>`,
})
class BareRootComponent {}

@Component({
    selector: 'test-options-root',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<form [ezClassifyOptions]="options" ezClassify></form>`,
})
class OptionsRootComponent {
    options: { format?: string } = {};
}

function rootDirective(
    fixture: ComponentFixture<unknown>,
): EzClassifyDirective {
    return fixture.debugElement.children[0].injector.get(EzClassifyDirective);
}

describe('EzClassifyDirective: a bare root', () => {
    let context: Context;

    beforeEach(async () => {
        context = Context.fromComponents({ scheme: MINIMAL_SCHEME });
        await TestBed.configureTestingModule({
            imports: [BareRootComponent, OptionsRootComponent],
            providers: [provideEzClassify({ context })],
        }).compileComponents();
    });

    it('has no store before its first change detection', () => {
        const fixture = TestBed.createComponent(BareRootComponent);
        expect(rootDirective(fixture).getStore()).toBeNull();
    });

    it('builds its own store from the provided Context with nothing bound', () => {
        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const directive = rootDirective(fixture);
        expect(directive.getContext()).toBe(context);
        expect(directive.getStore()).not.toBeNull();
    });

    it('mounts the UI runtime on the host element', async () => {
        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const form: HTMLElement = fixture.nativeElement.querySelector('form');
        expect(form.hasAttribute('data-ezclassify-mount-root')).toBe(false);
        await Promise.resolve();
        expect(form.hasAttribute('data-ezclassify-mount-root')).toBe(true);
    });

    it('gives two roots two stores', async () => {
        @Component({
            selector: 'test-two-roots',
            standalone: true,
            imports: [EzClassifyDirective],
            template: `<form ezClassify></form>
                <form ezClassify></form>`,
        })
        class TwoRootsComponent {}

        const fixture = TestBed.createComponent(TwoRootsComponent);
        fixture.detectChanges(false);
        const [first, second] = fixture.debugElement.children.map((child) =>
            child.injector.get(EzClassifyDirective).getStore(),
        );
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first).not.toBe(second);
    });

    it('destroys the store it built when the root is destroyed', () => {
        const fixture = TestBed.createComponent(BareRootComponent);
        fixture.detectChanges(false);
        const store = rootDirective(fixture).getStore();
        fixture.destroy();
        expect(() => store?.subscribe('doc', () => {})).toThrow(/destroyed/);
    });

    it('replaces and destroys its store on an options change', () => {
        const fixture = TestBed.createComponent(OptionsRootComponent);
        fixture.detectChanges(false);
        const directive = rootDirective(fixture);
        const firstStore = directive.getStore();

        fixture.componentInstance.options = { format: 'default' };
        fixture.detectChanges(false);

        const nextStore = directive.getStore();
        expect(nextStore).not.toBeNull();
        expect(nextStore).not.toBe(firstStore);
        expect(() => firstStore?.subscribe('doc', () => {})).toThrow(
            /destroyed/,
        );
        expect(() => nextStore?.subscribe('doc', () => {})).not.toThrow();
    });
});

@Component({
    selector: 'test-runtime-reader',
    standalone: true,
    template: `<input id="title" value="HIGH" />`,
})
class RuntimeReaderComponent {
    readonly ui = injectEzClassifyUI();
}

@Component({
    selector: 'test-runtime-root',
    standalone: true,
    imports: [EzClassifyDirective, RuntimeReaderComponent],
    template: `<form ezClassify><test-runtime-reader /></form>`,
})
class RuntimeRootComponent {}

@Component({
    selector: 'test-runtime-outside',
    standalone: true,
    imports: [RuntimeReaderComponent],
    template: `<test-runtime-reader />`,
})
class RuntimeOutsideComponent {}

describe('injectEzClassifyUI', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RuntimeRootComponent, RuntimeOutsideComponent],
            providers: [
                provideEzClassify({
                    context: Context.fromComponents({ scheme: MINIMAL_SCHEME }),
                }),
            ],
        }).compileComponents();
    });

    it("gives a descendant its root's runtime, which marks up an element the page did not", async () => {
        const fixture = TestBed.createComponent(RuntimeRootComponent);
        fixture.detectChanges(false);
        const reader = fixture.debugElement.query(
            (node) => node.componentInstance instanceof RuntimeReaderComponent,
        ).componentInstance as RuntimeReaderComponent;
        expect(reader.ui()).toBeNull();
        await Promise.resolve();
        const ui = reader.ui()!;
        expect(ui.root).toBe(fixture.nativeElement.querySelector('form'));

        const title: HTMLInputElement =
            fixture.nativeElement.querySelector('#title');
        ui.add(title, 'marking');
        expect(ui.components.has(title)).toBe(true);
        await expect.poll(() => ui.store.get('title').rendered).toBe('HIGH');

        fixture.destroy();
        expect(reader.ui()).toBeNull();
        expect(title.hasAttribute('data-ezclassify-controller')).toBe(false);
    });

    it('refuses a caller outside any root', () => {
        expect(() => TestBed.createComponent(RuntimeOutsideComponent)).toThrow(
            /inside an ezClassify root/,
        );
    });
});

describe('EzClassifyDirective: no Context', () => {
    it('fails with the fix named when nothing provides a Context', async () => {
        await TestBed.configureTestingModule({
            imports: [BareRootComponent],
        }).compileComponents();

        const fixture = TestBed.createComponent(BareRootComponent);
        expect(() => fixture.detectChanges(false)).toThrow(
            /found no Context.*provideEzClassify\(\{ context \}\)/,
        );
    });
});

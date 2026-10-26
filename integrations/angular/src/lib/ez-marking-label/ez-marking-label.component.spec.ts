import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, Input, SimpleChange, signal } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { SchemeEngine } from '@ezclassify/engine';
import { EzClassifyDirective } from '../ezclassify.directive';
import { EzMarkingLabelComponent } from './ez-marking-label.component';

// Raw JSON document in canonical nested form, passed directly to Context.fromComponents.
// The outer `scheme:` key is what the engine parser expects at the document root.
const testSchemeDoc = {
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
                        id: 'LOW',
                        name: 'Low',
                        views: { default: 'LOW' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 0,
                        rank: 0,
                    },
                    {
                        id: 'MED',
                        name: 'Med',
                        views: { default: 'MED' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 1,
                        rank: 1,
                    },
                    {
                        id: 'HIGH',
                        name: 'High',
                        views: { default: 'HIGH' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 2,
                        rank: 2,
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

const COLOR_MAP = {
    LOW: { background: '#16a34a', text: '#ffffff' },
    MED: { background: '#d97706', text: '#ffffff', border: '#92400e' },
    HIGH: { background: '#b91c1c', text: '#ffffff', border: '#7f1d1d' },
};

function makeChange(
    cur: unknown,
    prev: unknown = '',
    first = true,
): SimpleChange {
    return {
        currentValue: cur,
        previousValue: prev,
        firstChange: first,
        isFirstChange: () => first,
    } as SimpleChange;
}

// ─── standalone (no directive) ───────────────────────────────────────────────

describe('EzMarkingLabelComponent: standalone', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [EzMarkingLabelComponent],
        }).compileComponents();
    });

    it('renders the marking text', () => {
        const fixture = TestBed.createComponent(EzMarkingLabelComponent);
        fixture.componentInstance.marking = 'HIGH';
        fixture.componentInstance.ngOnChanges({ marking: makeChange('HIGH') });
        fixture.detectChanges(false);
        expect(fixture.nativeElement.textContent.trim()).toBe('HIGH');
    });

    it('renders without color when there is no engine or colorMap', () => {
        const fixture = TestBed.createComponent(EzMarkingLabelComponent);
        fixture.componentInstance.marking = 'HIGH';
        fixture.componentInstance.ngOnChanges({ marking: makeChange('HIGH') });
        fixture.detectChanges(false);
        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span).toBeTruthy();
        expect(span.classList.contains('ez-marking-label--colored')).toBe(
            false,
        );
    });

    it('renders without color when colorMap has entries but no engine for processing', () => {
        const fixture = TestBed.createComponent(EzMarkingLabelComponent);
        fixture.componentInstance.marking = 'HIGH';
        fixture.componentInstance.colorMap = COLOR_MAP;
        fixture.componentInstance.ngOnChanges({
            marking: makeChange('HIGH'),
            colorMap: makeChange(COLOR_MAP),
        });
        fixture.detectChanges(false);
        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        // No engine → cannot process → no color
        expect(span.classList.contains('ez-marking-label--colored')).toBe(
            false,
        );
    });
});

// ─── inside an [ezClassify] scope ─────────────────────────────────────────────

@Component({
    selector: 'test-host',
    standalone: true,
    imports: [EzClassifyDirective, EzMarkingLabelComponent],
    template: `
        <div [ezClassify]="engine" [ezClassifyOptions]="{ colorMap: colorMap }">
            <ez-marking-label [marking]="marking" />
        </div>
    `,
})
class TestHostComponent {
    engine!: SchemeEngine;
    colorMap = COLOR_MAP;
    @Input() marking = '';
}

describe('EzMarkingLabelComponent: inside [ezClassify] scope', () => {
    let engine: SchemeEngine;

    beforeEach(async () => {
        engine = Context.fromComponents({ scheme: testSchemeDoc })
            .scheme as SchemeEngine;

        await TestBed.configureTestingModule({
            imports: [TestHostComponent],
        }).compileComponents();
    });

    function createHost(marking: string) {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.componentInstance.marking = marking;
        // EzClassifyDirective initializes via a microtask, flush before detecting
        fixture.detectChanges(false);
        return fixture;
    }

    it('renders the marking text', () => {
        const fixture = createHost('HIGH');
        const label = fixture.nativeElement.querySelector('ez-marking-label');
        expect(label.textContent.trim()).toBe('HIGH');
    });

    it('applies colorMap colors for a known concept', async () => {
        const fixture = createHost('HIGH');
        // Give the directive's microtask a chance to run
        await Promise.resolve();
        fixture.detectChanges(false);

        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        // The ez-marking-label--colored class marks that colors were found
        expect(span.classList.contains('ez-marking-label--colored')).toBe(true);
        // CSS custom props should be set
        expect(span.style.getPropertyValue('--ez-marking-bg')).toBe('#b91c1c');
        expect(span.style.getPropertyValue('--ez-marking-text')).toBe(
            '#ffffff',
        );
        expect(span.style.getPropertyValue('--ez-marking-border')).toBe(
            '#7f1d1d',
        );
    });

    it('matches color for a lower level', async () => {
        const fixture = createHost('LOW');
        await Promise.resolve();
        fixture.detectChanges(false);

        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.classList.contains('ez-marking-label--colored')).toBe(true);
        expect(span.style.getPropertyValue('--ez-marking-bg')).toBe('#16a34a');
    });

    it('renders without color when marking is not in colorMap', async () => {
        const fixture = createHost('UNKNOWN-MARKING');
        await Promise.resolve();
        fixture.detectChanges(false);

        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.classList.contains('ez-marking-label--colored')).toBe(
            false,
        );
    });
});

// ─── explicit [colorMap] override ─────────────────────────────────────────────

@Component({
    selector: 'test-override-host',
    standalone: true,
    imports: [EzClassifyDirective, EzMarkingLabelComponent],
    template: `
        <div
            [ezClassify]="engine"
            [ezClassifyOptions]="{ colorMap: inheritedMap }">
            <ez-marking-label [marking]="marking" [colorMap]="overrideMap" />
        </div>
    `,
})
class TestOverrideHostComponent {
    engine!: SchemeEngine;
    marking = 'LOW';
    inheritedMap = { HIGH: { background: '#b91c1c', text: '#ffffff' } };
    overrideMap = { LOW: { background: '#0000ff', text: '#ffffff' } };
}

describe('EzMarkingLabelComponent: explicit [colorMap] overrides inherited', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestOverrideHostComponent],
        }).compileComponents();
    });

    it('uses the explicit [colorMap] input instead of the inherited one', async () => {
        const engine = Context.fromComponents({ scheme: testSchemeDoc })
            .scheme as SchemeEngine;
        const fixture = TestBed.createComponent(TestOverrideHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.detectChanges(false);
        await Promise.resolve();
        fixture.detectChanges(false);

        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.classList.contains('ez-marking-label--colored')).toBe(true);
        // Should use the override map's LOW color, not the inherited HIGH-only map
        expect(span.style.getPropertyValue('--ez-marking-bg')).toBe('#0000ff');
    });
});

// ─── an engine that arrives after the label is on screen ─────────────────────

@Component({
    selector: 'test-late-engine-host',
    standalone: true,
    imports: [EzClassifyDirective, EzMarkingLabelComponent],
    template: `
        <div
            [ezClassify]="engine()"
            [ezClassifyOptions]="{ colorMap: colorMap }">
            <ez-marking-label [marking]="marking" />
        </div>
    `,
})
class TestLateEngineHostComponent {
    readonly engine = signal<SchemeEngine | null>(null);
    colorMap = COLOR_MAP;
    marking = 'HIGH';
}

describe('EzMarkingLabelComponent: an engine that arrives late', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestLateEngineHostComponent],
        }).compileComponents();
    });

    /**
     * A REST-backed adapter is fetched, so the host binds an engine that is
     * null for the first frames. The pill must resolve its color when the
     * engine arrives, even when the label's own inputs have not changed.
     */
    it('colors the pill once the scope resolves an engine', async () => {
        const fixture = TestBed.createComponent(TestLateEngineHostComponent);
        fixture.detectChanges(false);
        await Promise.resolve();
        fixture.detectChanges(false);

        const span = fixture.nativeElement.querySelector('.ez-marking-label');
        expect(span.classList.contains('ez-marking-label--colored')).toBe(
            false,
        );

        fixture.componentInstance.engine.set(
            Context.fromComponents({ scheme: testSchemeDoc })
                .scheme as SchemeEngine,
        );
        fixture.detectChanges(false);
        await Promise.resolve();
        fixture.detectChanges(false);

        expect(span.classList.contains('ez-marking-label--colored')).toBe(true);
        expect(span.style.getPropertyValue('--ez-marking-bg')).toBe('#b91c1c');
    });
});

/**
 * Tests for the Angular ContextReference binding. Proves the component stamps
 * the controller's declarative attributes and CSS variables onto its host (a
 * thin map, not a re-implementation) and that, inside an [ezClassify] scope,
 * the ambient scanner enhances it into a tabbed drawer with the host's
 * projected custom tab hoisted: the same behavior the React and Vue bindings
 * produce.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';
import {
    cedarValleySchemeYaml,
    cedarValleyGuideYaml,
    cedarValleyAccessYaml,
} from '@ezclassify/example-schemes/cedar-valley';
import { EzClassifyDirective } from '../ezclassify.directive';
import { EzContextReferenceComponent } from './context-reference.component';
import { EzContextReferenceTabComponent } from './context-reference-tab.component';

const flush = () => new Promise((r) => setTimeout(r, 50));

function fullContext(): Context {
    return Context.fromComponents({
        scheme: yaml.load(cedarValleySchemeYaml),
        guides: [yaml.load(cedarValleyGuideYaml)],
        access: yaml.load(cedarValleyAccessYaml),
    });
}

describe('EzContextReferenceComponent: markup', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                EzContextReferenceComponent,
                EzContextReferenceTabComponent,
            ],
        }).compileComponents();
    });

    it('maps presentation inputs onto the controller attributes and CSS vars', () => {
        const fixture = TestBed.createComponent(EzContextReferenceComponent);
        const c = fixture.componentInstance;
        c.placement = 'left';
        c.size = '24rem';
        c.open = true;
        c.tabs = ['handbook', 'access'];
        c.offset = { top: '60px' };
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.getAttribute('data-ezclassify-controller')).toBe(
            'context-reference',
        );
        expect(
            host.getAttribute('data-ezclassify-context-reference-placement'),
        ).toBe('left');
        expect(
            host.getAttribute('data-ezclassify-context-reference-size'),
        ).toBe('24rem');
        expect(
            host.hasAttribute('data-ezclassify-context-reference-open'),
        ).toBe(true);
        expect(
            host.getAttribute('data-ezclassify-context-reference-tabs'),
        ).toBe('handbook,access');
        expect(host.style.getPropertyValue('--ez-context-ref-offset-top')).toBe(
            '60px',
        );
    });

    it('stamps the tab marker attributes on the tab host', () => {
        const fixture = TestBed.createComponent(EzContextReferenceTabComponent);
        const c = fixture.componentInstance;
        c.id = 'developers';
        c.label = 'Developers';
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.hasAttribute('data-ezclassify-tab')).toBe(true);
        expect(host.getAttribute('data-ezclassify-tab-id')).toBe('developers');
        expect(host.getAttribute('data-ezclassify-tab-label')).toBe(
            'Developers',
        );
    });
});

@Component({
    selector: 'test-host',
    standalone: true,
    imports: [
        EzClassifyDirective,
        EzContextReferenceComponent,
        EzContextReferenceTabComponent,
    ],
    template: `
        <div [ezClassify]="engine">
            <ez-context-reference [open]="true" placement="left">
                <ez-context-reference-tab id="developers" label="Developers">
                    <p>dev content</p>
                </ez-context-reference-tab>
            </ez-context-reference>
        </div>
    `,
})
class TestHostComponent {
    engine = fullContext();
}

describe('EzContextReferenceComponent: inside an [ezClassify] scope', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestHostComponent],
        }).compileComponents();
    });

    it('is enhanced by the ambient scanner into a tabbed drawer', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();
        await flush();

        const host = fixture.nativeElement as HTMLElement;
        const ids = Array.from(
            host.querySelectorAll<HTMLButtonElement>('.ez-context-ref__tab'),
        ).map((t) => t.dataset.tabId);
        expect(ids).toEqual(['handbook', 'guidebook', 'access', 'developers']);

        const devPanel = host.querySelector('#ez-context-ref-panel-developers');
        expect(devPanel?.textContent).toContain('dev content');
    });
});

/**
 * The controller must never reparent an `<ng-content>`-projected custom-tab
 * host out of Angular's control. These drive real change detection through the
 * scanner: enhancement happens, then Angular adds/removes/reorders its
 * projected tabs.
 */
interface CustomTab {
    id: string;
    label: string;
    content: string;
}

@Component({
    selector: 'reactive-host',
    standalone: true,
    imports: [
        CommonModule,
        EzClassifyDirective,
        EzContextReferenceComponent,
        EzContextReferenceTabComponent,
    ],
    template: `
        <div [ezClassify]="engine">
            <ez-context-reference [open]="true">
                <ez-context-reference-tab
                    *ngFor="let t of customs(); trackBy: trackId"
                    [id]="t.id"
                    [label]="t.label">
                    <p>{{ t.content }}</p>
                </ez-context-reference-tab>
            </ez-context-reference>
        </div>
    `,
})
class ReactiveHostComponent {
    engine = fullContext();
    readonly customs = signal<CustomTab[]>([
        { id: 'developers', label: 'Developers', content: 'dev content' },
    ]);
    trackId(_i: number, t: CustomTab): string {
        return t.id;
    }
}

describe('EzContextReferenceComponent reactive lifecycle', () => {
    let fixture: ComponentFixture<ReactiveHostComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ReactiveHostComponent],
        }).compileComponents();
        fixture = TestBed.createComponent(ReactiveHostComponent);
    });

    /** Initial render + scanner enhancement. */
    const settle = async () => {
        fixture.detectChanges();
        await flush();
        await flush();
    };

    /**
     * Apply a reactive change and drive change detection so Angular re-diffs
     * the projected `*ngFor`, then let the controller's observer rebuild the
     * strip.
     *
     * `markForCheck() + whenStable()` is required, not decoration: in this
     * vitest + Angular runner a plain post-mutation `detectChanges()` over
     * `<ng-content>`-projected `*ngFor` items does not re-diff and raises a
     * dev-mode NG0100: reproducible with NO drawer in the tree at all, so it is
     * a runner artifact, not a controller defect. The second pass lets the
     * controller's (async) MutationObserver reconcile the tab strip.
     */
    const mutate = async (fn: () => void) => {
        fn();
        fixture.componentRef.changeDetectorRef.markForCheck();
        await fixture.whenStable();
        fixture.detectChanges();
        await flush();
        await flush();
    };

    const ids = () =>
        Array.from(
            (
                fixture.nativeElement as HTMLElement
            ).querySelectorAll<HTMLButtonElement>('.ez-context-ref__tab'),
        ).map((t) => t.dataset.tabId);

    it('projects a custom tab in place without reparenting it', async () => {
        await settle();
        expect(ids()).toEqual([
            'handbook',
            'guidebook',
            'access',
            'developers',
        ]);
        const custom = (fixture.nativeElement as HTMLElement).querySelector(
            '[data-ezclassify-tab]',
        ) as HTMLElement;
        expect(custom.parentElement?.classList.contains('ez-context-ref')).toBe(
            true,
        );
        expect(custom.getAttribute('role')).toBe('tabpanel');
    });

    it('removes a custom tab on a reactive removal without throwing', async () => {
        await settle();
        expect(ids()).toContain('developers');
        await mutate(() => {
            fixture.componentInstance.customs.set([]);
        });
        expect(ids()).not.toContain('developers');
    });

    it('adds a custom tab on a reactive addition', async () => {
        await settle();
        await mutate(() => {
            fixture.componentInstance.customs.update((customs) => [
                ...customs,
                { id: 'ops', label: 'Ops', content: 'ops content' },
            ]);
        });
        expect(ids()).toContain('ops');
    });

    it('reorders custom tabs on a reactive reorder', async () => {
        await mutate(() => {
            fixture.componentInstance.customs.set([
                { id: 'developers', label: 'Developers', content: 'dev' },
                { id: 'ops', label: 'Ops', content: 'ops' },
            ]);
        });
        expect(ids()).toEqual([
            'handbook',
            'guidebook',
            'access',
            'developers',
            'ops',
        ]);
        await mutate(() => {
            fixture.componentInstance.customs.update((customs) =>
                [...customs].reverse(),
            );
        });
        expect(ids()).toEqual([
            'handbook',
            'guidebook',
            'access',
            'ops',
            'developers',
        ]);
    });

    it('updates custom panel content in place', async () => {
        await settle();
        await mutate(() => {
            fixture.componentInstance.customs.set([
                {
                    id: 'developers',
                    label: 'Developers',
                    content: 'updated content',
                },
            ]);
        });
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '#ez-context-ref-panel-developers',
            )?.textContent,
        ).toContain('updated content');
    });

    it('destroys without throwing', async () => {
        await settle();
        expect(() => fixture.destroy()).not.toThrow();
    });
});

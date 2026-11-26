/**
 * `injectEzClassifyUnverified(id)` follows one field's own state: the attribute
 * and `ezclassify:unverified-change` event its host carries. These drive a real
 * enhanced field through a failed and then a successful check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal, type Signal } from '@angular/core';
import { EzClassifyDirective } from './ezclassify.directive';
import { provideEzClassify } from './provide-ezclassify';
import { injectEzClassifyUnverified } from './inject-ezclassify-unverified';
import { createUnverifiableContext } from '../../../../libs/ui/test-fixtures/unverifiable-context';

const UNVERIFIED = 'data-ezclassify-unverified';

async function settle(): Promise<void> {
    for (let index = 0; index < 8; index++)
        await new Promise<void>((tick) => setTimeout(tick, 25));
}

function report(host: HTMLElement, unverified: boolean): void {
    host.toggleAttribute(UNVERIFIED, unverified);
    host.dispatchEvent(
        new CustomEvent('ezclassify:unverified-change', {
            bubbles: true,
            detail: { unverified },
        }),
    );
}

@Component({
    selector: 'test-unverified-form',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<form ezClassify>
        <input id="mine" data-ezclassify-controller="marking" />
        <input id="other" data-ezclassify-controller="marking" />
    </form>`,
})
class FormComponent {
    readonly mine = injectEzClassifyUnverified('mine');
    readonly other = injectEzClassifyUnverified('other');
}

@Component({
    selector: 'test-unverified-probe',
    standalone: true,
    template: ``,
})
class ProbeComponent {
    readonly id = signal('first');
    readonly unverified: Signal<boolean> = injectEzClassifyUnverified(this.id);
}

afterEach(() => {
    TestBed.resetTestingModule();
    document.body.replaceChildren();
});

describe('injectEzClassifyUnverified in a real field', () => {
    it('is true after a failed check, false again after the next one lands, and only for its own field', async () => {
        const controls = { down: false };
        const context = await createUnverifiableContext(controls);
        await TestBed.configureTestingModule({
            imports: [FormComponent],
            providers: [provideEzClassify({ context: context as never })],
        }).compileComponents();
        const fixture = TestBed.createComponent(FormComponent);
        document.body.append(fixture.nativeElement);
        fixture.detectChanges();
        await settle();
        const editor = fixture.nativeElement.querySelector(
            '.marking-field-host',
        ) as HTMLTextAreaElement;
        const type = (text: string) => {
            editor.focus();
            editor.value = text;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        };
        expect(fixture.componentInstance.mine()).toBe(false);
        controls.down = true;
        type('sec');
        await settle();
        expect(
            fixture.nativeElement
                .querySelector('#mine')
                .hasAttribute(UNVERIFIED),
        ).toBe(true);
        expect(fixture.componentInstance.mine()).toBe(true);
        expect(fixture.componentInstance.other()).toBe(false);
        controls.down = false;
        type('secret zzz');
        await settle();
        expect(fixture.componentInstance.mine()).toBe(false);
    });
});

describe('injectEzClassifyUnverified', () => {
    it('reads true when the field already is, waits for one not enhanced yet, and follows an id that changes', () => {
        const first = document.createElement('input');
        first.id = 'first';
        first.setAttribute(UNVERIFIED, '');
        const second = document.createElement('input');
        second.id = 'second';
        document.body.append(first, second);
        const fixture = TestBed.createComponent(ProbeComponent);
        fixture.detectChanges();
        expect(fixture.componentInstance.unverified()).toBe(true);
        fixture.componentInstance.id.set('second');
        fixture.detectChanges();
        expect(fixture.componentInstance.unverified()).toBe(false);
        report(second, true);
        expect(fixture.componentInstance.unverified()).toBe(true);
        report(first, false);
        expect(fixture.componentInstance.unverified()).toBe(true);
        fixture.componentInstance.id.set('late');
        fixture.detectChanges();
        expect(fixture.componentInstance.unverified()).toBe(false);
    });

    it('stops listening when its component is destroyed', () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        const fixture = TestBed.createComponent(ProbeComponent);
        fixture.detectChanges();
        const named = (spy: typeof add) =>
            spy.mock.calls.filter(
                ([type]) => type === 'ezclassify:unverified-change',
            ).length;
        expect(named(add)).toBeGreaterThan(0);
        fixture.destroy();
        expect(named(remove)).toBe(named(add));
    });
});

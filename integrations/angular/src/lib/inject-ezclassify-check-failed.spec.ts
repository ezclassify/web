/**
 * `injectEzClassifyCheckFailed(id)` follows one field's own check state: the
 * attribute and `ezclassify:check-change` event its host carries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { injectEzClassifyCheckFailed } from './inject-ezclassify-check-failed';

afterEach(() => document.body.replaceChildren());

describe('injectEzClassifyCheckFailed', () => {
    it('is true while its own field reports a failed check, and not for another field', () => {
        const mine = document.createElement('input');
        mine.id = 'mine';
        const other = document.createElement('input');
        other.id = 'other';
        document.body.append(mine, other);
        const failed = TestBed.runInInjectionContext(() =>
            injectEzClassifyCheckFailed('mine'),
        );
        const report = (host: HTMLElement, state: boolean) =>
            host.dispatchEvent(
                new CustomEvent('ezclassify:check-change', {
                    bubbles: true,
                    detail: { failed: state },
                }),
            );
        expect(failed()).toBe(false);
        report(other, true);
        expect(failed()).toBe(false);
        report(mine, true);
        expect(failed()).toBe(true);
        report(mine, false);
        expect(failed()).toBe(false);
    });
});

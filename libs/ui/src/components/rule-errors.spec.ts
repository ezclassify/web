/**
 * Unit tests for the shared rule-error surface: the broken rules, then the
 * engine's ways to fix the marking (each a whole resulting marking), the
 * statement a pressed fix leaves, and the rendered list itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    Fix,
    FixConceptReference,
    ValidationError,
} from '@ezclassify/types';
import {
    RuleErrorList,
    fixAssertions,
    fixButtonLabel,
    placeUnderField,
    ruleErrorsFrom,
    type RuleErrorReport,
} from './rule-errors';

const ref = (conceptId: string, categoryId = 'cat'): FixConceptReference => ({
    conceptId,
    categoryId,
});

/** A proposed fix: one whole resulting marking. */
function scenario(partial: Partial<Fix> & Pick<Fix, 'message'>): Fix {
    return { rendered: '', keeps: [], adds: [], removes: [], ...partial };
}

describe('ruleErrorsFrom', () => {
    const errors: ValidationError[] = [
        { constraintId: 'needs-b', message: 'Alpha requires Bravo.' },
        { constraintId: 'no-c', message: 'Charlie is not allowed.' },
    ];

    it('lists the rule errors, then every fix, each worded by its own message', () => {
        const result = ruleErrorsFrom(errors, [
            scenario({
                message: 'Replace Alpha with Bravo and remove Charlie.',
                rendered: 'BRAVO',
            }),
            scenario({ message: 'Remove Alpha and Charlie.', rendered: '' }),
        ]);
        expect(result.messages).toEqual([
            'Alpha requires Bravo.',
            'Charlie is not allowed.',
        ]);
        expect(result.fixes.map((f) => f.label)).toEqual([
            'Replace Alpha with Bravo and remove Charlie',
            'Remove Alpha and Charlie',
        ]);
    });

    it('offers two fixes that end in the same marking once, where the engine first listed it', () => {
        const first = scenario({ message: 'Add Bravo.', rendered: 'A//B' });
        const result = ruleErrorsFrom(errors, [
            first,
            scenario({ message: 'Remove Charlie.', rendered: 'A' }),
            scenario({ message: 'Add Bravo, again.', rendered: 'A//B' }),
        ]);
        expect(result.fixes.map((f) => f.fix)).toEqual([
            first,
            expect.objectContaining({ rendered: 'A' }),
        ]);
    });

    it('reports every engine error and its proposed fixes regardless of the constraint id', () => {
        const fixes = [scenario({ message: 'Remove Qqq.', rendered: 'A' })];
        const only = ruleErrorsFrom(
            [{ constraintId: '_unmatched_token', message: 'Unrecognized' }],
            fixes,
        );
        expect(only.messages).toEqual(['Unrecognized']);
        expect(only.fixes.map(({ fix }) => fix)).toEqual(fixes);
        expect(only.warnings).toEqual([]);
        const mixed = ruleErrorsFrom(
            [
                { constraintId: '_unmatched_token', message: 'Unrecognized' },
                { constraintId: 'rule', message: 'Broken rule.' },
            ],
            fixes,
        );
        expect(mixed.messages).toEqual(['Unrecognized', 'Broken rule.']);
        expect(mixed.fixes).toHaveLength(1);
    });

    it("reports the whole's invalid-part finding alongside its other engine errors", () => {
        const result = ruleErrorsFrom(
            [
                { constraintId: '_unmatched_token', message: 'Unrecognized' },
                {
                    constraintId: '_invalid_part',
                    message: 'Part 2 does not read as a valid part marking.',
                },
            ],
            [],
        );
        expect(result.messages).toEqual([
            'Unrecognized',
            'Part 2 does not read as a valid part marking.',
        ]);
    });

    it('carries the warnings, each once, and never offers a fix for a warning alone', () => {
        const fixes = [scenario({ message: 'Remove Qqq.', rendered: 'A' })];
        const warning = {
            ruleId: '_whole_unverified',
            kind: 'rule' as const,
            message: 'Unable to compare with invalid whole.',
        };
        expect(ruleErrorsFrom([], fixes, [warning, warning])).toEqual({
            messages: [],
            fixes: [],
            warnings: ['Unable to compare with invalid whole.'],
        });
        const both = ruleErrorsFrom(
            [{ constraintId: 'rule', message: 'Broken rule.' }],
            fixes,
            [warning],
        );
        expect(both.messages).toEqual(['Broken rule.']);
        expect(both.warnings).toEqual([warning.message]);
        expect(both.fixes).toHaveLength(1);
    });

    it('shows a part with no whole to compare against as valid, with the warning and no error', () => {
        // A rule that asks about the whole is unresolved when the part has no
        // whole. The engine returns the part valid, with no errors, and only
        // the `_whole_unverified` warning.
        const report = ruleErrorsFrom(
            [],
            [],
            [
                {
                    ruleId: '_whole_unverified',
                    kind: 'rule',
                    message: 'Unable to compare with invalid whole.',
                },
            ],
        );
        expect(report).toEqual({
            messages: [],
            fixes: [],
            warnings: ['Unable to compare with invalid whole.'],
        });

        const list = new RuleErrorList(document);
        list.update(report, vi.fn());
        expect([...list.element.children].map((c) => c.className)).toEqual([
            'ez-validation-errors__item ez-validation-errors__item--warning',
        ]);
        expect(list.element.querySelector('button')).toBeNull();
    });
});

describe('fixButtonLabel', () => {
    it('reads the fix message as an action, without its closing period', () => {
        expect(
            fixButtonLabel(
                scenario({ message: 'Replace PUBLIC with CONFIDENTIAL.' }),
            ),
        ).toBe('Replace PUBLIC with CONFIDENTIAL');
        expect(
            fixButtonLabel(
                scenario({
                    message:
                        'Remove FINANCIAL INFORMATION, OAKWOOD and DO NOT FORWARD',
                }),
            ),
        ).toBe('Remove FINANCIAL INFORMATION, OAKWOOD and DO NOT FORWARD');
    });
});

describe('fixAssertions', () => {
    it('states what the fix keeps and what it adds as the author marking', () => {
        const next = fixAssertions(
            scenario({
                message: 'Replace L1 with L2 and add B.',
                rendered: 'L2//A//B',
                keeps: [ref('A')],
                adds: [ref('L2', 'level'), ref('B')],
                removes: [ref('L1', 'level'), ref('C')],
            }),
        );
        expect(next).toEqual([
            {
                conceptId: 'A',
                categoryId: 'cat',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'L2',
                categoryId: 'level',
                confidence: 'certain',
                source: 'user',
            },
            {
                conceptId: 'B',
                categoryId: 'cat',
                confidence: 'certain',
                source: 'user',
            },
        ]);
    });

    it('states nothing the fix removes, and nothing the engine will derive again', () => {
        const next = fixAssertions(
            scenario({
                message: 'Remove everything.',
                removes: [ref('A'), ref('B')],
            }),
        );
        expect(next).toEqual([]);
    });
});

describe('RuleErrorList', () => {
    let host: HTMLDivElement;
    beforeEach(() => {
        document.body.innerHTML = '';
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    const errors: RuleErrorReport = {
        messages: ['Alpha requires Bravo.', 'Charlie is not allowed.'],
        warnings: [],
        fixes: [
            {
                fix: scenario({
                    message: 'Replace Alpha with Bravo.',
                    rendered: 'BRAVO',
                    adds: [ref('B')],
                    removes: [ref('A')],
                }),
                label: 'Replace Alpha with Bravo',
            },
            {
                fix: scenario({
                    message: 'Remove Alpha.',
                    rendered: '',
                    removes: [ref('A')],
                }),
                label: 'Remove Alpha',
            },
        ],
    };

    it('shows warnings after the errors, as warnings, and shows a list of warnings alone', () => {
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update({ ...errors, warnings: ['Heads up.'] }, vi.fn());
        expect(
            [...list.element.children].map((c) => c.className).slice(0, 3),
        ).toEqual([
            'ez-validation-errors__item',
            'ez-validation-errors__item',
            'ez-validation-errors__item ez-validation-errors__item--warning',
        ]);

        list.update(
            { messages: [], fixes: [], warnings: ['Heads up.'] },
            vi.fn(),
        );
        expect(list.element.hidden).toBe(false);
        expect(list.element.textContent).toBe('Heads up.');
        expect(list.element.querySelector('button')).toBeNull();
    });

    it('lists the errors, then the fix paths as real buttons', () => {
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update(errors, vi.fn());

        const children = [...list.element.children];
        expect(children.map((c) => c.className)).toEqual([
            'ez-validation-errors__item',
            'ez-validation-errors__item',
            'ez-validation-errors__fixes-heading',
            'ez-validation-errors__fixes',
        ]);
        // The paths are one group, named by the heading above them.
        expect(children[2].textContent).toBe('Ways to fix');
        expect(children[3].getAttribute('role')).toBe('group');
        expect(children[3].getAttribute('aria-labelledby')).toBe(
            children[2].id,
        );
        expect(
            children
                .slice(0, 2)
                .map(
                    (c) =>
                        c.querySelector('.ez-validation-errors__message')
                            ?.textContent,
                ),
        ).toEqual(['Alpha requires Bravo.', 'Charlie is not allowed.']);
        // No error carries buttons of its own.
        expect(
            list.element.querySelectorAll('.ez-validation-errors__item button'),
        ).toHaveLength(0);
        const buttons = Array.from(
            children[3].querySelectorAll<HTMLButtonElement>(
                'button.ez-validation-errors__fix',
            ),
        );
        expect(buttons.map((b) => b.textContent)).toEqual([
            'Replace Alpha with Bravo',
            'Remove Alpha',
        ]);
        expect(buttons.every((b) => b.type === 'button')).toBe(true);
        expect(list.element.hidden).toBe(false);
        expect(list.element.getAttribute('aria-live')).toBe('polite');
    });

    it('hands a fix to the owner once, whole', () => {
        const whole = scenario({
            message: 'Remove Bravo, Charlie and Delta.',
            rendered: 'ALPHA',
            keeps: [ref('A')],
            removes: [ref('B'), ref('C'), ref('D')],
        });
        const report = ruleErrorsFrom(
            [
                { constraintId: 'r1', message: 'One.' },
                { constraintId: 'r2', message: 'Two.' },
            ],
            [whole],
        );
        const onApply = vi.fn();
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update(report, onApply);
        list.element.querySelector<HTMLButtonElement>('button')!.click();

        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply).toHaveBeenCalledWith(whole);
        expect(
            fixAssertions(onApply.mock.calls[0][0]).map((a) => a.conceptId),
        ).toEqual(['A']);
    });

    it('hands the chosen fix to the owner', () => {
        const onApply = vi.fn();
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update(errors, onApply);

        list.element
            .querySelectorAll<HTMLButtonElement>(
                'button.ez-validation-errors__fix',
            )[1]
            .click();

        expect(onApply).toHaveBeenCalledTimes(1);
        expect(onApply).toHaveBeenCalledWith(errors.fixes[1].fix);
    });

    it('keeps the same nodes when the report has not changed, so it is not announced again', () => {
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update(errors, vi.fn());
        const first = list.element.firstElementChild;

        list.update(errors, vi.fn());

        expect(list.element.firstElementChild).toBe(first);
    });

    it('rebuilds when a fix with the same words now writes a different marking', () => {
        const onApply = vi.fn();
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        const before = scenario({ message: 'Remove A.', rendered: 'LOW//B' });
        const after = scenario({ message: 'Remove A.', rendered: 'HIGH//B' });
        list.update(
            {
                messages: ['A over B.'],
                fixes: [{ fix: before, label: 'Remove A' }],
                warnings: [],
            },
            onApply,
        );
        list.update(
            {
                messages: ['A over B.'],
                fixes: [{ fix: after, label: 'Remove A' }],
                warnings: [],
            },
            onApply,
        );
        list.element.querySelector<HTMLButtonElement>('button')!.click();
        expect(onApply).toHaveBeenCalledWith(after);
    });

    it('never takes focus on a pointer press, and returns it to the field after any press', () => {
        const returnFocus = vi.fn();
        const list = new RuleErrorList(document, returnFocus);
        host.appendChild(list.element);
        list.update(errors, vi.fn());
        const button = list.element.querySelector<HTMLButtonElement>(
            'button.ez-validation-errors__fix',
        )!;

        const press = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        button.dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);
        // A tap or click: the button goes with its errors, so focus goes
        // back to the field rather than staying on the page.
        button.click();
        expect(returnFocus).toHaveBeenCalledTimes(1);

        button.focus();
        button.click();
        expect(returnFocus).toHaveBeenCalledTimes(2);
    });

    it('passes touch activation to its owner and resets for the next keyboard activation', () => {
        const returnFocus = vi.fn();
        const list = new RuleErrorList(document, returnFocus);
        host.appendChild(list.element);
        list.update(errors, vi.fn());
        const button = list.element.querySelector<HTMLButtonElement>(
            'button.ez-validation-errors__fix',
        )!;
        const touch = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(touch, 'pointerType', { value: 'touch' });
        button.dispatchEvent(touch);
        button.dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1 }),
        );
        expect(returnFocus).toHaveBeenLastCalledWith('touch');
        button.click();
        expect(returnFocus).toHaveBeenLastCalledWith('keyboard');
        button.dispatchEvent(touch);
        button.dispatchEvent(new Event('pointercancel'));
        button.click();
        expect(returnFocus).toHaveBeenLastCalledWith('keyboard');
    });

    it('an abandoned touch press does not change a later assistive activation', () => {
        const returnFocus = vi.fn();
        const list = new RuleErrorList(document, returnFocus);
        host.appendChild(list.element);
        list.update(errors, vi.fn());
        const button = list.element.querySelector<HTMLButtonElement>(
            'button.ez-validation-errors__fix',
        )!;
        const touch = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(touch, 'pointerType', { value: 'touch' });
        button.dispatchEvent(touch);
        document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
        button.click();
        expect(returnFocus).toHaveBeenLastCalledWith('keyboard');
    });

    it('shows the message alone when the owner cannot apply fixes', () => {
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update(errors, null);

        expect(
            list.element.querySelectorAll('button.ez-validation-errors__fix'),
        ).toHaveLength(0);
        expect(list.element.textContent).toContain('Alpha requires Bravo.');
    });

    it('hides and empties itself when there is nothing to report', () => {
        const list = new RuleErrorList(document);
        host.appendChild(list.element);
        list.update(errors, vi.fn());
        list.update({ messages: [], fixes: [], warnings: [] }, vi.fn());

        expect(list.element.hidden).toBe(true);
        expect(list.element.childElementCount).toBe(0);
    });
});

describe('placeUnderField', () => {
    it('sits directly after a wrapper with no chrome, not after a hidden mount elsewhere', () => {
        document.body.innerHTML = `
            <div id="card">
                <div class="marking-field-wrap"><textarea id="host"></textarea></div>
                <div id="mount" data-ezclassify-mount></div>
            </div>`;
        const el = document.createElement('div');
        placeUnderField(
            el,
            document.getElementById('host')!,
            document.getElementById('mount')!,
        );
        expect(
            document.querySelector('.marking-field-wrap')!.nextElementSibling,
        ).toBe(el);
    });

    it('goes inside the wrapper before the field chrome, so Tab reaches the fixes first', () => {
        document.body.innerHTML = `
            <div class="marking-field-wrap">
                <textarea id="host"></textarea>
                <div class="marking-field-display"></div>
                <div class="ez-field-drawer"><button>star</button></div>
            </div>`;
        const el = document.createElement('div');
        const wrap = document.querySelector('.marking-field-wrap')!;
        placeUnderField(el, document.getElementById('host')!, wrap);
        expect(el.parentElement).toBe(wrap);
        expect(el.nextElementSibling?.classList).toContain('ez-field-drawer');
        // Placing it again keeps it where it is.
        placeUnderField(el, document.getElementById('host')!, wrap);
        expect(wrap.querySelectorAll(':scope > div')).toHaveLength(3);
    });

    it('goes before a marked field hint row', () => {
        document.body.innerHTML = `
            <div class="marked-input-wrap">
                <div class="marked-input-display"></div>
                <textarea id="host"></textarea>
                <div class="marked-input-footer"><button>star</button></div>
            </div>`;
        const el = document.createElement('div');
        placeUnderField(el, document.getElementById('host')!, document.body);
        expect(el.nextElementSibling?.classList).toContain(
            'marked-input-footer',
        );
    });

    it('falls back to the mount when the field has no wrapper of its own', () => {
        document.body.innerHTML = `
            <div id="card">
                <input id="host" hidden />
                <div id="mount" data-ezclassify-mount><div class="tag-input-wrap"></div></div>
            </div>`;
        const el = document.createElement('div');
        placeUnderField(
            el,
            document.getElementById('host')!,
            document.getElementById('mount')!,
        );
        expect(document.getElementById('mount')!.nextElementSibling).toBe(el);
    });
});

/**
 * The composer's surface: the pinned result row, corrections, the needed strip,
 * Escape's two stages, and the combobox/listbox accessibility contract. Mounted
 * on a plain input over the in-memory port, so what is asserted is the view,
 * not any one field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerController } from './composer-controller';
import { ComposerView, accessibleLabel, middleEllipsis } from './composer-view';
import { CONCEPTS, FakePort, assertion } from './composer-port-mock';
import {
    activeRow,
    openSurface,
    press,
    resultState,
    resultValue,
    rowFor,
    rowLabels,
    rows,
    typeText,
    wait,
} from './composer-harness';

let root: HTMLDivElement;
let input: HTMLInputElement;
let port: FakePort;
let controller: ComposerController;
let view: ComposerView;

function mount(shape: 'whole' | 'additive' = 'whole') {
    controller = new ComposerController({
        port,
        shape,
        announce: (t) => view?.announce(t),
    });
    view = new ComposerView({
        controller,
        input,
        anchor: root,
        label: () => accessibleLabel(input, 'Marking'),
        singleLine: true,
    });
    root.appendChild(view.announcer);
    root.appendChild(view.note);
}

async function type(text: string) {
    typeText(input, text);
    await wait();
    await controller.settle();
    await wait(10);
}

beforeEach(() => {
    port = new FakePort();
    root = document.createElement('div');
    root.innerHTML = '<label for="m">Document marking</label><input id="m" />';
    document.body.appendChild(root);
    input = root.querySelector('input')!;
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    view?.destroy();
    controller?.dispose();
    root.remove();
});

describe('the result row', () => {
    it('keeps the result, required categories and options inside one scrolling body', async () => {
        mount();
        input.focus();
        await type('SECRET');
        const surface = openSurface()!;
        const scroll = surface.querySelector('.ez-composer__scroll')!;
        expect(
            scroll.contains(surface.querySelector('.ez-composer__result')),
        ).toBe(true);
        expect(
            scroll.contains(surface.querySelector('.ez-composer__needs')),
        ).toBe(true);
        expect(scroll.contains(view.list)).toBe(true);
        expect(
            scroll.contains(surface.querySelector('.ez-composer__footer')),
        ).toBe(false);
    });

    it('shows what a commit stores, with a change mark per fact', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        mount();
        input.focus();
        await type('SECRET noforn');
        expect(resultState()).toBe('ok');
        expect(resultValue()).toBe('SECRET//NOFORN');
        const marks = [
            ...openSurface()!.querySelectorAll('.ez-composer__change'),
        ].map((m) => m.textContent);
        expect(marks).toEqual(['+ NOFORN']);
    });

    it('marks a removed fact, struck through', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        mount();
        input.focus();
        await type('SECRET');
        const removed = openSurface()!.querySelector(
            '.ez-composer__change--removed',
        );
        expect(removed?.textContent).toBe('− NOFORN');
    });

    it('flags an unread fragment in place and says it is not recognized', async () => {
        mount();
        input.focus();
        await type('SECRET qqq ');
        expect(resultState()).toBe('incomplete');
        const fragment = openSurface()!.querySelector('.ez-composer__fragment');
        expect(fragment?.textContent).toBe('qqq');
        expect(
            openSurface()!.querySelector('.ez-composer__result-rule')
                ?.textContent,
        ).toContain('“qqq” is not recognized');
    });

    it('marks the row as not current between a keystroke and its reading', async () => {
        mount();
        input.focus();
        await type('SECRET');
        const read = port.read.bind(port);
        let release: () => void = () => {};
        port.read = (text, base) =>
            new Promise((resolve) => {
                release = () => void read(text, base).then(resolve);
            });
        typeText(input, 'SECRET noforn');
        await wait();
        const row = openSurface()!.querySelector(
            '.ez-composer__result',
        ) as HTMLElement;
        expect(row.dataset.stale).toBe('true');
        expect(row.getAttribute('aria-busy')).toBe('true');
        release();
        await controller.settle();
        await wait(10);
        expect(row.dataset.stale).toBeUndefined();
        expect(resultValue()).toBe('SECRET//NOFORN');
    });

    it('in an additive field, shows the marking already held with the unread text after it, not the fragment alone', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        mount('additive');
        input.focus();
        await type('zz orcon');
        expect(resultState()).toBe('incomplete');
        expect(resultValue()).toBe('SECRET//NOFORN/ORCON zz');
        const marks = [
            ...openSurface()!.querySelectorAll(
                '.ez-composer__result-value mark',
            ),
        ].map((m) => m.textContent);
        expect(marks).toEqual(['zz']);
    });

    it('treats the token being typed as in progress, not as a mistake', async () => {
        mount();
        input.focus();
        await type('SECRET nof');
        expect(resultState()).toBe('typing');
        expect(
            openSurface()!.querySelector('.ez-composer__fragment--typing')
                ?.textContent,
        ).toBe('nof');
        expect(
            openSurface()!.querySelector('.ez-composer__result-rule'),
        ).toBeNull();
    });

    it('commits when pressed, the same as Enter with no active row', async () => {
        mount();
        input.focus();
        await type('noforn secret');
        (
            openSurface()!.querySelector('.ez-composer__result') as HTMLElement
        ).click();
        await wait(20);
        await controller.settle();
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(openSurface()).toBeNull();
    });
});

describe('the popover Done action', () => {
    const done = () =>
        openSurface()!.querySelector<HTMLButtonElement>(
            '.ez-composer__result button',
        )!;

    it.each(['whole', 'additive'] as const)(
        'commits the %s draft once even when a suggestion is active',
        async (shape) => {
            port.value = {
                assertions: [assertion(CONCEPTS[1])],
                rendered: 'SECRET',
            };
            mount(shape);
            input.focus();
            await type(shape === 'whole' ? 'secret noforn' : 'noforn');
            press(input, 'ArrowDown');
            await wait();
            const action = done();
            expect(action?.textContent).toBe('Done');
            expect(action?.type).toBe('button');
            action.click();
            await controller.settle();
            await wait(20);
            expect(port.value.rendered).toBe('SECRET//NOFORN');
            expect(port.stored).toHaveLength(1);
            expect(openSurface()).toBeNull();
            expect(document.activeElement).toBe(input);
        },
    );

    it('preserves unread text and keyboard focus when Done cannot commit it', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        mount();
        input.focus();
        await type('SECRET qqq');
        const action = done();
        expect(action?.getAttribute('aria-disabled')).toBe('true');
        action.focus();
        action.click();
        await controller.settle();
        await wait(20);
        expect(port.value.rendered).toBe('SECRET');
        expect(port.stored).toHaveLength(0);
        expect(openSurface()).not.toBeNull();
        expect(input.value).toBe('SECRET qqq');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(action);
        expect(
            openSurface()!
                .querySelector('.ez-composer__result')
                ?.getAttribute('data-refused'),
        ).toBe('true');
    });

    it('commits when keyboard focus leaves Done for a control outside the helper', async () => {
        mount();
        input.focus();
        await type('SECRET noforn');
        done().focus();
        const outside = document.createElement('button');
        root.appendChild(outside);
        outside.focus();
        await controller.settle();
        await wait(20);
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(port.stored).toHaveLength(1);
        expect(openSurface()).toBeNull();
        expect(document.activeElement).toBe(outside);
    });

    it('commits the last keystroke when Done is pressed before its reading returns', async () => {
        mount();
        input.focus();
        await type('SECRET');
        typeText(input, 'secret noforn');
        done().click();
        await controller.settle();
        await wait(20);
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(port.stored).toHaveLength(1);
    });
});

describe('corrections', () => {
    it('offers "did you mean" first and applies it to the draft', async () => {
        mount();
        input.focus();
        await type('secrte noforn ');
        const first = rows()[0];
        expect(first.dataset.kind).toBe('correction');
        expect(first.textContent).toContain('Use SECRET for “secrte”');
        first.click();
        await wait();
        await controller.settle();
        expect(input.value).toBe('SECRET noforn ');
        expect(resultValue()).toBe('SECRET//NOFORN');
    });

    it('offers a proposed rule fix as a row', async () => {
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        mount();
        input.focus();
        await type('SECRET ORCON');
        const fix = rows().find((r) => r.dataset.kind === 'fix');
        expect(fix?.textContent).toContain('Remove ORCON');
    });

    it('says why a draft was not saved, under the field, after blur', async () => {
        mount();
        input.focus();
        await type('SECRET secrte');
        input.blur();
        await wait(200);
        expect(view.note.hidden).toBe(false);
        expect(view.note.textContent).toContain(
            '“secrte” is not recognized. Did you mean SECRET?',
        );
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toContain(view.note.id);
        expect(input.value).toBe('SECRET secrte');
    });
});

describe('leaving right after typing', () => {
    it('commits the last keystroke as soon as focus leaves, not after a grace period', async () => {
        mount();
        input.focus();
        // Keystrokes land and focus leaves before any reading has come back.
        typeText(input, 'noforn');
        typeText(input, 'noforn secret');
        input.blur();
        // Well inside the old 120ms grace period: the commit has to be under
        // way already, so a host reading the value on the same click (a Save
        // button, a route change) gets what was typed.
        await wait(10);
        await controller.settle();
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(openSurface()).toBeNull();
    });

    it('still waits for a press on the list, which blurs the input on some platforms', async () => {
        mount();
        input.focus();
        await type('SECRET');
        const surface = openSurface()!;
        surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        input.blur();
        await wait(20);
        // The press keeps the edit open; the input gets focus back.
        expect(openSurface()).not.toBeNull();
        expect(port.value.rendered).not.toBe('SECRET');
    });

    it('Done right after the last keystroke stores that keystroke', async () => {
        mount();
        input.focus();
        typeText(input, 'noforn');
        typeText(input, 'noforn secret');
        (
            openSurface()!.querySelector('.ez-composer__result') as HTMLElement
        ).click();
        await wait(10);
        await controller.settle();
        expect(port.value.rendered).toBe('SECRET//NOFORN');
    });
});

describe('the needed strip', () => {
    it('names a required category the result lacks and scopes the list to it', async () => {
        mount();
        input.focus();
        await type('NOFORN ');
        const strip = openSurface()!.querySelector('.ez-composer__needs')!;
        expect(strip.hasAttribute('hidden')).toBe(false);
        const chip = strip.querySelector('button')!;
        expect(chip.textContent).toBe('Level');
        chip.click();
        await wait();
        const groups = [
            ...openSurface()!.querySelectorAll('.ez-composer__group-label'),
        ].map((g) => g.querySelector('.ez-composer__group-title')?.textContent);
        expect(groups).toEqual(['Level']);
        expect(
            openSurface()!
                .querySelector('.ez-composer__needs button')!
                .getAttribute('aria-pressed'),
        ).toBe('true');
    });

    it('is hidden once nothing is needed', async () => {
        mount();
        input.focus();
        await type('SECRET ');
        expect(
            openSurface()!
                .querySelector('.ez-composer__needs')!
                .hasAttribute('hidden'),
        ).toBe(true);
    });
});

describe('Escape', () => {
    it('first closes the list and keeps the draft; the second reverts it; the third passes through', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        mount();
        input.focus();
        await type('SECRET NOFORN');
        const first = press(input, 'Escape');
        await wait();
        expect(first.defaultPrevented).toBe(true);
        expect(openSurface()).toBeNull();
        expect(input.value).toBe('SECRET NOFORN');
        const second = press(input, 'Escape');
        await wait();
        expect(second.defaultPrevented).toBe(true);
        expect(input.value).toBe('SECRET');
        const third = press(input, 'Escape');
        expect(third.defaultPrevented).toBe(false);
    });
});

describe('opening', () => {
    it('does not open on focus alone, only on a request', async () => {
        mount();
        input.focus();
        await wait();
        expect(openSurface()).toBeNull();
        press(input, 'ArrowDown');
        await wait();
        expect(openSurface()).not.toBeNull();
    });

    it('opens the list on Ctrl/Cmd+Enter, the shortcut the field hint names', async () => {
        mount();
        input.focus();
        await wait();
        for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
            const e = press(input, 'Enter', init);
            await wait();
            expect(e.defaultPrevented).toBe(true);
            expect(openSurface()).not.toBeNull();
            expect(input.getAttribute('aria-expanded')).toBe('true');
            view.close();
            await wait();
        }
    });

    it('browses by category for an empty query, with labels outside the arrow path', async () => {
        mount();
        input.focus();
        press(input, 'ArrowDown');
        await wait();
        const list = openSurface()!.querySelector('[role="listbox"]')!;
        const groups = [...list.querySelectorAll('[role="group"]')];
        expect(groups.length).toBe(2);
        for (const group of groups) {
            const labelId = group.getAttribute('aria-labelledby')!;
            const label = document.getElementById(labelId)!;
            expect(label.getAttribute('role')).toBe('presentation');
            expect(label.getAttribute('role')).not.toBe('option');
        }
        // Arrowing lands only on options, never on a group label.
        press(input, 'ArrowDown');
        await wait();
        expect(activeRow(input)?.getAttribute('role')).toBe('option');
    });
});

describe('rows the rules gate and queries that match nothing', () => {
    it('shows a gated row with what it needs first, outside the arrow path', async () => {
        port.gatedRows = [
            {
                conceptId: 'OC',
                categoryId: 'caveat',
                label: 'ORCON',
                description: '',
                name: 'ORCON',
                views: { default: 'ORCON' },
                group: 'Caveat',
                selected: false,
                order: 0,
                gated: true,
                requires: ['S'],
                requiresDisplay: ['SECRET'],
            },
        ];
        mount();
        input.focus();
        await type('OR');
        await wait(20);
        const gated = openSurface()!.querySelector('.ez-composer__gated')!;
        expect(gated.hasAttribute('hidden')).toBe(false);
        expect(gated.textContent).toContain('Not yet available');
        expect(gated.textContent).toContain('ORCON');
        expect(gated.textContent).toContain('Add SECRET first');
        // Not an option: arrowing and Enter can never land on it.
        expect(gated.querySelector('[role="option"]')).toBeNull();
        expect(rowLabels()).not.toContain('ORCON');
    });

    it('says a query matched nothing, outside the listbox', async () => {
        mount();
        input.focus();
        await type('SECRET qq');
        const status = openSurface()!.querySelector('.ez-composer__status')!;
        expect(status.hasAttribute('hidden')).toBe(false);
        expect(status.textContent).toBe('No matches for \u201cqq\u201d');
        expect(status.closest('[role="listbox"]')).toBeNull();
    });
});

describe('keys', () => {
    it('ignores keys mid-IME-composition', async () => {
        mount();
        input.focus();
        await type('SECRET nof');
        const before = activeRow(input)?.id;
        const e = press(input, 'Enter', { isComposing: true });
        const legacy = press(input, 'ArrowDown', { keyCode: 229 });
        await wait();
        expect(e.defaultPrevented).toBe(false);
        expect(legacy.defaultPrevented).toBe(false);
        expect(activeRow(input)?.id).toBe(before);
        expect(port.stored).toHaveLength(0);
    });

    it('PageDown and PageUp move the active row by a page', async () => {
        mount();
        input.focus();
        press(input, 'ArrowDown');
        await wait();
        press(input, 'PageDown');
        await wait();
        const ids = rows().map((r) => r.id);
        expect(ids.indexOf(activeRow(input)!.id)).toBe(4);
        press(input, 'PageUp');
        await wait();
        expect(ids.indexOf(activeRow(input)!.id)).toBe(0);
    });
});

describe('accessibility contract', () => {
    it('is an editable combobox that controls a named, multiselectable listbox', async () => {
        mount();
        input.focus();
        await type('se');
        expect(input.getAttribute('role')).toBe('combobox');
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(input.getAttribute('aria-autocomplete')).toBe('list');
        const listId = input.getAttribute('aria-controls')!;
        const list = document.getElementById(listId)!;
        expect(list.getAttribute('role')).toBe('listbox');
        expect(list.getAttribute('aria-multiselectable')).toBe('true');
        const labelledBy = list.getAttribute('aria-labelledby')!;
        expect(document.getElementById(labelledBy)?.textContent).toBe(
            'Document marking',
        );
    });

    it('conveys the active row by aria-activedescendant, and aria-selected only for what is in the marking', async () => {
        mount();
        input.focus();
        await type('SECRET nof');
        const active = activeRow(input)!;
        expect(active.textContent).toContain('NOFORN');
        expect(active.getAttribute('aria-selected')).toBe('false');
        expect(active.classList.contains('ez-composer__row--active')).toBe(
            true,
        );
        await type('SECRET NOFORN s');
        const secret = rowFor('SECRET')!;
        expect(secret.getAttribute('aria-selected')).toBe('true');
    });

    it('keeps key hints and check glyphs out of option names', async () => {
        mount();
        input.focus();
        await type('SECRET NOFORN s');
        for (const row of rows()) {
            for (const glyph of row.querySelectorAll('.ez-composer__check')) {
                expect(glyph.getAttribute('aria-hidden')).toBe('true');
            }
            expect(row.textContent).not.toMatch(/Enter|Tab/);
        }
        expect(
            openSurface()!
                .querySelector('.ez-composer__footer')!
                .getAttribute('aria-hidden'),
        ).toBe('true');
    });

    it('gives a row the same id for the same concept across renders', async () => {
        mount();
        input.focus();
        await type('se');
        const before = rowFor('SECRET')!.id;
        await type('sec');
        expect(rowFor('SECRET')!.id).toBe(before);
        expect(before).toMatch(/-c-level-S$/);
    });

    it('announces through one polite live region per field, including the commit', async () => {
        mount();
        expect(view.announcer.getAttribute('aria-live')).toBe('polite');
        input.focus();
        await type('noforn secret');
        press(input, 'Enter');
        await wait(50);
        expect(view.announcer.textContent).toBe(
            'Marking set to SECRET//NOFORN',
        );
    });

    it('sets enterkeyhint to "enter" while a row is active and "done" otherwise', async () => {
        mount();
        input.focus();
        await type('SECRET nof');
        expect(input.getAttribute('enterkeyhint')).toBe('enter');
        press(input, 'Escape');
        await wait();
        expect(input.getAttribute('enterkeyhint')).toBe('done');
    });

    it.each([
        ['SECRET nof', 'SECRET//NOFORN'],
        ['SECRET NOFORN nof', 'SECRET'],
    ])(
        'names Enter as accept for %s, then save for the resulting draft',
        async (draft, saved) => {
            mount();
            input.focus();
            await type(draft);
            press(input, 'ArrowUp');
            press(input, 'ArrowDown');
            const enterHint = () =>
                [...openSurface()!.querySelectorAll('.ez-composer__hint')].find(
                    (hint) =>
                        hint.querySelector('kbd')?.textContent === 'Enter',
                )?.textContent;
            expect(enterHint()).toBe('Enter accept');
            press(input, 'Enter');
            await controller.settle();
            await wait();
            expect(resultValue()).toBe(saved);
            expect(enterHint()).toBe('Enter save');
            press(input, 'Enter');
            await controller.settle();
            await wait();
            expect(port.value.rendered).toBe(saved);
            expect(openSurface()).toBeNull();
        },
    );

    it('names an input that has no name of its own from the field label', async () => {
        const bare = document.createElement('input');
        root.appendChild(bare);
        const c = new ComposerController({ port, shape: 'whole' });
        const v = new ComposerView({
            controller: c,
            input: bare,
            anchor: root,
            label: () => accessibleLabel(input, 'Marking'),
        });
        expect(bare.getAttribute('aria-labelledby')).toBe(input.labels![0].id);
        v.destroy();
        c.dispose();
    });
});

describe('the sheet bar', () => {
    const originalMatchMedia = window.matchMedia;
    const originalWidth = window.innerWidth;

    /** A phone: coarse pointer, narrower than the sheet breakpoint. */
    function asPhone() {
        window.matchMedia = ((query: string) => ({
            matches: query.includes('coarse'),
            media: query,
            addEventListener() {},
            removeEventListener() {},
        })) as unknown as typeof window.matchMedia;
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 390,
        });
    }

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: originalWidth,
        });
    });

    const bar = () =>
        openSurface()?.querySelector<HTMLElement>('.ez-composer__sheet-bar');
    const button = (name: 'done' | 'cancel') =>
        openSurface()!.querySelector<HTMLButtonElement>(
            `.ez-composer__sheet-${name}`,
        )!;
    const sheetInput = () =>
        openSurface()!.querySelector<HTMLInputElement>(
            '.ez-composer__sheet-input',
        )!;

    async function openSheetAndType(text: string) {
        await view.open('api');
        typeText(sheetInput(), text);
        await wait();
        await controller.settle();
        await wait(10);
    }

    it('is not part of the desktop popover', async () => {
        mount();
        input.focus();
        press(input, 'ArrowDown');
        await wait();
        const surface = openSurface()!;
        expect(surface.dataset.surface).toBe('popover');
        expect(bar()?.closest('[hidden]')).not.toBeNull();
    });

    it('shows Cancel, the field name and Done on the sheet, as named buttons', async () => {
        asPhone();
        mount();
        await view.open('api');
        expect(openSurface()!.dataset.surface).toBe('sheet');
        expect(bar()!.closest('[hidden]')).toBeNull();
        const [cancel, label, done] = [...bar()!.children] as HTMLElement[];
        expect(cancel).toBe(button('cancel'));
        expect(done).toBe(button('done'));
        expect(label.textContent).toBe('Document marking');
        for (const b of [cancel, done] as HTMLButtonElement[]) {
            expect(b.tagName).toBe('BUTTON');
            expect(b.type).toBe('button');
        }
        expect(cancel.textContent).toBe('Cancel');
        expect(done.textContent).toBe('Done');
    });

    it('Done commits the draft, the same as Enter with no active row, and closes', async () => {
        asPhone();
        mount();
        await openSheetAndType('noforn secret');
        button('done').click();
        await wait(20);
        await controller.settle();
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(openSurface()).toBeNull();
    });

    it('Done on a draft that cannot be read keeps the sheet open and stores nothing', async () => {
        asPhone();
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        mount();
        await openSheetAndType('SECRET qqq');
        button('done').click();
        await wait(20);
        await controller.settle();
        expect(port.value.rendered).toBe('SECRET');
        expect(openSurface()).not.toBeNull();
        expect(sheetInput().getAttribute('aria-invalid')).toBe('true');
    });

    it('Done on a draft that cannot be stored answers visibly: Done is marked not ready, shakes, and the reason is marked', async () => {
        asPhone();
        mount();
        await openSheetAndType('SECRET qqq');
        // Not storable yet: Done says so, and stays pressable.
        expect(button('done').getAttribute('aria-disabled')).toBe('true');
        expect(button('done').disabled).toBe(false);
        button('done').click();
        await wait(20);
        await controller.settle();
        expect(openSurface()).not.toBeNull();
        expect(button('done').classList).toContain(
            'ez-composer__sheet-done--refused',
        );
        const result = openSurface()!.querySelector<HTMLElement>(
            '.ez-composer__result',
        )!;
        expect(result.dataset.refused).toBe('true');
        expect(
            result.querySelector('.ez-composer__result-rule')?.textContent,
        ).toContain('qqq');

        // A draft that reads is storable again.
        typeText(sheetInput(), 'SECRET');
        await wait();
        await controller.settle();
        await wait(10);
        expect(button('done').hasAttribute('aria-disabled')).toBe(false);
        expect(result.dataset.refused).toBeUndefined();
    });

    it('says when there is nothing more to add, instead of an empty list', async () => {
        asPhone();
        const all = port.suggestions.bind(port);
        port.suggestions = async () =>
            (await all()).filter((s) => s.categoryId === 'level');
        mount();
        await openSheetAndType('SECRET//');
        const status = openSurface()!.querySelector<HTMLElement>(
            '.ez-composer__status',
        )!;
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('Nothing more to add here');
    });

    it('tells the field a commit closed the sheet, so it can leave focus off its text', async () => {
        asPhone();
        mount();
        view.destroy();
        const onEnterCommit = vi.fn();
        view = new ComposerView({
            controller,
            input,
            anchor: root,
            label: () => accessibleLabel(input, 'Marking'),
            singleLine: true,
            onEnterCommit,
        });
        await openSheetAndType('noforn secret');
        button('done').click();
        await wait(40);
        await controller.settle();
        expect(onEnterCommit).toHaveBeenCalledWith('stored', true);
    });

    it('returns focus to the field box when Done or Cancel closes the sheet, not to its text input', async () => {
        asPhone();
        mount();
        for (const name of ['done', 'cancel'] as const) {
            await openSheetAndType('noforn secret');
            button(name).click();
            await wait(40);
            await controller.settle();
            expect(openSurface()).toBeNull();
            expect(document.activeElement).toBe(root);
            // The box holds focus only until the next move.
            input.focus();
            expect(root.hasAttribute('tabindex')).toBe(false);
        }
    });

    it('leaves focus where the host put it when a canceled sheet ends the edit', async () => {
        asPhone();
        mount();
        view.destroy();
        const elsewhere = document.createElement('button');
        document.body.appendChild(elsewhere);
        view = new ComposerView({
            controller,
            input,
            anchor: root,
            label: () => accessibleLabel(input, 'Marking'),
            singleLine: true,
            onEscapeIdle: () => {
                elsewhere.focus();
                return true;
            },
        });
        await openSheetAndType('noforn secret');
        button('cancel').click();
        await wait(40);
        expect(document.activeElement).toBe(elsewhere);
        expect(root.hasAttribute('tabindex')).toBe(false);
        elsewhere.remove();
    });

    it('browses a category in the phone sheet without changing the marking', async () => {
        asPhone();
        mount();
        await openSheetAndType('SECRET');
        press(sheetInput(), 'ArrowDown', { altKey: true });
        expect(activeRow(sheetInput())?.dataset.categoryId).toBe('level');
        press(sheetInput(), 'ArrowDown', { altKey: true });
        expect(document.activeElement).toBe(sheetInput());
        expect(activeRow(sheetInput())?.dataset.categoryId).toBe('caveat');
        expect(rowLabels()).toContain('SECRET');
        expect(rowLabels()).toContain('NOFORN');
        expect(sheetInput().value).toBe('SECRET');
        expect(port.stored).toHaveLength(0);
    });

    it('scrolls the outer area when jumping categories in a compact phone sheet', async () => {
        asPhone();
        const height = window.innerHeight;
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 330,
        });
        try {
            mount();
            await openSheetAndType('');
            const surface = openSurface()!;
            expect(surface.dataset.compact).toBe('true');
            const scroll = surface.querySelector<HTMLElement>(
                '.ez-composer__scroll',
            )!;
            const nextGroup = surface.querySelector<HTMLElement>(
                '.ez-composer__group-label[data-category-id="caveat"]',
            )!.parentElement!;
            vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
                top: 100,
            } as DOMRect);
            vi.spyOn(nextGroup, 'getBoundingClientRect').mockReturnValue({
                top: 500,
            } as DOMRect);
            surface
                .querySelector<HTMLButtonElement>(
                    '.ez-composer__group-label[data-category-id="level"] button[aria-label="Next category"]',
                )!
                .click();
            expect(scroll.scrollTop).toBe(400);
            expect(view.list.scrollTop).toBe(0);
            expect(activeRow(sheetInput())?.dataset.categoryId).toBe('caveat');
            expect(document.activeElement).toBe(sheetInput());
            expect(rows()).toHaveLength(5);
            expect(port.stored).toHaveLength(0);
        } finally {
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                value: height,
            });
        }
    });

    it('with the keyboard up keeps only the bar and the input fixed; the whole result scrolls first in the list area', async () => {
        asPhone();
        const height = window.innerHeight;
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 330,
        });
        try {
            port.value = {
                assertions: [assertion(CONCEPTS[1])],
                rendered: 'SECRET',
            };
            mount();
            await openSheetAndType('UNCLASSIFIED NOFORN');
            const surface = openSurface()!;
            expect(surface.dataset.compact).toBe('true');
            const pinned = [...surface.children]
                .filter((c) => !(c as HTMLElement).hidden)
                .map((c) => c.className)
                .filter((c) => !c.includes('footer'));
            expect(pinned).toEqual([
                'ez-composer__sheet-field',
                'ez-composer__scroll',
            ]);
            // The sheet is the band, whatever the content.
            expect(surface.style.height).toBe('326px');
            const scroll = surface.querySelector('.ez-composer__scroll')!;
            const order = [...scroll.children]
                .filter((c) => !(c as HTMLElement).hidden)
                .map((c) => c.className);
            expect(order[0]).toBe('ez-composer__result');
            expect(order.indexOf('ez-composer__list')).toBeGreaterThan(0);
            // The result block is whole: the full marking and its changes.
            const result = scroll.querySelector('.ez-composer__result')!;
            expect(
                result.querySelector('.ez-composer__result-value')!.textContent,
            ).toBe('UNCLASSIFIED//NOFORN');
            expect(
                result.querySelector('.ez-composer__changes'),
            ).not.toBeNull();
        } finally {
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                value: height,
            });
        }
    });

    it('keeps the result in the scrolling body when the keyboard goes down', async () => {
        asPhone();
        const height = window.innerHeight;
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 330,
        });
        try {
            mount();
            await openSheetAndType('SECRET');
            expect(
                openSurface()!.querySelector(
                    '.ez-composer__scroll > .ez-composer__result',
                ),
            ).not.toBeNull();
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                value: 800,
            });
            typeText(sheetInput(), 'SECRET NOFORN');
            await wait();
            await controller.settle();
            await wait(10);
            const surface = openSurface()!;
            expect(surface.dataset.compact).toBeUndefined();
            expect(
                surface.querySelector(
                    '.ez-composer__scroll > .ez-composer__result',
                ),
            ).not.toBeNull();
        } finally {
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                value: height,
            });
        }
    });

    it('Cancel reverts the draft to the stored value and closes', async () => {
        asPhone();
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        mount();
        await openSheetAndType('SECRET NOFORN');
        button('cancel').click();
        // Past the blur commit delay: the blur that follows the close must
        // find nothing left to store.
        await wait(250);
        await controller.settle();
        expect(openSurface()).toBeNull();
        expect(port.value.rendered).toBe('SECRET');
        expect(input.value).toBe('SECRET');
        expect(controller.isDirty()).toBe(false);
    });

    it('Cancel hands off to the field once the draft is reverted, as an idle Escape does', async () => {
        asPhone();
        mount();
        view.destroy();
        const onEscapeIdle = vi.fn(() => {
            // A field that took an editor down refocuses its own input.
            input.focus();
            return true;
        });
        view = new ComposerView({
            controller,
            input,
            anchor: root,
            label: () => accessibleLabel(input, 'Marking'),
            singleLine: true,
            onEscapeIdle,
        });
        await openSheetAndType('SECRET NOFORN');
        button('cancel').click();
        expect(onEscapeIdle).toHaveBeenCalledTimes(1);
        expect(controller.isDirty()).toBe(false);
        // The edit was canceled: nothing keeps the keyboard up.
        expect(document.activeElement).not.toBe(input);
    });

    it('does not pull focus back to the field after a tap closes the sheet', async () => {
        asPhone();
        mount();
        await openSheetAndType('noforn secret');
        const done = button('done');
        done.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        done.click();
        await wait(250);
        await controller.settle();
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(document.activeElement).not.toBe(input);
    });
});

describe('middleEllipsis', () => {
    const within = (n: number) => (text: string) => text.length <= n;
    const title = 'Paragraph 2: Document body with inline portion markings';

    it('leaves a title that fits alone', () => {
        expect(middleEllipsis(title, within(100))).toBe(title);
    });

    it('keeps the start through its colon and the last words', () => {
        expect(middleEllipsis(title, within(34))).toBe(
            'Paragraph 2: \u2026 portion markings',
        );
        expect(middleEllipsis(title, within(25))).toBe(
            'Paragraph 2: \u2026 markings',
        );
    });

    it('keeps at least the start', () => {
        expect(middleEllipsis(title, within(5))).toBe('Paragraph 2: \u2026');
    });
});

describe('category navigation', () => {
    const headings = () => [
        ...view.list.querySelectorAll<HTMLElement>(
            '.ez-composer__group-label[data-category-id]',
        ),
    ];
    const arrow = (index: number, direction: 'Previous' | 'Next') =>
        headings()[index].querySelector<HTMLButtonElement>(
            `button[aria-label="${direction} category"]`,
        )!;

    it('jumps past a long category in both directions without filtering or writing', async () => {
        const suggestions = await port.suggestions();
        const categories = port.categories();
        port.categories = () => [
            ...categories,
            {
                id: 'last',
                label: 'Last',
                single: false,
                required: false,
            },
        ];
        port.suggestions = async () => [
            ...suggestions.filter((s) => s.categoryId === 'level'),
            ...Array.from({ length: 280 }, (_, index) => ({
                ...suggestions[2],
                conceptId: `item-${index}`,
            })),
            { ...suggestions[3], categoryId: 'last' },
        ];
        mount();
        input.focus();
        await view.open('keyboard');
        expect(headings().map((h) => h.dataset.categoryId)).toEqual([
            'level',
            'caveat',
            'last',
        ]);
        expect(openSurface()!.querySelector('select')).toBeNull();
        press(input, 'ArrowDown', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        press(input, 'ArrowDown', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('last');
        press(input, 'ArrowDown', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('last');
        press(input, 'ArrowUp', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        press(input, 'ArrowUp', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('level');
        expect(rows()).toHaveLength(283);
        expect(controller.snapshot().scope).toBeNull();
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('');
        expect(port.stored).toHaveLength(0);
    });

    it('puts previous/next buttons on each heading and scrolls to the natural group start', async () => {
        mount();
        input.focus();
        await view.open('keyboard');
        expect(arrow(0, 'Previous').disabled).toBe(true);
        expect(arrow(1, 'Next').disabled).toBe(true);
        const scroll = openSurface()!.querySelector<HTMLElement>(
            '.ez-composer__scroll',
        )!;
        vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
            top: 100,
        } as DOMRect);
        vi.spyOn(
            headings()[1].parentElement!,
            'getBoundingClientRect',
        ).mockReturnValue({ top: 400 } as DOMRect);
        arrow(0, 'Next').dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        arrow(0, 'Next').click();
        expect(scroll.scrollTop).toBe(300);
        expect(view.list.scrollTop).toBe(0);
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        arrow(1, 'Previous').click();
        expect(activeRow(input)?.dataset.categoryId).toBe('level');
        expect(rows()).toHaveLength(5);
        expect(document.activeElement).toBe(input);
        expect(port.stored).toHaveLength(0);
    });

    it('leaves a scoped Needs choice for the full browse list without changing the draft', async () => {
        mount();
        input.focus();
        await type('SEC');
        controller.scopeTo('level');
        press(input, 'ArrowDown', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        expect(controller.snapshot().scope).toBeNull();
        expect(input.value).toBe('SEC');
        expect(port.stored).toHaveLength(0);
        press(input, 'ArrowUp', { altKey: true });
        rowFor('SECRET')!.click();
        await controller.settle();
        expect(controller.draftText).toBe('SECRET');
    });

    it('jumps with a scoped Needs heading arrow and restores the full list', async () => {
        mount();
        input.focus();
        await type('SEC');
        controller.scopeTo('level');
        expect(arrow(0, 'Next').disabled).toBe(false);
        arrow(0, 'Next').click();
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        expect(controller.snapshot().scope).toBeNull();
        expect(rows()).toHaveLength(5);
        expect(input.value).toBe('SEC');
        expect(document.activeElement).toBe(input);
        expect(port.stored).toHaveLength(0);
    });

    it('disables both arrows when only one category is available', async () => {
        const suggestions = await port.suggestions();
        port.suggestions = async () =>
            suggestions.filter((s) => s.categoryId === 'level');
        mount();
        input.focus();
        await view.open('keyboard');
        expect(headings()).toHaveLength(1);
        expect(arrow(0, 'Previous').disabled).toBe(true);
        expect(arrow(0, 'Next').disabled).toBe(true);
        press(input, 'ArrowDown', { altKey: true });
        press(input, 'ArrowUp', { altKey: true });
        expect(activeRow(input)?.dataset.categoryId).toBe('level');
        expect(port.stored).toHaveLength(0);
    });

    it('updates scoped heading arrows when a live reading offers another category', async () => {
        const suggestions = await port.suggestions();
        port.suggestions = async (live) =>
            live?.length
                ? suggestions
                : suggestions.filter((row) => row.categoryId === 'level');
        mount();
        input.focus();
        await view.open('keyboard');
        controller.scopeTo('level');
        expect(arrow(0, 'Next').disabled).toBe(true);
        const reading = controller.input('SECRET', 6);
        controller.scopeTo('level');
        await reading;
        await controller.settle();
        expect(arrow(0, 'Next').disabled).toBe(false);
        arrow(0, 'Next').click();
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        expect(input.value).toBe('SECRET');
        expect(port.stored).toHaveLength(0);
    });

    it('does not add an empty Needs strip when browsing a complete marking', async () => {
        mount();
        await type('SECRET ');
        controller.scopeTo('caveat');
        expect(
            openSurface()!
                .querySelector('.ez-composer__needs')
                ?.hasAttribute('hidden'),
        ).toBe(true);
        expect(port.stored).toHaveLength(0);
    });

    it.each([
        ['MacIntel', '⌥↑↓', 'Option'],
        ['Win32', 'Alt+↑↓', 'Alt'],
        ['Linux x86_64', 'Alt+↑↓', 'Alt'],
    ])(
        'labels category shortcuts for %s',
        async (platform, visible, modifier) => {
            const platformGetter = vi
                .spyOn(navigator, 'platform', 'get')
                .mockReturnValue(platform);
            try {
                mount();
                input.focus();
                await view.open('keyboard');
                expect(
                    openSurface()!.querySelector(
                        '.ez-composer__hint--categories kbd',
                    )?.textContent,
                ).toBe(visible);
                expect(arrow(0, 'Next').title).toBe(
                    `Next category (${modifier}+↓)`,
                );
                expect(arrow(1, 'Previous').title).toBe(
                    `Previous category (${modifier}+↑)`,
                );
                // The field announces the shortcuts; the listbox keeps only
                // groups and options in the accessibility tree.
                expect(input.getAttribute('aria-keyshortcuts')).toBe(
                    'Alt+ArrowUp Alt+ArrowDown',
                );
                const list = openSurface()!.querySelector('[role="listbox"]')!;
                for (const button of list.querySelectorAll('button')) {
                    expect(
                        button.closest('[aria-hidden="true"]'),
                    ).not.toBeNull();
                }
                press(input, 'ArrowDown', { altKey: true });
                expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
                expect(document.activeElement).toBe(input);
                expect(port.stored).toHaveLength(0);
            } finally {
                platformGetter.mockRestore();
            }
        },
    );

    it('navigates categories with identical labels by their IDs', async () => {
        const original = port.categories.bind(port);
        port.categories = () =>
            original().map((c) => ({ ...c, label: 'Shared label' }));
        mount();
        input.focus();
        await view.open('keyboard');
        arrow(0, 'Next').click();
        expect(activeRow(input)?.dataset.categoryId).toBe('caveat');
        arrow(1, 'Previous').click();
        expect(activeRow(input)?.dataset.categoryId).toBe('level');
    });
});

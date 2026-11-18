/**
 * Every control bound to a shared marking agrees on what the marking writes,
 * whichever control made the change: a DecisionFlow option, a TagInput entry, a
 * picker's button, or text typed into a MarkingField.
 *
 * The status mark of each control lists only changes to what the marking
 * writes. A fact a rule derived that the marking does not write (a member
 * collapsed into its group's written name, a default no output prints, a fact a
 * rule adds that the line leaves out) is no change on any of them. TagInput
 * still draws such a fact, faded and dashed with no remove button, and says why
 * the marking holds it in its native hint and accessible name.
 *
 * The engine is a stand-in (see `label-record-stand-in.ts`). The marking starts
 * as HIGH, which shares with DISTRICT: a fact the line leaves out. Adding GROUP
 * takes in MEMBER, collapsed into GROUP's written name, and adds ANCHOR, which
 * the line writes. HOME is the owner's default, which the line leaves out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { labelRecordStandIn } from '../../test-fixtures/label-record-stand-in';
import { EzClassifyUI } from '../ezclassify-ui';
import { press, rowFor, typeText, wait } from './composer/composer-harness';
import { cleanupTooltipForRoot } from './tooltip-manager';

/** Let the engine's answers, the store's commits and their echoes land. */
async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) await wait(20);
}

let root: HTMLElement;
let forms: EzClassifyUI | null = null;

beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = `
      <div id="root">
        <input type="hidden" id="m" data-ezclassify-marking value="HIGH">
        <input id="mf" type="text" data-ezclassify-controller="marking" data-ezclassify-bound-to="m">
        <div id="df" data-ezclassify-controller="decisionflow" data-ezclassify-bound-to="m"></div>
        <input id="ti" type="text" data-ezclassify-controller="tags" data-ezclassify-bound-to="m">
        <fieldset id="gs" data-ezclassify-controller="selector" data-ezclassify-facet-of="m" data-ezclassify-category="group"></fieldset>
      </div>`;
    root = document.getElementById('root')!;
    forms = new EzClassifyUI(schemeOnlyContext(labelRecordStandIn() as never), {
        root,
    });
    await settle();
});

afterEach(() => {
    forms?.destroy();
    forms = null;
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

/** The box a control draws: its mount beside the host, or the host's wrap. */
function controlOf(id: string): HTMLElement {
    const host = document.getElementById(id)!;
    const mount = host.nextElementSibling as HTMLElement | null;
    if (mount?.hasAttribute('data-ezclassify-mount')) return mount;
    return host.closest<HTMLElement>('.marking-field-wrap')!;
}

/** Press a control's status mark open and read its list, then close it. */
function listOf(id: string): string[] {
    const mark = controlOf(id).querySelector<HTMLElement>('.ez-status-mark')!;
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const tipId = mark.getAttribute('aria-describedby');
    const tip = tipId ? document.getElementById(tipId) : null;
    const open = !!tip && !tip.hidden;
    const lines = open
        ? [
              ...tip.querySelectorAll(
                  '.ez-tooltip__header, .ez-status-list__text',
              ),
          ].map((row) => row.textContent ?? '')
        : [];
    if (open)
        tip.querySelector<HTMLButtonElement>(
            '.ez-marking-tools__close',
        )!.click();
    return lines;
}

/** The TagInput's chips, in order, each with how it is drawn. */
function chips() {
    return [
        ...controlOf('ti').querySelectorAll<HTMLElement>(
            '.proto-tag:not(.proto-tag--unread)',
        ),
    ].map((chip) => ({
        id: chip.dataset.conceptId,
        derived: chip.classList.contains('proto-tag--inferred'),
        faded: chip.classList.contains('proto-tag--unprinted'),
        removable: !!chip.querySelector('.proto-tag-remove'),
        name: chip.getAttribute('aria-label'),
    }));
}

/** The native hint a TagInput chip exposes, line by line. */
async function chipHint(conceptId: string): Promise<string[]> {
    const chip = controlOf('ti').querySelector<HTMLElement>(
        `.proto-tag[data-concept-id="${conceptId}"]`,
    )!;
    chip.dispatchEvent(new Event('mouseenter'));
    await wait(20);
    expect(document.querySelector('.ez-tooltip:not([hidden])')).toBeNull();
    const lines = chip.title.split('\n');
    chip.dispatchEvent(new Event('mouseleave'));
    return lines;
}

const ONE_CHANGE = [
    '1 change made by a marking rule',
    'Added ANCHOR to Groups.',
];

/**
 * What every entry path must end with: one change, the rule-written ANCHOR, on
 * every control bound to the whole marking; chips for every fact the marking
 * holds, the unwritten derived ones faded, unremovable and explained.
 */
async function expectWrittenAgreement(): Promise<void> {
    expect(forms!.store.get('m').rendered).toBe('HIGH//GROUP/ANCHOR');
    for (const id of ['mf', 'df', 'ti'])
        expect(listOf(id), id).toEqual(ONE_CHANGE);

    const drawn = chips();
    const chip = (id: string) => drawn.find((c) => c.id === id);
    expect(drawn.map((c) => c.id).sort()).toEqual(
        ['ANCHOR', 'DISTRICT', 'GROUP', 'HIGH', 'HOME', 'MEMBER'].sort(),
    );
    // The author's values: solid and removable.
    for (const id of ['HIGH', 'GROUP'])
        expect(chip(id), id).toMatchObject({
            derived: false,
            faded: false,
            removable: true,
        });
    // A value a rule wrote into the marking: derived, not faded.
    expect(chip('ANCHOR')).toMatchObject({
        derived: true,
        faded: false,
        removable: false,
        name: 'Anchor (inferred)',
    });
    // Facts the marking holds and does not write: faded, never removable,
    // each with the reason.
    expect(chip('MEMBER')).toEqual({
        id: 'MEMBER',
        derived: true,
        faded: true,
        removable: false,
        name: 'Member (inferred), Included by GROUP',
    });
    expect(chip('HOME')).toEqual({
        id: 'HOME',
        derived: true,
        faded: true,
        removable: false,
        name: 'Home (inferred), Default Owner, not written in the marking',
    });
    expect(chip('DISTRICT')).toEqual({
        id: 'DISTRICT',
        derived: true,
        faded: true,
        removable: false,
        name: 'District (inferred), Not written in the marking',
    });
    // The chips go in the order the line writes their categories (level,
    // then groups), the categories it does not write after them in the
    // scheme's order (owner, then shared with). Within a category the
    // engine's order stands, so the member follows the group it is written
    // under, and the faded owner comes after the level, not first.
    expect(drawn.map((c) => c.id)).toEqual([
        'HIGH',
        'GROUP',
        'MEMBER',
        'ANCHOR',
        'HOME',
        'DISTRICT',
    ]);
    expect((await chipHint('MEMBER'))[0]).toBe('Included by GROUP');
    expect((await chipHint('HOME'))[0]).toBe(
        'Default Owner, not written in the marking',
    );
}

describe('a change to the shared marking', () => {
    it('made through a DecisionFlow option is judged by what the marking writes', async () => {
        const flow = controlOf('df');
        flow.querySelector<HTMLElement>(
            '.ez-decision-flow__step-dot[data-category-id="group"]',
        )!.click();
        await settle();
        [...flow.querySelectorAll<HTMLElement>('.ez-decision-flow__option')]
            .find((option) => option.textContent?.trim() === 'GROUP')!
            .click();
        await settle();

        await expectWrittenAgreement();
    });

    it('made through a TagInput entry is judged by what the marking writes', async () => {
        const filter =
            controlOf('ti').querySelector<HTMLInputElement>(
                '.tag-input-filter',
            )!;
        filter.focus();
        typeText(filter, 'GROUP');
        await wait(100);
        // The press fills the draft; Enter stores it.
        rowFor('GROUP')!.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
        );
        await settle();
        press(filter, 'Enter');
        await settle();

        await expectWrittenAgreement();
    });

    it("made through a picker's button is judged by what the marking writes", async () => {
        controlOf('gs')
            .querySelector<HTMLElement>(
                '.category-selector-btn[data-concept-id="GROUP"]',
            )!
            .click();
        await settle();

        expect(listOf('gs')).toEqual(ONE_CHANGE);
        await expectWrittenAgreement();
    });

    it('typed into a MarkingField is judged by what the marking writes', async () => {
        const field = controlOf('mf').querySelector<HTMLTextAreaElement>(
            '.marking-field-host',
        )!;
        field.focus();
        typeText(field, 'HIGH//GROUP');
        await settle();
        press(field, 'Enter');
        await settle();

        await expectWrittenAgreement();
    });

    it('leaves the derived chips to Backspace: it reaches the last value the author stated', async () => {
        controlOf('gs')
            .querySelector<HTMLElement>(
                '.category-selector-btn[data-concept-id="GROUP"]',
            )!
            .click();
        await settle();
        const filter =
            controlOf('ti').querySelector<HTMLInputElement>(
                '.tag-input-filter',
            )!;
        filter.focus();
        press(filter, 'Backspace');

        const focused = document.activeElement as HTMLElement;
        const stated = chips()
            .filter((c) => !c.derived)
            .map((c) => c.id);
        expect(focused.dataset.conceptId).toBe(stated[stated.length - 1]);
        expect(focused.classList.contains('proto-tag--inferred')).toBe(false);
    });
});

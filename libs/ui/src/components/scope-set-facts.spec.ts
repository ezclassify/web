/**
 * An editable control writes and shows the facts of its scope set: the scheme's
 * default scope when its host lists none, the scopes it lists otherwise. A fact
 * of another scope belongs to the controls that write that scope, so a TagInput
 * neither draws it as a chip nor states it back, a chip removed or a value
 * cleared leaves it in the shared marking, and no control holds it to publish
 * again.
 *
 * The engine is a stand-in (see `label-record-stand-in.ts`): the cases are
 * about what the field does with each answer, so each answer is written out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assertion } from '@ezclassify/types';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import {
    labelRecordStandIn,
    statedFact,
} from '../../test-fixtures/label-record-stand-in';
import { EzClassifyUI } from '../ezclassify-ui';
import { TagInput } from './tag-input';
import { cleanupTooltipForRoot } from './tooltip-manager';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Let the engine's answers and what they trigger land. */
async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await wait();
}

const context = () => schemeOnlyContext(labelRecordStandIn() as never);
const facts = (...ids: string[]): Assertion[] => ids.map(statedFact);
const ids = (assertions: readonly Assertion[]) =>
    assertions.map((a) => a.conceptId).sort();
const chips = (root: Element) =>
    [...root.querySelectorAll<HTMLElement>('.proto-tag')]
        .map((chip) => chip.dataset.conceptId)
        .sort();

let forms: EzClassifyUI | null = null;
let tags: TagInput | null = null;

afterEach(() => {
    forms?.destroy();
    forms = null;
    tags?.destroy();
    tags = null;
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

/** A TagInput mounted directly, the way a host mounts a component. */
async function mountTags(scopes?: string[]): Promise<HTMLDivElement> {
    const root = document.createElement('div');
    root.innerHTML = '<input>';
    document.body.appendChild(root);
    tags = new TagInput();
    await tags.init(
        root,
        context(),
        scopes
            ? {
                  scopes,
                  scope: scopes.length === 1 ? scopes[0] : undefined,
              }
            : {},
    );
    return root;
}

/**
 * A TagInput bound to the marking `m` on a page, beside nothing else, and the
 * runtime that holds the marking.
 */
async function boundTags(scope?: string) {
    Element.prototype.scrollIntoView = vi.fn();
    const root = document.createElement('div');
    root.innerHTML = `
        <input type="hidden" id="m" data-ezclassify-marking>
        <input id="tags" data-ezclassify-controller="tags"
               data-ezclassify-bound-to="m"
               ${scope ? `data-ezclassify-scope="${scope}"` : ''}>`;
    document.body.appendChild(root);
    forms = new EzClassifyUI(context(), { root });
    await settle();
    const el = root.querySelector<HTMLElement>('#tags')!;
    const field = (forms.components.get(el) ??
        (
            forms as unknown as {
                autocompleters: Map<Element, TagInput>;
            }
        ).autocompleters.get(el)) as TagInput;
    return { root, field, store: forms.store };
}

describe('a TagInput that lists no scope', () => {
    it("shows and holds the default scope's facts only", async () => {
        const root = await mountTags();
        tags!.setAssertions(facts('LOW', 'ALICE'));
        await settle();

        // HOME, the owner's default, is drawn too, faded: the line holds it
        // and does not write it.
        expect(chips(root)).toEqual(['HOME', 'LOW', 'STD']);
        expect(ids(tags!.getAssertions())).toEqual(['HOME', 'LOW', 'STD']);
    });

    it("shows no other scope's facts from an invalid shared marking", async () => {
        // An invalid marking reaches a bound field whole, with its errors, so
        // every field says what is wrong with it. That is no reason to draw
        // the record's facts as this field's chips.
        const { root, store } = await boundTags();
        await store.publishAssertions('m', facts('HIGH', 'STD', 'BOB'));
        await settle();

        expect(store.get('m').valid).toBe(false);
        expect(chips(root)).toEqual(['DISTRICT', 'HIGH', 'HOME', 'STD']);
    });
});

describe('a TagInput that lists both scopes', () => {
    it('shows the facts of each', async () => {
        const root = await mountTags(['label', 'record']);
        tags!.setAssertions(facts('LOW', 'ALICE'));
        await settle();

        expect(chips(root)).toEqual(
            expect.arrayContaining(['ALICE', 'LOW', 'POLICY', 'STD']),
        );
    });
});

describe("a bound TagInput leaves the other scopes' facts in the shared marking", () => {
    it('when a chip is removed', async () => {
        const { root, store } = await boundTags();
        await store.publishAssertions(
            'm',
            facts('HIGH', 'STD', 'GROUP', 'BOB'),
        );
        await settle();

        root.querySelector<HTMLElement>(
            '.proto-tag[data-concept-id="GROUP"] .proto-tag-remove',
        )!.click();
        await settle();

        expect(chips(root)).toEqual(['DISTRICT', 'HIGH', 'HOME', 'STD']);
        const held = ids(store.get('m').assertions);
        expect(held).not.toContain('GROUP');
        expect(held).toEqual(expect.arrayContaining(['BOB', 'HIGH']));
    });

    it('when the field is cleared', async () => {
        const { root, store } = await boundTags();
        await store.publishAssertions('m', facts('HIGH', 'STD', 'BOB'));
        await settle();

        root.querySelector<HTMLButtonElement>('.ez-clear-button')!.click();
        await settle();

        // What the field stated is gone; the owner's default the marking
        // still holds stays drawn, faded.
        expect(chips(root)).toEqual(['HOME']);
        const held = ids(store.get('m').assertions);
        expect(held).not.toContain('HIGH');
        expect(held).toContain('BOB');
    });

    it("when it publishes, so it never writes the other scopes' facts", async () => {
        const { field, store } = await boundTags();
        await store.publishAssertions('m', facts('HIGH', 'ALICE'));
        await settle();

        // The host hands the field a marking that names another signer. The
        // signer is the record block's to write, not this field's.
        field.setAssertions(facts('LOW', 'BOB'));
        await settle();

        const held = ids(store.get('m').assertions);
        expect(held).toContain('LOW');
        expect(held).toContain('ALICE');
        expect(held).not.toContain('BOB');
    });
});

describe('every picker bound to an invalid shared marking', () => {
    it.each([
        ['selector', 'div'],
        ['select', 'div'],
        ['checklist', 'div'],
    ])("a %s holds the default scope's facts only", async (controller, tag) => {
        Element.prototype.scrollIntoView = vi.fn();
        const root = document.createElement('div');
        root.innerHTML = `
                <input type="hidden" id="m" data-ezclassify-marking>
                <${tag} id="field" data-ezclassify-controller="${controller}"
                        data-ezclassify-bound-to="m"
                        data-ezclassify-category="group"></${tag}>`;
        document.body.appendChild(root);
        forms = new EzClassifyUI(context(), { root });
        await settle();
        await forms.store.publishAssertions(
            'm',
            facts('HIGH', 'STD', 'GROUP', 'BOB'),
        );
        await settle();

        const field = forms.components.get(root.querySelector('#field')!)!;
        expect(forms.store.get('m').valid).toBe(false);
        const held = ids(field.getAssertions());
        expect(held).toEqual(expect.arrayContaining(['GROUP', 'HIGH']));
        expect(held).not.toContain('BOB');
    });
});

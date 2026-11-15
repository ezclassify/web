/**
 * The author signs what the marking writes, so a field draws as values of the
 * marking, and lists as changes, only facts the marking writes. A member
 * collapsed into its group's written name and a default no output prints are
 * facts the marking holds, not values the author sees: no chip, no change, and
 * no undo for a result whose only changes were those. A value a rule added that
 * the marking does write is listed and counted, though the author did not write
 * it. A field that shows its marking in several forms counts a change that
 * alters any of them.
 *
 * The engine is a stand-in (see `label-record-stand-in.ts`): each answer, with
 * the assessment of what each render wrote, is written out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { schemeOnlyContext } from '../../test-fixtures/context-doubles';
import { labelRecordStandIn } from '../../test-fixtures/label-record-stand-in';
import { DecisionFlow } from './decision-flow';
import { TagInput } from './tag-input';
import type { ComponentInstance } from './component-base';
import { cleanupTooltipForRoot } from './tooltip-manager';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Let the engine's answers and what they trigger land. */
async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await wait();
}

const context = () => schemeOnlyContext(labelRecordStandIn() as never);

let container: HTMLDivElement;
let mounted: ComponentInstance | undefined;

afterEach(() => {
    mounted?.destroy();
    mounted = undefined;
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
});

/** Press the field's status mark open and read its list. */
function openList(): string[] {
    const mark = container.querySelector<HTMLElement>('.ez-status-mark')!;
    mark.click();
    const tip = document.querySelector<HTMLElement>('.ez-tooltip');
    const lines =
        tip && !tip.hidden
            ? [
                  ...tip.querySelectorAll(
                      '.ez-tooltip__header, .ez-status-list__text, .ez-status-list__undo',
                  ),
              ].map((row) => row.textContent ?? '')
            : [];
    if (tip && !tip.hidden) mark.click();
    return lines;
}

/** The chips a TagInput draws: each concept, and whether it is drawn inferred. */
const chips = () =>
    [...container.querySelectorAll<HTMLElement>('.proto-tag')].map(
        (chip) =>
            chip.dataset.conceptId +
            (chip.classList.contains('proto-tag--inferred')
                ? ' (inferred)'
                : ''),
    );

async function mountTags(value: string): Promise<TagInput> {
    container = document.createElement('div');
    container.innerHTML = `<input value="${value}">`;
    document.body.appendChild(container);
    const tags = new TagInput();
    mounted = tags;
    await tags.init(container, context());
    await settle();
    return tags;
}

describe('a TagInput', () => {
    it("draws no chip for a group's collapsed member or an unprinted default, and lists no change for them", async () => {
        await mountTags('GROUP');

        // GROUP takes in MEMBER, written as GROUP, and the owner HOME is a
        // default the line leaves out: the marking holds both.
        const held = mounted!.getAssertions().map((a) => a.conceptId);
        expect(held).toEqual(expect.arrayContaining(['MEMBER', 'HOME']));
        expect(chips()).toEqual(['GROUP', 'ANCHOR (inferred)']);
        // ANCHOR is a value a rule added that the line writes, beside GROUP:
        // listed and counted though the author did not write it.
        expect(openList()).toEqual([
            '1 change made by a marking rule',
            'Added ANCHOR to Groups.',
        ]);
    });

    it('fades a value the author stated that the marking leaves out of print', async () => {
        await mountTags('LOW HOME');

        const home = container.querySelector<HTMLElement>(
            '.proto-tag[data-concept-id="HOME"]',
        )!;
        expect(home.classList.contains('proto-tag--unprinted')).toBe(true);
        expect(home.classList.contains('proto-tag--inferred')).toBe(false);
    });

    it('lists a rule change the marking writes, and none it does not', async () => {
        await mountTags('LOW');

        expect(openList()).toEqual([
            '1 change made by a marking rule',
            'Added STD to Handling.',
        ]);
        expect(chips()).toEqual(['LOW', 'STD (inferred)']);
    });

    it('offers no change and no undo for an edit whose only rule change the marking does not write', async () => {
        await mountTags('HIGH//GROUP');
        container
            .querySelector<HTMLElement>(
                '.proto-tag[data-concept-id="GROUP"] .proto-tag-remove',
            )!
            .click();
        await settle();

        // Removing GROUP is the author's edit; what the rules make of HIGH is
        // that it is shared with DISTRICT, which the line does not write.
        expect(mounted!.getAssertions().map((a) => a.conceptId)).toContain(
            'DISTRICT',
        );
        expect(chips()).toEqual(['HIGH']);
        expect(openList()).toEqual([]);
        expect(
            container
                .querySelector('.ez-status-mark')!
                .classList.contains('ez-status-mark--quiet'),
        ).toBe(true);
    });
});

describe('a DecisionFlow over both scopes', () => {
    it('counts a change that alters either scope line, and none that alters neither', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        const flow = new DecisionFlow();
        mounted = flow;
        await flow.init(container, context(), {
            scopes: ['label', 'record'],
            initialValue: 'LOW',
        });
        flow.setAssertions(
            ['LOW', 'ALICE'].map((conceptId) => ({
                conceptId,
                categoryId: conceptId === 'LOW' ? 'level' : 'signer',
                confidence: 'certain' as const,
                source: 'user',
            })),
        );
        await settle();

        // ALICE's signature cites POLICY, which the record block writes and
        // the label line leaves out, and leaves TRACE, which neither writes.
        expect(
            container.querySelector('.ez-decision-flow__values')?.textContent,
        ).toContain('Basis: POLICY');
        expect(openList()).toEqual([
            '2 changes made by marking rules',
            'Added STD to Handling.',
            'Added POLICY to Basis.',
        ]);
    });
});

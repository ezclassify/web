/**
 * Unit tests for the Enhancement Status Indicator module: the single-mark
 * invariant, the brand glyph, the quiet/unseen/seen state machine and its
 * transitions, the error state, the corner dot, reduced-motion handling, and
 * the tooltip guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Assertion, Change } from '@ezclassify/types';
import { hasAdoptedStyles } from '../styles/adopt';
import statusMarkCss from './status-mark.css?inline';
import {
    ensureStatusMark,
    explainedChanges,
    setStatusMarkError,
    setStatusMarkFixes,
} from './status-mark';
import { cleanupTooltipForRoot, showTooltip } from './tooltip-manager';
import { markTone } from '../../test-fixtures/field-chrome';

/**
 * The tooltip's lines, one per row it draws: for the mark's list, what is
 * wrong, its heading and each change.
 */
function lineTexts(tip: HTMLElement): string[] {
    const list = tip.querySelector('.ez-status-list');
    if (list)
        return [
            ...list.querySelectorAll(
                '.ez-status-list__error, .ez-tooltip__header, .ez-status-list__text',
            ),
        ].map((row) => row.textContent ?? '');
    const rows = [...tip.querySelectorAll(':scope > div')];
    return (
        rows.length > 0
            ? rows.map((row) => row.textContent ?? '')
            : tip.textContent!.split('\n')
    ).filter((line) => line.trim());
}

/** A change rule `ruleId` made, adding `conceptId` (its own, by default). */
function makeFix(
    ruleId: string,
    message = `fix by ${ruleId}`,
    conceptId = `X-${ruleId}`,
): Change {
    return {
        ruleId,
        action: 'add',
        add: [{ conceptId, categoryId: 'cat' }],
        message,
    };
}

/** A fact the marking holds, stated unless a rule is named for it. */
function held(conceptId: string, sourceRule?: string): Assertion {
    return sourceRule
        ? {
              conceptId,
              categoryId: 'cat',
              confidence: 'inferred',
              source: 'infer',
              sourceRule,
          }
        : {
              conceptId,
              categoryId: 'cat',
              confidence: 'certain',
              source: 'user',
          };
}

/** A field that shows each fact it holds and writes every category. */
const SHOWS_FACTS = { showsUnwritten: true } as const;

/** Stub matchMedia with a controllable `matches` value for a single query. */
function stubMatchMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
            matches,
            media: query,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    });
}

let wrap: HTMLDivElement;
let originalMatchMedia: typeof window.matchMedia | undefined;

beforeEach(() => {
    document.body.innerHTML = '';
    wrap = document.createElement('div');
    document.body.appendChild(wrap);
    originalMatchMedia = window.matchMedia;
    stubMatchMedia(false);
});

afterEach(() => {
    // These tests mount marks without an explicit tooltip root, so the
    // tooltip manager keys its per-root cache to document.body. Clean it up
    // before wiping the DOM, or the next test reuses a tooltip element that
    // innerHTML just detached, and it never gets re-appended.
    cleanupTooltipForRoot(document.body);
    document.body.innerHTML = '';
    if (originalMatchMedia) {
        window.matchMedia = originalMatchMedia;
    }
});

/** Hover a mark long enough for the tooltip's hover-intent delay to fire. */
async function hoverPastIntent(mark: HTMLElement): Promise<void> {
    mark.dispatchEvent(new Event('mouseenter'));
    await new Promise((r) => setTimeout(r, 400));
}

describe('ensureStatusMark', () => {
    it('mounts exactly one mark and is idempotent', () => {
        const first = ensureStatusMark(wrap, { shape: 'input' });
        const second = ensureStatusMark(wrap, { shape: 'input' });
        expect(second).toBe(first);
        expect(wrap.querySelectorAll('.ez-status-mark')).toHaveLength(1);
    });

    it('defaults to the quiet state', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(false);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
        expect(mark.getAttribute('aria-label')).toBe('Enhanced by EzClassify');
        expect(mark.tabIndex).toBe(-1);
    });

    it("positions by shape: input self-positions at the field's right edge", () => {
        // 'input' self-positions on a bare input host. 'chrome' uses the
        // caller-owned layout container for the enhanced fields.
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        expect(mark.classList.contains('ez-status-mark--input')).toBe(true);
    });

    it('adopts its stylesheet once per root', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        ensureStatusMark(wrap, { shape: 'input', root });
        expect(hasAdoptedStyles(statusMarkCss)).toBe(true);

        const adopted = document.adoptedStyleSheets.length;
        const other = document.createElement('div');
        document.body.appendChild(other);
        ensureStatusMark(other, { shape: 'input', root });
        expect(document.adoptedStyleSheets.length).toBe(adopted);
    });

    it('adopts its stylesheet once per document even when instances pass different roots', () => {
        // Each field instance passes its own mount element as the style root;
        // one sheet per CSS text per document is what keeps that from stacking
        // a copy per instance.
        const rootA = document.createElement('div');
        const rootB = document.createElement('div');
        document.body.append(rootA, rootB);
        const wrapB = document.createElement('div');
        document.body.appendChild(wrapB);
        ensureStatusMark(wrap, { shape: 'input', root: rootA });
        const adopted = document.adoptedStyleSheets.length;
        ensureStatusMark(wrapB, { shape: 'input', root: rootB });
        expect(document.adoptedStyleSheets.length).toBe(adopted);
        expect(hasAdoptedStyles(statusMarkCss)).toBe(true);
    });

    it('creates no style element, so a host can forbid inline styles', () => {
        ensureStatusMark(wrap, { shape: 'input' });
        expect(document.querySelector('style')).toBeNull();
    });

    it('renders the brand glyph with a separately classed sparkle', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        const svg = mark.querySelector('svg');
        expect(svg?.getAttribute('viewBox')).toBe('-4 -4 72 72');
        expect(mark.querySelector('.ez-status-mark__sparkle')).not.toBeNull();
        // Three bars: two vertical strokes, three horizontal fills.
        expect(mark.querySelectorAll('path[stroke]')).toHaveLength(2);
        expect(mark.querySelectorAll('rect')).toHaveLength(3);
    });
});

describe('the mark glyph and the plain input it sits on', () => {
    // Geometry can't be asserted from jsdom (the `?inline` CSS import is
    // stubbed to an empty string in the test transform, same as
    // mobile-font-floor.spec.ts), so these pin the stylesheet's structure.
    const here = dirname(fileURLToPath(import.meta.url));

    it('the sparkle sits in the glyph viewBox top-right corner', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        const sparkleGroup = mark.querySelector('svg g');
        expect(sparkleGroup?.getAttribute('transform')).toBe('translate(59 7)');
    });

    it("reserves the plain input's trailing room on the edge the mark sits on", () => {
        const css = readFileSync(join(here, 'status-mark.css'), 'utf8').replace(
            /\/\*[\s\S]*?\*\//g,
            '',
        );
        const rule = (selector: string) =>
            css.match(
                new RegExp(
                    `${selector.replace(/[.>]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
                ),
            )?.[1] ?? '';
        // Both on the logical end edge: a right-to-left field keeps its room
        // under the mark, not on the far side.
        expect(rule('.ez-status-mark--input')).toMatch(
            /inset-inline-end:\s*0\.375rem/,
        );
        expect(rule('.ez-status-mark--input')).not.toMatch(
            /(^|;|\s)(right|left):/,
        );
        expect(rule('.ez-plain-field-wrap > input')).toMatch(
            /padding-inline-end:\s*1\.75rem\s*!important/,
        );
    });

    it("lays the plain input's wrap out as the input's own box, so the mark stays on the input in a grid or flex form", () => {
        const css = readFileSync(join(here, 'status-mark.css'), 'utf8').replace(
            /\/\*[\s\S]*?\*\//g,
            '',
        );
        const wrapRule =
            css.match(/\.ez-plain-field-wrap\s*\{([^}]*)\}/)?.[1] ?? '';
        // The positioning box the mark's inset is measured from.
        expect(wrapRule).toMatch(/position:\s*relative/);
        // An inline column flexbox: as wide as the input in a line, and when a
        // grid or flex form stretches the wrap, the input stretches with it
        // instead of leaving the mark at the far end of an empty row.
        expect(wrapRule).toMatch(/display:\s*inline-flex/);
        expect(wrapRule).toMatch(/flex-direction:\s*column/);
        expect(wrapRule).toMatch(/align-items:\s*stretch/);
    });

    it('hides the count while it is empty, so a reviewed mark is the glyph alone', () => {
        const css = readFileSync(join(here, 'status-mark.css'), 'utf8');
        expect(css).toMatch(
            /\.ez-status-mark__count:empty\s*\{\s*display:\s*none;/,
        );
    });
});

describe('setStatusMarkFixes state machine', () => {
    it('goes quiet -> unseen the moment a fix is applied', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(false);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
        expect(mark.tabIndex).toBe(0);
        expect(mark.getAttribute('aria-label')).toBe(
            'Enhanced by EzClassify. 1 change made by a marking rule, not yet reviewed.',
        );
    });

    it('mutates the same mark in place and never stacks a second one', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        setStatusMarkFixes(wrap, [makeFix('r1'), makeFix('r2')]);
        expect(wrap.querySelectorAll('.ez-status-mark')).toHaveLength(1);
        expect(mark.getAttribute('aria-label')).toContain(
            '2 changes made by marking rules',
        );
    });

    it('counts each change to the marking once, however many readings or rules made it', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [
            makeFix('r1', 'first message', 'USA'),
            makeFix('r1', 'first message', 'USA'),
            makeFix('r2', 'second message', 'USA'),
            makeFix('r3', 'third message', 'GBR'),
        ]);
        expect(mark.getAttribute('aria-label')).toContain(
            '2 changes made by marking rules',
        );
    });

    it('stays unseen across re-renders that repeat the same fix set (no premature seen)', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
    });

    it('returns to quiet when the fix set empties', () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        setStatusMarkFixes(wrap, []);
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(false);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
        expect(mark.getAttribute('aria-label')).toBe('Enhanced by EzClassify');
        expect(wrap.querySelectorAll('.ez-status-mark')).toHaveLength(1);
    });
});

describe('acknowledgment via the tooltip actually presenting', () => {
    it('a mouse merely passing through does not acknowledge', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);

        mark.dispatchEvent(new Event('mouseenter'));
        await new Promise((r) => setTimeout(r, 50));
        mark.dispatchEvent(new Event('mouseleave'));
        await new Promise((r) => setTimeout(r, 400));

        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
    });

    it('hovering past the hover-intent delay acknowledges it', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);

        await hoverPastIntent(mark);

        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(false);
    });

    it('focusing the mark also acknowledges (existing tooltip content path)', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);

        mark.dispatchEvent(new Event('focus'));
        await new Promise((r) => setTimeout(r, 400));

        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);
    });

    it('a new fix re-arms unseen even after the field was fully seen', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        await hoverPastIntent(mark);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        setStatusMarkFixes(wrap, [makeFix('r1'), makeFix('r2')]);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
    });

    it('a change already shown stays seen when another rule makes it again', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1', 'r1 added USA', 'USA')]);
        await hoverPastIntent(mark);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        setStatusMarkFixes(wrap, [
            makeFix('r1', 'r1 added USA', 'USA'),
            makeFix('r2', 'r2 added USA', 'USA'),
        ]);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);
    });

    it('a filled-in fact not shown yet re-arms unseen', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(
            wrap,
            explainedChanges(
                [makeFix('r1', 'r1 added USA', 'USA')],
                [held('GROUP'), held('USA', 'r1')],
                SHOWS_FACTS,
            ),
        );
        await hoverPastIntent(mark);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        setStatusMarkFixes(
            wrap,
            explainedChanges(
                [makeFix('r1', 'r1 added USA', 'USA')],
                [held('GROUP'), held('USA', 'r1'), held('AUS', 'expand')],
                SHOWS_FACTS,
            ),
        );
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
    });

    it('a clean reprocess forgets acknowledgment, so the next fix starts unseen', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        await hoverPastIntent(mark);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        setStatusMarkFixes(wrap, []);
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);

        // Same ruleId reapplied after a clean pass reads as a fresh fix.
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
    });

    it('a fix applied mid-dwell, after the tooltip content was already built, is not marked seen', async () => {
        // Acknowledgment applies only to fixes in the tooltip snapshot captured
        // at hover-start. A fix arriving during the dwell remains unseen.
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);

        mark.dispatchEvent(new Event('mouseenter'));
        // Reprocess before the 300ms hover-intent delay elapses: the
        // tooltip content that will render was already captured at
        // mouseenter and still only describes r1.
        setStatusMarkFixes(wrap, [makeFix('r1'), makeFix('r2')]);
        await new Promise((r) => setTimeout(r, 400));

        // r2 was never shown in the tooltip that just presented.
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);

        // r1 genuinely was shown; a later hover with only r1 present proves
        // the snapshot correctly credited it rather than under-crediting.
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);
    });

    it('prunes acknowledgment for a ruleId that drops out, so it re-arms unseen if it fires again later', async () => {
        // A rule that drops out loses its acknowledgment so a later application
        // starts unseen.
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        await hoverPastIntent(mark);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        // r1 drops out; a different rule fires instead.
        setStatusMarkFixes(wrap, [makeFix('r2')]);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);

        // r1 fires again, now against different input under the same
        // ruleId. This application was never shown.
        setStatusMarkFixes(wrap, [makeFix('r1', 'a different fix this time')]);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(false);
    });
});

describe('the number beside the mark', () => {
    // While a change is unreviewed the mark is strong as a whole and the number
    // of changes stands beside it, in the mark's own box; once the list has
    // been shown the number goes and the glyph stays strong.
    it('counts the unreviewed changes, and goes once they have been shown', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        const count = () =>
            mark.querySelector<HTMLElement>('.ez-status-mark__count')!;
        expect(count().getAttribute('aria-hidden')).toBe('true');
        expect(count().textContent).toBe('');

        setStatusMarkFixes(wrap, [
            makeFix('r1', 'one', 'AUS'),
            makeFix('r2', 'two', 'CAN'),
            makeFix('r3', 'three', 'GBR'),
        ]);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
        expect(count().textContent).toBe('3');

        await hoverPastIntent(mark);
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);
        expect(count().textContent).toBe('');
    });
});

describe('accessible label distinguishes unseen and seen', () => {
    // The number beside the mark is aria-hidden, so the label carries both
    // the count and whether it has been reviewed.
    it('says the changes are not yet reviewed until the list has been shown', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [makeFix('r1'), makeFix('r2')]);
        expect(mark.getAttribute('aria-label')).toBe(
            'Enhanced by EzClassify. 2 changes made by marking rules, not yet reviewed.',
        );

        await hoverPastIntent(mark);
        expect(mark.getAttribute('aria-label')).toBe(
            'Enhanced by EzClassify. 2 changes made by marking rules.',
        );
    });
});

describe('the error state', () => {
    const ERROR = 'The scan did not read the whole text.';

    it('reads as an error over any fixes, and returns to the fix state when cleared', () => {
        const mark = ensureStatusMark(wrap, { shape: 'chrome' });
        setStatusMarkFixes(wrap, [makeFix('r1')]);
        setStatusMarkError(wrap, ERROR);
        expect(mark.classList.contains('ez-status-mark--error')).toBe(true);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(false);
        expect(mark.tabIndex).toBe(0);
        expect(mark.getAttribute('aria-label')).toBe(
            `Enhanced by EzClassify. ${ERROR} 1 change made by a marking rule.`,
        );

        setStatusMarkError(wrap, null);
        expect(mark.classList.contains('ez-status-mark--error')).toBe(false);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);

        setStatusMarkFixes(wrap, []);
        setStatusMarkError(wrap, ERROR);
        expect(mark.getAttribute('aria-label')).toBe(
            `Enhanced by EzClassify. ${ERROR}`,
        );
        setStatusMarkError(wrap, null);
        expect(mark.classList.contains('ez-status-mark--quiet')).toBe(true);
        expect(mark.tabIndex).toBe(-1);
        expect(mark.getAttribute('aria-label')).toBe('Enhanced by EzClassify');
    });

    it('leads its popover with the error, even under the no-tooltips opt-out', async () => {
        const mark = ensureStatusMark(wrap, {
            shape: 'chrome',
            shouldShowTooltip: () => false,
        });
        setStatusMarkError(wrap, ERROR);
        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(tip).toBeTruthy();
        expect(tip.hidden).toBe(false);
        expect(tip.textContent!.split('\n')[0]).toBe(ERROR);
    });
});

describe('tooltip content', () => {
    it('says each change once, with the rule that made it under it', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [
            makeFix('r1', 'rule one explains'),
            makeFix('r1', 'rule one explains'),
        ]);

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(tip).toBeTruthy();
        expect(tip.hidden).toBe(false);
        expect(lineTexts(tip)).toEqual([
            '1 change made by a marking rule',
            'Added X-r1 to cat.',
        ]);
        expect(
            [...tip.querySelectorAll('.ez-status-list__rule')].map(
                (rule) => rule.textContent,
            ),
        ).toEqual(['Rule: r1']);
    });

    it("names values and categories in the field's own words", async () => {
        const mark = ensureStatusMark(wrap, {
            shape: 'input',
            words: {
                value: (ref) => `the ${ref.conceptId} value`,
                category: (id) => `Category ${id}`,
            },
        });
        setStatusMarkFixes(wrap, [
            makeFix('adds', 'ignored', 'USA'),
            {
                ruleId: 'drops',
                action: 'remove',
                remove: [{ conceptId: 'OLD', categoryId: 'cat' }],
                message: 'ignored',
            },
            {
                ruleId: 'swaps',
                action: 'replace',
                remove: [{ conceptId: 'LOW', categoryId: 'level' }],
                add: [{ conceptId: 'HIGH', categoryId: 'level' }],
                message: 'ignored',
            },
        ]);

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(lineTexts(tip)).toEqual([
            '3 changes made by marking rules',
            'Added the USA value to Category cat.',
            'Removed the OLD value from Category cat.',
            'Replaced the LOW value with the HIGH value in Category level.',
        ]);
    });

    it('names no rule for a change the engine made on its own', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [
            {
                ruleId: '_recognition_case',
                action: 'reorder',
                message: 'Read it.',
            },
        ]);

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(lineTexts(tip)).toEqual([
            '1 change made by a marking rule',
            'Read it.',
        ]);
        expect(tip.querySelector('.ez-status-list__rule')).toBeNull();
    });

    it('lists a change two rules made once, in the words of the first', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(wrap, [
            makeFix('requires', 'Rule "requires": added "USA"', 'USA'),
            makeFix('adds', 'Rule "adds": added "USA"', 'USA'),
        ]);

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(lineTexts(tip)).toEqual([
            '1 change made by a marking rule',
            'Added USA to cat.',
        ]);
        expect(tip.querySelector('.ez-status-list__rule')!.textContent).toBe(
            'Rule: requires',
        );
        expect(mark.getAttribute('aria-label')).toContain(
            '1 change made by a marking rule',
        );
    });

    it('also lists each fact a rule filled in that no applied fix names', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(
            wrap,
            explainedChanges(
                [makeFix('adds', 'Rule "adds": added "USA"', 'USA')],
                [
                    held('GROUP'),
                    held('USA', 'adds'),
                    held('AUS', 'expand'),
                    held('CAN', 'expand'),
                    // A category's default and a value taken from the whole are
                    // not changes to what the author chose.
                    {
                        conceptId: 'DEFAULTED',
                        categoryId: 'other',
                        confidence: 'certain',
                        source: 'default',
                    },
                    {
                        conceptId: 'FROM_WHOLE',
                        categoryId: 'cat',
                        confidence: 'inferred',
                        source: 'context',
                        sourceRule: 'shares',
                    },
                ],
                SHOWS_FACTS,
            ),
        );

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(lineTexts(tip)).toEqual([
            '3 changes made by marking rules',
            'Added USA to cat.',
            'Added AUS to cat.',
            'Added CAN to cat.',
        ]);
    });

    it('leaves out an applied addition the field no longer holds', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        setStatusMarkFixes(
            wrap,
            explainedChanges(
                [
                    makeFix('gone', 'Rule "gone": added "OLD"', 'OLD'),
                    makeFix('kept', 'Rule "kept": added "NEW"', 'NEW'),
                ],
                [held('NEW', 'kept')],
                SHOWS_FACTS,
            ),
        );

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(lineTexts(tip)).toEqual([
            '1 change made by a marking rule',
            'Added NEW to cat.',
        ]);
    });

    it('leaves out a removal whose concept the field holds again', () => {
        const removed = (conceptId: string): Change => ({
            ruleId: 'drops',
            action: 'remove',
            remove: [{ conceptId, categoryId: 'cat' }],
            message: `Rule "drops": removed "${conceptId}"`,
        });
        expect(
            explainedChanges(
                [removed('BACK'), removed('GONE')],
                [held('BACK')],
                SHOWS_FACTS,
            ).map((change) => change.message),
        ).toEqual(['Rule "drops": removed "GONE"']);
    });

    it('a field that shows only its text lists no fact a rule filled in', () => {
        // The text writes the group's name, not its members: the engine names
        // every added fact the text writes in the applied changes.
        const applied = [makeFix('adds', 'Rule "adds": added "USA"', 'USA')];
        const holds = [
            held('GROUP'),
            held('USA', 'adds'),
            held('AUS', 'expand'),
        ];
        expect(
            explainedChanges(applied, holds, { showsUnwritten: false }).map(
                (change) => change.message,
            ),
        ).toEqual(['Rule "adds": added "USA"']);
        expect(
            explainedChanges(applied, holds, SHOWS_FACTS).map(
                (change) => change.message,
            ),
        ).toEqual(['Rule "adds": added "USA"', 'Added AUS to cat.']);
    });

    it('lists only the changes to categories the field writes, and every note', () => {
        const elsewhere = (conceptId: string, sourceRule?: string) => ({
            ...held(conceptId, sourceRule),
            categoryId: 'other',
        });
        const changes = explainedChanges(
            [
                makeFix('own', 'Rule "own": added "MINE"', 'MINE'),
                {
                    ruleId: 'far',
                    action: 'add',
                    add: [{ conceptId: 'FAR', categoryId: 'other' }],
                    message: 'Rule "far": added "FAR"',
                },
                {
                    ruleId: 'swap',
                    action: 'replace',
                    remove: [{ conceptId: 'OLD', categoryId: 'other' }],
                    add: [{ conceptId: 'NEW', categoryId: 'cat' }],
                    message: 'Rule "swap": NEW in place of OLD',
                },
                { ruleId: '_order', action: 'reorder', message: 'Moved it.' },
            ],
            [
                held('MINE', 'own'),
                held('NEW', 'swap'),
                elsewhere('FAR', 'far'),
                held('FILLED', 'fills'),
                elsewhere('MEMBER', 'expand'),
            ],
            { writes: (id) => id === 'cat', showsUnwritten: true },
        );
        expect(changes.map((change) => change.message)).toEqual([
            'Rule "own": added "MINE"',
            'Rule "swap": NEW in place of OLD',
            'Moved it.',
            'Added FILLED to cat.',
        ]);
    });

    it('lists every change once: what it added or removed, and a note in the engine’s words', async () => {
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        // One rule that removes two concepts made two changes.
        setStatusMarkFixes(wrap, [
            {
                ruleId: 'adds',
                action: 'add',
                add: [{ conceptId: 'A', categoryId: 'c' }],
                message: 'A is required.',
            },
            {
                ruleId: 'removes',
                action: 'remove',
                remove: [{ conceptId: 'B', categoryId: 'c' }],
                message: 'A excludes the rest.',
            },
            {
                ruleId: 'removes',
                action: 'remove',
                remove: [{ conceptId: 'C', categoryId: 'c' }],
                message: 'A excludes the rest.',
            },
            { ruleId: '_order', action: 'reorder', message: 'Moved it.' },
        ]);

        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement;
        expect(lineTexts(tip)).toEqual([
            '4 changes made by marking rules',
            'Added A to c.',
            'Removed B from c.',
            'Removed C from c.',
            'Moved it.',
        ]);
        expect(mark.getAttribute('aria-label')).toContain(
            '4 changes made by marking rules',
        );
    });

    it('no tooltip in the quiet state and none under the no-tooltips opt-out', async () => {
        // Quiet: hovering must not show an explanation (nothing was fixed).
        const mark = ensureStatusMark(wrap, { shape: 'input' });
        await hoverPastIntent(mark);
        const tip = document.querySelector('.ez-tooltip') as HTMLElement | null;
        expect(!tip || tip.hidden).toBe(true);
        mark.dispatchEvent(new Event('mouseleave'));

        // Opt-out: even an active mark stays silent.
        const optedWrap = document.createElement('div');
        document.body.appendChild(optedWrap);
        const optedMark = ensureStatusMark(optedWrap, {
            shape: 'input',
            shouldShowTooltip: () => false,
        });
        setStatusMarkFixes(optedWrap, [makeFix('r9')]);
        await hoverPastIntent(optedMark);
        const tip2 = document.querySelector(
            '.ez-tooltip',
        ) as HTMLElement | null;
        expect(!tip2 || tip2.hidden).toBe(true);
        // The opt-out silences the tooltip, but the visual state machine
        // still runs off the fixes themselves; acknowledgment just never
        // fires because the tooltip never presents.
        expect(optedMark.classList.contains('ez-status-mark--unseen')).toBe(
            true,
        );
    });
});

describe('the applied-changes popover does not outstay the value it described', () => {
    function fieldWithMark() {
        const field = document.createElement('div');
        field.className = 'marking-field-wrap';
        const input = document.createElement('textarea');
        const chrome = document.createElement('div');
        field.append(input, chrome);
        document.body.appendChild(field);
        const mark = ensureStatusMark(chrome, { shape: 'chrome' });
        setStatusMarkFixes(chrome, [makeFix('r1', 'Added NOFORN')]);
        return { field, input, chrome, mark };
    }
    const tip = () => document.querySelector<HTMLElement>('.ez-tooltip');

    it('closes when the field value is rendered again', async () => {
        const { chrome, mark } = fieldWithMark();
        await hoverPastIntent(mark);
        expect(tip()?.hidden).toBe(false);
        setStatusMarkFixes(chrome, [makeFix('r1', 'Added NOFORN')]);
        expect(tip()?.hidden).toBe(true);
        expect(mark.hasAttribute('aria-describedby')).toBe(false);
    });

    it('closes when focus or a press goes outside the field, not inside it', async () => {
        const { input, mark } = fieldWithMark();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        await hoverPastIntent(mark);
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(tip()?.hidden).toBe(false);
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(tip()?.hidden).toBe(true);

        await hoverPastIntent(mark);
        expect(tip()?.hidden).toBe(false);
        outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(tip()?.hidden).toBe(true);
    });

    const box = (left: number, top: number, right: number, bottom: number) =>
        ({
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
        }) as DOMRect;

    /**
     * Run `body` with every tooltip measuring `width` x `height`, where its
     * style placed it.
     */
    async function withTipSize(
        width: number,
        height: number,
        body: () => Promise<void>,
    ): Promise<void> {
        const realRect = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function () {
            if (!this.classList.contains('ez-tooltip'))
                return realRect.call(this);
            const left = parseFloat(this.style.left) || 0;
            const top = parseFloat(this.style.top) || 0;
            return box(left, top, left + width, top + height);
        };
        try {
            await body();
        } finally {
            HTMLElement.prototype.getBoundingClientRect = realRect;
        }
    }

    it('opens outside the box of the field it belongs to, whatever control draws it', async () => {
        // A control with a header row (a picker, DecisionFlow) puts its mark
        // inside the suite frame, at the top of a tall box.
        const frame = document.createElement('div');
        frame.className = 'ez-field-frame';
        const header = document.createElement('div');
        const body = document.createElement('div');
        frame.append(header, body);
        document.body.appendChild(frame);
        const mark = ensureStatusMark(header, { shape: 'chrome' });
        setStatusMarkFixes(header, [makeFix('r1')]);
        frame.getBoundingClientRect = () => box(300, 300, 700, 700);
        mark.getBoundingClientRect = () => box(660, 306, 684, 330);

        await withTipSize(300, 120, async () => {
            mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const shown = tip()!;
            expect(shown.hidden).toBe(false);
            // No room below in jsdom's 768px viewport, so above the frame.
            const top = parseFloat(shown.style.top);
            expect(top + 120).toBeLessThanOrEqual(300);
            expect(top).toBe(174);
        });
    });

    it('opens past the field error list rather than over it, or closes', async () => {
        const { field, mark } = fieldWithMark();
        const list = document.createElement('div');
        list.className = 'ez-validation-errors';
        field.insertBefore(list, field.lastElementChild);
        field.getBoundingClientRect = () => box(0, 40, 300, 100);
        list.getBoundingClientRect = () => box(0, 100, 300, 200);
        mark.getBoundingClientRect = () => box(270, 44, 294, 68);

        await withTipSize(200, 50, async () => {
            await hoverPastIntent(mark);
            // Below the field and its errors: 200 + 6.
            expect(tip()?.hidden).toBe(false);
            expect(tip()?.style.top).toBe('206px');
            mark.dispatchEvent(new Event('mouseleave'));
        });

        // A tooltip as tall as the viewport fits nowhere outside them: it
        // closes rather than cover the errors.
        await withTipSize(1000, 760, async () => {
            await hoverPastIntent(mark);
            expect(tip()?.hidden).toBe(true);
        });
    });

    it('closes rather than cover the field it explains, an open step and its options included', async () => {
        const frame = document.createElement('div');
        frame.className = 'ez-field-frame';
        const header = document.createElement('div');
        frame.appendChild(header);
        document.body.appendChild(frame);
        const mark = ensureStatusMark(header, { shape: 'chrome' });
        setStatusMarkFixes(header, [makeFix('r1')]);
        // An open flow fills the viewport: no side of it has room.
        frame.getBoundingClientRect = () => box(0, 0, 1024, 768);
        mark.getBoundingClientRect = () => box(980, 8, 1004, 32);

        await withTipSize(300, 120, async () => {
            mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(tip()?.hidden).toBe(true);
        });
    });
});

describe('pressing the mark opens the applied-changes list', () => {
    function fieldWithMark() {
        const field = document.createElement('div');
        field.className = 'marking-field-wrap';
        const input = document.createElement('textarea');
        const chrome = document.createElement('div');
        field.append(input, chrome);
        document.body.appendChild(field);
        const mark = ensureStatusMark(chrome, { shape: 'chrome' });
        setStatusMarkFixes(chrome, [makeFix('r1', 'Added NOFORN')]);
        return { field, input, chrome, mark };
    }
    const tip = () => document.querySelector<HTMLElement>('.ez-tooltip');

    it('a press opens it at once and reviews the fixes; a second press closes it', () => {
        const { mark } = fieldWithMark();
        expect(mark.getAttribute('aria-expanded')).toBe('false');

        mark.click();
        expect(tip()?.hidden).toBe(false);
        expect(tip()?.textContent).toContain('Added X-r1 to cat.');
        expect(mark.getAttribute('aria-describedby')).toBe(tip()?.id);
        expect(mark.getAttribute('aria-expanded')).toBe('true');
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);

        mark.click();
        expect(tip()?.hidden).toBe(true);
        expect(mark.hasAttribute('aria-describedby')).toBe(false);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
    });

    it('the press stays with the mark: no default action, no field click, no focus move', () => {
        const { field, mark } = fieldWithMark();
        let fieldClicks = 0;
        field.addEventListener('click', () => fieldClicks++);
        const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        });
        mark.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(fieldClicks).toBe(0);
        // A press must not take focus from the field: the blur would commit
        // the field's draft mid-interaction.
        const down = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        mark.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
    });

    it('a pressed list stays when the pointer leaves; a hovered one does not', async () => {
        const { mark } = fieldWithMark();
        await hoverPastIntent(mark);
        mark.dispatchEvent(new Event('mouseleave'));
        expect(tip()?.hidden).toBe(true);

        mark.dispatchEvent(new Event('mouseenter'));
        mark.click();
        mark.dispatchEvent(new Event('mouseleave'));
        await new Promise((r) => setTimeout(r, 400));
        expect(tip()?.hidden).toBe(false);
        expect(mark.getAttribute('aria-expanded')).toBe('true');
    });

    it('a press on a list the hover already showed keeps it open', async () => {
        const { mark } = fieldWithMark();
        await hoverPastIntent(mark);
        expect(tip()?.hidden).toBe(false);
        mark.click();
        expect(tip()?.hidden).toBe(false);
        mark.dispatchEvent(new Event('mouseleave'));
        expect(tip()?.hidden).toBe(false);
    });

    it('Escape closes it, and goes no further than the mark', () => {
        const { field, mark } = fieldWithMark();
        let fieldEscapes = 0;
        field.addEventListener('keydown', () => fieldEscapes++);
        mark.click();
        const escape = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        mark.dispatchEvent(escape);
        expect(tip()?.hidden).toBe(true);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        expect(escape.defaultPrevented).toBe(true);
        expect(fieldEscapes).toBe(0);

        // With the list closed, Escape is the field's again.
        mark.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        expect(fieldEscapes).toBe(1);
    });

    it('a press elsewhere closes a pressed list', () => {
        const { mark } = fieldWithMark();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        mark.click();
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(tip()?.hidden).toBe(true);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
    });

    it('a hover or focus preview leaves the mark collapsed; the first press expands it', async () => {
        const { mark } = fieldWithMark();
        await hoverPastIntent(mark);
        expect(tip()?.hidden).toBe(false);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        mark.dispatchEvent(new Event('mouseleave'));

        mark.focus();
        await new Promise((r) => setTimeout(r, 400));
        expect(tip()?.hidden).toBe(false);
        expect(mark.getAttribute('aria-describedby')).toBe(tip()?.id);
        expect(mark.getAttribute('aria-expanded')).toBe('false');

        // Enter or Space on the focused button is a click.
        mark.click();
        expect(tip()?.hidden).toBe(false);
        expect(mark.getAttribute('aria-expanded')).toBe('true');
        mark.click();
        expect(tip()?.hidden).toBe(true);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
    });

    it('a pressed list names the tooltip it controls, and only while it is open', () => {
        const { mark } = fieldWithMark();
        expect(mark.hasAttribute('aria-controls')).toBe(false);
        mark.click();
        expect(tip()?.id).toBeTruthy();
        expect(mark.getAttribute('aria-controls')).toBe(tip()?.id);
        mark.click();
        expect(mark.hasAttribute('aria-controls')).toBe(false);
    });

    it('a pressed list hidden by a blur inside the field is no longer pinned, so a later hover closes on leave', async () => {
        const { field, mark } = fieldWithMark();
        const other = document.createElement('button');
        field.appendChild(other);
        mark.focus();
        mark.click();
        expect(mark.getAttribute('aria-expanded')).toBe('true');

        other.focus();
        expect(tip()?.hidden).toBe(true);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        expect(mark.hasAttribute('aria-controls')).toBe(false);

        await hoverPastIntent(mark);
        expect(tip()?.hidden).toBe(false);
        mark.dispatchEvent(new Event('mouseleave'));
        expect(tip()?.hidden).toBe(true);
    });

    it('another target taking the shared tooltip collapses a pressed mark', async () => {
        const { mark } = fieldWithMark();
        mark.click();
        const chip = document.createElement('span');
        document.body.appendChild(chip);
        showTooltip(chip, 'Another tooltip');
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        expect(mark.hasAttribute('aria-controls')).toBe(false);

        await hoverPastIntent(mark);
        mark.dispatchEvent(new Event('mouseleave'));
        expect(tip()?.hidden).toBe(true);
    });

    it('a quiet mark opens nothing and discloses nothing', () => {
        const { chrome, mark } = fieldWithMark();
        setStatusMarkFixes(chrome, []);
        expect(mark.hasAttribute('aria-expanded')).toBe(false);
        mark.click();
        expect(tip()?.hidden ?? true).toBe(true);
    });

    it('under the no-tooltips opt-out a press opens nothing', () => {
        const chrome = document.createElement('div');
        document.body.appendChild(chrome);
        const mark = ensureStatusMark(chrome, {
            shape: 'chrome',
            shouldShowTooltip: () => false,
        });
        setStatusMarkFixes(chrome, [makeFix('r1')]);
        mark.click();
        expect(tip()?.hidden ?? true).toBe(true);
        expect(mark.classList.contains('ez-status-mark--unseen')).toBe(true);
    });
});

describe('status mark tone', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, 'status-mark.css'), 'utf8');
    const palette = readFileSync(join(here, '..', 'styles.css'), 'utf8');

    /**
     * The declarations of the first palette block whose selector starts with
     * `head`.
     */
    function paletteBlock(head: string): string {
        const start = palette.indexOf(head);
        expect(start, head).toBeGreaterThanOrEqual(0);
        return palette.slice(start, palette.indexOf('\n}', start));
    }

    it('is muted while the field has nothing to say and strong once it has a message', () => {
        const mark = ensureStatusMark(wrap, { shape: 'chrome' });
        expect(markTone(mark)).toBe('muted');
        setStatusMarkFixes(wrap, [makeFix('r1', 'Added NOFORN')]);
        expect(markTone(mark)).toBe('strong');
        expect(mark.getAttribute('aria-label')).toContain('1 change made');
        setStatusMarkFixes(wrap, []);
        expect(markTone(mark)).toBe('muted');
        setStatusMarkError(wrap, 'Part of the text was not checked.');
        expect(markTone(mark)).toBe('strong');
        expect(mark.getAttribute('aria-label')).toContain(
            'Part of the text was not checked.',
        );
        setStatusMarkError(wrap, null);
        expect(markTone(mark)).toBe('muted');
    });

    it('paints the muted and strong tones from host-overridable tokens', () => {
        expect(css).toMatch(
            /\.ez-status-mark\s*\{[^}]*color:\s*var\(--ez-status-mark-color, #9ca3af\)/,
        );
        expect(css).toMatch(
            /\.ez-status-mark--unseen,\s*\.ez-status-mark--seen,\s*\.ez-status-mark--error\s*\{[^}]*color:\s*var\(--ez-status-mark-strong-color, currentColor\)/,
        );
    });

    it('is the text color on a light palette and gold on a dark one', () => {
        for (const light of [':root {', "[data-color-scheme='light'],"]) {
            const block = paletteBlock(light);
            expect(block).toMatch(/--ez-status-mark-color:\s*#9ca3af;/);
            expect(block).toMatch(
                /--ez-status-mark-strong-color:\s*currentColor;/,
            );
        }
        const dark = paletteBlock("[data-color-scheme='dark'],");
        expect(dark).toMatch(/--ez-status-mark-color:\s*#9ca3af;/);
        expect(dark).toMatch(
            /--ez-status-mark-strong-color:\s*var\(--ez-color-primary, #fdb827\);/,
        );
    });
});

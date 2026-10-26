/**
 * The commit table, driven through the headless controller over a small
 * in-memory port. The port reads text the way the engine's tolerant parser does
 * for this purpose (any order, any separator, case-insensitive, unread text
 * reported as spans), so every rule here is exercised without a DOM or an
 * engine. The same table is proven across the four real fields, with the real
 * engine, in `composer-contract.spec.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Assertion, Fix, Suggestion } from '@ezclassify/types';
import {
    ComposerController,
    type ComposerCategory,
    type ComposerPort,
    type ComposerReading,
} from './composer-controller';
import { CONCEPTS, FakePort, assertion } from './composer-port-mock';

let port: FakePort;
let announced: string[];

function controller(shape: 'whole' | 'additive' = 'whole') {
    announced = [];
    return new ComposerController({
        port,
        shape,
        announce: (t) => announced.push(t),
    });
}

async function typed(c: ComposerController, text: string) {
    await c.input(text, text.length);
    await c.settle();
}

function countedCategories(count: number, single: boolean) {
    let reads = 0;
    const categories = Array.from({ length: count }, (_, i) => {
        const category = {
            id: `category-${i}`,
            label: `Category ${i}`,
            single,
            required: false,
        };
        Object.defineProperty(category, 'id', {
            get: () => {
                reads++;
                return `category-${i}`;
            },
        });
        return category;
    });
    return { categories, reads: () => reads };
}

function portForReading(
    reading: ComposerReading,
    categories: readonly ComposerCategory[],
    suggestions: Suggestion[] = [],
): ComposerPort {
    return {
        read: async () => reading,
        render: async () => reading,
        suggestions: async () => suggestions,
        committed: () => ({ assertions: [], rendered: '' }),
        store: async () => {},
        separators: () => ['//'],
        categories: () => categories,
        add: (items) => [...items],
        remove: (items) => [...items],
    };
}

beforeEach(() => {
    port = new FakePort();
});

it('builds browse rows with work proportional to offered and held concepts', async () => {
    async function readsFor(count: number): Promise<number> {
        let reads = 0;
        const assertions: Assertion[] = Array.from(
            { length: count },
            (_, i) => {
                const assertion = {
                    categoryId: 'many',
                    confidence: 'certain',
                    source: 'user',
                } as Assertion;
                Object.defineProperty(assertion, 'conceptId', {
                    get: () => {
                        reads++;
                        return `item-${i}`;
                    },
                });
                return assertion;
            },
        );
        const suggestions: Suggestion[] = Array.from(
            { length: count },
            (_, i) => ({
                categoryId: 'many',
                conceptId: `item-${i}`,
                label: `Item ${i}`,
                name: `Item ${i}`,
                description: `Item ${i}`,
                group: 'Many',
                views: {},
                selected: false,
                order: i,
            }),
        );
        const reading: ComposerReading = {
            assertions,
            rendered: '',
            complete: true,
            unmatched: [],
            corrections: [],
            valid: true,
            errors: [],
            warnings: [],
            proposedFixes: [],
            appliedFixes: [],
        };
        const rowPort: ComposerPort = {
            read: async () => reading,
            render: async () => reading,
            suggestions: async () => suggestions,
            committed: () => ({ assertions, rendered: '' }),
            store: async () => {},
            separators: () => ['//'],
            categories: () => [
                { id: 'many', label: 'Many', single: false, required: false },
            ],
            add: (items) => [...items],
            remove: (items) => [...items],
        };
        const picker = new ComposerController({
            port: rowPort,
            shape: 'whole',
        });
        await picker.open();
        await picker.settle();
        reads = 0;
        picker.setCap(9);
        expect(picker.snapshot().rows).toHaveLength(count);
        expect(
            picker
                .snapshot()
                .rows.every((row) => row.kind === 'concept' && row.checked),
        ).toBe(true);
        return reads;
    }

    const small = await readsFor(64);
    const large = await readsFor(128);
    expect(large / small).toBeLessThan(2.5);
});

it('finds category errors and warnings with linear work', async () => {
    const count = 80;
    let errorCategoryReads = 0;
    const categories = countedCategories(count, false);
    const errors = Array.from({ length: count / 2 }, (_, i) => {
        const error = { constraintId: `rule-${i}`, message: `Missing ${i}` };
        Object.defineProperty(error, 'categoryId', {
            get: () => {
                errorCategoryReads++;
                return `category-${i}`;
            },
        });
        return error;
    });
    const warnings = Array.from({ length: count / 2 }, (_, i) => ({
        categoryId: `category-${i + count / 2}`,
        kind: 'rule' as const,
        message: `Suggested ${i}`,
    }));
    const reading: ComposerReading = {
        assertions: [],
        rendered: '',
        complete: true,
        unmatched: [],
        corrections: [],
        valid: false,
        errors,
        warnings,
        proposedFixes: [],
        appliedFixes: [],
    };
    const picker = new ComposerController({
        port: portForReading(reading, categories.categories),
        shape: 'whole',
    });
    await picker.open();
    await picker.settle();
    const needs = picker.snapshot().needs;
    expect(needs).toHaveLength(count);
    expect(needs[0]?.categoryId).toBe('category-0');
    expect(needs.at(-1)?.categoryId).toBe(`category-${count - 1}`);
    expect(errorCategoryReads).toBeLessThanOrEqual(count * 4);
    expect(categories.reads()).toBeLessThanOrEqual(count * 12);
});

it('finds filled single-choice categories with linear work', async () => {
    const count = 80;
    const categories = countedCategories(count, true);
    const assertions: Assertion[] = Array.from({ length: count }, (_, i) => ({
        conceptId: `concept-${i}`,
        categoryId: `category-${i}`,
        confidence: 'certain',
        source: 'user',
    }));
    const reading: ComposerReading = {
        assertions,
        rendered: '//',
        complete: true,
        unmatched: [],
        corrections: [],
        valid: true,
        errors: [],
        warnings: [],
        proposedFixes: [],
        appliedFixes: [],
    };
    const picker = new ComposerController({
        port: portForReading(reading, categories.categories),
        shape: 'whole',
    });
    await picker.open();
    await picker.input('//', 2);
    await picker.settle();
    expect(picker.snapshot().reading?.assertions).toHaveLength(count);
    expect(categories.reads()).toBeLessThanOrEqual(count * 30);
});

it('labels many changed concepts without searching the catalog for each one', async () => {
    const count = 80;
    let suggestionIdReads = 0;
    const assertions: Assertion[] = Array.from({ length: count }, (_, i) => ({
        conceptId: `concept-${i}`,
        categoryId: 'many',
        confidence: 'certain',
        source: 'user',
    }));
    const suggestions: Suggestion[] = Array.from({ length: count }, (_, i) => {
        const suggestion: Suggestion = {
            conceptId: `concept-${i}`,
            categoryId: 'many',
            label: `Concept ${i}`,
            name: `Concept ${i}`,
            description: '',
            group: 'Many',
            views: {},
            selected: false,
            order: i,
        };
        Object.defineProperty(suggestion, 'conceptId', {
            get: () => {
                suggestionIdReads++;
                return `concept-${i}`;
            },
        });
        return suggestion;
    });
    const reading: ComposerReading = {
        assertions,
        rendered: '',
        complete: true,
        unmatched: [],
        corrections: [],
        valid: true,
        errors: [],
        warnings: [],
        proposedFixes: [],
        appliedFixes: [],
    };
    const picker = new ComposerController({
        port: portForReading(
            reading,
            [{ id: 'many', label: 'Many', single: false, required: false }],
            suggestions,
        ),
        shape: 'whole',
    });
    await picker.open();
    await picker.settle();
    const changes = picker.snapshot().changes;
    expect(changes).toHaveLength(count);
    expect(changes[0]?.label).toBe('Concept 0');
    expect(changes.at(-1)?.label).toBe(`Concept ${count - 1}`);
    expect(suggestionIdReads).toBeLessThan(count * 60);
});

describe('reading the whole draft on every keystroke', () => {
    it('reads text in any order and shows the canonical result', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'noforn secret');
        const s = c.snapshot();
        expect(s.reading?.complete).toBe(true);
        expect(s.reading?.rendered).toBe('SECRET//NOFORN');
        expect(s.changes.map((x) => `${x.kind}:${x.label}`)).toEqual([
            'added:NOFORN',
            'added:SECRET',
        ]);
    });

    it('reports an unread fragment in place and offers the closest spelling first', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRTE NOFORN ');
        const s = c.snapshot();
        expect(s.reading?.complete).toBe(false);
        expect(s.reading?.unmatched.map((f) => f.text)).toEqual(['SECRTE']);
        expect(s.groups[0].id).toBe('corrections');
        const fix = s.rows[0];
        expect(fix.kind).toBe('correction');
        await c.activate(fix);
        expect(c.snapshot().text).toBe('SECRET NOFORN ');
        expect(c.snapshot().reading?.complete).toBe(true);
    });

    it('offers a correction per word when the parser reports two misspelled words as one span', async () => {
        const read = port.read.bind(port);
        port.read = async (text, base) => {
            const r = await read(text, base);
            // Merge adjacent unread words into one span, as the engine can.
            if (r.unmatched.length < 2) return r;
            const first = r.unmatched[0];
            const last = r.unmatched[r.unmatched.length - 1];
            return {
                ...r,
                unmatched: [
                    {
                        start: first.start,
                        end: last.end,
                        text: text.slice(first.start, last.end),
                    },
                ],
            };
        };
        const c = controller();
        await c.open();
        await typed(c, 'secrte nofron ');
        const corrections = c
            .snapshot()
            .rows.filter((r) => r.kind === 'correction')
            .map((r) => r.kind === 'correction' && r.suggestion.label);
        expect(corrections).toEqual(['SECRET', 'NOFORN']);
    });

    it('a correction keeps the caret where the user was and arms nothing', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'secrte nof');
        const fix = c.snapshot().rows.find((r) => r.kind === 'correction');
        await c.activate(fix!);
        const s = c.snapshot();
        expect(s.text).toBe('SECRET nof');
        expect(s.caret).toBe(s.text.length);
        expect(s.token.query).toBe('nof');
        // The token is still unread, but nothing is armed until the user
        // types again: an accept never pre-arms the next row.
        expect(s.activeIndex).toBe(-1);
        await c.input('secret nofo', 11);
        await c.settle();
        expect(c.snapshot().activeIndex).toBe(0);
    });

    it('does not flag the token still being typed as a mistake', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET NOF');
        const s = c.snapshot();
        expect(s.rows.some((r) => r.kind === 'correction')).toBe(false);
        expect(s.token.query).toBe('NOF');
    });

    it('names the required categories the result still needs', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'NOFORN');
        expect(c.snapshot().needs).toEqual([
            { categoryId: 'level', label: 'Level', kind: 'required' },
        ]);
        await typed(c, 'NOFORN SECRET');
        expect(c.snapshot().needs).toEqual([]);
    });
});

describe('the commit table', () => {
    it('arms the best completion for an unread token; Enter replaces only that token', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'secret nof');
        const s = c.snapshot();
        expect(s.activeIndex).toBe(0);
        expect(c.activeRow()?.kind).toBe('concept');
        const outcome = await c.enter();
        expect(outcome).toBe('accepted');
        // The pick is written by the format, not spliced in as typed.
        expect(c.snapshot().text).toBe('SECRET//NOFORN');
        expect(port.stored).toHaveLength(0);
    });

    it('leaves no row active after an accept, so the next Enter commits', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'secret nof');
        await c.enter();
        expect(c.snapshot().activeIndex).toBe(-1);
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//NOFORN');
    });

    it('does not arm anything for a token the parser already reads', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        expect(c.snapshot().activeIndex).toBe(-1);
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET');
    });

    it('Tab accepts the active row and keeps focus; with none active it lets focus leave', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'nof');
        expect(c.tab()).toBe(true);
        await c.settle();
        expect(c.snapshot().text).toBe('NOFORN');
        expect(c.tab()).toBe(false);
    });

    it('blur runs the same commit and closes', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'orcon secret');
        expect(await c.blur()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//ORCON');
        expect(c.isOpen).toBe(false);
    });

    it('a draft that does not read completely stores nothing and stays visible, invalid', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller();
        await c.open();
        await typed(c, 'SECRET zzz');
        expect(await c.blur()).toBe('invalid');
        expect(port.stored).toHaveLength(0);
        expect(port.value.rendered).toBe('SECRET');
        const s = c.snapshot();
        expect(s.invalid).toBe(true);
        expect(s.text).toBe('SECRET zzz');
        expect(s.problem?.fragment).toBe('zzz');
        expect(announced.at(-1)).toMatch(/Not saved/);
    });

    it('an empty draft clears the value', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller();
        await c.open();
        await typed(c, '');
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('');
    });

    it('first Escape closes and keeps the draft; second reverts to the committed value', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller();
        await c.open();
        await typed(c, 'SECRET NOFORN');
        expect(c.escape()).toBe(true);
        expect(c.isOpen).toBe(false);
        expect(c.snapshot().text).toBe('SECRET NOFORN');
        expect(c.escape()).toBe(true);
        expect(c.snapshot().text).toBe('SECRET');
        expect(port.stored).toHaveLength(0);
        // Nothing left to do: the key goes on to whatever encloses the field.
        expect(c.escape()).toBe(false);
    });

    it('a checked row removes its concept, keeping unread fragments', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET NOFORN zzz ');
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.conceptId === 'NF',
            );
        expect(row && row.kind === 'concept' && row.action).toBe('remove');
        await c.activate(row!);
        expect(c.snapshot().text).toBe('SECRET zzz');
    });

    it('an inferred fact is confirmed by its row, never removed', async () => {
        // The engine infers NOFORN from SECRET here; removing it would only
        // see the engine infer it again, so its row confirms it instead.
        const read = port.read.bind(port);
        port.read = async (text, base) => {
            const r = await read(text, base);
            if (!r.assertions.some((x) => x.conceptId === 'S')) return r;
            if (r.assertions.some((x) => x.conceptId === 'NF')) return r;
            return {
                ...r,
                assertions: [
                    ...r.assertions,
                    { ...assertion(CONCEPTS[2]), confidence: 'inferred' },
                ],
            };
        };
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ');
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.conceptId === 'NF',
            );
        expect(row?.kind === 'concept' && row.inferred).toBe(true);
        expect(row?.kind === 'concept' && row.action).toBe('confirm');
        await c.activate(row!);
        expect(c.snapshot().text).toBe('SECRET//NOFORN');
    });

    it('a row in a filled single-choice category says it replaces, and does', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET unc');
        const row = c.activeRow();
        expect(row?.kind === 'concept' && row.action).toBe('replace');
        expect(row?.kind === 'concept' && row.replaces).toBe('SECRET');
        await c.enter();
        expect(c.snapshot().reading?.rendered).toBe('UNCLASSIFIED');
    });

    it('a fix row sets the draft to the marking it leaves and stores it', async () => {
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON');
        const fix = c.snapshot().rows.find((r) => r.kind === 'fix');
        expect(fix?.kind === 'fix' && fix.label).toBe('Remove ORCON');
        await c.activate(fix!);
        expect(c.snapshot().text).toBe('SECRET');
        expect(port.value.rendered).toBe('SECRET');
        expect(c.isDirty()).toBe(false);
    });

    it('a pick leaves exactly the marking, and a separator typed next joins it', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SEC');
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.label === 'SECRET',
            )!;
        await c.activate(row);
        // No trailing separator or space.
        expect(c.snapshot().text).toBe('SECRET');
        expect(c.snapshot().caret).toBe(6);
        // The list browses: the last word of the marking is not a search.
        expect(c.snapshot().mode).toBe('browse');
        await c.input('SECRET/', 7);
        await c.input('SECRET//', 8);
        expect(c.snapshot().text).toBe('SECRET//');
    });

    it('a concept the catalog lacks stays listed, unchecked, after it is removed, and can be added back', async () => {
        // ORCON is not in the catalog; the list shows it only because the
        // draft holds it.
        const all = port.suggestions.bind(port);
        port.suggestions = async () =>
            (await all()).filter((s) => s.conceptId !== 'OC');
        (port as unknown as { suggestionFor: unknown }).suggestionFor = (
            a: Assertion,
        ) => {
            const c = CONCEPTS.find((x) => x.id === a.conceptId)!;
            return {
                conceptId: c.id,
                categoryId: c.category,
                label: c.label,
                description: c.label,
                name: c.label,
                views: { default: c.label },
                group: 'Caveat',
                selected: false,
                order: 0,
            };
        };
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[3])],
            rendered: 'SECRET//ORCON',
        };
        const c = controller();
        await c.open();
        const orcon = () =>
            c
                .snapshot()
                .rows.find(
                    (r): r is Extract<typeof r, { kind: 'concept' }> =>
                        r.kind === 'concept' && r.suggestion.conceptId === 'OC',
                );
        expect(orcon()?.checked).toBe(true);
        await c.activate(orcon()!);
        expect(c.snapshot().text).toBe('SECRET');
        // Still listed, unchecked.
        expect(orcon()).toBeDefined();
        expect(orcon()?.checked).toBe(false);
        await c.activate(orcon()!);
        expect(c.snapshot().text).toBe('SECRET//ORCON');
    });

    it('a word typed after a pick keeps the space before it', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SEC');
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.label === 'SECRET',
            )!;
        await c.activate(row);
        await c.input('SECRET N', 8);
        expect(c.snapshot().text).toBe('SECRET N');
    });

    it('right after a separator, the list starts at the next category, not the level already chosen', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET//');
        const s = c.snapshot();
        expect(s.mode).toBe('browse');
        expect(s.token.query).toBe('');
        const first = s.rows.find((r) => r.kind === 'concept');
        expect(first?.kind === 'concept' && first.suggestion.categoryId).toBe(
            'caveat',
        );
        // The level already chosen has no next part to give: it is not listed.
        expect(
            s.rows.some(
                (r) =>
                    r.kind === 'concept' && r.suggestion.categoryId === 'level',
            ),
        ).toBe(false);
    });

    it('right after a separator with no part left to add, ArrowDown picks nothing and Enter saves what was typed', async () => {
        // A scheme of one single-choice category, already chosen.
        const all = port.suggestions.bind(port);
        port.suggestions = async () =>
            (await all()).filter((s) => s.categoryId === 'level');
        const c = controller();
        await c.open();
        await typed(c, 'SECRET//');
        expect(c.snapshot().rows.filter((r) => r.kind === 'concept')).toEqual(
            [],
        );
        c.move(1);
        expect(c.activeRow()).toBeNull();
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET');
        expect(c.snapshot().text).toBe('SECRET');
    });

    it('a draft that reads completely reports no search miss for its last word; the list browses', async () => {
        // A search that finds nothing: the catalog has no row for NOFORN.
        const all = port.suggestions.bind(port);
        port.suggestions = async () =>
            (await all()).filter((s) => s.conceptId !== 'NF');
        const c = controller();
        await c.open();
        await typed(c, 'SECRET//NOFORN');
        const s = c.snapshot();
        expect(s.reading?.complete).toBe(true);
        expect(s.token.query).toBe('NOFORN');
        expect(s.mode).toBe('browse');
        expect(s.rows.some((r) => r.kind === 'concept')).toBe(true);

        // A word that does not read is still a search that missed.
        await typed(c, 'SECRET//QQQ');
        expect(c.snapshot().mode).toBe('ranked');
    });

    it('without a separator before the caret, browsing keeps the scheme order', async () => {
        const c = controller();
        await c.open();
        const s = c.snapshot();
        const first = s.rows.find((r) => r.kind === 'concept');
        expect(first?.kind === 'concept' && first.suggestion.categoryId).toBe(
            'level',
        );
    });

    it('after a fix stores, an open list reads the stored value and browses, with no search left over', async () => {
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON');
        const fix = c.snapshot().rows.find((r) => r.kind === 'fix');
        await c.activate(fix!);
        await c.settle();
        const s = c.snapshot();
        expect(s.open).toBe(true);
        expect(s.mode).toBe('browse');
        expect(s.token.query).toBe('');
        expect(s.reading?.rendered).toBe('SECRET');
        expect(s.stale).toBe(false);
        expect(s.rows.some((r) => r.kind === 'more')).toBe(false);
    });

    it.each(['whole', 'additive'] as const)(
        'a fix in the %s shape stores what it keeps and adds, not everything its rendering shows',
        async (shape) => {
            // The fix's rendering also shows NOFORN (the engine inferred it
            // from SECRET), but the fix states only SECRET. Reading the
            // rendering back as text would pin NOFORN as stated.
            port.fixes = [
                {
                    message: 'Remove ORCON.',
                    rendered: 'SECRET//NOFORN',
                    keeps: [{ conceptId: 'S', categoryId: 'level' }],
                    adds: [],
                    removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
                },
            ];
            const c = controller(shape);
            await c.open();
            await typed(c, 'SECRET ORCON');
            const fix = c.snapshot().rows.find((r) => r.kind === 'fix');
            await c.activate(fix!);
            expect(port.stored).toHaveLength(1);
            expect(port.stored[0].assertions.map((a) => a.conceptId)).toEqual([
                'S',
            ]);
        },
    );

    it('a fix that leaves the same rendering still stores', async () => {
        // The committed value renders as SECRET, and so does the fix, which
        // removes a concept the rendering never showed.
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[3])],
            rendered: 'SECRET',
        };
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ');
        const fix = c.snapshot().rows.find((r) => r.kind === 'fix');
        await c.activate(fix!);
        expect(port.stored.at(-1)?.assertions.map((a) => a.conceptId)).toEqual([
            'S',
        ]);
    });

    it('offers fixes for every engine error, including reading diagnostics', async () => {
        const removeOrcon: Fix = {
            message: 'Remove ORCON.',
            rendered: 'SECRET',
            keeps: [{ conceptId: 'S', categoryId: 'level' }],
            adds: [],
            removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
        };
        port.fixes = [removeOrcon];
        // The engine owns both the reading error and the proposed remedy.
        port.fixedErrors = [
            {
                constraintId: '_unmatched_token',
                message: 'Not recognized.',
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON');
        expect(c.snapshot().rows.some((r) => r.kind === 'fix')).toBe(true);

        // A rule identity does not change whether the engine error is reported.
        port.fixedErrors = [
            { constraintId: 'whole-rule', message: 'The whole needs more.' },
        ];
        const part = new ComposerController({
            port,
            shape: 'whole',
        });
        await part.open();
        await part.input('SECRET ORCON', 12);
        await part.settle();
        expect(part.snapshot().rows.some((r) => r.kind === 'fix')).toBe(true);
    });

    it('lists the ways to fix before spelling corrections', async () => {
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON NOFORM ');
        const ids = c.snapshot().groups.map((g) => g.id);
        expect(ids.indexOf('fixes')).toBe(0);
        expect(ids).toContain('corrections');
    });

    it("lists the fix rows under the error area's heading, apart from spelling corrections", async () => {
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON');
        const group = c
            .snapshot()
            .groups.find((g) => g.rows.some((r) => r.kind === 'fix'));
        expect(group?.label).toBe('Ways to fix');
        expect(group?.rows.every((r) => r.kind === 'fix')).toBe(true);
    });

    it('offers two fixes that end in the same marking as one row', async () => {
        const removeOrcon = (message: string): Fix => ({
            message,
            rendered: 'SECRET',
            keeps: [{ conceptId: 'S', categoryId: 'level' }],
            adds: [],
            removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
        });
        port.fixes = [removeOrcon('Remove ORCON.'), removeOrcon('Drop ORCON.')];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON');
        const fixes = c.snapshot().rows.filter((r) => r.kind === 'fix');
        expect(fixes).toHaveLength(1);
    });

    it('words a fix row by the fix message, as the error area does', async () => {
        port.fixes = [
            {
                message: 'Remove ORCON, NOFORN and SECRET.',
                rendered: '',
                keeps: [],
                adds: [],
                removes: [
                    { conceptId: 'OC', categoryId: 'caveat' },
                    { conceptId: 'NF', categoryId: 'caveat' },
                    { conceptId: 'S', categoryId: 'level' },
                ],
            },
        ];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET ORCON NOFORN');
        const fix = c.snapshot().rows.find((r) => r.kind === 'fix');
        expect(fix?.kind === 'fix' && fix.label).toBe(
            'Remove ORCON, NOFORN and SECRET',
        );
    });

    it('substring matches wait behind a "more" row', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'CRE');
        const s = c.snapshot();
        expect(s.rows.map((r) => r.kind)).toEqual(['more']);
        await c.activate(s.rows[0]);
        expect(c.snapshot().rows.map((r) => r.kind)).toEqual(['concept']);
    });

    it('a fast Enter waits for the reading of the text as typed', async () => {
        const c = controller();
        await c.open();
        void c.input('noforn secret', 13);
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//NOFORN');
    });
});

describe('browsing after a click into the draft', () => {
    it('adds a browsed row after the word the caret sits inside, never splitting it', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller();
        await c.open();
        // A click left the caret between "SEC" and "RET".
        await c.input('SECRET', 3);
        await c.settle();
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.conceptId === 'NF',
            );
        await c.activate(row!);
        expect(c.snapshot().text).toBe('SECRET//NOFORN');
    });

    it('removes a checked row without touching the word the caret sits inside', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        const c = controller();
        await c.open();
        await c.input('SECRET//NOFORN', 3);
        await c.settle();
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.conceptId === 'NF',
            );
        await c.activate(row!);
        expect(c.snapshot().text).toBe('SECRET');
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET');
    });
});

describe('an additive draft (text adds to the committed set)', () => {
    it('stores confirmation of an inferred committed assertion', async () => {
        port.value = {
            assertions: [
                assertion(CONCEPTS[1]),
                { ...assertion(CONCEPTS[2]), confidence: 'inferred' },
            ],
            rendered: 'SECRET//NOFORN',
        };
        const c = controller('additive');
        await c.open();
        const row = c
            .snapshot()
            .rows.find(
                (candidate) =>
                    candidate.kind === 'concept' &&
                    candidate.suggestion.conceptId === 'NF',
            );
        expect(row?.kind === 'concept' && row.action).toBe('confirm');
        await c.activate(row!);
        expect(await c.blur()).toBe('stored');
        expect(
            port.value.assertions.find((one) => one.conceptId === 'NF'),
        ).toMatchObject({
            confidence: 'certain',
            source: 'user',
        });
    });

    it('reads the text over the committed set and commits the union', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller('additive');
        await c.open();
        expect(c.snapshot().text).toBe('');
        await typed(c, 'noforn');
        expect(c.snapshot().reading?.rendered).toBe('SECRET//NOFORN');
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(c.snapshot().text).toBe('');
    });

    it('removing a committed concept edits the base, not the text', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        const c = controller('additive');
        await c.open();
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.conceptId === 'NF',
            );
        await c.activate(row!);
        expect(c.isDirty()).toBe(true);
        expect(c.snapshot().reading?.rendered).toBe('SECRET');
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET');
    });

    it('a pasted marking starts over from the paste alone', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller('additive');
        await c.open();
        await c.startOver('UNCLASSIFIED ORCON');
        await c.settle();
        expect(c.snapshot().reading?.rendered).toBe('UNCLASSIFIED//ORCON');
    });

    it('follows an outside change to the committed value while clean', async () => {
        const c = controller('additive');
        port.value = {
            assertions: [assertion(CONCEPTS[0])],
            rendered: 'UNCLASSIFIED',
        };
        c.syncCommitted();
        await c.open();
        await c.settle();
        expect(c.snapshot().reading?.rendered).toBe('UNCLASSIFIED');
    });
});

describe('what a commit tells the field about the value it stores over', () => {
    it('a whole-marking draft replaces the value', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller('whole');
        await c.open();
        await typed(c, 'SECRET NOFORN');
        expect(await c.enter()).toBe('stored');
        expect(port.commits).toEqual([{ replaces: true }]);
    });

    it('an additive draft that only adds does not replace it', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller('additive');
        await c.open();
        await typed(c, 'noforn');
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//NOFORN');
        expect(port.commits).toEqual([{ replaces: false }]);
    });

    it('an additive draft that removes a committed concept replaces it', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        const c = controller('additive');
        await c.open();
        const row = c
            .snapshot()
            .rows.find(
                (r) => r.kind === 'concept' && r.suggestion.conceptId === 'NF',
            );
        await c.activate(row!);
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET');
        expect(port.commits).toEqual([{ replaces: true }]);
    });

    it('a pasted marking that starts an additive draft over replaces it', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        const c = controller('additive');
        await c.open();
        await c.startOver('UNCLASSIFIED ORCON');
        expect(await c.enter()).toBe('stored');
        expect(port.value.rendered).toBe('UNCLASSIFIED//ORCON');
        expect(port.commits).toEqual([{ replaces: true }]);
    });
});

describe('async ordering', () => {
    it('retries contextual suggestions after a transient failure', async () => {
        let contextualCalls = 0;
        const suggestions = port.suggestions.bind(port);
        port.suggestions = async (live) => {
            if (live?.length) {
                contextualCalls++;
                if (contextualCalls === 1) throw new Error('network down');
            }
            return suggestions();
        };
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        await typed(c, 'SECRET ');
        expect(contextualCalls).toBe(2);
    });

    it('ignores a gated search result after its query is cleared', async () => {
        let finish!: (rows: Awaited<ReturnType<FakePort['gated']>>) => void;
        port.gated = () =>
            new Promise((resolve) => {
                finish = resolve;
            });
        const c = controller();
        await c.open();
        await typed(c, 'NOF');
        await typed(c, '');
        const suggestion = (await port.suggestions()).find(
            (one) => one.conceptId === 'NF',
        )!;
        finish([
            {
                ...suggestion,
                gated: true,
            },
        ]);
        await Promise.resolve();
        const row = c
            .snapshot()
            .rows.find(
                (candidate) =>
                    candidate.kind === 'concept' &&
                    candidate.suggestion.conceptId === 'NF',
            );
        expect(row?.kind === 'concept' && row.gated).toBe(false);
    });

    it('discards a superseded reading that lands after a newer one', async () => {
        const read = port.read.bind(port);
        const gates: Array<() => void> = [];
        port.read = (text, base) =>
            new Promise((resolve) => {
                gates.push(() => void read(text, base).then(resolve));
            });
        const c = controller();
        void c.open();
        const first = c.input('SECRET', 6);
        const second = c.input('UNCLASSIFIED', 12);
        // The newer reading lands first, then the older one.
        gates[gates.length - 1]();
        await second;
        gates[gates.length - 2]();
        await first;
        await wait0();
        expect(c.snapshot().reading?.rendered).toBe('UNCLASSIFIED');
    });

    it('fetches the catalog again on the next open after a failed fetch', async () => {
        let fail = true;
        const suggestions = port.suggestions.bind(port);
        port.suggestions = async () => {
            if (fail) throw new Error('network down');
            return suggestions();
        };
        const c = controller();
        await c.open();
        expect(c.snapshot().rows).toEqual([]);
        c.close();
        fail = false;
        await c.open();
        expect(c.snapshot().rows.length).toBeGreaterThan(0);
    });
});

describe('stale readings never reach the store', () => {
    it('a failed read stores nothing rather than the reading of the older text', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        const read = port.read.bind(port);
        port.read = async (text, base) => {
            if (text.includes('NOFORN')) throw new Error('network down');
            return read(text, base);
        };
        await c.input('SECRET NOFORN', 13);
        expect(await c.blur()).toBe('invalid');
        expect(port.stored).toEqual([]);
        expect(c.snapshot().text).toBe('SECRET NOFORN');
        expect(c.snapshot().problem?.rule).toBeTruthy();
    });

    it('an additive commit reads again when the committed set changed under an unchanged text', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        const c = controller('additive');
        await c.open();
        await typed(c, 'orcon');
        expect(c.snapshot().reading?.rendered).toBe('SECRET//NOFORN/ORCON');
        // A chip removed outside the composer: the field stores and tells it.
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        c.syncCommitted();
        expect(await c.blur()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//ORCON');
    });

    it('an additive reading made over the old committed set is never stored once that set changed', async () => {
        port.value = {
            assertions: [assertion(CONCEPTS[1]), assertion(CONCEPTS[2])],
            rendered: 'SECRET//NOFORN',
        };
        const c = controller('additive');
        await c.open();
        await typed(c, 'orcon');
        // The chip comes off, and the engine cannot be reached to read again:
        // the old reading (NOFORN still in it) must not be what is stored.
        port.value = {
            assertions: [assertion(CONCEPTS[1])],
            rendered: 'SECRET',
        };
        port.read = async () => {
            throw new Error('network down');
        };
        c.syncCommitted();
        expect(await c.blur()).toBe('invalid');
        expect(port.value.rendered).toBe('SECRET');
    });

    it('a whole-marking commit reads again when the committed value changed under the draft', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        let reads = 0;
        const read = port.read.bind(port);
        port.read = async (text, base) => {
            reads++;
            return read(text, base);
        };
        port.value = {
            assertions: [assertion(CONCEPTS[0])],
            rendered: 'UNCLASSIFIED',
        };
        c.syncCommitted();
        await c.commit();
        expect(reads).toBeGreaterThan(0);
    });

    it('a reading that lands after an Escape revert is dropped', async () => {
        const read = port.read.bind(port);
        const gates: Array<() => void> = [];
        port.read = (text, base) =>
            new Promise((resolve) => {
                gates.push(() => void read(text, base).then(resolve));
            });
        const c = controller();
        void c.open();
        const pending = c.input('SECRET', 6);
        c.close();
        expect(c.escape()).toBe(true);
        gates[gates.length - 1]();
        await pending;
        await wait0();
        expect(c.snapshot().text).toBe('');
        expect(c.snapshot().reading).toBeNull();
    });

    it('a revert during a store leaves the stored value, not the text from before it', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        const store = port.store.bind(port);
        port.store = async (r, commit) => {
            // Two Escapes while the store is in flight.
            c.close();
            c.escape();
            await store(r, commit);
        };
        expect(await c.commit()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET');
        expect(c.snapshot().text).toBe('SECRET');
        expect(c.isDirty()).toBe(false);
    });

    it('in an additive draft, a fix row stands for the whole value, not an addition to it', async () => {
        port.value = {
            assertions: [
                assertion(CONCEPTS[1]),
                assertion(CONCEPTS.find((c) => c.id === 'OC')!),
            ],
            rendered: 'SECRET//ORCON',
        };
        port.fixes = [
            {
                message: 'Remove ORCON.',
                rendered: 'SECRET',
                keeps: [{ conceptId: 'S', categoryId: 'level' }],
                adds: [],
                removes: [{ conceptId: 'OC', categoryId: 'caveat' }],
            },
        ];
        const c = controller('additive');
        await c.open();
        await typed(c, 'noforn');
        const fix = c.snapshot().rows.find((r) => r.kind === 'fix');
        await c.activate(fix!);
        expect(port.value.rendered).toBe('SECRET');
    });

    it('typing during a commit is not reported as a failed read', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        const read = port.read.bind(port);
        let once = true;
        port.read = async (text, base) => {
            if (once && text === 'SECRET NOFORN') {
                once = false;
                // More typing lands while this read runs.
                void c.input('SECRET NOFORN ORCON', 19);
            }
            return read(text, base);
        };
        void c.input('SECRET NOFORN', 13);
        expect(await c.commit()).toBe('stored');
        expect(port.value.rendered).toBe('SECRET//NOFORN/ORCON');
    });

    it('two commits in a row store once', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        const [a, b] = await Promise.all([c.commit(), c.commit()]);
        expect([a, b]).toEqual(['stored', 'unchanged']);
        expect(port.stored).toHaveLength(1);
    });

    it('text typed while a store runs stays as the draft', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        const store = port.store.bind(port);
        let during: Promise<void> | null = null;
        port.store = async (r, commit) => {
            during = c.input('SECRET NOFORN', 13);
            await store(r, commit);
        };
        expect(await c.commit()).toBe('stored');
        await during;
        await c.settle();
        expect(port.value.rendered).toBe('SECRET');
        expect(c.snapshot().text).toBe('SECRET NOFORN');
        expect(c.isDirty()).toBe(true);
    });

    it('Enter behind a closed list commits instead of accepting a row nobody sees', async () => {
        const c = controller();
        await c.open();
        c.close();
        // Typing behind the closed list (the first Escape closed it) must
        // not arm a completion the user cannot see.
        await typed(c, 'SECRET noforn ORC');
        expect(c.activeRow()).toBeNull();
        expect(await c.enter()).toBe('invalid');
        expect(c.snapshot().text).toBe('SECRET noforn ORC');
    });
});

function wait0(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

describe('announcements', () => {
    it('announces a commit with the stored value', async () => {
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        await c.enter();
        expect(announced).toContain('Marking set to SECRET');
    });
});

describe('category browsing', () => {
    it('places newly offered categories in declared order, not catalog arrival order', async () => {
        const all = await port.suggestions();
        const earlier = all.filter((s) => s.categoryId === 'level');
        const late = all.filter((s) => s.categoryId === 'caveat');
        const country = {
            ...all[0],
            conceptId: 'region-a',
            categoryId: 'regions',
            group: 'Regions',
        };
        const original = port.categories.bind(port);
        port.categories = () => [
            ...original(),
            { id: 'regions', label: 'Regions', single: false, required: false },
        ];
        port.suggestions = async (live) =>
            live?.length
                ? [...earlier, country, ...late]
                : [...earlier, country];
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        c.close();
        await c.open();
        expect(c.snapshot().groups.map((g) => g.label)).toEqual([
            'Level',
            'Caveat',
            'Regions',
        ]);
        c.scopeTo('caveat');
        expect(c.snapshot().categories.map((category) => category.id)).toEqual([
            'level',
            'caveat',
            'regions',
        ]);
        expect(
            c
                .snapshot()
                .rows.every(
                    (r) =>
                        r.kind === 'concept' &&
                        r.suggestion.categoryId === 'caveat',
                ),
        ).toBe(true);
        expect(c.snapshot().text).toBe('SECRET');
        expect(port.stored).toHaveLength(0);
        c.scopeTo(null);
        expect(c.snapshot().groups.map((g) => g.label)).toEqual([
            'Level',
            'Caveat',
            'Regions',
        ]);
        c.dispose();
    });

    it.each(['whole', 'additive'] as const)(
        'completes a partial token after category browsing in %s fields',
        async (shape) => {
            const c = controller(shape);
            await c.open();
            await typed(c, 'SECRET//ORC');
            c.scopeTo('caveat');
            await c.activate(
                c
                    .snapshot()
                    .rows.find(
                        (row) =>
                            row.kind === 'concept' &&
                            row.suggestion.conceptId === 'OC',
                    )!,
            );
            expect(c.snapshot().text).toBe(
                shape === 'whole' ? 'SECRET//ORCON' : '',
            );
            expect(c.snapshot().reading?.unmatched).toEqual([]);
            expect(port.stored).toHaveLength(0);
            expect(await c.enter()).toBe('stored');
            expect(port.stored).toHaveLength(1);
            expect(port.value.rendered).toBe('SECRET//ORCON');
            c.dispose();
        },
    );

    it.each(['whole', 'additive'] as const)(
        'preserves unrelated unread text when completing after browsing in %s fields',
        async (shape) => {
            const c = controller(shape);
            await c.open();
            await typed(c, 'SECRET//garbage//ORC');
            c.scopeTo('caveat');
            await c.activate(
                c
                    .snapshot()
                    .rows.find(
                        (row) =>
                            row.kind === 'concept' &&
                            row.suggestion.conceptId === 'OC',
                    )!,
            );
            expect(
                c
                    .snapshot()
                    .reading?.unmatched.map((fragment) => fragment.text),
            ).toEqual(['garbage']);
            expect(await c.enter()).toBe('invalid');
            expect(port.stored).toHaveLength(0);
            c.dispose();
        },
    );

    it('keeps distinct categories with identical labels separate', async () => {
        const all = await port.suggestions();
        port.suggestions = async () =>
            all.map((row) => ({ ...row, group: 'Shared label' }));
        const c = controller();
        await c.open();
        expect(c.snapshot().groups.map((g) => g.id)).toEqual([
            'g-level',
            'g-caveat',
        ]);
        c.dispose();
    });

    it('drops unavailable categories and clears their selected filter without writing', async () => {
        const all = await port.suggestions();
        port.suggestions = async (live) =>
            live?.length ? all : all.filter((s) => s.categoryId === 'level');
        const c = controller();
        await c.open();
        await typed(c, 'SECRET');
        c.scopeTo('caveat');
        await typed(c, '');
        expect(c.snapshot().categories.map((category) => category.id)).toEqual([
            'level',
        ]);
        expect(c.snapshot().scope).toBeNull();
        expect(port.stored).toHaveLength(0);
        c.dispose();
    });
});

it('keeps declared browse order while required categories remain in the needs strip', async () => {
    const original = port.categories.bind(port);
    port.categories = () => original().reverse();
    const c = controller();
    await c.open();
    expect(c.snapshot().needs.map((n) => n.categoryId)).toEqual(['level']);
    expect(c.snapshot().groups.map((g) => g.label)).toEqual([
        'Caveat',
        'Level',
    ]);
    c.dispose();
});

it('keeps gated-only categories out of the browsing selector', async () => {
    const all = await port.suggestions();
    port.suggestions = async () =>
        all.map((s) => ({ ...s, gated: s.categoryId === 'caveat' }));
    const c = controller();
    await c.open();
    expect(c.snapshot().categories.map((c) => c.id)).toEqual(['level']);
    expect(c.snapshot().gatedRows).toHaveLength(3);
    c.dispose();
});

it('discards a catalog returned after its whole context changed', async () => {
    const original = await port.suggestions();
    let finishOld!: (rows: Suggestion[]) => void;
    let calls = 0;
    port.suggestions = async () =>
        ++calls === 1
            ? new Promise<Suggestion[]>((resolve) => {
                  finishOld = resolve;
              })
            : [];
    const c = controller();
    const opening = c.open();
    await c.refreshContext();
    finishOld(original);
    await opening;
    await c.settle();
    expect(c.snapshot().rows.filter((row) => row.kind === 'concept')).toEqual(
        [],
    );
});

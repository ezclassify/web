/**
 * A stand-in scheme view whose marking spans two scopes: a label line, the
 * default scope, and a record block. Its answers are written out here, the way
 * the engine gives them, so a spec about what a field does with an answer can
 * say exactly which answer it is.
 *
 * The label line writes the level, the groups and the handling. A group's
 * member is collapsed into the group's written name; the owner, a default, and
 * whom the marking is shared with are left out of it. The record block writes
 * the signer and the basis; the trace a signer leaves is left out of it. The
 * rules:
 *
 * - LOW adds STD, which the line writes.
 * - HIGH shares with DISTRICT, which the line leaves out.
 * - GROUP takes in MEMBER, collapsed into GROUP's written name, and adds ANCHOR,
 *   which the line writes beside it.
 * - A signer leaves TRACE, which no output writes, and cites POLICY when no basis
 *   is given, which the block writes.
 * - HIGH is never STD, so a marking that holds both is invalid.
 *
 * Every render reports what it wrote, left out and collapsed in its assessment,
 * scoped the way the engine scopes it: a form of one surface leaves out every
 * fact of the other.
 */
import type { Assertion, AssertionRef, Change } from '@ezclassify/types';
import { mockRenderFormats } from '../src/render-format-layout-mock';
import { mockScanOutcome } from '../src/engine-result-mock';

const CONCEPTS: Array<[id: string, category: string]> = [
    ['LOW', 'level'],
    ['HIGH', 'level'],
    ['GROUP', 'group'],
    ['MEMBER', 'group'],
    ['ANCHOR', 'group'],
    ['STD', 'handling'],
    ['HOME', 'owner'],
    ['DISTRICT', 'share'],
    ['ALICE', 'signer'],
    ['BOB', 'signer'],
    ['POLICY', 'basis'],
    ['TRACE', 'trace'],
];

const CATEGORIES = [
    { id: 'level', label: 'Level', single: true },
    { id: 'group', label: 'Groups', single: false },
    { id: 'handling', label: 'Handling', single: false },
    { id: 'owner', label: 'Owner', single: true },
    { id: 'share', label: 'Shared with', single: false },
    { id: 'signer', label: 'Signer', single: true, scopes: ['record'] },
    { id: 'basis', label: 'Basis', single: false, scopes: ['record'] },
    { id: 'trace', label: 'Trace', single: true, scopes: ['record'] },
].map((category, position) => ({
    required: false,
    rollup: 'union',
    position,
    ...category,
}));

const LINE = 'label/line';
const BLOCK = 'record/block';
const FORMATS = [
    {
        id: LINE,
        surface: 'label',
        categoryOrder: ['level', 'group', 'handling'],
        separator: '/',
        categorySeparator: '//',
        view: 'default',
    },
    {
        id: BLOCK,
        surface: 'record',
        mode: 'block' as const,
        categoryOrder: ['signer', 'basis'],
        view: 'default',
    },
];

const ref = (a: Pick<Assertion, 'categoryId' | 'conceptId'>): AssertionRef => ({
    categoryId: a.categoryId,
    conceptId: a.conceptId,
});
const categoryOf = (conceptId: string) =>
    CONCEPTS.find(([id]) => id === conceptId)![1];
const derived = (a: Assertion) => a.source !== 'parse' && a.source !== 'user';

/** A fact the author stated. */
export function statedFact(conceptId: string): Assertion {
    return {
        conceptId,
        categoryId: categoryOf(conceptId),
        confidence: 'certain',
        source: 'user',
    };
}

/** The facts a format's surface writes, and how. */
function writtenBy(format: string, holds: readonly Assertion[]) {
    const line = format === LINE || format === '';
    const block = format === BLOCK || format === '';
    const has = (id: string) => holds.some((a) => a.conceptId === id);
    const emitted: AssertionRef[] = [];
    const omitted: AssertionRef[] = [];
    const collapsed: AssertionRef[][] = [];
    for (const fact of holds) {
        const inLine = ['level', 'group', 'handling'].includes(fact.categoryId);
        const inBlock = ['signer', 'basis'].includes(fact.categoryId);
        if (fact.conceptId === 'MEMBER' && has('GROUP') && line)
            collapsed.push([
                ref(fact),
                { categoryId: 'group', conceptId: 'GROUP' },
            ]);
        else if ((inLine && line) || (inBlock && block))
            emitted.push(ref(fact));
        else omitted.push(ref(fact));
    }
    const of = (categories: string[]) =>
        holds
            .filter(
                (a) =>
                    categories.includes(a.categoryId) &&
                    a.conceptId !== 'MEMBER',
            )
            .map((a) => a.conceptId);
    const lineText = line
        ? ['level', 'group', 'handling']
              .map((c) => of([c]).join('/'))
              .filter(Boolean)
              .join('//')
        : '';
    const blockText = block
        ? [
              ...of(['signer']).map((id) => `Signer: ${id}`),
              ...of(['basis']).map((id) => `Basis: ${id}`),
          ].join('\n')
        : '';
    return {
        rendered: [lineText, blockText].filter(Boolean).join('\n'),
        assessment: {
            emitted,
            omitted,
            collapsed,
            conflicts: [],
            unrepresentable: [],
        },
    };
}

/** Settle stated facts the way the scheme's rules do. */
function settle(stated: readonly Assertion[], format: string) {
    const holds: Assertion[] = stated.map((a) => ({ ...a }));
    const appliedFixes: Change[] = [];
    const has = (id: string) => holds.some((a) => a.conceptId === id);
    const add = (conceptId: string, rule: string, named: boolean) => {
        if (has(conceptId)) return;
        const fact: Assertion = {
            conceptId,
            categoryId: categoryOf(conceptId),
            confidence: 'inferred',
            source: 'infer',
            sourceRule: rule,
        };
        holds.push(fact);
        if (named)
            appliedFixes.push({
                ruleId: rule,
                action: 'add',
                add: [ref(fact)],
                message: `Rule "${rule}": added "${conceptId}"`,
            });
    };
    if (!holds.some((a) => a.categoryId === 'owner'))
        holds.push({
            conceptId: 'HOME',
            categoryId: 'owner',
            confidence: 'certain',
            source: 'default',
        });
    if (has('LOW')) add('STD', 'adds-std', true);
    if (has('HIGH')) add('DISTRICT', 'high-shares-district', true);
    if (has('GROUP')) {
        add('MEMBER', 'expands-group', false);
        add('ANCHOR', 'group-adds-anchor', true);
    }
    const signed = holds.some((a) => a.categoryId === 'signer');
    if (signed) {
        add('TRACE', 'signer-leaves-trace', true);
        if (!holds.some((a) => a.categoryId === 'basis'))
            add('POLICY', 'signer-cites-policy', true);
    }
    const errors =
        has('HIGH') && has('STD')
            ? [{ constraintId: 'high-not-std', message: 'HIGH is never STD.' }]
            : [];
    return {
        assertions: holds,
        ...writtenBy(format, holds),
        valid: errors.length === 0,
        inputWasValid: errors.length === 0,
        errors,
        warnings: [],
        appliedFixes,
        proposedFixes: [],
        notices: [],
        recognition: { status: 'complete' as const, unmatched: [] },
    };
}

/** The facts a text states: every concept id it names. */
function read(text: string): Assertion[] {
    const ids: readonly string[] = text.match(/[A-Z_]+/g) ?? [];
    return CONCEPTS.filter(([id]) => ids.includes(id)).map(([id]) =>
        statedFact(id),
    );
}

/**
 * The stand-in scheme view.
 *
 * @returns An object with the scheme view's operations, every answer worked out
 *   by the rules above
 */
export function labelRecordStandIn() {
    const concepts = CONCEPTS.map(([id, category], position) => ({
        id,
        name: id.charAt(0) + id.slice(1).toLowerCase(),
        views: { default: id },
        categories: [category],
        parents: [],
        aliases: [],
        position,
    }));
    const scheme = {
        id: 'label-record',
        version: '1.0.0',
        name: 'Label and record',
        concepts,
        categories: CATEGORIES,
        formats: FORMATS,
        defaultRenderFormat: LINE,
        scopes: [
            { id: 'label', label: 'Label Line' },
            { id: 'record', label: 'Record Block' },
        ],
        defaultScope: 'label',
    };
    const suggestions = concepts.map((c) => ({
        conceptId: c.id,
        categoryId: c.categories[0]!,
        label: c.id,
        name: c.name,
        group: c.categories[0]!,
    }));
    // A read is of a text, or of facts: given as the input or as `assertions`.
    const answer = (
        input: string | Assertion[],
        opts?: { assertions?: Assertion[]; outputFormat?: string },
    ) =>
        settle(
            Array.isArray(input)
                ? input.filter((a) => !derived(a))
                : opts?.assertions && opts.assertions.length > 0
                  ? opts.assertions.filter((a) => !derived(a))
                  : read(input),
            opts?.outputFormat ?? '',
        );
    return {
        getScheme: () => scheme,
        getSchemeMeta: () => ({
            id: scheme.id,
            version: scheme.version,
            name: scheme.name,
            defaultRenderFormat: LINE,
            defaultWholeRenderFormat: LINE,
            formats: mockRenderFormats(FORMATS),
            scopes: scheme.scopes,
            defaultScope: 'label',
        }),
        listCategories: () => CATEGORIES,
        getConceptsInCategory: (categoryId: string) =>
            concepts.filter((c) => c.categories.includes(categoryId)),
        process: answer,
        validate: answer,
        render: (
            assertions: Assertion[],
            format?: string | { format?: string },
        ) =>
            writtenBy(
                typeof format === 'string' ? format : (format?.format ?? ''),
                assertions,
            ),
        scan: () => mockScanOutcome([]),
        suggest: () => ({ suggestions }),
        aggregate: () => ({ rendered: '', assertions: [] }),
        aggregateAssertions: (sets: Assertion[][]) =>
            settle(
                sets.flat().filter((a) => !derived(a)),
                LINE,
            ),
        describeConcept: (conceptId: string) => ({ lines: [conceptId] }),
    };
}

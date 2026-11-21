/**
 * Which categories a field's composer port reports as the ones the field edits.
 * Isolated from any engine: the port reads the scheme's categories and the
 * field's format from what the field hands it.
 */
import { describe, expect, it } from 'vitest';
import type { SchemePublicView } from '@ezclassify/types';
import {
    ComposerController,
    type ComposerReading,
} from './composer-controller';
import { createComposerPort, type ComposerPortField } from './composer-port';
import type { FormatLayoutSource } from '../../format-layout';

it('browses live and base choices alphabetically within their tiers', async () => {
    const categories: SchemePublicView['categories'] = [
        { id: 'tags', label: 'Tags', rollup: 'union', sort: 'alphabetical' },
    ];
    const concept = (id: string, name: string, parent?: string) => ({
        id,
        name,
        parents: parent ? [parent] : [],
        tier: parent ? 'attached' : undefined,
        views: { default: name },
        aliases: [],
        categories: ['tags'],
        position: 0,
    });
    const concepts = [
        concept('root', 'Delta'),
        concept('other', 'Echo'),
        concept('child', 'Charlie', 'root'),
        concept('sibling', 'Bravo', 'root'),
        concept('leaf', 'Alpha', 'child'),
    ];
    const choices = (ids: string[]) =>
        ids.map((id) => {
            const { name, views } = concepts.find((entry) => entry.id === id)!;
            return {
                conceptId: id,
                categoryId: 'tags',
                label: name,
                description: '',
                name,
                views,
                group: 'Tags',
                order: 0,
                selected: false,
            };
        });
    const reading: ComposerReading = {
        assertions: [
            {
                conceptId: 'child',
                categoryId: 'tags',
                source: 'input',
                confidence: 'certain',
            },
        ],
        rendered: 'Charlie',
        complete: true,
        valid: true,
        errors: [],
        warnings: [],
        proposedFixes: [],
        appliedFixes: [],
        unmatched: [],
        corrections: [],
    };
    let rootOnly = false;
    let releaseLive: (() => void) | undefined;
    const port = createComposerPort({
        shape: 'whole',
        binding: {
            process: async () => {
                throw new Error('unused');
            },
        },
        scheme: () => ({ categories, concepts }),
        meta: () => ({}),
        formatId: () => 'demo',
        suggestions: async (live) => {
            if (rootOnly) return choices(['other', 'root']);
            if (!live) return choices(['child', 'root', 'other']);
            await new Promise<void>((resolve) => {
                releaseLive = resolve;
            });
            return choices(['leaf', 'sibling', 'child', 'root', 'other']);
        },
        gated: async () => [],
        committed: () => ({
            assertions: reading.assertions,
            rendered: reading.rendered,
        }),
        store: async () => {},
    });
    const browseIds = async () => {
        const picker = new ComposerController({
            port: {
                ...port,
                read: async () =>
                    rootOnly ? { ...reading, assertions: [] } : reading,
                render: async () => reading,
            },
            shape: 'whole',
        });
        await picker.open();
        await picker.settle();
        const other = picker
            .snapshot()
            .rows.findIndex(
                (row) =>
                    row.kind === 'concept' &&
                    row.suggestion.conceptId === 'other',
            );
        const activeId = picker.snapshot().rows[other]?.id;
        expect(activeId).toBeDefined();
        picker.setActive(other);
        if (releaseLive) {
            await new Promise<void>((resolve) => {
                const unsubscribe = picker.subscribe(() => {
                    unsubscribe();
                    resolve();
                });
                releaseLive?.();
                releaseLive = undefined;
            });
            expect(picker.activeRow()?.id).toBe(activeId);
        }
        const ids = picker
            .snapshot()
            .rows.flatMap((row) =>
                row.kind === 'concept' ? [row.suggestion.conceptId] : [],
            );
        picker.dispose();
        return ids;
    };
    expect(await browseIds()).toEqual([
        'root',
        'sibling',
        'child',
        'leaf',
        'other',
    ]);

    rootOnly = true;
    expect(await browseIds()).toEqual(['root', 'other']);

    rootOnly = false;
    categories[0]!.sort = 'position';
    expect(await browseIds()).toEqual([
        'child',
        'root',
        'other',
        'leaf',
        'sibling',
    ]);
});

const categories = [
    { id: 'level', label: 'Level', required: true, rollup: 'max' },
    { id: 'sharing', label: 'Sharing', rollup: 'union' },
    {
        id: 'handling',
        label: 'Handling',
        rollup: 'union',
        scopes: ['sensitivity'],
    },
    {
        id: 'keep',
        label: 'Keep for',
        required: true,
        rollup: 'max',
        scopes: ['retention'],
    },
] as SchemePublicView['categories'];

/** Two surfaces; a request that names no output writes `sensitivity`. */
const meta = {
    formats: [
        { id: 'sensitivity/full', surface: 'sensitivity' },
        { id: 'retention/block', surface: 'retention' },
    ],
    defaultRenderFormat: 'sensitivity/full',
} as unknown as FormatLayoutSource;

function categoryIds(
    formatId: string,
    declared: { categoryId?: string; scope?: string } = {},
    source: FormatLayoutSource = meta,
): string[] {
    const field = {
        shape: 'whole',
        binding: { process: async () => ({}) },
        scheme: () => ({ categories, concepts: [] }),
        meta: () => source,
        formatId: () => formatId,
        scope: () => declared.scope,
        categoryId: () => declared.categoryId,
    } as unknown as ComposerPortField;
    return createComposerPort(field)
        .categories()
        .map((c) => c.id);
}

describe('the categories a composer port reports', () => {
    it("are those of the default surface's field and the marking's own", () => {
        expect(categoryIds('sensitivity/full')).toEqual([
            'level',
            'sharing',
            'handling',
        ]);
    });

    it("are only the scoped ones of another surface's field", () => {
        expect(categoryIds('retention/block')).toEqual(['keep']);
    });

    it('follow the surface a field declares over its format', () => {
        expect(categoryIds('sensitivity/full', { scope: 'retention' })).toEqual(
            ['keep'],
        );
    });

    it('are every category when the format names no surface the metadata lists', () => {
        expect(categoryIds('sensitivity/short')).toEqual([
            'level',
            'sharing',
            'handling',
            'keep',
        ]);
    });

    it('are only the bound category for a field bound to one', () => {
        expect(
            categoryIds('sensitivity/full', { categoryId: 'level' }),
        ).toEqual(['level']);
        expect(categoryIds('sensitivity/full', { categoryId: 'keep' })).toEqual(
            [],
        );
    });
});

it('orders categories by the active format before stable scheme-order fallbacks', () => {
    const source = {
        ...meta,
        formats: [
            {
                id: 'sensitivity/full',
                surface: 'sensitivity',
                categoryOrder: ['handling', 'level'],
            },
            {
                id: 'sensitivity/short',
                surface: 'sensitivity',
                categoryOrder: ['sharing', 'handling'],
            },
        ],
    } as FormatLayoutSource;
    expect(categoryIds('sensitivity/full', {}, source)).toEqual([
        'handling',
        'level',
        'sharing',
    ]);
    expect(categoryIds('sensitivity/short', {}, source)).toEqual([
        'sharing',
        'handling',
        'level',
    ]);
    expect(source.formats?.[0].categoryOrder).toEqual(['handling', 'level']);
});

describe('a composer port for a field that lists several scopes', () => {
    const scoped = {
        ...meta,
        scopes: [
            { id: 'sensitivity', label: 'Sensitivity' },
            { id: 'retention', label: 'Retention' },
        ],
        defaultScope: 'sensitivity',
    };
    const port = (scopes: string[]) =>
        createComposerPort({
            shape: 'whole',
            binding: { process: async () => ({}) },
            scheme: () => ({ categories, concepts: [] }),
            meta: () => scoped,
            formatId: () => 'sensitivity/full',
            scopes: () => scopes,
        } as unknown as ComposerPortField);

    it("reports every listed scope's categories, scope by scope, each with its scope's label", () => {
        // Listed out of order on purpose: the scheme declares sensitivity first.
        expect(
            port(['retention', 'sensitivity'])
                .categories()
                .map((c) => [c.scope, c.id]),
        ).toEqual([
            ['Sensitivity', 'level'],
            ['Sensitivity', 'sharing'],
            ['Sensitivity', 'handling'],
            ['Retention', 'keep'],
        ]);
    });

    it('names no scope for a field that lists one', () => {
        expect(
            port(['sensitivity'])
                .categories()
                .map((c) => [c.scope, c.id]),
        ).toEqual([
            [undefined, 'level'],
            [undefined, 'sharing'],
            [undefined, 'handling'],
        ]);
    });
});

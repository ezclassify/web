import { describe, it, expect, vi } from 'vitest';
import {
    captureFormState,
    restoreFormState,
    exportFormState,
    importFormState,
    FormState,
} from './serialization';

function createMockForms(
    options: {
        fields?: Array<{ id?: string; name?: string; value?: string }>;
        schemeId?: string;
        schemeVersion?: string;
        defaultFormat?: string;
    } = {},
) {
    const {
        fields: fieldConfigs = [],
        schemeId = 'test-profile',
        schemeVersion = '1.0',
        defaultFormat = 'default',
    } = options;

    const fieldElements = fieldConfigs.map((f) => {
        const el = document.createElement('input') as HTMLInputElement;
        if (f.id) el.id = f.id;
        if (f.name) el.name = f.name;
        if (f.value) el.value = f.value;
        return el;
    });

    const _profile = {
        id: schemeId,
        version: schemeVersion,
        categories: [] as any[],
        concepts: [] as any[],
        formats: [] as any[],
        scopes: [] as any[],
    };
    const engine = {
        getScheme: () => _profile,
        getSchemeMeta: () => ({
            id: schemeId,
            version: schemeVersion,
            name: schemeId,
            defaultRenderFormat: defaultFormat,
            formats: [],
            scopes: [],
        }),
        listCategories: () => _profile.categories,
        getConceptsInCategory: (_catId: string) => [],
        validate: vi.fn((value: string) => ({
            assertions: value ? [{ conceptId: 'c1', categoryId: 'f1' }] : [],
            rendered: value,
            valid: true,
        })),
    };

    const forms = {
        engine,
        fields: fieldElements,
        defaultFormat,
        getRollup: vi.fn().mockReturnValue('rollup-value'),
        recalculate: vi.fn(),
    };

    return { forms: forms as any, fieldElements, engine };
}

describe('serialization', () => {
    describe('captureFormState', () => {
        it('captures basic form state', async () => {
            const { forms } = createMockForms({
                fields: [{ id: 'field1', value: 'test-value' }],
            });

            const state = await captureFormState(forms);
            expect(state.schemeId).toBe('test-profile');
            expect(state.schemeVersion).toBe('1.0');
            expect(state.rollup).toBe('rollup-value');
            expect(state.fields).toHaveLength(1);
            expect(state.timestamp).toBeDefined();
        });

        it('captures field id and value', async () => {
            const { forms } = createMockForms({
                fields: [{ id: 'f1', value: 'val1' }],
            });

            const state = await captureFormState(forms);
            expect(state.fields[0].id).toBe('f1');
            expect(state.fields[0].value).toBe('val1');
        });

        it('captures field name when no id', async () => {
            const { forms } = createMockForms({
                fields: [{ name: 'fname', value: 'v' }],
            });

            const state = await captureFormState(forms);
            expect(state.fields[0].id).toBe('fname');
        });

        it('captures conceptIds from engine.validate', async () => {
            const { forms } = createMockForms({
                fields: [{ id: 'f1', value: 'some-val' }],
            });

            const state = await captureFormState(forms);
            expect(state.fields[0].conceptIds).toEqual(['c1']);
        });

        it('returns empty conceptIds for empty values', async () => {
            const { forms } = createMockForms({
                fields: [{ id: 'f1', value: '' }],
            });

            const state = await captureFormState(forms);
            expect(state.fields[0].conceptIds).toEqual([]);
            expect(state.fields[0].valid).toBe(true);
        });

        it('captures multiple fields', async () => {
            const { forms } = createMockForms({
                fields: [
                    { id: 'f1', value: 'v1' },
                    { id: 'f2', value: 'v2' },
                    { id: 'f3', value: '' },
                ],
            });

            const state = await captureFormState(forms);
            expect(state.fields).toHaveLength(3);
        });

        it('includes ISO timestamp', async () => {
            const { forms } = createMockForms({ fields: [] });
            const state = await captureFormState(forms);
            expect(state.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('restoreFormState', () => {
        it('matches fields by id and sets values', async () => {
            const { forms, fieldElements } = createMockForms({
                fields: [{ id: 'f1', value: '' }],
            });

            const state: FormState = {
                version: 1,
                fields: [
                    {
                        id: 'f1',
                        value: 'restored',
                        conceptIds: [],
                        assertions: [],
                        valid: true,
                    },
                ],
                rollup: '',
                schemeId: 'p',
                schemeVersion: '1',
                timestamp: '',
            };

            restoreFormState(forms, state);
            expect(fieldElements[0].value).toBe('restored');
            expect(forms.recalculate).toHaveBeenCalled();
        });

        it('matches fields by name', async () => {
            const { forms, fieldElements } = createMockForms({
                fields: [{ name: 'fname', value: '' }],
            });

            const state: FormState = {
                version: 1,
                fields: [
                    {
                        id: 'fname',
                        value: 'by-name',
                        conceptIds: [],
                        assertions: [],
                        valid: true,
                    },
                ],
                rollup: '',
                schemeId: 'p',
                schemeVersion: '1',
                timestamp: '',
            };

            restoreFormState(forms, state);
            expect(fieldElements[0].value).toBe('by-name');
        });

        it('skips missing fields', async () => {
            const { forms } = createMockForms({ fields: [] });

            const state: FormState = {
                version: 1,
                fields: [
                    {
                        id: 'missing',
                        value: 'val',
                        conceptIds: [],
                        assertions: [],
                        valid: true,
                    },
                ],
                rollup: '',
                schemeId: 'p',
                schemeVersion: '1',
                timestamp: '',
            };

            // should not throw
            restoreFormState(forms, state);
            expect(forms.recalculate).toHaveBeenCalled();
        });
    });

    describe('exportFormState', () => {
        it('returns JSON string', async () => {
            const { forms } = createMockForms({
                fields: [{ id: 'f1', value: 'val' }],
            });

            const json = await exportFormState(forms);
            const parsed = JSON.parse(json);
            expect(parsed.fields).toBeDefined();
            expect(parsed.schemeId).toBe('test-profile');
        });

        it('produces formatted JSON', async () => {
            const { forms } = createMockForms({ fields: [] });
            const json = await exportFormState(forms);
            expect(json).toContain('\n');
        });
    });

    describe('importFormState', () => {
        it('parses JSON and restores state', async () => {
            const { forms, fieldElements } = createMockForms({
                fields: [{ id: 'f1', value: '' }],
            });

            const state: FormState = {
                version: 1,
                fields: [
                    {
                        id: 'f1',
                        value: 'imported',
                        conceptIds: [],
                        assertions: [],
                        valid: true,
                    },
                ],
                rollup: '',
                schemeId: 'test-profile',
                schemeVersion: '1',
                timestamp: '',
            };

            importFormState(forms, JSON.stringify(state));
            expect(fieldElements[0].value).toBe('imported');
        });

        it('throws on invalid JSON', async () => {
            const { forms } = createMockForms({ fields: [] });
            expect(() => importFormState(forms, 'invalid')).toThrow();
        });
    });

    // The version gate alone is not enough: a snapshot can claim version 1 and
    // still be structurally broken. Each malformed shape must fail closed at
    // the importFormState boundary with the clear shape error, never as a
    // downstream TypeError inside restore or the store.
    describe('importFormState: malformed version-1 snapshots fail closed', () => {
        const base = {
            version: 1,
            rollup: '',
            schemeId: 'test-profile',
            schemeVersion: '1',
            timestamp: '',
        };
        const field = {
            id: 'f1',
            value: 'v',
            conceptIds: [] as string[],
            assertions: [] as unknown[],
            valid: true,
        };

        function without(entry: typeof field, key: keyof typeof field) {
            const copy: Record<string, unknown> = { ...entry };
            delete copy[key];
            return copy;
        }

        function expectShapeError(snapshot: unknown, message: RegExp) {
            const { forms } = createMockForms({
                fields: [{ id: 'f1', value: '' }],
            });
            let thrown: unknown;
            try {
                importFormState(forms, JSON.stringify(snapshot));
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(Error);
            expect(thrown).not.toBeInstanceOf(TypeError);
            expect((thrown as Error).message).toMatch(message);
            // Fail closed: nothing was restored.
            expect(forms.recalculate).not.toHaveBeenCalled();
        }

        it('rejects a snapshot that is not a JSON object', () => {
            expectShapeError(null, /not a JSON object/);
            expectShapeError(42, /not a JSON object/);
        });

        it('rejects a snapshot with no fields key', () => {
            expectShapeError(base, /'fields' is not an array/);
        });

        it('rejects a snapshot whose fields is not an array', () => {
            expectShapeError(
                { ...base, fields: 'f1' },
                /'fields' is not an array/,
            );
            expectShapeError(
                { ...base, fields: { f1: field } },
                /'fields' is not an array/,
            );
        });

        it('rejects a field entry that is not an object', () => {
            expectShapeError(
                { ...base, fields: [null] },
                /fields\[0\] is not an object/,
            );
        });

        it('rejects a field entry with a missing or non-string id', () => {
            expectShapeError(
                { ...base, fields: [without(field, 'id')] },
                /fields\[0\]\.id is not a string/,
            );
        });

        it('rejects a field entry with a missing or non-string value', () => {
            expectShapeError(
                { ...base, fields: [without(field, 'value')] },
                /fields\[0\]\.value is not a string/,
            );
        });

        it('rejects a field entry with missing or non-array conceptIds', () => {
            expectShapeError(
                { ...base, fields: [without(field, 'conceptIds')] },
                /fields\[0\]\.conceptIds is not an array/,
            );
        });

        it('rejects a field entry with missing or non-array assertions', () => {
            expectShapeError(
                { ...base, fields: [without(field, 'assertions')] },
                /fields\[0\]\.assertions is not an array/,
            );
            expectShapeError(
                { ...base, fields: [{ ...field, assertions: 'SECRET' }] },
                /fields\[0\]\.assertions is not an array/,
            );
        });

        it('rejects a field entry with a missing or non-boolean valid flag', () => {
            expectShapeError(
                { ...base, fields: [without(field, 'valid')] },
                /fields\[0\]\.valid is not a boolean/,
            );
        });

        it('flags the offending index in a mixed-fields snapshot', () => {
            expectShapeError(
                {
                    ...base,
                    fields: [
                        field,
                        without({ ...field, id: 'f2' }, 'assertions'),
                    ],
                },
                /fields\[1\]\.assertions is not an array/,
            );
        });
    });
});

// ---------------------------------------------------------------------------
// B8, structural capture/restore round-trip (scoped facet + default field +
// capture value). captureFormState/restoreFormState now serialize the store's
// structured assertion arrays instead of re-deriving from a lossy render, so
// alternate-scope selections and capture-value free text survive export→import
// into a fresh mount.
// ---------------------------------------------------------------------------

describe('serialization: structural round-trip (B8)', () => {
    // Scheme: default scope `marking` (category `banner`); alternate scope
    // `authority` (categories `authority_type`, `declass_on`). The banner render
    // emits only default-scope categories and never a capture value, so a
    // projection through it would drop scoped + captured state.
    const CATEGORIES = [
        { id: 'banner', scopes: undefined },
        { id: 'authority_type', scopes: ['authority'] },
        { id: 'declass_on', scopes: ['authority'] },
    ];
    const DEFAULT_SCOPE = new Set(['banner']);

    function scopedEngine() {
        return {
            process(input: any) {
                const assertions: any[] = Array.isArray(input) ? input : [];
                const rendered = assertions
                    .filter((a) => DEFAULT_SCOPE.has(a.categoryId))
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' ');
                return { rendered, assertions, valid: true, errors: [] };
            },
            render(assertions: any[]) {
                return assertions
                    .filter((a) => DEFAULT_SCOPE.has(a.categoryId))
                    .map((a) => `${a.categoryId}:${a.conceptId}`)
                    .join(' ');
            },
            aggregate: () => ({
                rendered: '',
                assertions: [],
                valid: true,
                errors: [],
            }),
            aggregateAssertions(sets: any[][]) {
                const merged = sets.flat();
                return {
                    rendered: merged
                        .filter((a) => DEFAULT_SCOPE.has(a.categoryId))
                        .map((a) => `${a.categoryId}:${a.conceptId}`)
                        .join(' '),
                    assertions: merged,
                    valid: true,
                    errors: [],
                };
            },
            getSchemeMeta: () => ({
                id: 'gov',
                version: '1.0',
                defaultScope: 'marking',
                scopes: [{ id: 'marking' }, { id: 'authority' }],
            }),
            listCategories: () => CATEGORIES,
        };
    }

    /**
     * Minimal forms-shaped host wrapping a real store, for the serialization
     * API.
     */
    async function buildForms(store: any, engine: any) {
        const field = document.createElement('input') as HTMLInputElement;
        field.id = 'gov-doc';
        return {
            engine,
            store,
            fields: [field],
            defaultFormat: '',
            getRollup: () => store.get('gov-doc').rendered,
            recalculate: () => {},
        } as any;
    }

    it('captures + restores a scoped facet, a default field, and a capture value into a fresh mount', async () => {
        const { VanillaEzClassifyStore } =
            await import('./store/ezclassify-store');
        const engine = scopedEngine();
        const storeA = new VanillaEzClassifyStore(engine as any);
        const formsA = await buildForms(storeA, engine);

        // Publish: default-scope banner + scoped authority facet + scoped capture value.
        await storeA.publishAssertions('gov-doc', [
            { categoryId: 'banner', conceptId: 'SECRET' } as any,
            { categoryId: 'authority_type', conceptId: 'ORIGINAL' } as any,
            {
                categoryId: 'declass_on',
                conceptId: 'DECLASS_DATE',
                value: '20301231',
            } as any,
        ]);

        const snapshot = await captureFormState(formsA);
        // The snapshot carries the structured assertions, not just a string.
        expect(snapshot.version).toBe(1);
        const saved = snapshot.fields.find((f) => f.id === 'gov-doc');
        expect(saved?.assertions).toBeDefined();

        // Restore into a FRESH store + mount.
        const storeB = new VanillaEzClassifyStore(engine as any);
        const formsB = await buildForms(storeB, engine);
        restoreFormState(formsB, snapshot);
        await Promise.resolve();

        const restored = storeB.get('gov-doc').assertions as any[];
        const key = (a: any) => `${a.categoryId}:${a.conceptId}`;
        // All three survive.
        expect(restored.map(key).sort()).toEqual([
            'authority_type:ORIGINAL',
            'banner:SECRET',
            'declass_on:DECLASS_DATE',
        ]);
        // The capture value survives byte-identically.
        expect(restored.find((a) => a.categoryId === 'declass_on')?.value).toBe(
            '20301231',
        );
        // The banner string never carried the scoped/captured state.
        expect(storeB.get('gov-doc').rendered).toBe('banner:SECRET');
    });

    it('reports a rejected restore publish instead of leaking the rejection', async () => {
        const { VanillaEzClassifyStore } =
            await import('./store/ezclassify-store');
        const engine = scopedEngine();
        const store = new VanillaEzClassifyStore(engine as any);
        const forms = await buildForms(store, engine);

        // A publish that rejects the way a REST client does on a transient
        // failure. Unhandled, this takes a Node or SSR host down; the restore
        // path has to report it and let the previous value stand.
        const failure = new Error('publish failed');
        vi.spyOn(store, 'publishAssertions').mockRejectedValue(failure);
        const errors = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            restoreFormState(forms, {
                version: 1,
                fields: [
                    {
                        id: 'gov-doc',
                        value: 'banner:SECRET',
                        conceptIds: ['SECRET'],
                        assertions: [
                            {
                                categoryId: 'banner',
                                conceptId: 'SECRET',
                            } as any,
                        ],
                        valid: true,
                    },
                ],
                rollup: '',
                schemeId: 'gov',
                schemeVersion: '1.0',
                timestamp: '',
            });
            await Promise.resolve();
            await Promise.resolve();

            expect(errors).toHaveBeenCalledTimes(1);
            expect(errors.mock.calls[0][0]).toContain('restoreFormState');
            expect(errors.mock.calls[0][0]).toContain('gov-doc');
            expect(errors.mock.calls[0][1]).toBe(failure);
        } finally {
            errors.mockRestore();
        }
    });

    it('importFormState rejects a snapshot whose shape version is not current', async () => {
        const { VanillaEzClassifyStore } =
            await import('./store/ezclassify-store');
        const engine = scopedEngine();
        const store = new VanillaEzClassifyStore(engine as any);
        const forms = await buildForms(store, engine);

        // A snapshot without a version field (or with a foreign one) is not a
        // shape this build understands. Reads fail closed instead of guessing.
        const versionless = {
            fields: [
                {
                    id: 'gov-doc',
                    value: 'banner:SECRET',
                    conceptIds: ['SECRET'],
                    valid: true,
                },
            ],
            rollup: '',
            schemeId: 'gov',
            schemeVersion: '1.0',
            timestamp: '',
        };
        expect(() =>
            importFormState(forms, JSON.stringify(versionless)),
        ).toThrow(/shape version/);
        expect(() =>
            importFormState(
                forms,
                JSON.stringify({ ...versionless, version: 99 }),
            ),
        ).toThrow(/shape version/);
    });

    it('importFormState rejects a version-1 snapshot missing assertions before the store sees it', async () => {
        const { VanillaEzClassifyStore } =
            await import('./store/ezclassify-store');
        const engine = scopedEngine();
        const store = new VanillaEzClassifyStore(engine as any);
        const forms = await buildForms(store, engine);
        const publish = vi.spyOn(store, 'publishAssertions');

        // A snapshot claiming the current version still needs fields[].assertions.
        // Shape validation must refuse it before store publication.
        const noAssertions = {
            version: 1,
            fields: [
                {
                    id: 'gov-doc',
                    value: 'banner:SECRET',
                    conceptIds: ['SECRET'],
                    valid: true,
                },
            ],
            rollup: '',
            schemeId: 'gov',
            schemeVersion: '1.0',
            timestamp: '',
        };
        expect(() =>
            importFormState(forms, JSON.stringify(noAssertions)),
        ).toThrow(/assertions is not an array/);
        expect(publish).not.toHaveBeenCalled();
    });
});

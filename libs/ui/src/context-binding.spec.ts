import { describe, it, expect, beforeEach } from 'vitest';
import type {
    ContextAdapter,
    ContextSchemeDescriptor,
    ContextSchemeEngineAdapter,
} from '@ezclassify/types';
import {
    bucketKey,
    ContextResolutionError,
    ContextSet,
    contextForScheme,
    contextStoreBuckets,
    PRIMARY_SCHEME_SELECTOR,
    schemeEngineOf,
} from './context-binding';

/** A Context that holds the given schemes, primary first. */
function contextHolding(
    schemes:
        ContextSchemeDescriptor[] | (() => Promise<ContextSchemeDescriptor[]>),
): ContextAdapter {
    const unavailable = () => {
        throw new Error('not used by Context resolution');
    };
    const viewOf = (id: string, format: string) =>
        ({
            getScheme: () => ({ id }),
            getSchemeMeta: () => ({ defaultRenderFormat: format }),
        }) as unknown as ContextSchemeEngineAdapter;
    const primary = viewOf('primary-id', 'primary-format');
    // One view per selector the Context holds besides its primary, as a
    // Context caches them; any other selector is refused.
    const views = new Map<string, ContextSchemeEngineAdapter>();
    return {
        connected: true,
        scheme: primary,
        schemeView: (selector: string) => {
            const listed = Array.isArray(schemes)
                ? schemes.find((s) => s.selector === selector)
                : undefined;
            if (!listed || listed.roles.includes('primary'))
                throw new Error(`no scheme view '${selector}'`);
            if (!views.has(selector))
                views.set(selector, viewOf(listed.id, `${selector}-format`));
            return views.get(selector)!;
        },
        describeSchemes:
            typeof schemes === 'function' ? schemes : () => schemes,
        describeCrosswalks: unavailable,
        audit: unavailable,
        checkContextAccess: unavailable,
        accessRequirements: unavailable,
        translate: unavailable,
        destroy: () => {},
    };
}

const CROSSWALK_SCHEMES: ContextSchemeDescriptor[] = [
    {
        selector: 'base',
        id: 'scheme-a',
        version: '1.0.0',
        roles: ['primary', 'crosswalk-source'],
    },
    {
        selector: 'tier',
        id: 'scheme-b',
        version: '1.0.0',
        roles: ['crosswalk-target'],
    },
];

/** `<root><section ctx=...><input></section></root>` with the attrs given. */
function tree(attrs: {
    root?: Record<string, string>;
    section?: Record<string, string>;
}) {
    const root = document.createElement('div');
    const section = document.createElement('section');
    const field = document.createElement('input');
    for (const [k, v] of Object.entries(attrs.root ?? {}))
        root.setAttribute(k, v);
    for (const [k, v] of Object.entries(attrs.section ?? {}))
        section.setAttribute(k, v);
    section.appendChild(field);
    root.appendChild(section);
    document.body.appendChild(root);
    return { root, section, field };
}

function resolutionError(run: () => unknown): ContextResolutionError {
    try {
        run();
    } catch (err) {
        if (err instanceof ContextResolutionError) return err;
        throw err;
    }
    throw new Error('expected a ContextResolutionError');
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('ContextSet initialization', () => {
    it('takes one Context, or several under keys', () => {
        const one = ContextSet.from(contextHolding(CROSSWALK_SCHEMES));
        expect(one.single).toBe(true);

        const several = ContextSet.from({
            contexts: {
                capco: contextHolding(CROSSWALK_SCHEMES),
                cui: contextHolding(CROSSWALK_SCHEMES),
            },
        });
        expect(several.single).toBe(false);
        expect(several.keys).toEqual(['capco', 'cui']);
    });

    it('refuses a scheme view, an empty map, a blank key, and a non-Context value', () => {
        const scheme = contextHolding(CROSSWALK_SCHEMES).scheme;
        expect(() => ContextSet.from(scheme as never)).toThrow(TypeError);
        expect(() => ContextSet.from({ contexts: {} })).toThrow(
            /names no Context/,
        );
        expect(() =>
            ContextSet.from({
                contexts: { ' ': contextHolding(CROSSWALK_SCHEMES) },
            }),
        ).toThrow(/cannot be named in markup/);
        expect(() =>
            ContextSet.from({ contexts: { capco: scheme as never } }),
        ).toThrow(/contexts.capco is not a Context/);
    });
});

describe('ContextSet.resolve', () => {
    it('gives a single-Context instance its Context and primary scheme with no markup', () => {
        const context = contextHolding(CROSSWALK_SCHEMES);
        const set = ContextSet.from(context);
        set.load();
        const { root, field } = tree({});

        const resolved = set.resolve(field, root);

        expect(resolved.context).toBe(context);
        expect(resolved.primary).toBe(true);
        expect(resolved.bucket).toBe(bucketKey('', ''));
    });

    it('refuses data-ezclassify-context on a single-Context instance', () => {
        const set = ContextSet.from(contextHolding(CROSSWALK_SCHEMES));
        const { root, field } = tree({
            section: { 'data-ezclassify-context': 'capco' },
        });

        const err = resolutionError(() => set.resolve(field, root));

        expect(err.code).toBe('context-unresolved');
        expect(err.message).toMatch(/given one Context/);
    });

    it('resolves the nearest ancestor key among several Contexts', () => {
        const capco = contextHolding(CROSSWALK_SCHEMES);
        const cui = contextHolding(CROSSWALK_SCHEMES);
        const set = ContextSet.from({ contexts: { capco, cui } });
        const { root, field } = tree({
            root: { 'data-ezclassify-context': 'capco' },
            section: { 'data-ezclassify-context': 'cui' },
        });

        const resolved = set.resolve(field, root);

        expect(resolved.context).toBe(cui);
        expect(resolved.bucket).toBe(bucketKey('cui', ''));
        expect(set.resolve(root, root).context).toBe(capco);
    });

    it('takes no implicit default among several Contexts', () => {
        const set = ContextSet.from({
            contexts: {
                capco: contextHolding(CROSSWALK_SCHEMES),
                cui: contextHolding(CROSSWALK_SCHEMES),
            },
        });
        const { root, field } = tree({});

        const err = resolutionError(() => set.resolve(field, root));

        expect(err.code).toBe('context-unresolved');
        expect(err.message).toContain("'capco', 'cui'");
    });

    it('mounts a bucket list with no Context in markup, and honors one that is named', () => {
        const capco = contextHolding(CROSSWALK_SCHEMES);
        const cui = contextHolding(CROSSWALK_SCHEMES);
        const set = ContextSet.from({ contexts: { capco, cui } });
        const bare = tree({});
        const named = tree({ section: { 'data-ezclassify-context': 'cui' } });

        expect(set.resolveBucketList(bare.field, bare.root).context).toBe(
            capco,
        );
        expect(set.resolveBucketList(named.field, named.root).context).toBe(
            cui,
        );
    });

    it('refuses a key the instance does not hold', () => {
        const set = ContextSet.from({
            contexts: { capco: contextHolding(CROSSWALK_SCHEMES) },
        });
        const { root, field } = tree({
            section: { 'data-ezclassify-context': 'cui' },
        });

        expect(resolutionError(() => set.resolve(field, root)).message).toMatch(
            /names no Context this EzClassifyUI holds \('capco'\)/,
        );
    });

    it('reads no markup above the instance root', () => {
        const set = ContextSet.from(contextHolding(CROSSWALK_SCHEMES));
        const { root, field } = tree({});
        const outer = document.createElement('div');
        outer.setAttribute('data-ezclassify-context', 'capco');
        outer.setAttribute('data-ezclassify-scheme', 'tier');
        document.body.appendChild(outer);
        outer.appendChild(root);

        expect(set.resolve(field, root).bucket).toBe(bucketKey('', ''));
    });

    it('reads a declared primary selector as the primary bucket', () => {
        const set = ContextSet.from(contextHolding(CROSSWALK_SCHEMES));
        set.load();
        const { root, field } = tree({
            section: { 'data-ezclassify-scheme': 'base' },
        });

        const resolved = set.resolve(field, root);

        expect(resolved.primary).toBe(true);
        expect(resolved.bucket).toBe(bucketKey('', ''));
    });

    it('resolves another scheme of the Context to its own bucket, read by that scheme view', () => {
        const context = contextHolding(CROSSWALK_SCHEMES);
        const set = ContextSet.from(context);
        set.load();
        const { root, field } = tree({
            section: { 'data-ezclassify-scheme': 'tier' },
        });

        const resolved = set.resolve(field, root);

        expect(resolved.primary).toBe(false);
        expect(resolved.bucket).toBe(bucketKey('', 'tier'));
        const engine = schemeEngineOf(resolved, field);
        expect(engine).toBe(context.schemeView('tier'));
        expect(engine).not.toBe(context.scheme);
        expect(engine.getScheme().id).toBe('scheme-b');
    });

    it('refuses a scheme whose view the Context will not give, never reading it as the primary', () => {
        const context = contextHolding(CROSSWALK_SCHEMES);
        const { field } = tree({});

        const err = resolutionError(() =>
            schemeEngineOf(
                {
                    contextKey: '',
                    context,
                    schemeSelector: 'other',
                    primary: false,
                    bucket: bucketKey('', 'other'),
                },
                field,
            ),
        );

        expect(err.code).toBe('scheme-unresolved');
        expect(err.element).toBe(field);
    });

    it('refuses a selector the Context does not hold, naming the ones it does', () => {
        const set = ContextSet.from(contextHolding(CROSSWALK_SCHEMES));
        set.load();
        const { root, field } = tree({
            section: { 'data-ezclassify-scheme': 'other' },
        });

        const err = resolutionError(() => set.resolve(field, root));

        expect(err.code).toBe('scheme-unresolved');
        expect(err.message).toContain('base, tier');
    });

    it('holds a declared selector until a remote Context has listed its schemes', async () => {
        const set = ContextSet.from(
            contextHolding(async () => CROSSWALK_SCHEMES),
        );
        const { root, field } = tree({
            section: { 'data-ezclassify-scheme': 'tier' },
        });

        const listing = set.load();
        expect(resolutionError(() => set.resolve(field, root)).code).toBe(
            'scheme-pending',
        );
        // The primary needs no list.
        expect(set.resolve(root, root).bucket).toBe(bucketKey('', ''));

        await listing;
        expect(set.resolve(field, root).bucket).toBe(bucketKey('', 'tier'));
    });

    it('refuses a declared selector when the Context cannot list its schemes', async () => {
        const set = ContextSet.from(
            contextHolding(async () => {
                throw new Error('offline');
            }),
        );
        const { root, field } = tree({
            section: { 'data-ezclassify-scheme': 'tier' },
        });

        await set.load();

        const err = resolutionError(() => set.resolve(field, root));
        expect(err.code).toBe('scheme-unresolved');
        expect(err.message).toContain('offline');
        expect(set.resolve(root, root).primary).toBe(true);
    });
});

describe('ContextSet.bucketsNamed', () => {
    it('names each Context primary and other schemes, filtered by key and selector', () => {
        const set = ContextSet.from({
            contexts: {
                capco: contextHolding(CROSSWALK_SCHEMES),
                cui: contextHolding([
                    {
                        selector: 'cui',
                        id: 'scheme-c',
                        version: '1.0.0',
                        roles: ['primary'],
                    },
                ]),
            },
        });
        set.load();

        expect(set.bucketsNamed(null, null)).toEqual([
            bucketKey('capco', ''),
            bucketKey('capco', 'tier'),
            bucketKey('cui', ''),
        ]);
        expect(set.bucketsNamed('capco', 'base')).toEqual([
            bucketKey('capco', ''),
        ]);
        expect(set.bucketsNamed(null, 'tier')).toEqual([
            bucketKey('capco', 'tier'),
        ]);
        expect(set.bucketsNamed('other', null)).toEqual([]);
    });
});

describe('contextStoreBuckets', () => {
    it('reads one Context in a bucket per scheme, its primary the default', () => {
        const context = contextHolding(CROSSWALK_SCHEMES);
        const buckets = contextStoreBuckets(context);

        expect(buckets.defaultBucket).toBe(bucketKey('', ''));
        const primary = buckets.resolve(bucketKey('', ''));
        const second = buckets.resolve(bucketKey('', 'tier'));
        expect(primary.engine).toBe(context.scheme);
        expect(second.engine).toBe(context.schemeView('tier'));
        // No host format: each bucket names none, as a store over that scheme
        // alone, and the store writes in the scheme's own default.
        expect(primary).not.toHaveProperty('format');
        expect(second).not.toHaveProperty('format');
    });

    it('reads a second scheme under a Context key, with no default bucket', () => {
        const capco = contextHolding(CROSSWALK_SCHEMES);
        const buckets = contextStoreBuckets(
            { contexts: { capco } },
            { format: 'host-format' },
        );

        expect(buckets.defaultBucket).toBeUndefined();
        const second = buckets.resolve(bucketKey('capco', 'tier'));
        expect(second.engine).toBe(capco.schemeView('tier'));
        expect(second.format).toBe('host-format');
    });

    it('refuses a bucket for a scheme the Context does not hold', () => {
        const buckets = contextStoreBuckets(contextHolding(CROSSWALK_SCHEMES));

        expect(
            resolutionError(() => buckets.resolve(bucketKey('', 'other'))).code,
        ).toBe('scheme-unresolved');
        expect(
            resolutionError(() => buckets.resolve(bucketKey('capco', ''))).code,
        ).toBe('context-unresolved');
    });
});

describe('contextForScheme', () => {
    function resolved(context: ContextAdapter, schemeSelector: string) {
        const primary = schemeSelector === PRIMARY_SCHEME_SELECTOR;
        return {
            contextKey: '',
            context,
            schemeSelector,
            primary,
            bucket: bucketKey('', schemeSelector),
        };
    }

    it('is the Context itself for its primary scheme', () => {
        const context = contextHolding(CROSSWALK_SCHEMES);
        expect(
            contextForScheme(resolved(context, PRIMARY_SCHEME_SELECTOR)),
        ).toBe(context);
    });

    it('reads through the selected scheme and keeps the rest of the Context', () => {
        // A frozen Context, as an engine hands one out: its `scheme` cannot
        // be redefined on the object itself.
        const context = Object.freeze(contextHolding(CROSSWALK_SCHEMES));
        const bound = contextForScheme(resolved(context, 'tier'));

        expect(bound.scheme).toBe(context.schemeView('tier'));
        expect(bound.scheme.getScheme().id).toBe('scheme-b');
        expect('audit' in bound).toBe(true);
        expect(bound.describeSchemes).toBeTypeOf('function');
        expect(contextForScheme(resolved(context, 'tier'))).toBe(bound);
    });

    it('leaves out the guide and access policy, which do not mark in the selected scheme', () => {
        const context = Object.freeze({
            ...contextHolding(CROSSWALK_SCHEMES),
            guide: { buildGuideViews: () => [] },
            access: { listAccessRuleIds: () => [] },
        }) as unknown as ContextAdapter;
        const bound = contextForScheme(resolved(context, 'tier'));

        expect(bound.guide).toBeUndefined();
        expect(bound.access).toBeUndefined();
        expect('guide' in bound).toBe(false);
        expect('access' in bound).toBe(false);
        expect(context.guide).toBeDefined();
    });

    it('refuses a scheme the Context gives no view for', () => {
        const context = contextHolding(CROSSWALK_SCHEMES);
        expect(
            resolutionError(() =>
                contextForScheme(resolved(context, 'missing')),
            ).code,
        ).toBe('scheme-unresolved');
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import {
    registerContext,
    unregisterContext,
    findContext,
    clearContextRegistry,
} from './context-binding';

const MINIMAL_SCHEME_DOC = {
    scheme: {
        id: 'test-ctx',
        version: '1.0.0',
        name: 'Test Ctx',
        description: '',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: false,
                    single: true,
                    rollup: 'max',
                    position: 0,
                    hierarchy_root: true,
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'level-1',
                        name: 'Level 1',
                        views: { default: 'L1' },
                        aliases: [],
                        categories: ['level'],
                        parents: [],
                        position: 1,
                        rank: 0,
                    },
                    {
                        id: 'level-2',
                        name: 'Level 2',
                        views: { default: 'L2' },
                        aliases: [],
                        categories: ['level'],
                        parents: [],
                        position: 2,
                        rank: 1,
                    },
                ],
            },
        },
        rules: [],
        rollup_pipelines: [],
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '//',
                    fields: [{ category: 'level', separator: '//' }],
                },
            ],
        },
    },
};

describe('context-binding', () => {
    beforeEach(() => {
        clearContextRegistry();
        document.body.innerHTML = '';
    });

    it('returns null when no provider exists', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        expect(findContext(el)).toBeNull();
    });

    it('finds a Context registered for the nearest [ezclassify-context] ancestor', () => {
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });
        registerContext('demo', ctx);

        const provider = document.createElement('div');
        provider.setAttribute('data-ezclassify-context', 'demo');
        const child = document.createElement('span');
        provider.appendChild(child);
        document.body.appendChild(provider);

        expect(findContext(child)).toBe(ctx);
        expect(findContext(provider)).toBe(ctx);
    });

    it('returns null after unregisterContext', () => {
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });
        registerContext('demo', ctx);

        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-context', 'demo');
        document.body.appendChild(el);

        expect(findContext(el)).toBe(ctx);
        unregisterContext('demo');
        expect(findContext(el)).toBeNull();
    });

    it('replaces the registration on duplicate keys', () => {
        const ctxA = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });
        const ctxB = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });
        registerContext('demo', ctxA);
        registerContext('demo', ctxB);

        const el = document.createElement('div');
        el.setAttribute('data-ezclassify-context', 'demo');
        document.body.appendChild(el);

        expect(findContext(el)).toBe(ctxB);
    });

    it('returns null for null element', () => {
        expect(findContext(null)).toBeNull();
    });

    it('returns null for undefined element', () => {
        expect(findContext(undefined)).toBeNull();
    });

    it('returns null when nearest provider has an empty key attribute', () => {
        // Provider with data-ezclassify-context="", key is present but empty
        const provider = document.createElement('div');
        provider.setAttribute('data-ezclassify-context', '');
        const child = document.createElement('span');
        provider.appendChild(child);
        document.body.appendChild(provider);

        expect(findContext(child)).toBeNull();
    });
});

describe('component-base context resolution', () => {
    beforeEach(() => {
        clearContextRegistry();
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('accepts a Context directly without warning', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });

        const { StatusBanner } = await import('./components/status-banner');
        const container = document.createElement('div') as HTMLDivElement;
        document.body.appendChild(container);
        const banner = new StatusBanner();
        await banner.init(container, ctx);

        expect(warnSpy).not.toHaveBeenCalled();
        banner.destroy();
    });

    it('does not warn when initialized via Context.fromComponents', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });

        const { Handbook } = await import('./components/handbook');
        const container = document.createElement('div') as HTMLDivElement;
        document.body.appendChild(container);
        const handbook = new Handbook();
        await handbook.init(container, ctx);

        expect(warnSpy).not.toHaveBeenCalled();
        handbook.destroy();
    });

    it('discovers a Context from the [ezclassify-context] ancestor', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ctx = Context.fromComponents({ scheme: MINIMAL_SCHEME_DOC });
        registerContext('demo', ctx);

        const provider = document.createElement('div');
        provider.setAttribute('data-ezclassify-context', 'demo');
        const container = document.createElement('div') as HTMLDivElement;
        provider.appendChild(container);
        document.body.appendChild(provider);

        const { StatusBanner } = await import('./components/status-banner');
        const banner = new StatusBanner();
        await banner.init(container);

        expect(container.querySelector('[role="status"]')).toBeTruthy();
        expect(warnSpy).not.toHaveBeenCalled();
        banner.destroy();
    });
});

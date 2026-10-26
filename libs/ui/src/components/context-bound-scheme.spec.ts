/**
 * @vitest-environment jsdom
 *
 * Context-bound components use the Context-selected primary scheme. This suite
 * stays in the public lane: the adapter is a contract-shaped mock, not the
 * proprietary in-process engine.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
    ContextAdapter,
    RemoteContextSchemeEngineAdapter,
    SchemePublicView,
    ValidateResult,
} from '@ezclassify/types';
import { ReadOnlyComponentBase } from './component-base-readonly';
import { mockValidateResult } from '../engine-result-mock';

class BoundComponent extends ReadOnlyComponentBase {
    protected setup(): void {}
    protected render(): void {}
    destroy(): void {}
}

function scheme(): SchemePublicView {
    return {
        id: 'primary',
        name: 'Primary',
        version: '1.0.0',
        mode: 'combinatorial',
        categories: [],
        concepts: [],
        formats: [],
        defaultRenderFormat: 'default',
        rules: [],
        scopes: [],
    } as unknown as SchemePublicView;
}

/** A context whose scheme reads markings through `validate`. */
function context(validate: ReturnType<typeof vi.fn>): ContextAdapter {
    const primary = scheme();
    const adapter = {
        connected: true,
        getScheme: () => primary,
        getSchemeMeta: () => ({
            id: 'primary',
            name: 'Primary',
            version: '1.0.0',
            mode: 'combinatorial',
            defaultRenderFormat: 'default',
        }),
        listCategories: () => [],
        getConceptsInCategory: () => [],
        validate,
        render: vi.fn(async () => ''),
        suggest: vi.fn(async () => ({ suggestions: [] })),
    } as unknown as RemoteContextSchemeEngineAdapter;
    return {
        connected: true,
        scheme: adapter,
        describeSchemes: async () => [],
        audit: vi.fn(),
        assessDocumentAccess: vi.fn(),
        checkContextAccess: vi.fn(),
        accessRequirements: vi.fn(),
        translate: vi.fn(),
        destroy: vi.fn(),
    } as unknown as ContextAdapter;
}

describe('Context-bound scheme operations', () => {
    it('reads through the bound operation without a scheme selector', async () => {
        const validate = vi.fn(async (): Promise<ValidateResult> =>
            mockValidateResult({ rendered: 'A' }),
        );
        const container = document.createElement('div');
        const component = new BoundComponent();

        await component.init(container, context(validate), {
            initialValue: 'A',
        });

        expect(validate).toHaveBeenCalledOnce();
        expect(validate).toHaveBeenCalledWith('A', {
            outputFormat: 'default',
            context: undefined,
        });
    });

    it('rejects an attempt to select a different scheme', async () => {
        const validate = vi.fn();
        const container = document.createElement('div');
        container.dataset.ezclassifyScheme = 'secondary';
        const component = new BoundComponent();

        await expect(
            component.init(container, context(validate)),
        ).rejects.toThrow(/Context-bound scheme operations target 'primary'/);
        expect(validate).not.toHaveBeenCalled();
    });
});

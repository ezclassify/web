import { expect, it, vi } from 'vitest';
import { Context } from '@ezclassify/engine';
import { AccessHandbook } from './access-handbook';

it('searches a large policy without recomputing every rule reference', async () => {
    let digestReads = 0;
    const rules = Array.from({ length: 128 }, (_, index) => ({
        access: { id: 'policy', kind: 'access', version: '1.0.0' },
        scheme: { id: 'test', kind: 'scheme', version: '1.0.0' },
        rule: {
            artifact: { id: 'policy', kind: 'access', version: '1.0.0' },
            ruleId: `r${index}`,
            get ruleDigest() {
                digestReads++;
                return `sha256:r${index}`;
            },
        },
        name: `Rule ${index}`,
        requirementText: 'Requirement',
        attributesNeeded: [],
        dependsOn: [],
        overrides: [],
        lines: [],
    }));
    const scheme = {
        getScheme: () => ({
            id: 'test',
            version: '1.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            categories: [],
            concepts: [],
            formats: [],
            scopes: [],
            conceptGroups: [],
            parseRules: [],
            wizardQuestions: [],
        }),
        getSchemeMeta: () => ({
            id: 'test',
            version: '1.0',
            name: 'Test',
            defaultRenderFormat: 'default',
            formats: [],
            scopes: [],
        }),
        listCategories: () => [],
        getConceptsInCategory: () => [],
        process: () => ({ assertions: [], rendered: '', valid: true }),
        suggest: () => ({ suggestions: [] }),
        render: () => '',
    };
    const context = Context.fromSchemeEngine(scheme as never);
    Object.assign(context, {
        access: { schemeId: 'test', describeAllAccessRules: () => rules },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handbook = new AccessHandbook();
    try {
        await handbook.init(container, context as never);
        await vi.waitFor(() =>
            expect(
                container.querySelectorAll('.ez-access-handbook__entry'),
            ).toHaveLength(128),
        );
        digestReads = 0;
        const search = container.querySelector<HTMLInputElement>(
            '.ez-access-handbook__search-input',
        )!;
        search.value = 'Rule 127';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(digestReads).toBeLessThanOrEqual(128 * 3);
        expect(
            container.querySelectorAll(
                '.ez-access-handbook__entry:not(.ez-access-handbook__entry--hidden)',
            ),
        ).toHaveLength(1);
    } finally {
        handbook.destroy();
        container.remove();
    }
});

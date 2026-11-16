/**
 * Engine calls a rollup pass makes. The rollup values come from the store,
 * which rolls up contributor facts, so the pass itself aggregates nothing; it
 * reads each whole and each part once for coverage and reuses those reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoverageReport, ProcessResult } from '@ezclassify/types';
import { clearRollupProcessCache, updateRollup } from './rollup';
import type { BucketScheme, FormsContext } from './types';
import { SOLE_BUCKET } from '../store/store-shared';

vi.mock('./dom', () => ({
    showCopiedIndicator: vi.fn(),
}));

function createEngine() {
    return {
        process: vi.fn(
            (input: string, _options?: unknown) =>
                ({
                    valid: true,
                    rendered: input,
                    assertions: [],
                    errors: [],
                    warnings: [],
                }) as unknown as ProcessResult,
        ),
        checkCoverage: vi.fn(
            (_children: string[], _parent: string) =>
                ({
                    covered: true,
                    missing: [],
                    missingLabels: [],
                    excess: [],
                    excessLabels: [],
                    rendered: '',
                }) as unknown as CoverageReport,
        ),
        aggregate: vi.fn(),
        aggregateAssertions: vi.fn(),
        suggest: vi.fn(),
    };
}

function createCtx(
    engine: ReturnType<typeof createEngine>,
    overrides: Partial<FormsContext> = {},
): FormsContext {
    const scheme: BucketScheme = {
        bucket: SOLE_BUCKET,
        adapter: engine,
        process: (input, options) => engine.process(input, options as never),
        validate: (input) => engine.process(input) as never,
        checkCoverage: (children, parent) =>
            engine.checkCoverage(children as never, parent as never),
        getSchemeMeta: () => ({ id: 's', version: '1', name: 's' }) as never,
    };
    return {
        engine: engine as unknown as FormsContext['engine'],
        schemeOf: () => scheme,
        bucketsNamed: () => [SOLE_BUCKET],
        aggregateOf: () => new Map(),
        destroyed: false,
        root: document.body,
        fields: [],
        defaultFormat: 'default',
        defaultPartFormat: 'default',
        domObserver: null,
        autocompleters: new Map(),
        lastValidated: new Map(),
        fieldAssertions: new Map(),
        tooltipEl: null,
        settingValue: false,
        colorMap: {},
        initializing: false,
        mountInstanceId: 'instance',
        mounted: new Map(),
        partOfMap: new Map(),
        aggregates: new Map(),
        ...overrides,
    } as FormsContext;
}

function input(value: string, id = ''): HTMLInputElement {
    const el = document.createElement('input');
    el.value = value;
    if (id) el.id = id;
    document.body.appendChild(el);
    return el;
}

describe('API call budget: a rollup pass', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        clearRollupProcessCache();
    });

    it('aggregates nothing itself, however many fields hold markings', async () => {
        const engine = createEngine();
        const fields = ['A', 'B', 'C'].map((v) => input(v));
        const ctx = createCtx(engine, { fields });

        await updateRollup(ctx);

        expect(engine.aggregate).not.toHaveBeenCalled();
        expect(engine.aggregateAssertions).not.toHaveBeenCalled();
        expect(engine.process).not.toHaveBeenCalled();
        expect(engine.suggest).not.toHaveBeenCalled();
    });

    it('reads a whole and each part once, one coverage check per whole, and reuses the reads', async () => {
        const engine = createEngine();
        const whole = input('W', 'memo');
        const parts = [input('P1'), input('P2')];
        const ctx = createCtx(engine, {
            fields: [whole, ...parts],
            partOfMap: new Map(parts.map((p) => [p, 'memo'])),
        });

        await updateRollup(ctx);
        expect(engine.process).toHaveBeenCalledTimes(3);
        expect(engine.checkCoverage).toHaveBeenCalledTimes(1);

        await updateRollup(ctx);
        expect(engine.process).toHaveBeenCalledTimes(3);
    });

    it('makes no call while initializing', async () => {
        const engine = createEngine();
        const whole = input('W', 'memo');
        const part = input('P1');
        const ctx = createCtx(engine, {
            initializing: true,
            fields: [whole, part],
            partOfMap: new Map([[part, 'memo']]),
        });

        await updateRollup(ctx);

        expect(engine.process).not.toHaveBeenCalled();
        expect(engine.checkCoverage).not.toHaveBeenCalled();
    });
});

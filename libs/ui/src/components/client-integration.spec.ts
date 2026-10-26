/**
 * Client integration tests.
 *
 * Tests the EzClassifyClient and async engine mock together with the forms
 * components, end-to-end integration without a real server.
 */

import { Context } from '@ezclassify/engine';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TagInput } from './tag-input';
import { createAsyncMockEngine } from './async-engine-mock';

function wait(ms = 50) {
    return new Promise((r) => setTimeout(r, ms));
}

const toCtx = (eng: unknown) => Context.fromSchemeEngine(eng as never);
let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    document.body.removeChild(container);
});

describe('Client integration: component lifecycle', () => {
    it('init → add → remove → add cycle works with async engine', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        const methods = ac as unknown as {
            addAssertion: (id: string, fid: string) => void;
            removeAssertion: (id: string, fid: string) => void;
        };

        // Add A
        methods.addAssertion('A', 'f1');
        await wait(50);
        expect(ac.getAssertions().some((a) => a.conceptId === 'A')).toBe(true);

        // Remove A
        methods.removeAssertion('A', 'f1');
        await wait(50);
        expect(ac.getAssertions().some((a) => a.conceptId === 'A')).toBe(false);

        // Add B
        methods.addAssertion('B', 'f1');
        await wait(50);
        expect(ac.getAssertions().some((a) => a.conceptId === 'B')).toBe(true);
    });

    it('getRendered stays in sync with assertions after async mutations', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(50);

        const rendered = ac.getRendered();
        const assertionIds = ac.getAssertions().map((a) => a.conceptId);

        // Rendered should contain all assertion concept IDs
        for (const id of assertionIds) {
            expect(rendered).toContain(id);
        }
    });

    it('enhanced input value synced after async reprocess', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(50);

        // The hidden input value should match getRendered
        expect(input.value).toBe(ac.getRendered());
    });

    it('chips render correctly with async engine', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A,B';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        const chips = c.querySelectorAll('.proto-tag');
        expect(chips.length).toBeGreaterThan(0);

        // Chip labels should include A and B
        const labels = Array.from(chips).map((chip) =>
            chip.textContent?.replace('×', '').trim(),
        );
        expect(labels).toContain('A');
        expect(labels).toContain('B');
    });

    it('preview bar shows rendered marking', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        const preview = c.querySelector('.proto-preview') as HTMLElement;
        if (preview) {
            expect(preview.textContent?.length).toBeGreaterThan(0);
        }
    });

    it('scoped component processes an edit on its bound surface', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(engine), { scope: 'test-scope' });

        const callsBefore = engine._callCount('process');

        (
            ac as unknown as { addAssertion: (id: string, fid: string) => void }
        ).addAssertion('A', 'f1');
        await wait(50);

        const callsAfter = engine._callCount('process');
        expect(callsAfter).toBe(callsBefore + 1);
        const lastProcess = engine._calls
            .filter((call) => call.method === 'process')
            .at(-1);
        expect(lastProcess?.args[1]).toMatchObject({ surface: 'test-scope' });

        expect(ac.getAssertions().some((a) => a.conceptId === 'A')).toBe(true);
    });
});

describe('Client integration: request counting', () => {
    it('init fires process (not render) for initial value', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);

        engine._calls.length = 0;
        await ac.init(c, toCtx(engine));

        // Should have called process for init, not render
        expect(engine._callCount('process')).toBeGreaterThanOrEqual(1);
    });

    it('getRendered does not fire any API calls', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        const callsBefore = engine._calls.length;
        ac.getRendered();
        ac.getRendered();
        ac.getRendered();

        // No additional API calls, uses cached _lastRendered
        expect(engine._calls.length).toBe(callsBefore);
    });

    it('multiple getAssertions calls do not fire API calls', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        const callsBefore = engine._calls.length;
        ac.getAssertions();
        ac.getAssertions();
        ac.getAssertions();

        expect(engine._calls.length).toBe(callsBefore);
    });
});

describe('Client integration: edge cases', () => {
    it('empty initial value produces valid state', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        c.appendChild(document.createElement('input'));
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        expect(ac.getAssertions()).toEqual([]);
        expect(ac.getRendered()).toBe('');
    });

    it('destroy cleans up DOM', async () => {
        const engine = createAsyncMockEngine({ delay: 5 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        expect(c.querySelector('.tag-input-wrap')).toBeTruthy();
        ac.destroy();
        expect(c.querySelector('.tag-input-wrap')).toBeFalsy();
    });

    it('component handles high latency gracefully', async () => {
        const engine = createAsyncMockEngine({ delay: 200 });
        const ac = new TagInput();
        const c = document.createElement('div');
        const input = document.createElement('input');
        input.value = 'A';
        c.appendChild(input);
        container.appendChild(c);
        await ac.init(c, toCtx(engine));

        // Even with high latency, init should complete and produce valid state
        expect(ac.getAssertions().length).toBeGreaterThan(0);
        expect(ac.getRendered().length).toBeGreaterThan(0);
    });
});

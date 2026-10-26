import { describe, it, expect, vi } from 'vitest';
import { compareRenderings, initComparison } from './comparison';

function createMockEngine(readResults: Record<string, any> = {}) {
    return {
        validate: vi.fn((input: string) => {
            return (
                readResults[input] ?? {
                    assertions: [],
                    rendered: input,
                    valid: true,
                }
            );
        }),
    } as any;
}

describe('comparison', () => {
    describe('compareRenderings', () => {
        it('returns identical when both inputs produce same concepts', async () => {
            const engine = createMockEngine({
                A: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'A',
                    valid: true,
                },
                B: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'B',
                    valid: true,
                },
            });

            const result = await compareRenderings('A', 'B', engine);
            expect(result.relationship).toBe('identical');
            expect(result.addedConcepts).toEqual([]);
            expect(result.removedConcepts).toEqual([]);
        });

        it('detects upgrade when after has higher order', async () => {
            const engine = createMockEngine({
                low: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'low',
                    valid: true,
                },
                high: {
                    assertions: [
                        {
                            conceptId: 'c2',
                            categoryId: 'f1',
                            metadata: { order: 5 },
                        },
                    ],
                    rendered: 'high',
                    valid: true,
                },
            });

            const result = await compareRenderings('low', 'high', engine);
            expect(result.relationship).toBe('upgrade');
            expect(result.addedConcepts).toContain('c2');
            expect(result.removedConcepts).toContain('c1');
        });

        it('detects downgrade when after has lower order', async () => {
            const engine = createMockEngine({
                high: {
                    assertions: [
                        {
                            conceptId: 'c2',
                            categoryId: 'f1',
                            metadata: { order: 5 },
                        },
                    ],
                    rendered: 'high',
                    valid: true,
                },
                low: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'low',
                    valid: true,
                },
            });

            const result = await compareRenderings('high', 'low', engine);
            expect(result.relationship).toBe('downgrade');
        });

        it('detects lateral change when same max order', async () => {
            const engine = createMockEngine({
                A: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 3 },
                        },
                    ],
                    rendered: 'A',
                    valid: true,
                },
                B: {
                    assertions: [
                        {
                            conceptId: 'c2',
                            categoryId: 'f1',
                            metadata: { order: 3 },
                        },
                    ],
                    rendered: 'B',
                    valid: true,
                },
            });

            const result = await compareRenderings('A', 'B', engine);
            expect(result.relationship).toBe('lateral');
        });

        it('computes addedConcepts correctly', async () => {
            const engine = createMockEngine({
                before: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'before',
                    valid: true,
                },
                after: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                        {
                            conceptId: 'c2',
                            categoryId: 'f1',
                            metadata: { order: 2 },
                        },
                    ],
                    rendered: 'after',
                    valid: true,
                },
            });

            const result = await compareRenderings('before', 'after', engine);
            expect(result.addedConcepts).toEqual(['c2']);
            expect(result.removedConcepts).toEqual([]);
        });

        it('computes removedConcepts correctly', async () => {
            const engine = createMockEngine({
                before: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                        {
                            conceptId: 'c2',
                            categoryId: 'f1',
                            metadata: { order: 2 },
                        },
                    ],
                    rendered: 'before',
                    valid: true,
                },
                after: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'after',
                    valid: true,
                },
            });

            const result = await compareRenderings('before', 'after', engine);
            expect(result.removedConcepts).toEqual(['c2']);
            expect(result.addedConcepts).toEqual([]);
        });

        it('returns rendered strings from engine', async () => {
            const engine = createMockEngine({
                'input-a': {
                    assertions: [],
                    rendered: 'RENDERED-A',
                    valid: true,
                },
                'input-b': {
                    assertions: [],
                    rendered: 'RENDERED-B',
                    valid: true,
                },
            });

            const result = await compareRenderings(
                'input-a',
                'input-b',
                engine,
            );
            expect(result.before).toBe('RENDERED-A');
            expect(result.after).toBe('RENDERED-B');
        });

        it('handles empty assertions gracefully', async () => {
            const engine = createMockEngine({
                a: { assertions: [], rendered: 'a', valid: true },
                b: { assertions: [], rendered: 'b', valid: true },
            });

            const result = await compareRenderings('a', 'b', engine);
            expect(result.relationship).toBe('identical');
        });

        it('handles assertions without metadata order', async () => {
            const engine = createMockEngine({
                a: {
                    assertions: [{ conceptId: 'c1', categoryId: 'f1' }],
                    rendered: 'a',
                    valid: true,
                },
                b: {
                    assertions: [{ conceptId: 'c2', categoryId: 'f1' }],
                    rendered: 'b',
                    valid: true,
                },
            });

            const result = await compareRenderings('a', 'b', engine);
            expect(result.relationship).toBe('lateral');
        });
    });

    describe('initComparison', () => {
        it('listens to input events on both fields', async () => {
            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');
            const engine = createMockEngine();

            const comp = initComparison(fieldA, fieldB, container, engine);

            fieldA.value = 'test-a';
            fieldB.value = 'test-b';
            fieldA.dispatchEvent(new Event('input'));

            // Allow async update() to settle
            await new Promise((r) => setTimeout(r, 10));

            expect(engine.validate).toHaveBeenCalled();
            comp.destroy();
        });

        /**
         * A remote engine need not answer in the order it was asked. Without
         * sequencing, a slower earlier comparison would paint over the newer
         * one and leave a diff of text the fields no longer hold.
         */
        it('does not let a slower earlier comparison paint over a newer one', async () => {
            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');
            const waiting = new Map<string, () => void>();
            const engine = {
                validate: (input: string) =>
                    new Promise((resolve) => {
                        waiting.set(input, () =>
                            resolve({
                                assertions: [
                                    {
                                        conceptId: input,
                                        categoryId: 'f1',
                                        metadata: { order: 1 },
                                    },
                                ],
                                rendered: input,
                                valid: true,
                            }),
                        );
                    }),
            } as any;

            /** Let one pending validate() call finish and settle the chain. */
            async function release(input: string): Promise<void> {
                for (let i = 0; i < 20 && !waiting.has(input); i++) {
                    await Promise.resolve();
                }
                waiting.get(input)!();
                waiting.delete(input);
                await new Promise((r) => setTimeout(r, 0));
            }

            const comp = initComparison(fieldA, fieldB, container, engine);

            fieldA.value = 'stale-a';
            fieldB.value = 'stale-b';
            fieldA.dispatchEvent(new Event('input'));
            fieldA.value = 'fresh-a';
            fieldB.value = 'fresh-b';
            fieldA.dispatchEvent(new Event('input'));

            // The newer comparison finishes first, then the older one.
            await release('fresh-a');
            await release('fresh-b');
            expect(container.textContent).toContain('fresh');

            await release('stale-a');
            await release('stale-b');

            expect(container.textContent).toContain('fresh');
            expect(container.textContent).not.toContain('stale');
            comp.destroy();
        });

        it('hides container when either field is empty', async () => {
            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');
            const engine = createMockEngine();

            const comp = initComparison(fieldA, fieldB, container, engine);

            fieldA.value = '';
            fieldB.value = 'test';
            fieldA.dispatchEvent(new Event('input'));

            // Allow async update() to settle
            await new Promise((r) => setTimeout(r, 10));

            expect(container.style.display).toBe('none');
            comp.destroy();
        });

        it('shows container when both fields have values', async () => {
            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');
            const engine = createMockEngine();

            fieldA.value = 'a';
            fieldB.value = 'b';
            const comp = initComparison(fieldA, fieldB, container, engine);

            // Allow async update() to settle
            await new Promise((r) => setTimeout(r, 10));

            expect(container.style.display).toBe('block');
            comp.destroy();
        });

        it('cleans up event listeners on destroy', async () => {
            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');
            const engine = createMockEngine();

            fieldA.value = 'a';
            fieldB.value = 'b';
            const comp = initComparison(fieldA, fieldB, container, engine);

            // Allow async update() to settle
            await new Promise((r) => setTimeout(r, 10));

            comp.destroy();

            expect(container.innerHTML).toBe('');
        });

        it('renders comparison result with relationship indicator', async () => {
            const engine = createMockEngine({
                a: {
                    assertions: [
                        {
                            conceptId: 'c1',
                            categoryId: 'f1',
                            metadata: { order: 1 },
                        },
                    ],
                    rendered: 'ALPHA',
                    valid: true,
                },
                b: {
                    assertions: [
                        {
                            conceptId: 'c2',
                            categoryId: 'f1',
                            metadata: { order: 5 },
                        },
                    ],
                    rendered: 'BETA',
                    valid: true,
                },
            });

            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');

            fieldA.value = 'a';
            fieldB.value = 'b';

            const comp = initComparison(fieldA, fieldB, container, engine);

            // Allow async update() to settle
            await new Promise((r) => setTimeout(r, 10));

            expect(container.innerHTML).toContain('Upgrade');
            expect(container.innerHTML).toContain('ALPHA');
            expect(container.innerHTML).toContain('BETA');
            comp.destroy();
        });

        it('shows error message when comparison throws', async () => {
            const engine = {
                validate: vi.fn(() => {
                    throw new Error('fail');
                }),
            } as any;

            const fieldA = document.createElement('input');
            const fieldB = document.createElement('input');
            const container = document.createElement('div');

            fieldA.value = 'a';
            fieldB.value = 'b';

            const comp = initComparison(fieldA, fieldB, container, engine);

            // Allow async update() to settle
            await new Promise((r) => setTimeout(r, 10));

            expect(container.innerHTML).toContain('Unable to compare');
            comp.destroy();
        });
    });
});

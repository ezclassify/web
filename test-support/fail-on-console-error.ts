import { format } from 'node:util';
import { afterAll, beforeEach, expect } from 'vitest';

const errors: string[] = [];
const originalError = console.error;

console.error = (...args: unknown[]) => {
    errors.push(format(...args));
    originalError.apply(console, args);
};

/** Assert and consume one deliberately triggered diagnostic. Extra calls still fail. */
export function expectConsoleError(...args: unknown[]) {
    const expected = format(...args);
    const index = errors.indexOf(expected);
    expect(index, `Missing expected console error: ${expected}`).toBeGreaterThanOrEqual(0);
    errors.splice(index, 1);
}

function assertNoErrors() {
    expect(errors.splice(0), 'Unexpected console errors').toEqual([]);
}

beforeEach(({ onTestFinished }) => {
    onTestFinished(assertNoErrors);
});

afterAll(() => {
    console.error = originalError;
    assertNoErrors();
});

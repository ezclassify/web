/**
 * Complete engine result fixtures for specs that mock an adapter.
 *
 * A spec that stubs `process` cares about two or three members of the result,
 * but `ProcessResult` is the engine's full contract and a partial literal cast
 * to it hides the day a component starts reading a member the fixture never
 * had. These factories fill the rest of the contract with empty, valid values
 * so a case can state only what it is about and still hand the code under test
 * a result shaped the way a real engine's is.
 *
 * The `-mock` suffix keeps this file out of the declaration build and the
 * published tarball (see `tsconfig.lib.json`).
 */

import type {
    Assertion,
    ProcessResult,
    RenderAssessment,
    ScanOutcome,
    ScanResult,
    ValidateResult,
} from '@ezclassify/types';

/** What a write that wrote everything it was given reports. */
export const EMPTY_RENDER_ASSESSMENT: RenderAssessment = {
    emitted: [],
    omitted: [],
    collapsed: [],
    conflicts: [],
    unrepresentable: [],
};

/**
 * One assertion, defaulted to a certain parse.
 *
 * @param partial - At least the concept and category; anything else overrides
 *   the default
 * @returns A complete assertion
 */
export function mockAssertion(
    partial: Pick<Assertion, 'conceptId' | 'categoryId'> & Partial<Assertion>,
): Assertion {
    return { confidence: 'certain', source: 'parse', ...partial };
}

/**
 * What every reader and author result carries, valid and empty. `inputWasValid`
 * follows `valid` unless a case sets it.
 */
function readerDefaults(
    valid: boolean,
): Omit<ValidateResult, 'recognition' | 'displayColor'> {
    return {
        assertions: [],
        rendered: '',
        assessment: EMPTY_RENDER_ASSESSMENT,
        valid: true,
        inputWasValid: valid,
        errors: [],
        warnings: [],
        appliedFixes: [],
        notices: [],
    };
}

/**
 * A complete {@link ValidateResult}, valid and empty unless the case says
 * otherwise.
 *
 * @param partial - Members the case cares about
 * @returns A complete validate result
 */
export function mockValidateResult(
    partial: Partial<ValidateResult> = {},
): ValidateResult {
    return { ...readerDefaults(partial.valid ?? true), ...partial };
}

/**
 * A complete {@link ProcessResult}, valid and empty unless the case says
 * otherwise. `renders` is empty, as it is when a request names no outputs.
 *
 * @param partial - Members the case cares about
 * @returns A complete process result
 */
export function mockProcessResult(
    partial: Partial<ProcessResult> = {},
): ProcessResult {
    return {
        ...readerDefaults(partial.valid ?? true),
        renders: {},
        proposedFixes: [],
        ...partial,
    };
}

/**
 * What a scan returns when it read the whole document: the markings it found
 * and a limit report that says nothing stopped it.
 *
 * @param results - The markings the mocked scan found, in document order
 * @returns A complete scan outcome
 */
export function mockScanOutcome(
    results: readonly ScanResult[] = [],
): ScanOutcome {
    return {
        results: [...results],
        limits: { status: 'complete', regionsFound: results.length },
    };
}

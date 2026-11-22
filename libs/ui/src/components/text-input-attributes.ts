import type {
    Assertion,
    AssertionRef,
    ConceptTextInput,
    ValueEncoding,
} from '@ezclassify/types';

/**
 * Apply browser constraints that can be represented faithfully by a concept's
 * typed value encoding. Semantic validation still belongs to the engine when
 * the edited assertion is processed.
 */
export function applyTextInputAttributes(
    input: HTMLInputElement,
    config: ConceptTextInput,
): void {
    const encoding = config.encoding;
    if (!encoding) return;

    if (encoding.type === 'text') {
        if (encoding.pattern) input.pattern = encoding.pattern;
        if (encoding.maxLength !== undefined)
            input.maxLength = encoding.maxLength;
        return;
    }

    if (encoding.type === 'calendar-date') {
        input.inputMode = 'numeric';
        input.pattern = calendarPattern(encoding);
    }
}

function calendarPattern(
    encoding: Extract<ValueEncoding, { type: 'calendar-date' }>,
): string {
    return encoding.accepts
        .map((format) =>
            format === 'YYYYMMDD'
                ? String.raw`\d{8}`
                : String.raw`\d{4}-\d{2}-\d{2}`,
        )
        .join('|');
}

/** Describe native draft validity before publishing an assertion to Runtime. */
export function capturedValueProblem(
    input: HTMLInputElement,
    field: ConceptTextInput,
    requireValue = input.required,
): string {
    if (!input.value.trim()) return requireValue ? 'Required' : '';
    if (input.validity.valid) return '';
    return `Invalid format. Expected: ${field.placeholder ?? 'the required value format'}`;
}

/** Record a value the author supplied, replacing any prior rule attribution. */
export function statedCapture(ref: AssertionRef, value: string): Assertion {
    const assertion: Assertion = {
        ...ref,
        value,
        confidence: 'certain',
        source: 'user',
    };
    delete assertion.sourceRule;
    return assertion;
}

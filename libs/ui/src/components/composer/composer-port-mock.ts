/**
 * An in-memory composer port for specs: a five-concept scheme (a single-choice
 * `level`, a multi-choice `caveat`) and a reader that behaves like the engine's
 * tolerant parser for the composer's purposes: any order, any separator,
 * case-insensitive, and every unread run reported as a span. Excluded from the
 * library build (`*-mock.ts`).
 */
import type {
    Assertion,
    Fix,
    Suggestion,
    ValidationError,
} from '@ezclassify/types';
import type {
    ComposerCommit,
    ComposerPort,
    ComposerReading,
} from './composer-controller';

export interface Concept {
    id: string;
    category: string;
    label: string;
}

export const CONCEPTS: Concept[] = [
    { id: 'U', category: 'level', label: 'UNCLASSIFIED' },
    { id: 'S', category: 'level', label: 'SECRET' },
    { id: 'NF', category: 'caveat', label: 'NOFORN' },
    { id: 'OC', category: 'caveat', label: 'ORCON' },
    { id: 'OH', category: 'caveat', label: 'ON HOLD' },
];
const CATEGORY_ORDER = ['level', 'caveat'];

export function assertion(c: Concept): Assertion {
    return {
        conceptId: c.id,
        categoryId: c.category,
        confidence: 'certain',
        source: 'user',
    };
}

function render(assertions: readonly Assertion[]): string {
    return CATEGORY_ORDER.map((cat) =>
        CONCEPTS.filter((c) =>
            assertions.some(
                (a) => a.conceptId === c.id && a.categoryId === cat,
            ),
        )
            .map((c) => c.label)
            .join('/'),
    )
        .filter(Boolean)
        .join('//');
}

function reading(
    assertions: Assertion[],
    unmatched: { start: number; end: number; text: string }[],
    text: string,
): ComposerReading {
    const hasLevel = assertions.some((a) => a.categoryId === 'level');
    return {
        assertions,
        rendered: render(assertions),
        complete: text.trim() === '' || unmatched.length === 0,
        unmatched,
        corrections: [],
        valid: hasLevel,
        errors: hasLevel
            ? []
            : [
                  {
                      constraintId: 'required',
                      message: 'Choose a level.',
                      categoryId: 'level',
                  },
              ],
        warnings: [],
        proposedFixes: [],
        appliedFixes: [],
    };
}

/** Longest-label-first reader over separators and whitespace. */
function parse(text: string): {
    assertions: Assertion[];
    unmatched: { start: number; end: number; text: string }[];
} {
    const assertions: Assertion[] = [];
    const unmatched: { start: number; end: number; text: string }[] = [];
    const upper = text.toUpperCase();
    let i = 0;
    const byLength = [...CONCEPTS].sort(
        (a, b) => b.label.length - a.label.length,
    );
    while (i < text.length) {
        if (/[\s/]/.test(text[i])) {
            i++;
            continue;
        }
        const hit = byLength.find(
            (c) =>
                upper.startsWith(c.label, i) &&
                !/[A-Z0-9]/.test(upper[i + c.label.length] ?? ''),
        );
        if (hit) {
            const single = hit.category === 'level';
            if (single) {
                const at = assertions.findIndex(
                    (a) => a.categoryId === 'level',
                );
                if (at >= 0) assertions.splice(at, 1);
            }
            assertions.push(assertion(hit));
            i += hit.label.length;
            continue;
        }
        let j = i;
        while (j < text.length && !/[\s/]/.test(text[j])) j++;
        unmatched.push({ start: i, end: j, text: text.slice(i, j) });
        i = j;
    }
    return { assertions, unmatched };
}

export class FakePort implements ComposerPort {
    stored: ComposerReading[] = [];
    /** What each store was told about the value it replaced. */
    commits: ComposerCommit[] = [];
    value: { assertions: Assertion[]; rendered: string } = {
        assertions: [],
        rendered: '',
    };
    fixes: Fix[] = [];
    /**
     * The rule errors a reading reports alongside {@link fixes}, the errors
     * those fixes answer (the engine proposes fixes for broken rules).
     */
    fixedErrors: ValidationError[] = [
        {
            constraintId: 'caveat-rule',
            message: 'This caveat is not allowed here.',
            categoryId: 'caveat',
        },
    ];
    /** Rows `gated()` reports for any query. */
    gatedRows: Suggestion[] = [];

    async gated(): Promise<Suggestion[]> {
        return this.gatedRows;
    }

    async read(text: string, base: readonly Assertion[] | null) {
        const parsed = parse(text);
        let assertions = parsed.assertions;
        if (base) {
            let merged = [...base];
            for (const a of assertions) merged = this.add(merged, a);
            assertions = merged;
        }
        const r = reading(assertions, parsed.unmatched, text);
        if (this.fixes.length === 0) return r;
        return {
            ...r,
            valid: false,
            errors: [...r.errors, ...this.fixedErrors],
            proposedFixes: this.fixes,
        };
    }
    async render(assertions: readonly Assertion[]) {
        return reading([...assertions], [], '');
    }
    async suggestions(_live?: readonly Assertion[]): Promise<Suggestion[]> {
        return CONCEPTS.map((c) => ({
            conceptId: c.id,
            categoryId: c.category,
            label: c.label,
            description: c.label,
            name: c.label,
            views: { default: c.label },
            group: c.category === 'level' ? 'Level' : 'Caveat',
            selected: false,
            order: 0,
        }));
    }
    committed() {
        return this.value;
    }
    async store(r: ComposerReading, commit: ComposerCommit) {
        this.stored.push(r);
        this.commits.push(commit);
        this.value = {
            assertions: r.assertions,
            rendered: render(r.assertions),
        };
    }
    separators() {
        return ['//', '/'];
    }
    categories() {
        return [
            { id: 'level', label: 'Level', single: true, required: true },
            { id: 'caveat', label: 'Caveat', single: false, required: false },
        ];
    }
    add(
        assertions: readonly Assertion[],
        ref: { conceptId: string; categoryId: string },
    ) {
        const single = ref.categoryId === 'level';
        const kept = assertions.filter(
            (a) =>
                !(
                    a.conceptId === ref.conceptId &&
                    a.categoryId === ref.categoryId
                ) && !(single && a.categoryId === ref.categoryId),
        );
        return [
            ...kept,
            {
                conceptId: ref.conceptId,
                categoryId: ref.categoryId,
                confidence: 'certain' as const,
                source: 'user' as const,
            },
        ];
    }
    remove(
        assertions: readonly Assertion[],
        ref: { conceptId: string; categoryId: string },
    ) {
        return assertions.filter(
            (a) =>
                !(
                    a.conceptId === ref.conceptId &&
                    a.categoryId === ref.categoryId
                ),
        );
    }
}

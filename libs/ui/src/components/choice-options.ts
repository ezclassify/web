import type {
    Assertion,
    AssertionRef,
    ProcessResult,
    Suggestion,
} from '@ezclassify/types';
import { derivedAssertion, takenFromWhole } from '../assertion-identity';
import { suggestionDepth } from './composer/suggestion-catalog';
import { t } from '../i18n';

export type ChoiceOrigin = 'stated' | 'inferred' | 'inherited';

/** An authored choice wins when the Runtime also explains its derivation. */
export function choiceOrigins(
    assertions: readonly Assertion[],
    categoryId: string,
): ReadonlyMap<string, ChoiceOrigin> {
    const origins = new Map<string, ChoiceOrigin>();
    for (const assertion of assertions) {
        if (assertion.categoryId !== categoryId) continue;
        const current = origins.get(assertion.conceptId);
        if (current === 'stated') continue;
        const origin = takenFromWhole(assertion)
            ? 'inherited'
            : derivedAssertion(assertion)
              ? 'inferred'
              : 'stated';
        if (origin !== 'inherited' || !current)
            origins.set(assertion.conceptId, origin);
    }
    return origins;
}

export interface ChoiceOption<T> {
    concept: T;
    origin: ChoiceOrigin | undefined;
    blocked: boolean;
    depth: number | undefined;
}

type SuggestionsByCategory = ReadonlyMap<
    string,
    ReadonlyMap<string, Suggestion>
>;

function indexSuggestions(rows: readonly Suggestion[]): SuggestionsByCategory {
    const result = new Map<string, Map<string, Suggestion>>();
    for (const row of rows) {
        const category = result.get(row.categoryId) ?? new Map();
        if (!category.has(row.conceptId)) category.set(row.conceptId, row);
        result.set(row.categoryId, category);
    }
    return result;
}

/**
 * Projects Runtime replacement suggestions and suggestions beside the current
 * marking. The caller still owns the DOM, the scope offered to the Runtime and
 * whether it wants to show a blocked row with an explanation.
 */
export class ChoiceAvailability {
    private baseline: SuggestionsByCategory | null = null;
    private baselineSignature = 'null';
    private live: SuggestionsByCategory | null = null;
    private requestKey: string | null = null;
    private revision = 0;
    private loading = Promise.resolve();

    get hasBaseline(): boolean {
        return this.baseline !== null;
    }

    updateBaseline(rows: readonly Suggestion[] | null): boolean {
        const signature = JSON.stringify(
            rows?.map((row) => [
                row.categoryId,
                row.conceptId,
                suggestionDepth(row),
                row.gated ?? false,
            ]) ?? null,
        );
        if (signature === this.baselineSignature) return false;
        this.baselineSignature = signature;
        this.baseline = rows === null ? null : indexSuggestions(rows);
        return true;
    }

    /** A null key withdraws live suggestions. An older answer never redraws. */
    refresh(
        key: string | null,
        read: () => Promise<Suggestion[]>,
        changed: () => void,
    ): Promise<void> {
        if (key === this.requestKey) return this.loading;
        this.requestKey = key;
        const revision = ++this.revision;
        if (key === null) {
            const hadLive = this.live !== null;
            this.live = null;
            this.loading = Promise.resolve();
            if (hadLive) changed();
            return this.loading;
        }
        this.loading = (async () => {
            let answer: SuggestionsByCategory | null;
            try {
                answer = indexSuggestions(await read());
            } catch {
                answer = null;
            }
            if (revision !== this.revision) return;
            this.live = answer;
            changed();
        })();
        return this.loading;
    }

    dispose(): void {
        ++this.revision;
    }

    canAddBeside(categoryId: string, conceptId: string): boolean {
        const row = this.live?.get(categoryId)?.get(conceptId);
        return this.live === null || (row !== undefined && !row.gated);
    }

    choices<T>(
        categoryId: string,
        concepts: readonly T[],
        idOf: (concept: T) => string,
        origins: ReadonlyMap<string, ChoiceOrigin>,
        options: { restrictBeside?: boolean; pending?: string } = {},
    ): ChoiceOption<T>[] {
        const baseline = this.baseline?.get(categoryId);
        const live = this.live?.get(categoryId);
        const available = new Map<string, ChoiceOption<T>>();
        for (const concept of concepts) {
            const id = idOf(concept);
            const origin = origins.get(id);
            if (origin === 'inherited') continue;
            const baseRow = baseline?.get(id);
            const liveRow = live?.get(id);
            const held = origin !== undefined || id === options.pending;
            if (!held && this.baseline !== null && !baseRow && !liveRow)
                continue;
            available.set(id, {
                concept,
                origin,
                blocked:
                    !held &&
                    ((options.restrictBeside &&
                        !this.canAddBeside(categoryId, id)) ||
                        (liveRow?.gated ?? baseRow?.gated ?? false)),
                depth:
                    (liveRow && suggestionDepth(liveRow)) ??
                    (baseRow && suggestionDepth(baseRow)),
            });
        }
        // A live tier order places newly offered children beside their parent.
        // Flat facets retain the Runtime's replacement order followed by additions.
        const tiered = [...(live?.values() ?? [])].some(
            (row) => suggestionDepth(row) !== undefined,
        );
        const sources = tiered ? [live, baseline] : [baseline, live];
        const ordered: ChoiceOption<T>[] = [];
        for (const source of sources) {
            if (!source) continue;
            for (const id of source.keys()) {
                const option = available.get(id);
                if (!option) continue;
                ordered.push(option);
                available.delete(id);
            }
        }
        return [...ordered, ...available.values()];
    }
}

/**
 * Available choices retain root/sibling order, with descendants after their
 * parent.
 */
export function orderChoiceOptions<T extends { concept: { id: string } }>(
    options: readonly T[],
    concepts: readonly { id: string; parents?: readonly string[] }[],
): T[] {
    const byId = new Map(options.map((option) => [option.concept.id, option]));
    const parents = new Map(
        concepts.map((concept) => [concept.id, concept.parents]),
    );
    const children = new Map<string, T[]>();
    const hasParent = new Set<string>();
    for (const option of options) {
        for (const parent of parents.get(option.concept.id) ?? []) {
            if (!byId.has(parent)) continue;
            const siblings = children.get(parent) ?? [];
            siblings.push(option);
            children.set(parent, siblings);
            hasParent.add(option.concept.id);
        }
    }
    const result: T[] = [];
    const seen = new Set<string>();
    const walk = (root: T) => {
        const pending = [root];
        while (pending.length > 0) {
            const option = pending.pop()!;
            if (seen.has(option.concept.id)) continue;
            seen.add(option.concept.id);
            result.push(option);
            pending.push(
                ...[...(children.get(option.concept.id) ?? [])].reverse(),
            );
        }
    };
    options.filter((option) => !hasParent.has(option.concept.id)).forEach(walk);
    // A cycle has no root; still show each available option once.
    options.forEach(walk);
    return result;
}

/**
 * Explain a blocked choice using DecisionFlow's canonical engine-result
 * priority.
 */
export function choiceBlockReason(
    result: Pick<ProcessResult, 'errors' | 'appliedFixes'>,
    conceptId: string,
    currentMessages: readonly string[],
): string {
    const errors = (result.errors ?? []).filter(
        (error) => !currentMessages.includes(error.message),
    );
    const fixes = result.appliedFixes ?? [];
    const touches = (refs: readonly AssertionRef[] | undefined) =>
        (refs ?? []).some((ref) => ref.conceptId === conceptId);
    return (
        errors.find((error) => error.affectedConcepts?.includes(conceptId))
            ?.message ??
        fixes.find((fix) => touches(fix.remove) || touches(fix.add))?.message ??
        fixes.find((fix) => (fix.remove ?? []).length > 0)?.message ??
        errors[0]?.message ??
        t('composer.unavailable')
    );
}

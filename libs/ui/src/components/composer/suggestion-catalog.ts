import type { Assertion, Suggestion } from '@ezclassify/types';

const keyOf = (row: { conceptId: string; categoryId: string }) =>
    JSON.stringify([row.conceptId, row.categoryId]);

/**
 * The picker catalog shared by text composers and immediate concept pickers.
 * Loading is explicit: constructing, invalidating, and reading it never query
 * the engine. An empty-own-value catalog keeps replacement choices reachable;
 * live offerings add concepts that become available only in the current value.
 */
export class SuggestionCatalog {
    private base: Suggestion[] = [];
    private offered: Suggestion[] = [];
    private pending: Promise<void> | null = null;
    private version = 0;
    private liveSequence = 0;
    private livePending: Promise<void> | null = null;
    private liveKey: string | null = '[]';
    private disposed = false;
    private contextKey = '';

    constructor(
        private readonly suggestions: (
            live?: readonly Assertion[],
        ) => Promise<Suggestion[]>,
        private readonly changed: () => void,
    ) {}

    /** Engine-ordered base choices followed by newly offered qualified choices. */
    rows(): Suggestion[] {
        const known = new Set(this.base.map(keyOf));
        return [
            ...this.base,
            ...this.offered.filter((s) => !known.has(keyOf(s))),
        ];
    }

    /** Load the base catalog once, sharing concurrent requests. */
    async load(contextKey = ''): Promise<void> {
        if (this.disposed) return;
        this.useContext(contextKey);
        if (!this.pending) {
            const version = this.version;
            this.pending = (async () => {
                try {
                    const rows = await this.suggestions();
                    if (this.disposed || version !== this.version) return;
                    this.base = rows;
                } catch {
                    if (this.disposed || version !== this.version) return;
                    this.base = [];
                    this.pending = null;
                }
                this.changed();
            })();
        }
        await this.pending;
    }

    /**
     * Refresh live offerings explicitly; late results cannot replace newer
     * ones.
     */
    async refresh(live: readonly Assertion[]): Promise<void> {
        if (this.disposed) return;
        const key = JSON.stringify(
            live.map((a) => [a.conceptId, a.categoryId, a.value]).sort(),
        );
        if (key === this.liveKey) {
            await this.livePending;
            return;
        }
        this.liveKey = key;
        const sequence = ++this.liveSequence;
        this.livePending = (async () => {
            try {
                const rows = live.length ? await this.suggestions(live) : [];
                if (this.disposed || sequence !== this.liveSequence) return;
                this.offered = rows;
                this.changed();
            } catch {
                if (sequence === this.liveSequence) this.liveKey = null;
            }
        })();
        await this.livePending;
    }

    /** Invalidate a changed binding without starting an engine request. */
    useContext(contextKey: string): boolean {
        if (contextKey === this.contextKey) return false;
        this.invalidate();
        this.contextKey = contextKey;
        return true;
    }

    /**
     * Invalidate live results after a value change, retaining replacement
     * choices.
     */
    invalidateLive(): void {
        this.liveSequence++;
        this.livePending = null;
        this.liveKey = null;
        this.offered = [];
    }

    /** Forget an old context without starting work for an inactive field. */
    invalidate(): void {
        this.version++;
        this.liveSequence++;
        this.livePending = null;
        this.base = [];
        this.offered = [];
        this.liveKey = '[]';
        this.pending = null;
    }

    /** Prevent in-flight requests from publishing after teardown. */
    dispose(): void {
        this.disposed = true;
        this.invalidate();
    }
}

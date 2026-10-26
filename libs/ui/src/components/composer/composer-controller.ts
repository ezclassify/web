/**
 * ComposerController: the one headless controller behind every field's picker.
 *
 * TagInput, MarkedInput, MarkedTextArea and MarkingField share one answer to
 * "what does Enter do", "what does blur store" and "what does the list show for
 * this text", so the four cannot drift apart. A field supplies a
 * {@link ComposerPort} (how to read text through its engine binding and how to
 * store a result) and forwards its input's events; everything the user sees and
 * every value that gets stored comes from here.
 *
 * THE MODEL. The draft is what the user typed, held verbatim. On every
 * keystroke the whole draft is read through the engine's tolerant parser, and
 * that reading is the result row: exactly what a commit would store. The list
 * completes the token under the caret; it never commits on its own.
 *
 * THE COMMIT TABLE (enforced by `composer-contract.spec.ts` across all four
 * fields):
 *
 * | Action                                   | Effect                                       |
 * | ---------------------------------------- | -------------------------------------------- |
 * | Enter, Tab, click or tap on a suggestion | replace the caret token with it, re-read the |
 * |                                          | draft, leave no row active                   |
 * | Enter with no active row                 | commit the result                            |
 * | Blur                                     | commit the result, close                     |
 * | Tab with no active row                   | nothing here; focus leaves, so blur commits  |
 * | First Escape                             | close the list, keep the draft               |
 * | Second Escape                            | revert the draft to the committed value      |
 *
 * Commit stores the reading only when it accounts for every character typed.
 * Anything else keeps the draft visible, marks it invalid and stores nothing:
 * the raw string is never stored and typed text is never dropped silently.
 *
 * DRAFT SHAPES. A field whose input is the whole marking (MarkingField and the
 * inline editor behind MarkedInput and MarkedTextArea) reads its text alone. A
 * field whose input only adds to a committed set (TagInput's filter beside its
 * chips) reads its text over a base assertion set. Structural edits (remove,
 * replace in a single-choice category, a rule fix) are made on assertions and
 * written back in the draft's own shape: re-rendered text for a whole-marking
 * draft, a new base for an additive one. Either way the fragments the parser
 * could not read are carried along, never dropped.
 */

import type {
    Assertion,
    Change,
    Fix,
    FixConceptReference,
    Suggestion,
    ValidationError,
    Warning,
} from '@ezclassify/types';
import { SuggestionCatalog } from './suggestion-catalog';
import { takenFromWhole } from '../../assertion-identity';
import { t } from '../../i18n';
import { fixAssertions, ruleErrorsFrom } from '../rule-errors';
import {
    caretToken,
    spliceToken,
    type CaretToken,
    type TextRange,
} from './composer-text';
import {
    closestSpelling,
    rankSuggestions,
    reachesAny,
    type RankedSuggestion,
} from './composer-ranking';

/** One span of the draft the parser could not account for. */
export interface ComposerFragment extends TextRange {
    readonly text: string;
}

/** A departure from canonical that the parser read through. */
export interface ComposerCorrection extends TextRange {
    readonly original: string;
    readonly replacement: string;
    readonly reason: string;
}

/**
 * The engine's reading of a draft: the result row, and what a commit stores.
 * Offsets in `unmatched` and `corrections` are relative to the draft text.
 */
export interface ComposerReading {
    readonly assertions: Assertion[];
    readonly rendered: string;
    /** Every character of the draft was accounted for (or the draft is empty). */
    readonly complete: boolean;
    readonly unmatched: readonly ComposerFragment[];
    readonly corrections: readonly ComposerCorrection[];
    readonly valid: boolean;
    readonly errors: readonly ValidationError[];
    readonly warnings: readonly Warning[];
    readonly proposedFixes: readonly Fix[];
    /**
     * Every fix the engine applied to reach this reading: what reading the
     * draft text corrected (case, separator, order, spelling) and what a rule
     * repaired. A commit hands them to the field's status mark with the value.
     */
    readonly appliedFixes: readonly Change[];
    /** What was read before repair, the basis a rule fix applies to. */
    readonly assertionsBeforeRepair?: Assertion[];
}

/** A category as the composer needs it. */
export interface ComposerCategory {
    readonly id: string;
    readonly label: string;
    readonly single: boolean;
    readonly required: boolean;
}

/** The committed value a field holds right now. */
export interface ComposerCommitted {
    readonly assertions: readonly Assertion[];
    readonly rendered: string;
}

/**
 * What a field provides. Every engine call goes through here, so the controller
 * never learns whether the engine is in-process or remote.
 */
export interface ComposerPort {
    /**
     * Read `text` as a marking through the tolerant parser. `base`, when the
     * draft is additive, is the assertion set the text adds to.
     */
    read(
        text: string,
        base: readonly Assertion[] | null,
    ): Promise<ComposerReading>;
    /** Render an assertion set in the field's format. */
    render(assertions: readonly Assertion[]): Promise<ComposerReading>;
    /**
     * The text an assertion set is written as in the field's format, as it is:
     * a set that breaks a rule is written with everything in it (no repair), so
     * reading the text back reports the rule. Without it, a pick is written as
     * `render` gives it.
     */
    write?(assertions: readonly Assertion[]): Promise<string>;
    /**
     * Every concept the field offers, in engine order. Asked once with no
     * `live` assertions, and again for each new draft with them: a scheme can
     * offer a category only once something in the draft calls for it (the
     * countries a REL TO list takes, say).
     */
    suggestions(live?: readonly Assertion[]): Promise<Suggestion[]>;
    /**
     * Suggestions for `query` that the scheme's rules gate right now, with what
     * each one needs first. Optional; without it no row is shown as gated.
     */
    gated?(query: string, live: readonly Assertion[]): Promise<Suggestion[]>;
    /** The value the field currently stores. */
    committed(): ComposerCommitted;
    /** Store a complete reading as the field's value. */
    store(reading: ComposerReading, commit: ComposerCommit): Promise<void>;
    /** The active format's separators, which bound tokens. */
    separators(): readonly string[];
    /**
     * The categories this field edits, in its active format's declared order,
     * then scheme order for categories the format omits. Includes only the
     * bound category, if any, and none another surface owns.
     */
    categories(): readonly ComposerCategory[];
    /** Extra spellings a user may type for a concept (scheme aliases). */
    aliases?(conceptId: string): readonly string[];
    /** Add a concept as the user's own choice (single-choice replaces). */
    add(
        assertions: readonly Assertion[],
        ref: FixConceptReference,
    ): Assertion[];
    /** Remove a concept and whatever the scheme says goes with it. */
    remove(
        assertions: readonly Assertion[],
        ref: FixConceptReference,
    ): Assertion[];
    /** A short name for a concept id, for gated-row reasons and change marks. */
    conceptName?(conceptId: string): string;
    /**
     * A row for an assertion the catalog does not offer (a concept the engine
     * filled in from a category the surface does not suggest), so every fact in
     * the result shows as a checked row.
     */
    suggestionFor?(assertion: Assertion): Suggestion | undefined;
}

/** Whether the draft is the whole marking or an addition to a base set. */
export type ComposerDraftShape = 'whole' | 'additive';

/** What an accepted concept row does to the draft. */
export type ComposerRowAction = 'add' | 'remove' | 'replace' | 'confirm';

/** A row in the list. Every navigable row has a stable id. */
export type ComposerRow =
    | {
          readonly kind: 'concept';
          readonly id: string;
          readonly suggestion: Suggestion;
          readonly ranked?: RankedSuggestion;
          /** In the marking the result row shows (aria-selected). */
          readonly checked: boolean;
          readonly inferred: boolean;
          readonly action: ComposerRowAction;
          /** For a replace, the label of the concept it replaces. */
          readonly replaces?: string;
          readonly gated: boolean;
          readonly gatedReason?: string;
      }
    | {
          readonly kind: 'correction';
          readonly id: string;
          readonly fragment: ComposerFragment;
          readonly suggestion: Suggestion;
      }
    | {
          readonly kind: 'fix';
          readonly id: string;
          readonly fix: Fix;
          readonly label: string;
      }
    | { readonly kind: 'more'; readonly id: string; readonly count: number };

/** A labeled run of rows: a category in browse, or corrections. */
export interface ComposerGroup {
    readonly id: string;
    readonly label: string;
    readonly rows: ComposerRow[];
}

/** A category the result still needs (required) or the rules suggest. */
export interface ComposerNeed {
    readonly categoryId: string;
    readonly label: string;
    readonly kind: 'required' | 'suggested';
}

/** One fact's change between the committed value and the result. */
export interface ComposerChange {
    readonly kind: 'added' | 'removed' | 'reordered';
    readonly label: string;
}

/** Why the last commit stored nothing. */
export interface ComposerProblem {
    readonly fragment: string;
    readonly suggestion?: string;
    /**
     * The scheme rule the draft breaks when every character was read but the
     * reading is still not one complete marking (two values in a single-choice
     * category, say). Its message says more than "not recognized" would.
     */
    readonly rule?: string;
}

/**
 * The message that best explains a draft with no single complete reading: the
 * first engine error, or, when it reports none, that it does not read as one
 * marking.
 */
export function ruleMessageOf(reading: ComposerReading): string {
    return (
        ruleErrorsFrom(reading.errors, []).messages[0] ??
        t('composer.noReading')
    );
}

/** Everything a view renders, recomputed on every change. */
export interface ComposerSnapshot {
    readonly open: boolean;
    readonly text: string;
    readonly caret: number;
    readonly token: CaretToken;
    /** The reading of the current text, or null while none has landed. */
    readonly reading: ComposerReading | null;
    /** True when `reading` belongs to an older text than `text`. */
    readonly stale: boolean;
    readonly mode: 'ranked' | 'browse';
    readonly groups: ComposerGroup[];
    /** Navigable rows in display order; `activeIndex` indexes this. */
    readonly rows: ComposerRow[];
    /** Gated rows, shown after the list and never navigable. */
    readonly gatedRows: ComposerRow[];
    readonly activeIndex: number;
    readonly needs: ComposerNeed[];
    /**
     * Available categories in declared order, independent of the current
     * filter.
     */
    readonly categories: readonly ComposerCategory[];
    readonly scope: string | null;
    readonly changes: ComposerChange[];
    readonly invalid: boolean;
    readonly problem: ComposerProblem | null;
    readonly dirty: boolean;
}

/** Outcome of a commit. */
export type CommitOutcome = 'stored' | 'unchanged' | 'invalid';

/** Controller options. */
export interface ComposerOptions {
    readonly port: ComposerPort;
    readonly shape: ComposerDraftShape;
    /** Visible ranked rows before the "more" row. Default 8. */
    readonly cap?: number;
    /** Polite announcements for the field's live region. */
    readonly announce?: (text: string) => void;
}

type Listener = (snapshot: ComposerSnapshot) => void;

interface RowLookup {
    categories: readonly ComposerCategory[];
    heldByKey: Map<string, Assertion>;
    statedByCategory: Map<string, Assertion>;
    singleCategories: Set<string>;
    labelsByKey: Map<string, string>;
}

const EMPTY_TOKEN: CaretToken = { start: 0, end: 0, query: '' };

/** Row ids are DOM ids, so anything outside a safe set is escaped. */
function idPart(value: string): string {
    // Every character outside [A-Za-z0-9-], "_" included, becomes "_<hex>_",
    // so two different values can never produce the same id.
    return value.replace(
        /[^A-Za-z0-9-]/g,
        (c) => `_${c.charCodeAt(0).toString(16)}_`,
    );
}

/**
 * True when an unread fragment is the token still being typed: it overlaps a
 * non-empty caret token. Such a fragment is in progress, not a mistake.
 */
export function isTypingFragment(
    fragment: TextRange,
    token: CaretToken,
): boolean {
    return (
        token.query.length > 0 &&
        fragment.start < token.end &&
        fragment.end > token.start
    );
}

function keyOf(a: { conceptId: string; categoryId: string }): string {
    return `${a.categoryId}\u0000${a.conceptId}`;
}

/**
 * The assertions a user stated, without what the engine inferred, filled in by
 * default or took from the whole the marking is a part of. A re-render hands
 * the engine only these, so it derives the rest again instead of pinning a
 * stale inference or writing the whole's list into a part that stood for it.
 */
export function statedAssertions(
    assertions: readonly Assertion[],
): Assertion[] {
    return assertions.filter(
        (a) =>
            a.confidence !== 'inferred' &&
            a.source !== 'default' &&
            !takenFromWhole(a),
    );
}

/**
 * Whether marks that now state `after` replace marks that stated `before`
 * rather than only adding to them: some mark of `before` states something that
 * no mark of `after` still states along with the rest of that mark. This is the
 * rule {@link ComposerCommit.replaces} follows, and the fields apply it to the
 * edits that do not commit through a composer: a tag removed with its ×, a
 * pressed fix, text written straight into a marked field. A field that holds
 * one marking passes one mark on each side. MarkedTextArea passes one per
 * paragraph, so adding, moving or extending a paragraph's mark replaces
 * nothing.
 *
 * @param before - What each mark stated when the field last recorded its fixes
 * @param after - What each mark states now
 * @returns True when something `before` stated is no longer held
 */
export function replacesMarks(
    before: readonly (readonly Assertion[])[],
    after: readonly (readonly Assertion[])[],
): boolean {
    const held = after.map(
        (mark) => new Set(statedAssertions(mark).map(keyOf)),
    );
    // A mark read again unchanged is the common case; only a mark with no
    // exact match needs the containment scan.
    const exact = new Set(held.map(markKey));
    return before.some((mark) => {
        const stated = new Set(statedAssertions(mark).map(keyOf));
        if (stated.size === 0 || exact.has(markKey(stated))) return false;
        return !held.some((keys) => [...stated].every((k) => keys.has(k)));
    });
}

/**
 * {@link replacesMarks} for a field that holds one marking.
 *
 * @param before - What the field stated when it last recorded its fixes
 * @param after - What it states now
 * @returns True when something `before` stated is no longer held
 */
export function replacesStated(
    before: readonly Assertion[],
    after: readonly Assertion[],
): boolean {
    return replacesMarks([before], [after]);
}

function markKey(keys: ReadonlySet<string>): string {
    return [...keys].sort().join('\u0001');
}

/** What a commit does to the value it stores over. */
export interface ComposerCommit {
    /**
     * The stored reading replaces the committed value rather than only adding
     * to it: every whole-marking draft, and an additive draft that drops
     * something the field held (a pasted marking that starts over, a chip
     * removed in the draft). What was said about the replaced value, such as
     * the fixes behind it, no longer describes the field.
     */
    readonly replaces: boolean;
}

/** See the module comment. */
export class ComposerController {
    private readonly port: ComposerPort;
    /** Whether the draft is the whole marking or text added over a base. */
    readonly shape: ComposerDraftShape;
    private readonly announceText: (text: string) => void;
    private cap: number;

    private _open = false;
    private text = '';
    private caret = 0;
    private base: Assertion[] | null = null;
    /**
     * An additive draft's base was changed by the user (a remove, replace, fix
     * or paste). Until then the base is simply the committed set, and follows
     * it when the field's value changes from outside.
     */
    private baseEdited = false;
    /**
     * The committed text a whole-marking draft was last reset to. Dirty means
     * the user changed the draft since, not that it differs from whatever is
     * committed now: a value that changes from outside under an untouched draft
     * must replace the draft, not be treated as the user's edit.
     */
    private baselineText = '';
    private reading: ComposerReading | null = null;
    /**
     * What the current reading was read from: the text plus the versions of the
     * value it builds on. A reading is only good for the key it was made for.
     * Text alone is not enough: a chip removed, or a value changed from
     * outside, under an unchanged text makes the old reading wrong.
     */
    private readingKey = '';
    /**
     * The reading came from a structural edit (a rule fix), not from the text,
     * so the draft is dirty even when its text matches the stored rendering:
     * the edit may change what the rendering cannot show.
     */
    private structural = false;
    /** Bumped whenever the committed value changes. */
    private committedVersion = 0;
    /** Bumped whenever an additive draft's edited base changes. */
    private baseVersion = 0;
    /**
     * Bumped when something a reading depends on besides the draft changed,
     * such as the parts a whole must cover.
     */
    private contextVersion = 0;
    private readSeq = 0;
    /** The commit in flight, so a second commit waits for it. */
    private commitChain: Promise<unknown> = Promise.resolve();
    /** Bumped on every reset to the committed value (a revert, a commit). */
    private resets = 0;
    private pendingRead: Promise<void> | null = null;
    /** Every row the list can offer: the base catalog, then `contextual`. */
    private catalog: Suggestion[] = [];
    private readonly suggestionCatalog = new SuggestionCatalog(
        (live) => this.port.suggestions(live),
        () => {
            this.catalog = this.suggestionCatalog.rows();
            this.reconcileScope();
            this.emit();
        },
    );
    /**
     * Rows this open has listed beyond the catalog (a concept only the draft
     * held). A removed one stays listed, unchecked, so it can be added back.
     */
    private listed = new Map<string, Suggestion>();
    private gatedByKey = new Map<string, Suggestion>();
    private gatedSeq = 0;
    private activeIndex = -1;
    /** The user moved the active row; arming must not override it. */
    private navigated = false;
    /** An accept just landed: nothing is armed until the user types again. */
    private disarmed = false;
    /**
     * Just opened and not yet typed in or moved within: the list browses
     * instead of completing whatever word the caret happens to sit after.
     */
    private browsing = false;
    /**
     * Where the space a pick left after its insertion sits, or -1. Cleared by
     * any edit that is not a separator typed straight after it.
     */
    private softSpaceAt = -1;
    private showMore = false;
    private scope: string | null = null;
    private invalid = false;
    private problem: ComposerProblem | null = null;
    private busy: Promise<unknown> = Promise.resolve();
    private readonly listeners = new Set<Listener>();
    private snapshotCache: ComposerSnapshot | null = null;

    constructor(options: ComposerOptions) {
        this.port = options.port;
        this.shape = options.shape;
        this.cap = options.cap ?? 8;
        this.announceText = options.announce ?? (() => {});
        this.resetToCommitted();
    }

    // --- Subscription ------------------------------------------------------

    /** Subscribe to snapshots; returns the unsubscribe. */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** The current snapshot. */
    snapshot(): ComposerSnapshot {
        if (!this.snapshotCache) this.snapshotCache = this.buildSnapshot();
        return this.snapshotCache;
    }

    private emit(): void {
        this.snapshotCache = null;
        const snap = this.snapshot();
        for (const listener of this.listeners) listener(snap);
    }

    // --- Lifecycle ---------------------------------------------------------

    get isOpen(): boolean {
        return this._open;
    }

    /** Set how many ranked rows show before the "more" row. */
    setCap(cap: number): void {
        if (cap === this.cap) return;
        this.cap = cap;
        this.emit();
    }

    /**
     * Open the list: loads the catalog once, reads the draft if needed.
     *
     * @param browse - Start by browsing (an explicit open: a press, ArrowDown,
     *   an editor opening) rather than completing the word the caret happens to
     *   sit after. An open caused by typing passes false: the user is
     *   completing that word.
     */
    async open(browse = true): Promise<void> {
        if (!this._open) {
            this._open = true;
            this.showMore = false;
            this.browsing = browse;
            this.emit();
        }
        await this.loadCatalog();
        if (this.readingKey !== this.readKey() || !this.reading) {
            await this.read();
        } else {
            this.arm();
            this.emit();
        }
    }

    /** Close the list. The draft is untouched. */
    close(): void {
        if (!this._open) return;
        this._open = false;
        this.listed.clear();
        this.activeIndex = -1;
        this.navigated = false;
        this.scope = null;
        this.showMore = false;
        this.emit();
    }

    /** Discard an editing session without committing its draft. */
    discard(): void {
        this.close();
        this.resetToCommitted();
        this.emit();
    }

    /** Forget the cached catalog, for a field whose scheme or scope changed. */
    invalidateCatalog(): void {
        this.suggestionCatalog.invalidate();
        this.gatedSeq++;
        this.gatedByKey.clear();
        this.catalog = [];
        this.scope = null;
    }

    /**
     * Categories stay reachable when a query or category filter narrows the
     * list.
     */
    private browseCategories(
        declared = this.port.categories(),
    ): ComposerCategory[] {
        const available = new Map<string, string>();
        for (const s of [...this.catalog, ...this.uncatalogued()]) {
            if (s.gated || this.gatedByKey.has(keyOf(s))) continue;
            if (!available.has(s.categoryId))
                available.set(s.categoryId, s.group || s.categoryId);
        }
        const categories: ComposerCategory[] = [];
        for (const c of declared) {
            if (available.delete(c.id)) categories.push(c);
        }
        for (const [id, label] of available) {
            categories.push({ id, label, single: false, required: false });
        }
        return categories;
    }

    private reconcileScope(): void {
        if (
            this.scope &&
            !this.browseCategories().some((c) => c.id === this.scope)
        )
            this.scope = null;
    }

    /**
     * Ask what the field offers with the draft's assertions, when they changed.
     * A category the scheme only offers because of something in the draft lists
     * all of its concepts, not just the ones already in it.
     */
    private async refreshOffered(): Promise<void> {
        await this.suggestionCatalog.refresh(
            statedAssertions(this.liveAssertions()),
        );
    }

    /**
     * The field's committed value changed from outside (a setValue, a favorite,
     * a sibling view): a draft that matched the old value follows it; a dirty
     * draft is left alone.
     */
    syncCommitted(): void {
        this.committedVersion++;
        if (this.isDirty()) {
            // The draft stays, but what it builds on moved: read it again so
            // the result row describes what a commit would now store.
            if (this.reading) void this.read();
            return;
        }
        this.resetToCommitted();
        this.emit();
    }

    /**
     * Something the draft is read against changed, not the draft itself (the
     * parts a whole must cover): read it again so the result row and the fix
     * rows describe what a commit would now meet. Nothing to do while the
     * composer is closed on a clean draft; the next open reads fresh.
     */
    refreshContext(): Promise<void> {
        this.contextVersion++;
        this.invalidateCatalog();
        if (!this._open && !this.isDirty()) return Promise.resolve();
        return this.loadCatalog().then(() => this.read());
    }

    private resetToCommitted(): void {
        this.resets++;
        this.structural = false;
        // Any read still in flight was for the draft being thrown away.
        this.readSeq++;
        this.pendingRead = null;
        this.committedVersion++;
        const committed = this.port.committed();
        if (this.shape === 'whole') {
            this.text = committed.rendered;
            this.baselineText = committed.rendered;
            this.base = null;
        } else {
            this.text = '';
            this.base = [...committed.assertions];
        }
        this.baseEdited = false;
        this.caret = this.text.length;
        this.reading = null;
        this.readingKey = '';
        this.invalid = false;
        this.problem = null;
        this.activeIndex = -1;
        this.navigated = false;
        this.disarmed = false;
        this.showMore = false;
        // Nothing is being typed any more: the list browses the categories,
        // not a search for the last word of the stored marking.
        this.browsing = true;
        // Still open (the phone sheet after a fix or Done-less commit): read
        // the stored value at once, so the result row and the list describe
        // it instead of the draft they replaced.
        if (this._open) void this.read();
    }

    // --- Text --------------------------------------------------------------

    /**
     * The input's text or caret changed. A text change clears any active row
     * the user picked and re-reads the draft; a caret move only re-targets the
     * token.
     */
    input(text: string, caret: number): Promise<void> {
        ({ text, caret } = this.attachSeparator(text, caret));
        const textChanged = text !== this.text;
        const caretMoved = caret !== this.caret;
        this.text = text;
        this.caret = caret;
        // Only typing ends browsing: a click or caret move into a finished
        // word is not a request to complete it.
        if (textChanged) this.browsing = false;
        if (!textChanged) {
            if (caretMoved) {
                // A new caret position completes a different token, so the
                // old active row no longer means anything.
                this.activeIndex = -1;
                this.navigated = false;
                this.showMore = false;
                this.arm();
            }
            this.emit();
            return Promise.resolve();
        }
        this.activeIndex = -1;
        this.navigated = false;
        this.disarmed = false;
        this.showMore = false;
        if (this.invalid) {
            this.invalid = false;
            this.problem = null;
        }
        this.emit();
        return this.read();
    }

    /**
     * Start the draft over from `text` alone: for an additive draft the base
     * set is dropped, so the text stands for the whole value (a pasted
     * marking). The result row shows what that stores before anything is.
     */
    startOver(text: string): Promise<void> {
        if (this.shape === 'additive') {
            this.base = [];
            this.baseEdited = true;
            this.baseVersion++;
        }
        this.text = '';
        return this.input(text, text.length);
    }

    /** Remove a chosen fact from the draft, carrying every unread fragment. */
    async remove(ref: FixConceptReference): Promise<void> {
        await this.settle();
        const reading =
            this.readingKey === this.readKey() ? this.reading : null;
        if (!reading) return;
        const stated = statedAssertions(reading.assertions);
        this.browsing = true;
        await this.rewrite(this.port.remove(stated, ref), reading.unmatched);
    }

    /**
     * The reading of the draft as it stands now, when it reads completely: what
     * a commit would store. Null while the draft is unread, stale or
     * incomplete, so a caller never mistakes typed text for a marking.
     */
    completeReading(): ComposerReading | null {
        if (!this.reading || this.readingKey !== this.readKey()) return null;
        return this.reading.complete ? this.reading : null;
    }

    /** The current draft text. */
    get draftText(): string {
        return this.text;
    }

    /** Caret offset the view should restore after a controller edit. */
    get draftCaret(): number {
        return this.caret;
    }

    /** The base an additive read builds on: the edited base, or committed. */
    private currentBase(): Assertion[] | null {
        if (this.shape === 'whole') return null;
        return this.baseEdited
            ? (this.base ?? [])
            : [...this.port.committed().assertions];
    }

    /** The key a reading of the draft as it stands now would carry. */
    private readKey(): string {
        const base = this.baseEdited ? `e${this.baseVersion}` : 'c';
        return `${this.committedVersion}\u0000${this.contextVersion}\u0000${base}\u0000${this.text}`;
    }

    private async read(): Promise<void> {
        // Reading the text again replaces a structural edit's reading.
        this.structural = false;
        const text = this.text;
        const key = this.readKey();
        const base = this.currentBase();
        const seq = ++this.readSeq;
        const run = (async () => {
            let reading: ComposerReading;
            try {
                reading = await this.port.read(text, base);
            } catch {
                // A transient failure (network, abort) keeps the last reading
                // rather than blanking the result row for one keystroke.
                return;
            }
            if (seq !== this.readSeq) return;
            this.reading = reading;
            this.readingKey = key;
            this.refreshGated();
            this.arm();
            this.emit();
            this.announceReading();
            void this.refreshOffered();
        })();
        this.pendingRead = run;
        await run;
        if (this.pendingRead === run) this.pendingRead = null;
    }

    /** Wait until the reading belongs to the current text. */
    async settle(): Promise<void> {
        await this.busy;
        await this.settleReads();
    }

    /**
     * Wait for reads only. Used from inside an activation, which is itself what
     * `busy` waits on.
     */
    private async settleReads(): Promise<void> {
        while (this.pendingRead) {
            const pending = this.pendingRead;
            await pending;
            if (this.pendingRead === pending) this.pendingRead = null;
        }
        if (this.readingKey !== this.readKey()) await this.read();
    }

    private async loadCatalog(): Promise<void> {
        await this.suggestionCatalog.load();
    }

    private refreshGated(): void {
        const query = this.currentToken().query;
        const gated = this.port.gated;
        if (!gated || !query) {
            ++this.gatedSeq;
            if (this.gatedByKey.size > 0) this.gatedByKey = new Map();
            return;
        }
        const seq = ++this.gatedSeq;
        const live = this.reading?.assertions ?? [];
        void gated
            .call(this.port, query, live)
            .then((rows) => {
                if (seq !== this.gatedSeq) return;
                const next = new Map<string, Suggestion>();
                for (const row of rows)
                    if (row.gated) next.set(keyOf(row), row);
                this.gatedByKey = next;
                this.reconcileScope();
                this.emit();
            })
            .catch(() => {});
    }

    // --- Rows --------------------------------------------------------------

    private aliasesOf = (s: Suggestion): readonly string[] =>
        this.port.aliases?.(s.conceptId) ?? [];

    private currentToken(completing = false): CaretToken {
        if (!this.text) return EMPTY_TOKEN;
        if (this.browsing && !completing) {
            return { start: this.caret, end: this.caret, query: '' };
        }
        const token = caretToken(
            this.text,
            this.caret,
            this.port.separators(),
            (q) => reachesAny(q, this.catalog, this.aliasesOf),
        );
        if (this.browsing && !this.tokenUnread(token)) {
            return { start: this.caret, end: this.caret, query: '' };
        }
        return token;
    }

    private conceptRow(
        suggestion: Suggestion,
        lookup: RowLookup,
        ranked?: RankedSuggestion,
    ): ComposerRow {
        const key = keyOf(suggestion);
        const held = lookup.heldByKey.get(key);
        const inferred = held?.confidence === 'inferred';
        const checked = !!held;
        let action: ComposerRowAction = 'add';
        let replaces: string | undefined;
        // The token under the caret spells this concept exactly: the row is
        // what the user is typing, not something already chosen, so taking it
        // completes the spelling rather than removing it.
        const typed = ranked?.tier === 'exact' && checked;
        if (checked && !typed) {
            action = inferred ? 'confirm' : 'remove';
        } else if (checked) {
            action = 'add';
        } else if (lookup.singleCategories.has(suggestion.categoryId)) {
            const other = lookup.statedByCategory.get(suggestion.categoryId);
            if (other) {
                action = 'replace';
                replaces =
                    lookup.labelsByKey.get(keyOf(other)) ??
                    this.port.conceptName?.(other.conceptId) ??
                    other.conceptId;
            }
        }
        const gatedRow = this.gatedByKey.get(key);
        const gated = !!(gatedRow ?? suggestion.gated);
        return {
            kind: 'concept',
            id: `c-${idPart(suggestion.categoryId)}-${idPart(suggestion.conceptId)}`,
            suggestion: gatedRow ? { ...suggestion, ...gatedRow } : suggestion,
            ranked,
            checked,
            inferred,
            action,
            replaces,
            gated,
            gatedReason: gated
                ? this.gatedReason(gatedRow ?? suggestion)
                : undefined,
        };
    }

    private gatedReason(s: Suggestion): string {
        const requires = s.requires ?? [];
        if (requires.length === 0) return t('composer.unavailable');
        const names = requires.map(
            (id, i) =>
                s.requiresDisplay?.[i] ?? this.port.conceptName?.(id) ?? id,
        );
        return t('composer.addFirst').replace(
            '{names}',
            names.join(t('composer.namesSeparator')),
        );
    }

    /** Corrections and rule fixes, offered first while anything is wrong. */
    private correctionRows(token: CaretToken): ComposerRow[] {
        const reading = this.reading;
        if (!reading || this.readingKey !== this.readKey()) return [];
        const rows: ComposerRow[] = [];
        for (const fragment of reading.unmatched) {
            // The token under the caret is still being typed; the list
            // completes it, so it is not a mistake yet.
            if (isTypingFragment(fragment, token)) continue;
            for (const part of this.correctable(fragment)) {
                const close = closestSpelling(
                    part.text,
                    this.catalog,
                    this.aliasesOf,
                );
                if (!close) continue;
                rows.push({
                    kind: 'correction',
                    id: `dym-${part.start}`,
                    fragment: part,
                    suggestion: close.suggestion,
                });
            }
        }
        // The ways to fix the engine's errors, each resulting marking
        // once, exactly as the field's error area offers them.
        const { fixes } = ruleErrorsFrom(reading.errors, reading.proposedFixes);
        fixes.forEach(({ fix, label }, i) => {
            rows.push({ kind: 'fix', id: `fix-${i}`, fix, label });
        });
        return rows;
    }

    /**
     * The pieces of an unread fragment worth a "did you mean": the fragment
     * itself when one spelling is close to all of it, otherwise each of its
     * words. The parser often reports two misspelled words as one span.
     */
    private correctable(fragment: ComposerFragment): ComposerFragment[] {
        const whole = fragment.text.trim();
        if (!/\s/.test(whole)) return [fragment];
        if (closestSpelling(whole, this.catalog, this.aliasesOf)) {
            return [fragment];
        }
        const parts: ComposerFragment[] = [];
        const word = /\S+/g;
        for (
            let m = word.exec(fragment.text);
            m;
            m = word.exec(fragment.text)
        ) {
            parts.push({
                start: fragment.start + m.index,
                end: fragment.start + m.index + m[0].length,
                text: m[0],
            });
        }
        return parts;
    }

    private buildRows(token: CaretToken): {
        mode: 'ranked' | 'browse';
        groups: ComposerGroup[];
        rows: ComposerRow[];
        gatedRows: ComposerRow[];
        labelsByKey: ReadonlyMap<string, string>;
        categories: readonly ComposerCategory[];
    } {
        const lookup = this.rowLookup();
        const categories = this.browseCategories(lookup.categories);
        const inScope = (s: Suggestion) =>
            !this.scope || s.categoryId === this.scope;
        const offered = this.correctionRows(token);
        const groups: ComposerGroup[] = [];
        // The ways to fix an engine error, under the same heading the field's
        // error area gives them, then spelling corrections.
        const corrections = offered.filter((r) => r.kind === 'correction');
        const fixes = offered.filter((r) => r.kind === 'fix');
        // The ways to fix an engine error lead: they are what the user most
        // likely wants, and on a phone with the keyboard up the first rows
        // may be all that shows.
        if (fixes.length > 0) {
            groups.push({
                id: 'fixes',
                label: t('fix.heading'),
                rows: fixes,
            });
        }
        if (corrections.length > 0) {
            groups.push({
                id: 'corrections',
                label: t('composer.corrections'),
                rows: corrections,
            });
        }
        const gatedRows: ComposerRow[] = [];
        let mode: 'ranked' | 'browse';
        const search = token.query
            ? this.searchRows(token.query, lookup)
            : null;
        // A search that finds nothing in a draft that reads completely is no
        // miss worth reporting: the word under the caret is simply the last
        // one of a whole marking. The list browses instead.
        const missed =
            search !== null &&
            search.available.length === 0 &&
            search.extra.length === 0 &&
            this.readsCompletely();
        if (search && !missed) {
            mode = 'ranked';
            gatedRows.push(...search.gated);
            const { available, extra } = search;
            const overflow = [...available.slice(this.cap), ...extra];
            const shown = this.showMore
                ? [...available, ...extra]
                : available.slice(0, this.cap);
            const rows = [...shown];
            if (!this.showMore && overflow.length > 0) {
                rows.push({
                    kind: 'more',
                    id: 'more',
                    count: overflow.length,
                });
            }
            groups.push({ id: 'matches', label: '', rows });
        } else {
            mode = 'browse';
            const rank = new Map<string, number>();
            const labels = new Map<string, string>();
            categories.forEach((c, index) => {
                const id = c.id;
                rank.set(id, index);
                labels.set(id, c.label);
            });
            const byGroup = new Map<string, ComposerRow[]>();
            const order: string[] = [];
            // One row per concept per category, whichever source offers it.
            const seen = new Set<string>();
            for (const s of [...this.catalog, ...this.uncatalogued()].filter(
                inScope,
            )) {
                if (seen.has(keyOf(s))) continue;
                seen.add(keyOf(s));
                const row = this.conceptRow(s, lookup);
                if (row.kind === 'concept' && row.gated) {
                    gatedRows.push(row);
                    continue;
                }
                if (!byGroup.has(s.categoryId)) {
                    byGroup.set(s.categoryId, []);
                    order.push(s.categoryId);
                    if (!labels.has(s.categoryId))
                        labels.set(s.categoryId, s.group || s.categoryId);
                }
                byGroup.get(s.categoryId)!.push(row);
            }
            // After a separator, omit filled single-choice categories unless the
            // author explicitly browses one to replace its value.
            const filled = this.startsNewPart(token)
                ? this.filledSingleChoice(lookup.singleCategories)
                : new Set<string>();
            order.sort(
                (a, b) =>
                    (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
                    (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
            );
            for (const id of order) {
                if (filled.has(id) && this.scope !== id) continue;
                groups.push({
                    id: `g-${idPart(id)}`,
                    label: labels.get(id)!,
                    rows: byGroup.get(id)!,
                });
            }
        }
        const rows = groups.flatMap((g) => g.rows);
        return {
            mode,
            groups,
            rows,
            gatedRows,
            labelsByKey: lookup.labelsByKey,
            categories,
        };
    }

    /**
     * A separator typed straight after the space a pick left attaches to the
     * word before it: "CONFIDENTIAL //" reads "CONFIDENTIAL//". The space was
     * only there to let the next word be typed; the user chose a separator
     * instead.
     */
    private attachSeparator(
        text: string,
        caret: number,
    ): { text: string; caret: number } {
        // A caret move alone keeps the space in play.
        if (text === this.text) return { text, caret };
        const at = this.softSpaceAt;
        this.softSpaceAt = -1;
        if (at < 0 || this.text[at] !== ' ') return { text, caret };
        const typed = text.length - this.text.length;
        const inserted = text.slice(at + 1, at + 1 + typed);
        const unchanged =
            typed > 0 &&
            caret === at + 1 + typed &&
            text.slice(0, at + 1) === this.text.slice(0, at + 1) &&
            text.slice(at + 1 + typed) === this.text.slice(at + 1);
        const separator = this.port
            .separators()
            .map((sep) => sep.trim())
            .some((sep) => sep !== '' && inserted.startsWith(sep[0]));
        if (!unchanged || !separator) return { text, caret };
        return {
            text: text.slice(0, at) + text.slice(at + 1),
            caret: caret - 1,
        };
    }

    /** The catalog's rows for a search, split the way the list shows them. */
    private rowLookup(): RowLookup {
        const heldByKey = new Map<string, Assertion>();
        const statedByCategory = new Map<string, Assertion>();
        for (const assertion of this.liveAssertions()) {
            // A value taken from the whole is not held by this marking: its
            // row stays an ordinary one the user may add.
            if (takenFromWhole(assertion)) continue;
            const key = keyOf(assertion);
            if (!heldByKey.has(key)) heldByKey.set(key, assertion);
            if (
                assertion.confidence !== 'inferred' &&
                assertion.source !== 'default' &&
                !statedByCategory.has(assertion.categoryId)
            ) {
                statedByCategory.set(assertion.categoryId, assertion);
            }
        }
        const categories = this.port.categories();
        const singleCategories = new Set(
            categories
                .filter((category) => category.single)
                .map((category) => category.id),
        );
        const labelsByKey = new Map<string, string>();
        for (const suggestion of this.catalog) {
            const key = keyOf(suggestion);
            if (!labelsByKey.has(key)) labelsByKey.set(key, suggestion.label);
        }
        return {
            categories,
            heldByKey,
            statedByCategory,
            singleCategories,
            labelsByKey,
        };
    }

    private searchRows(
        query: string,
        lookup: RowLookup,
    ): {
        available: ComposerRow[];
        extra: ComposerRow[];
        gated: ComposerRow[];
    } {
        const inScope = (s: Suggestion) =>
            !this.scope || s.categoryId === this.scope;
        const ranked = rankSuggestions(
            query,
            this.catalog.filter(inScope),
            this.aliasesOf,
        );
        const available: ComposerRow[] = [];
        const extra: ComposerRow[] = [];
        const gated: ComposerRow[] = [];
        for (const r of [...ranked.primary, ...ranked.more]) {
            const row = this.conceptRow(r.suggestion, lookup, r);
            if (row.kind === 'concept' && row.gated) gated.push(row);
            else if (r.tier === 'substring') extra.push(row);
            else available.push(row);
        }
        return { available, extra, gated };
    }

    /** The current draft has a current reading, and it reads completely. */
    private readsCompletely(): boolean {
        return (
            !!this.reading &&
            this.readingKey === this.readKey() &&
            this.reading.complete
        );
    }

    /**
     * Whether the caret sits right after a separator with nothing typed yet:
     * the user is starting the next part of the marking.
     */
    private startsNewPart(token: CaretToken): boolean {
        if (token.query) return false;
        const before = this.text.slice(0, this.caret).trimEnd();
        return this.port
            .separators()
            .some((sep) => sep.trim() !== '' && before.endsWith(sep.trim()));
    }

    /** Single-choice categories the current reading already holds a value in. */
    private filledSingleChoice(
        singleCategories: ReadonlySet<string>,
    ): Set<string> {
        const live = this.reading?.assertions ?? this.currentBase() ?? [];
        const out = new Set<string>();
        for (const a of live) {
            if (a.confidence === 'inferred') continue;
            if (singleCategories.has(a.categoryId)) out.add(a.categoryId);
        }
        return out;
    }

    /** Facts in the result that the catalog has no row for. */
    private uncatalogued(): Suggestion[] {
        const reading = this.reading;
        if (!reading || !this.port.suggestionFor) return [];
        const known = new Set(this.catalog.map(keyOf));
        // Only the categories this field edits: a field bound to one
        // category does not list what the engine put in another.
        const edited = new Set(this.port.categories().map((c) => c.id));
        for (const a of this.liveAssertions()) {
            if (takenFromWhole(a)) continue;
            if (known.has(keyOf(a)) || !edited.has(a.categoryId)) continue;
            if (this.listed.has(keyOf(a))) continue;
            const s = this.port.suggestionFor(a);
            if (s) this.listed.set(keyOf(a), s);
        }
        // Listed once, listed for the rest of this open: a concept the user
        // just removed stays where it was, unchecked. One the catalog has
        // since come to offer (asked again for the draft) is its row, not a
        // second one.
        return [...this.listed.values()].filter((s) => !known.has(keyOf(s)));
    }

    /** The resulting draft facts, for checking picker rows. */
    private liveAssertions(): Assertion[] {
        return this.reading?.assertions ?? this.currentBase() ?? [];
    }

    /**
     * Arm the best completion, but only for a token the parser cannot read yet.
     * A token that already reads as a concept is finished, so Enter must commit
     * it rather than swap it for a longer neighbor.
     */
    private arm(): void {
        // Nothing is armed behind a closed list: Enter must never accept a row
        // the user cannot see.
        if (!this._open) return;
        if (this.navigated || this.disarmed || this.activeIndex >= 0) return;
        const token = this.currentToken();
        if (!token.query || !this.tokenUnread(token)) return;
        const { rows } = this.buildRows(token);
        const first = rows.findIndex(
            (r) => r.kind === 'concept' && !r.gated && r.action !== 'remove',
        );
        if (first >= 0 && rows[first].kind === 'concept') {
            this.activeIndex = first;
        }
    }

    private tokenUnread(token: CaretToken): boolean {
        const reading = this.reading;
        if (!reading) return true;
        return reading.unmatched.some((f) => isTypingFragment(f, token));
    }

    // --- Needs and changes --------------------------------------------------

    private needs(): ComposerNeed[] {
        const reading = this.reading;
        if (!reading) return [];
        const present = new Set(reading.assertions.map((a) => a.categoryId));
        const flagged = new Set(
            reading.errors.map((error) => error.categoryId),
        );
        const categories = this.port.categories();
        const categoryById = new Map(
            categories.map((category) => [category.id, category]),
        );
        const out: ComposerNeed[] = [];
        const seen = new Set<string>();
        for (const category of categories) {
            if (present.has(category.id)) continue;
            // A required category the engine left empty is a need when the
            // engine also judged the result invalid; the engine is the judge
            // of validity, the scheme's declared `required` names the gap.
            if (
                flagged.has(category.id) ||
                (category.required && !reading.valid)
            ) {
                out.push({
                    categoryId: category.id,
                    label: category.label,
                    kind: 'required',
                });
                seen.add(category.id);
            }
        }
        for (const w of reading.warnings) {
            if (!w.categoryId || seen.has(w.categoryId)) continue;
            if (present.has(w.categoryId)) continue;
            const category = categoryById.get(w.categoryId);
            if (!category) continue;
            out.push({
                categoryId: category.id,
                label: category.label,
                kind: 'suggested',
            });
            seen.add(category.id);
        }
        return out;
    }

    private changes(
        labelsByKey: ReadonlyMap<string, string>,
    ): ComposerChange[] {
        const reading = this.reading;
        if (!reading || !reading.complete) return [];
        const labelOf = (assertion: Assertion) =>
            labelsByKey.get(keyOf(assertion)) ??
            this.port.conceptName?.(assertion.conceptId) ??
            assertion.conceptId;
        const committed = this.port.committed().assertions;
        const before = new Set(committed.map(keyOf));
        const after = new Set(reading.assertions.map(keyOf));
        const out: ComposerChange[] = [];
        for (const a of reading.assertions) {
            if (!before.has(keyOf(a))) {
                out.push({
                    kind: 'added',
                    label: labelOf(a),
                });
            }
        }
        for (const a of committed) {
            if (!after.has(keyOf(a))) {
                out.push({
                    kind: 'removed',
                    label: labelOf(a),
                });
            }
        }
        if (reading.corrections.some((c) => c.reason === 'order')) {
            out.push({ kind: 'reordered', label: '' });
        }
        return out;
    }

    /**
     * True when the user changed the draft since it last matched the committed
     * value.
     */
    isDirty(): boolean {
        if (this.shape === 'whole') {
            if (this.structural) return true;
            return this.text.trim() !== this.baselineText.trim();
        }
        if (this.text.trim().length > 0) return true;
        if (!this.baseEdited) return false;
        const committed = statedAssertions(this.port.committed().assertions);
        const base = statedAssertions(this.base ?? []);
        if (base.length !== committed.length) return true;
        const byKey = new Map(committed.map((one) => [keyOf(one), one]));
        return base.some((one) => {
            const previous = byKey.get(keyOf(one));
            return (
                !previous ||
                one.value !== previous.value ||
                one.source !== previous.source ||
                one.confidence !== previous.confidence
            );
        });
    }

    // --- Snapshot ------------------------------------------------------------

    private buildSnapshot(): ComposerSnapshot {
        const token = this.currentToken();
        const built = this.buildRows(token);
        const activeIndex =
            this.activeIndex < built.rows.length ? this.activeIndex : -1;
        return {
            open: this._open,
            text: this.text,
            caret: this.caret,
            token,
            reading: this.reading,
            stale: this.readingKey !== this.readKey(),
            mode: built.mode,
            groups: built.groups,
            rows: built.rows,
            gatedRows: built.gatedRows,
            activeIndex,
            needs: this.needs(),
            categories: built.categories,
            scope: this.scope,
            changes: this.changes(built.labelsByKey),
            invalid: this.invalid,
            problem: this.problem,
            dirty: this.isDirty(),
        };
    }

    // --- Navigation ----------------------------------------------------------

    /**
     * Move the active row; -1 means none. Stops on the last row going down; one
     * step up from the first row leaves no row active.
     */
    move(delta: number): void {
        const rows = this.snapshot().rows;
        if (rows.length === 0) return;
        let next = this.activeIndex + delta;
        if (next >= rows.length) next = rows.length - 1;
        // A page up stops on the first row; only a single step up from it
        // leaves the list with no active row.
        if (next < 0) next = delta < -1 && this.activeIndex > 0 ? 0 : -1;
        this.activeIndex = next;
        this.navigated = true;
        this.emit();
    }

    /** Make a row active (pointer hover does not; this is for keyboard). */
    setActive(index: number): void {
        this.activeIndex = index;
        this.navigated = true;
        this.emit();
    }

    /**
     * Browse one category or all of them, preserving the draft and stored
     * value.
     */
    scopeTo(categoryId: string | null): void {
        this.scope = categoryId;
        this.browsing = true;
        this.showMore = false;
        this.activeIndex = -1;
        this.navigated = false;
        this.emit();
    }

    /** The row the keyboard would act on, if any. */
    activeRow(): ComposerRow | null {
        const snap = this.snapshot();
        return snap.activeIndex >= 0 ? snap.rows[snap.activeIndex] : null;
    }

    // --- The commit table ------------------------------------------------------

    /**
     * Enter: accept the active row, or commit the result when none is active.
     * Waits for the reading of the current text first, so a fast Enter never
     * acts on the previous keystroke's list.
     */
    async enter(): Promise<CommitOutcome | 'accepted'> {
        await this.settle();
        const row = this._open ? this.activeRow() : null;
        if (row) {
            await this.activate(row);
            return 'accepted';
        }
        return this.commit();
    }

    /**
     * Tab: accept the active row and report true, or report false so focus
     * leaves the field (its blur then commits). Synchronous by design: the
     * caller must decide on the keydown whether to keep focus.
     */
    tab(): boolean {
        const row = this.activeRow();
        if (!row || !this._open) return false;
        if (row.kind === 'concept' && row.gated) return false;
        void this.activate(row);
        return true;
    }

    /**
     * Escape. First press closes the list and keeps the draft. A press with the
     * list already closed reverts a dirty or invalid draft to the committed
     * value. Returns false when there was nothing to do, so the key can reach
     * an enclosing dialog.
     */
    escape(): boolean {
        if (this._open) {
            this.close();
            return true;
        }
        if (this.isDirty() || this.invalid) {
            this.resetToCommitted();
            this.emit();
            this.announceText(t('a11y.composer.reverted'));
            return true;
        }
        return false;
    }

    /** Blur: the same commit as Enter with no active row, then close. */
    async blur(): Promise<CommitOutcome> {
        const outcome = await this.commit();
        this.close();
        return outcome;
    }

    /**
     * Act on a row (keyboard accept, click or tap). A fix row sets the draft to
     * the marking the fix leaves and commits it through the ordinary commit,
     * once the activation has settled (a commit waits for activations).
     */
    activate(row: ComposerRow): Promise<void> {
        const run = this.busy.then(() => this.activateNow(row));
        this.busy = run.catch(() => {});
        if (row.kind !== 'fix') return run;
        return run.then(async () => {
            await this.commit();
        });
    }

    private async activateNow(row: ComposerRow): Promise<void> {
        switch (row.kind) {
            case 'more':
                this.showMore = true;
                this.activeIndex = -1;
                this.emit();
                return;
            case 'correction': {
                const next = spliceToken(
                    this.text,
                    row.fragment,
                    row.suggestion.label,
                    this.port.separators(),
                );
                // A correction fixes text elsewhere in the draft; the caret
                // stays where the user was typing, shifted by the edit.
                const caret =
                    this.caret >= row.fragment.end
                        ? this.caret + (next.text.length - this.text.length)
                        : next.caret;
                await this.replaceDraft(next.text, caret);
                this.announceText(
                    t('a11y.composer.corrected')
                        .replace('{from}', row.fragment.text)
                        .replace('{to}', row.suggestion.label),
                );
                return;
            }
            case 'fix':
                await this.applyFix(row);
                return;
            case 'concept':
                if (row.gated) return;
                await this.acceptConcept(row);
                return;
        }
    }

    /**
     * A rule fix is a structural edit, the same one the field's error list
     * makes: the fix's kept and added concepts become the stated marking
     * (fixAssertions), rendered through the port. Its rendering is not read
     * back as typed text, which would state everything the rendering shows
     * (inferred and defaulted concepts included) and carry back committed
     * concepts the rendering cannot show.
     */
    private async applyFix(
        row: Extract<ComposerRow, { kind: 'fix' }>,
    ): Promise<void> {
        const assertions = fixAssertions(row.fix);
        // The whole value was replaced, not typed: nothing to search.
        this.browsing = true;
        if (this.shape === 'additive') {
            // The fix stands for the whole value: it becomes the chips.
            await this.rewrite(assertions, []);
        } else {
            let reading: ComposerReading;
            try {
                reading = await this.port.render(assertions);
            } catch {
                return;
            }
            this.adoptReading(reading.rendered, reading);
        }
        this.announceText(row.label);
    }

    /**
     * Make `text` the draft with `reading` as its reading, without reading the
     * text again: the reading came from a structural edit, not from text.
     */
    private adoptReading(text: string, reading: ComposerReading): void {
        this.text = text;
        this.caret = text.length;
        this.softSpaceAt = -1;
        this.activeIndex = -1;
        this.navigated = false;
        this.disarmed = true;
        this.showMore = false;
        this.invalid = false;
        this.problem = null;
        // A read still in flight belongs to an older draft.
        this.readSeq++;
        this.reading = reading;
        this.readingKey = this.readKey();
        this.structural = true;
        void this.refreshOffered();
        this.refreshGated();
        this.emit();
    }

    private async acceptConcept(
        row: Extract<ComposerRow, { kind: 'concept' }>,
    ): Promise<void> {
        // Browsing changes the displayed rows, not the unfinished token a
        // chosen concept completes. Finished marking tokens stay intact.
        const token = this.currentToken(true);
        const s = row.suggestion;
        const ref = { conceptId: s.conceptId, categoryId: s.categoryId };
        // A pick is a structural edit, like a fix: the concept is added to
        // (or removed from) what the draft reads as, and the draft becomes
        // that marking as the format writes it, separators and anything the
        // engine infers included. The text is never spliced. The token being
        // completed is not part of what the draft reads as: the pick is what
        // it was being typed for.
        const settled = token.query
            ? spliceToken(this.text, token, '', this.port.separators()).text
            : this.text;
        let baseline: ComposerReading;
        try {
            baseline = await this.port.read(
                settled.trimEnd(),
                this.currentBase(),
            );
        } catch {
            return;
        }
        // Apply the edit to the value the engine returned.
        const stated = statedAssertions(baseline.assertions);
        const next =
            row.action === 'remove'
                ? this.port.remove(stated, ref)
                : this.port.add(stated, ref);
        // The draft was rewritten, not typed: the list browses rather than
        // search for the last word of the marking.
        this.browsing = true;
        // Text the draft could not read stays, after the marking.
        await this.rewrite(next, baseline.unmatched);
        this.announceText(
            row.action === 'remove'
                ? t('a11y.suggestionRemoved').replace('{label}', s.label)
                : row.action === 'replace'
                  ? t('a11y.composer.replaced')
                        .replace('{label}', s.label)
                        .replace('{old}', row.replaces ?? '')
                  : t(
                        row.action === 'confirm'
                            ? 'a11y.composer.confirmed'
                            : 'a11y.suggestionAdded',
                    ).replace('{label}', s.label),
        );
    }

    /**
     * Write an assertion set back into the draft in the draft's own shape,
     * carrying every fragment the parser could not read.
     */
    private async rewrite(
        assertions: Assertion[],
        leftovers: readonly ComposerFragment[],
    ): Promise<void> {
        const carried = leftovers.map((f) => f.text.trim()).filter(Boolean);
        if (this.shape === 'additive') {
            this.base = assertions;
            this.baseEdited = true;
            this.baseVersion++;
            const text = carried.join(' ');
            await this.replaceDraft(text, text.length);
            return;
        }
        // The draft states what the user stated, written as the format
        // writes it: not what the engine infers from it (the USA a REL TO
        // list starts with, say), which the reading shows under "Saves as"
        // and which re-reading would pin as stated, and not a repair of a
        // rule the set breaks, which the reading reports instead.
        let rendered: string;
        try {
            rendered = this.port.write
                ? await this.port.write(assertions)
                : (await this.port.render(assertions)).rendered;
        } catch {
            return;
        }
        // Exactly the marking, then anything unread: no trailing separator
        // or space. Typing goes on from there as it would anywhere.
        const text = [rendered, ...carried].filter(Boolean).join(' ');
        await this.replaceDraft(text, text.length);
    }

    private async replaceDraft(text: string, caret: number): Promise<void> {
        this.text = text;
        this.caret = caret;
        // The space a pick leaves after what it inserted, so the next word
        // can be typed straight away (see attachSeparator).
        this.softSpaceAt =
            caret > 0 && text[caret - 1] === ' ' ? caret - 1 : -1;
        this.activeIndex = -1;
        this.navigated = false;
        this.disarmed = true;
        this.showMore = false;
        this.invalid = false;
        this.problem = null;
        this.emit();
        await this.read();
    }

    /**
     * The one commit function. Stores the reading when it accounts for the
     * whole draft; otherwise keeps the draft, marks it invalid and stores
     * nothing.
     */
    commit(): Promise<CommitOutcome> {
        // One commit at a time. A second (the blur timer and an outside press
        // can both ask) runs after the first and finds nothing left to store,
        // instead of storing the same reading twice.
        const run = this.commitChain.then(() => this.commitNow());
        this.commitChain = run.catch(() => {});
        return run;
    }

    private async commitNow(): Promise<CommitOutcome> {
        await this.settle();
        if (!this.isDirty()) {
            // Nothing to store, but the text may still differ from what is
            // stored by its spacing (a pick leaves a separator after the
            // concept it added). The field's text after a commit is the stored
            // marking's rendering and nothing else.
            const settled = this.shape === 'whole' ? this.baselineText : '';
            if (this.text !== settled) {
                this.resetToCommitted();
                this.emit();
            } else if (this.invalid) {
                this.invalid = false;
                this.problem = null;
                this.emit();
            }
            return 'unchanged';
        }
        // A read that failed leaves the reading of an older draft in place.
        // Storing it would drop what was typed since, so nothing is stored.
        const current = this.readingKey === this.readKey();
        const reading = current ? this.reading : null;
        if (!reading || !reading.complete) {
            this.invalid = true;
            this.problem = current
                ? this.describeProblem(reading)
                : {
                      fragment: this.text.trim(),
                      rule: t('composer.readFailed'),
                  };
            this.emit();
            this.announceText(
                t('a11y.composer.notSaved').replace(
                    '{problem}',
                    this.problemText(this.problem),
                ),
            );
            return 'invalid';
        }
        const stored = this.text;
        const resets = this.resets;
        await this.port.store(reading, { replaces: this.replacesCommitted() });
        if (this.text === stored || this.resets !== resets) {
            // Nothing typed during the store, or the user reverted during it:
            // either way the draft becomes the value just stored.
            this.resetToCommitted();
        } else {
            // The user kept typing while the store ran. What was stored is now
            // the committed value; the newer text stays as the draft over it.
            this.committedVersion++;
            const committed = this.port.committed();
            if (this.shape === 'whole') {
                this.baselineText = committed.rendered;
            } else {
                this.base = [...committed.assertions];
                this.baseEdited = false;
            }
            this.invalid = false;
            this.problem = null;
            void this.read();
        }
        this.emit();
        const rendered = this.port.committed().rendered;
        this.announceText(
            rendered
                ? t('a11y.composer.set').replace('{rendered}', rendered)
                : t('a11y.composer.cleared'),
        );
        return 'stored';
    }

    /**
     * Whether storing the draft replaces the committed value (see
     * ComposerCommit): always for a whole marking; for an additive draft, when
     * its base no longer holds everything the field stores.
     */
    private replacesCommitted(): boolean {
        if (this.shape === 'whole') return true;
        if (!this.baseEdited) return false;
        return replacesStated(
            this.port.committed().assertions,
            this.base ?? [],
        );
    }

    private describeProblem(reading: ComposerReading | null): ComposerProblem {
        const first = reading?.unmatched.find((f) => f.text.trim());
        const fragment = first?.text.trim() ?? this.text.trim();
        if (!first && reading)
            return { fragment, rule: ruleMessageOf(reading) };
        // The first piece with a close spelling names the suggestion.
        const pieces = first ? this.correctable(first) : [];
        for (const piece of pieces) {
            const close = closestSpelling(
                piece.text,
                this.catalog,
                this.aliasesOf,
            );
            if (close) return { fragment, suggestion: close.suggestion.label };
        }
        const close = closestSpelling(fragment, this.catalog, this.aliasesOf);
        return { fragment, suggestion: close?.suggestion.label };
    }

    /** Human text for a problem, shared by the note and the announcement. */
    problemText(problem: ComposerProblem): string {
        if (problem.rule) return problem.rule;
        const base = t('composer.notRecognized').replace(
            '{text}',
            problem.fragment,
        );
        return problem.suggestion
            ? `${base} ${t('composer.didYouMean').replace('{label}', problem.suggestion)}`
            : base;
    }

    private announceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * While the list is open, say how many rows match and what the draft reads
     * as. Debounced so typing produces one announcement per pause, not one per
     * keystroke.
     */
    private announceReading(): void {
        if (!this._open) return;
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = setTimeout(() => {
            this.announceTimer = null;
            if (!this._open) return;
            const snap = this.snapshot();
            const count = snap.rows.filter((r) => r.kind === 'concept').length;
            const parts = [
                count === 1
                    ? t('a11y.composer.countOne')
                    : t('a11y.composer.count').replace(
                          '{count}',
                          String(count),
                      ),
            ];
            const reading = snap.reading;
            if (reading && reading.complete && reading.rendered) {
                parts.push(
                    t('a11y.composer.savesAs').replace(
                        '{rendered}',
                        reading.rendered,
                    ),
                );
            } else if (reading && reading.unmatched.length > 0) {
                const token = snap.token;
                const flagged = reading.unmatched.find(
                    (f) => !isTypingFragment(f, token),
                );
                if (flagged) {
                    parts.push(
                        t('composer.notRecognized').replace(
                            '{text}',
                            flagged.text.trim(),
                        ),
                    );
                }
            }
            this.announceText(parts.join(t('a11y.sentenceSeparator')));
        }, 350);
    }

    /** Stop timers; the field is going away. */
    dispose(): void {
        this.suggestionCatalog.dispose();
        if (this.announceTimer) clearTimeout(this.announceTimer);
        this.announceTimer = null;
        this.listeners.clear();
        this.readSeq++;
        this.gatedSeq++;
    }
}

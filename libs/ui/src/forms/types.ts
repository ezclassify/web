import type {
    Assertion,
    CoverageReport,
    ProcessingContext,
    ProcessResult,
    SchemeMetaView,
    ValidateResult,
} from '@ezclassify/types';
import type { ComponentSchemeEngine } from '../components/component-base-readonly';
import { RenderColorMap } from '../render-colors';
import type { TagInput } from '../components/tag-input';
import type { ComponentInstance } from '../components/component-base';
import type { EzClassifyState } from '../store/ezclassify-store';
import type { BucketKey } from '../store/store-shared';

/**
 * One bucket of a level's rollup, as the store computed it from its
 * contributors' facts. Any store state satisfies it.
 */
export interface BucketAggregate {
    rendered: string;
    assertions: Assertion[];
    /** The store holds this value from an earlier rollup; see EzClassifyState. */
    stale?: boolean;
}

/**
 * The scheme operations the DOM rollup asks of one bucket. The instance binds
 * it to the element's Context and Context-local scheme selector, so nothing in
 * the rollup resolves a Context or passes a scheme id.
 */
export interface BucketScheme {
    /** The bucket the element reads in. */
    readonly bucket: BucketKey;
    /**
     * The adapter that answers. Cached answers are partitioned by it, so one
     * Context's answer is never handed to another, and one Context's teardown
     * clears only its own.
     */
    readonly adapter: object;
    process(
        input: string,
        options: { outputFormat?: string; context?: ProcessingContext },
    ): ProcessResult | Promise<ProcessResult>;
    validate(
        input: string,
        options: { outputFormat?: string },
    ): ValidateResult | Promise<ValidateResult>;
    checkCoverage(
        children: string[],
        parent: string,
        options: { outputFormat?: string },
    ): CoverageReport | Promise<CoverageReport>;
    getSchemeMeta(): SchemeMetaView;
}

/** Why a rollup output was left without a value. */
export type RollupOutputErrorCode =
    /** Several buckets could fill it and it names none of them. */
    | 'aggregate-bucket-ambiguous'
    /** Its own `context` or `scheme` names no bucket this instance holds. */
    | 'aggregate-bucket-unknown'
    /** Its value names neither a whole nor a collection. */
    | 'aggregate-level-unknown';

/** An output the rollup refuses to fill, in the shape of a binding host error. */
export interface RollupOutputError {
    code: RollupOutputErrorCode;
    /** What is wrong, for the developer reading the console or the event. */
    message: string;
    /** The output whose markup is refused. */
    element: HTMLElement;
}

/** Assertion shape stored per-field. */
export interface FieldAssertion {
    conceptId: string;
    categoryId: string;
    value?: string;
}

/** Engine adapter binding and rendering configuration. */
export interface FormsConfigState {
    /** The default Context's scheme surface. */
    engine: ComponentSchemeEngine;
    /**
     * The scheme operations for the bucket `el` reads in: the Context it
     * resolves (its nearest `data-ezclassify-context`, else the only one) and
     * that Context's scheme selector (its nearest `data-ezclassify-scheme`,
     * else the primary scheme). Throws when `el` resolves no Context; the
     * rollup then leaves `el` out rather than guess one.
     */
    schemeOf(el: HTMLElement): BucketScheme;
    /**
     * The buckets this instance holds that a Context key and a scheme selector
     * name, `null` naming any: every registered Context key with each scheme
     * that Context holds. A selector naming a Context's primary scheme names
     * its primary bucket. Fixed once initialization has finished. An output
     * resolves its bucket from its own attributes through it, and needs exactly
     * one.
     */
    bucketsNamed(
        contextKey: string | null,
        schemeSelector: string | null,
    ): readonly BucketKey[];
    /**
     * The store's rollup of one level, by bucket, computed from contributor
     * facts: `null` is the instance root (the page: its wholes, each whole's
     * parts rollup and its child collections), a collection id names that
     * collection's members, and a whole's id names the rollup of its parts. A
     * bucket is present once it holds a contributor or misses one (then flagged
     * stale), as `EzClassifyStore.getAggregate` reports it.
     */
    aggregateOf(
        levelId: string | null,
    ): ReadonlyMap<BucketKey, BucketAggregate>;
    /**
     * Report a host error: markup the runtime refuses to read. The rollup has
     * already left the element without a value when it calls this. Optional so
     * non-instance contexts (tests) can omit it.
     */
    reportHostError?(error: RollupOutputError): void;
    /** True once the owning instance has been torn down. */
    readonly destroyed: boolean;
    /**
     * Logical root container for discovery, events, and theme inheritance.
     * Viewport overlays portal to document.body so consumer clipping ancestors
     * cannot make them unusable; they remain owned and cleaned up by this
     * root.
     */
    root: HTMLElement;
    defaultFormat: string;
    /**
     * The format a field that shows a part writes when it names none: the
     * scheme's part default, the format the store writes a part in, else
     * `defaultFormat`.
     */
    defaultPartFormat: string;
    colorMap: RenderColorMap;
    /**
     * True during initialization: expensive operations are deferred until all
     * components are ready.
     */
    initializing: boolean;
    /**
     * Stable id of the owning EzClassifyUI instance. Stamped on the root as
     * `data-ezclassify-mount-root`; used by the rollup pass to pull this
     * scope's registered child contributions out of the cross-instance
     * mount-rollup registry.
     */
    mountInstanceId: string;
}

/** Guards programmatic field writes against the controller's input handlers. */
export interface FormsSelectionState {
    settingValue: boolean;
}

/** Per-field validation snapshots and assertion storage. */
export interface FormsHistoryState {
    lastValidated: Map<HTMLInputElement, string>;
    fieldAssertions: Map<HTMLInputElement, FieldAssertion[]>;
}

/** References to DOM elements managed by the forms controller. */
export interface FormsUIState {
    /**
     * Controller-less marking hosts the runtime enhanced. Views (`source`,
     * `aggregate`, `bound-to`, `facet-of`) are never here: they show markings
     * and contribute none.
     */
    fields: HTMLInputElement[];
    domObserver: MutationObserver | null;
    tooltipEl: HTMLElement | null;
}

/** Registered component instances and their relationships. */
export interface FormsComponentState {
    autocompleters: Map<HTMLInputElement, TagInput>;
    /** Every component the runtime mounted, by host element. */
    mounted: Map<HTMLElement, ComponentInstance>;
    /**
     * Every part, by host element, mapped to its whole's marking id: the parts
     * inside a `data-ezclassify-whole` container and the ones placed outside it
     * with `data-ezclassify-part-of`.
     */
    partOfMap: Map<HTMLElement, string>;
    /**
     * Per-whole coverage state, keyed by the whole's marking id. Populated by
     * the rollup pass: every whole with parts gets its own entry, holding the
     * whole's element and its coverage outcome against those parts (see
     * binding-model §2).
     */
    aggregates: Map<string, { el: HTMLElement; state: EzClassifyState }>;
    /**
     * Called by the rollup pass at the end of each run with this instance
     * root's rollup by bucket, facts included. The owning instance records it
     * as what it contributes to an enclosing instance and, if it changed,
     * notifies that instance. Optional so non-instance contexts (tests) can
     * omit it.
     */
    onRollupComputed?(byBucket: ReadonlyMap<BucketKey, BucketAggregate>): void;
    /**
     * The value the marking store has committed for the marking `el` holds or
     * shows, or `undefined` when the store has none for it or `el` holds an
     * uncommitted draft. The rollup reads it in place of the element's own
     * rendering, which can still be on its way to that value. Optional so
     * non-instance contexts (tests) can omit it.
     */
    committedRendering?(el: HTMLElement): string | undefined;
    /**
     * Run `run` once the marking store has no read on the wire, so a rollup
     * pass reads every committed value from the same settled state. Returns
     * true, without queuing `run`, when the store is idle now.
     */
    whenStoreIdle?(run: () => void): boolean;
    /**
     * Read again whether this scope's rollup may be missing markings and pass
     * the answer to `setOutputsIncomplete`. The rollup pass calls it with
     * `fromRollup` after each run, which is the only call allowed to clear it.
     * Optional so non-instance contexts (tests) can omit it.
     */
    refreshIncomplete?(fromRollup?: boolean): void;
}

/**
 * Shared context passed to extracted module functions. Composed from focused
 * sub-interfaces so each concern is self-documenting.
 */
export interface FormsContext
    extends
        FormsConfigState,
        FormsSelectionState,
        FormsHistoryState,
        FormsUIState,
        FormsComponentState {}

/**
 * Escape a string for use in a CSS selector (polyfill for environments without
 * CSS.escape).
 */
export function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return value.replace(/([^\w-])/g, '\\$1');
}

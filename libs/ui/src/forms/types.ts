import type { ComponentSchemeEngine } from '../components/component-base-readonly';
import { RenderColorMap } from '../render-colors';
import type { TagInput } from '../components/tag-input';
import type { ComponentInstance } from '../components/component-base';
import type { EzClassifyState } from '../store/ezclassify-store';

/** Assertion shape stored per-field. */
export interface FieldAssertion {
    conceptId: string;
    categoryId: string;
    value?: string;
}

/** Engine adapter binding and rendering configuration. */
export interface FormsConfigState {
    engine: ComponentSchemeEngine;
    /** Whether this controller may pass explicit scheme selectors to operations. */
    schemeAddressing: boolean;
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
    fields: HTMLInputElement[];
    rollupField: HTMLInputElement | null;
    domObserver: MutationObserver | null;
    tooltipEl: HTMLElement | null;
}

/** Registered component instances and their relationships. */
export interface FormsComponentState {
    autocompleters: Map<HTMLInputElement, TagInput>;
    /** Every component the runtime mounted, by host element. */
    mounted: Map<HTMLElement, ComponentInstance>;
    partOfMap: Map<HTMLElement, string>;
    targetMap: Map<HTMLElement, string>;
    /**
     * Per-parent aggregate state, keyed by the parent marking's id. Populated
     * by the rollup pass: every distinct parent declared via
     * `data-ezclassify-part-of` gets its own entry, holding the parent element
     * and the computed coverage state across its part-of contributors. The
     * single `rollupField` is the synthesized page-level aggregate that
     * `data-ezclassify-aggregate` subscribers read; this map is the per-marking
     * decomposition that powers multi-whole partitioning (see binding-model
     * §2).
     */
    aggregates: Map<string, { el: HTMLElement; state: EzClassifyState }>;
    /**
     * Called by the rollup pass at the end of each run with this scope's
     * per-scheme rendered wholes. The owning instance records them as its
     * upstream contribution and (if changed) synchronously notifies its parent
     * scope to re-aggregate. Optional so non-instance contexts (tests) can omit
     * it.
     */
    onRollupComputed?(renderedByScheme: Map<string, string>): void;
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
     * Set or clear the rollup field's incomplete state from what the scope
     * knows it could not read. The rollup pass calls it with `fromRollup` after
     * each run, which is the only call allowed to clear it. Optional so
     * non-instance contexts (tests) can omit it.
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

import type { Fix, MaybePromise, SchemePublicView } from '@ezclassify/types';

/** The full associated store marking behind an editable control. */
export interface MarkingTarget {
    schemeId: string;
    scope?: string;
    formatId: string;
    scheme: SchemePublicView;
    read: (marking: string) => MaybePromise<{ rendered: string }>;
    applyPreset: (presetId: string) => MaybePromise<{ rendered: string }>;
    getCurrent: () => { rendered: string; valid: boolean };
    onApply: (marking: string, signal: AbortSignal) => MaybePromise<void>;
    /** Apply all canonical kept/added facts through the associated store. */
    applyFix?: (fix: Fix, signal: AbortSignal) => MaybePromise<void>;
}

const targets = new WeakMap<object, MarkingTarget>();

/** Runtime binding, kept separate from the host's persistence provider. */
export function setMarkingTarget(
    component: object,
    target: MarkingTarget,
): void {
    targets.set(component, target);
}

/** Resolve an editable control’s associated store marking, when bound. */
export function markingTarget(component: object): MarkingTarget | undefined {
    return targets.get(component);
}

/** An inline editor's active store entry and its local edit teardown. */
export interface MarkingEntry {
    id: () => string | undefined;
    /**
     * Discard the old edit; its disposer ends the owned publication/projection
     * interval.
     */
    prepareApply: () => void | (() => void);
}

const entries = new WeakMap<object, MarkingEntry>();

/** Bind a multi-marking editor's caret to its existing entry identity. */
export function setMarkingEntry(component: object, entry: MarkingEntry): void {
    entries.set(component, entry);
}

/** Resolve the active-entry binding of a multi-marking editor. */
export function markingEntry(component: object): MarkingEntry | undefined {
    return entries.get(component);
}

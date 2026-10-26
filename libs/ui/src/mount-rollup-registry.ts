/**
 * Cross-instance mount rollup registry.
 *
 * The mount-root boundary (see `element-scanner.ts` `isOwnedBy`) makes each
 * `EzClassifyUI` enhance ONLY the fields whose nearest enclosing mount root is
 * its own. That correctly stops a parent instance from double-enhancing a field
 * that a nested child instance already owns, but it also severs any cross-mount
 * rollup contribution a whole-subtree scan would provide. A nested child's
 * marking must still flow up into the parent's banner; this registry carries
 * that edge explicitly.
 *
 * Model:
 *
 * - Ownership is the boundary (one instance enhances a field).
 * - Contribution is hierarchical (a child scope contributes its rolled-up WHOLE,
 *   never its raw fields, to its nearest ancestor scope).
 *
 * The edge is inferred from DOM ancestry at construction: a child instance
 * walks up from its own root's parent to the nearest
 * `[data-ezclassify-mount-root]` and, if found, registers itself as that
 * ancestor's child. No opt-in attribute; independent (disjoint) mounts simply
 * have no enclosing root, so they register no edge and contribute to nothing.
 *
 * The singleton is keyed on `globalThis` via a well-known Symbol so that when a
 * page ends up with two duplicate copies of `@ezclassify/ui` in its module
 * graph, both still share ONE registry. Without this, a parent in bundle A and
 * a child in bundle B would never find each other.
 */

import type { FieldAssertion } from './forms/types';

/**
 * One child scope's contribution to its parent, grouped by scheme id. The child
 * publishes the assertion set of its rolled-up whole per scheme; the parent
 * re-aggregates these into its own per-scheme buckets so distinct schemes
 * render side-by-side and the same scheme co-aggregates losslessly.
 *
 * Assertions (not the rendered string) are the payload: the assertion-set path
 * skips the parse round-trip and is immune to the format-mismatch loss vector.
 */
export interface ChildWhole {
    /** Scheme id this whole belongs to. Distinct ids never co-aggregate. */
    schemeId: string;
    /**
     * The child whole's rendered string (already rolled up within the child).
     * This is what the parent re-aggregates into its own per-scheme bucket.
     * Whole-of-wholes aggregation is lossless within a scheme family, so
     * contributing the child's rendered whole is safe.
     */
    rendered: string;
    /**
     * The child whole's assertion set, when available. Reserved for adapters
     * that expose `aggregateAssertions` (the structurally safer path); the
     * current consumer re-aggregates `rendered`.
     */
    assertions: FieldAssertion[];
}

/** Minimal view of a registered child instance the registry needs. */
export interface RegistryChild {
    /** Stable per-instance id (the child's `data-ezclassify-mount-root` value). */
    readonly instanceId: string;
    /**
     * The child's current rolled-up wholes, one per contributing scheme id.
     * Read by the parent's rollup pass.
     */
    childWholesByScheme(): Map<string, ChildWhole>;
    /**
     * Whether the child's rolled-up whole may be missing markings: something in
     * its scope was not read, or a scope inside it says so. A parent built from
     * it is then incomplete as well.
     */
    incomplete?(): boolean;
}

interface RegistryEntry {
    child: RegistryChild;
    parentId: string;
}

/** What an instance exposes for cross-instance reclaim. */
export interface Releaser {
    /** Tear down everything this instance wired for `host` so a peer can own it. */
    releaseElement(host: HTMLElement): void;
    /**
     * Read again whether this instance's rollup is incomplete, because a child
     * scope's answer changed. Optional so a registry shared with an older copy
     * of this module still works.
     */
    refreshIncomplete?(): void;
}

interface MountRollupRegistry {
    /** InstanceId -> entry (child + its parent id). */
    readonly entries: Map<string, RegistryEntry>;
    /** ParentId -> set of child instanceIds. */
    readonly childIds: Map<string, Set<string>>;
    /** InstanceId -> a synchronous "re-aggregate now" callback for that parent. */
    readonly flushers: Map<string, () => void>;
    /** InstanceId -> its releaser, for the reclaim-on-register sweep. */
    readonly releasers: Map<string, Releaser>;
}

const REGISTRY_KEY = Symbol.for('@ezclassify/ui:mount-registry');

function getRegistry(): MountRollupRegistry {
    const g = globalThis as unknown as Record<
        symbol,
        MountRollupRegistry | undefined
    >;
    let reg = g[REGISTRY_KEY];
    if (!reg) {
        reg = {
            entries: new Map(),
            childIds: new Map(),
            flushers: new Map(),
            releasers: new Map(),
        };
        g[REGISTRY_KEY] = reg;
    }
    return reg;
}

/**
 * Register an instance's synchronous flush callback so a child's `notifyParent`
 * can re-aggregate the parent inside the child's settle window (bypassing the
 * parent's rollup debounce). Called by every instance on construction; cleared
 * on teardown.
 */
export function registerFlusher(instanceId: string, flush: () => void): void {
    getRegistry().flushers.set(instanceId, flush);
}

/** Register an instance's releaser (for the reclaim-on-register sweep). */
export function registerReleaser(instanceId: string, releaser: Releaser): void {
    getRegistry().releasers.set(instanceId, releaser);
}

/** The releaser for an instance id, if it is still live. */
export function instanceById(instanceId: string): Releaser | undefined {
    return getRegistry().releasers.get(instanceId);
}

/** Register a parent->child edge inferred from DOM ancestry. */
export function addChild(
    parentId: string,
    childId: string,
    child: RegistryChild,
): void {
    const reg = getRegistry();
    reg.entries.set(childId, { child, parentId });
    let set = reg.childIds.get(parentId);
    if (!set) {
        set = new Set();
        reg.childIds.set(parentId, set);
    }
    set.add(childId);
}

/**
 * Remove a child instance (and its flusher). Safe to call for an instance that
 * never registered an ancestry edge, only the flusher entry is dropped then.
 */
export function removeChild(childId: string): void {
    const reg = getRegistry();
    const entry = reg.entries.get(childId);
    if (entry) {
        reg.entries.delete(childId);
        const set = reg.childIds.get(entry.parentId);
        if (set) {
            set.delete(childId);
            if (set.size === 0) reg.childIds.delete(entry.parentId);
        }
    }
    reg.flushers.delete(childId);
    reg.releasers.delete(childId);
}

/** The live child views registered under `parentId`, in registration order. */
export function childrenOf(parentId: string): RegistryChild[] {
    const reg = getRegistry();
    const set = reg.childIds.get(parentId);
    if (!set) return [];
    const out: RegistryChild[] = [];
    for (const id of set) {
        const entry = reg.entries.get(id);
        if (entry) out.push(entry.child);
    }
    return out;
}

/**
 * Tell `childId`'s parent that whether the child's whole is incomplete changed.
 * The parent reads it again without re-aggregating, and passes a change of its
 * own on to its parent the same way.
 */
export function notifyParentIncomplete(childId: string): void {
    const reg = getRegistry();
    const entry = reg.entries.get(childId);
    if (!entry) return;
    reg.releasers.get(entry.parentId)?.refreshIncomplete?.();
}

/**
 * Tell `childId`'s parent to re-aggregate synchronously. Walks one hop up; the
 * parent's own flush recurses upward (its rollup tail calls notifyParent
 * again), so a leaf change settles all the way to the page root within one
 * synchronous chain.
 */
export function notifyParent(childId: string): void {
    const reg = getRegistry();
    const entry = reg.entries.get(childId);
    if (!entry) return;
    const flush = reg.flushers.get(entry.parentId);
    if (flush) flush();
}

/** Test-only: reset the process registry between specs. */
export function __resetMountRollupRegistry(): void {
    const g = globalThis as unknown as Record<
        symbol,
        MountRollupRegistry | undefined
    >;
    delete g[REGISTRY_KEY];
}

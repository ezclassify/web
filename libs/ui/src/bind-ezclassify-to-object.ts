/**
 * Domain-object binding helper: per `libs/ui/docs/binding-model.md` §10.
 *
 * Most callers don't want to wire individual markings one id at a time; they
 * have a document object with classification fields scattered through it and
 * want a single call that keeps the doc and the store in sync. This helper
 * accepts a config mapping marking-id → doc-path (dot-notation or RFC 6901 JSON
 * Pointer) and an optional per-marking mode, subscribes to the store, and
 * writes the new value back to the doc on every commit.
 *
 * Vanilla semantics: `setPath` is the only way to push a programmatic edit into
 * the store. Plain JS objects aren't reactive, so a direct
 * `doc.title.classification = 'X'` mutation is invisible to this layer.
 * Framework variants (`@ezclassify/angular`, `@ezclassify/react`,
 * `@ezclassify/vue`) catch direct mutation through their own reactive
 * primitives; see each adapter's package.
 */

import type { Assertion } from '@ezclassify/types';
import type { EzClassifyStore } from './store/ezclassify-store';

/** Which side of the marking state populates the doc field. */
export type MarkingBindingMode = 'rendered' | 'assertions';

/**
 * The value type written to / read from a doc path. Rendered-mode bindings
 * carry the engine's canonical rendered string; assertion-mode bindings carry
 * the live `Assertion[]` for the marking.
 */
export type MarkingBindingValue = string | Assertion[];

/** Explicit per-marking binding shape. */
export interface MarkingBindingConfig {
    path: string;
    mode: MarkingBindingMode;
}

/**
 * Config map. Each key is a marking id; the value is either a bare path
 * (shorthand for `{ path, mode: 'rendered' }`) or an explicit `{ path, mode }`
 * pair.
 */
export type MarkingsToObjectConfig = Record<
    string,
    string | MarkingBindingConfig
>;

/** Per-commit diff entry surfaced to `onChange` listeners. */
export interface MarkingDiffEntry {
    path: string;
    before: string;
    after: string;
}

/** Handle returned by `bindEzClassifyToObject`. */
export interface BindMarkingsHandle<T> {
    /** Register a change listener. Returns an unsubscribe function. */
    onChange(
        listener: (updatedDoc: T, diff: MarkingDiffEntry[]) => void,
    ): () => void;
    /** Programmatically publish an edit. Routes through the store. */
    setPath(path: string, value: MarkingBindingValue): void;
    /** Tear down all subscriptions. Idempotent. */
    dispose(): void;
}

/**
 * Split a doc path into segments. A leading slash selects JSON Pointer decoding
 * (RFC 6901); otherwise we treat the path as plain dot-notation.
 */
export function parseDocPath(path: string): string[] {
    if (path.startsWith('/')) {
        // RFC 6901: '/' separates; '~1' encodes '/', '~0' encodes '~'.
        // Decode ~1 first to keep '~01' parsing correctly to '~1'.
        return path
            .slice(1)
            .split('/')
            .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
    }
    return path.split('.');
}

/**
 * Read a value at `path` inside `obj`. Returns `undefined` if any intermediate
 * is null.
 */
export function readDocPath(obj: unknown, path: string): unknown {
    const segs = parseDocPath(path);
    let cur: unknown = obj;
    for (const seg of segs) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}

/**
 * Write `value` at `path` inside `obj`. Mutates intermediates into plain
 * objects when missing so the write succeeds even on partial documents. The
 * terminal value is assigned by reference; no copying.
 */
export function writeDocPath(obj: unknown, path: string, value: unknown): void {
    const segs = parseDocPath(path);
    if (segs.length === 0) return;
    if (obj == null || typeof obj !== 'object') {
        throw new Error(
            '[ezclassify] bindEzClassifyToObject: target doc is not an object',
        );
    }
    let cur = obj as Record<string, unknown>;
    for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i];
        const next = cur[seg];
        if (next == null || typeof next !== 'object') {
            cur[seg] = {};
        }
        cur = cur[seg] as Record<string, unknown>;
    }
    cur[segs[segs.length - 1]] = value;
}

/**
 * Immutable counterpart to {@link writeDocPath}: returns a new document with
 * `value` set at `path`, structurally sharing the untouched branches and
 * shallow-copying each node on the path. Used by the React and Angular
 * adapters, whose reactive primitives require a fresh reference to register a
 * change. The Vue adapter mutates in place instead, so it does not use this.
 */
export function writeDocPathImmutable<T extends object>(
    doc: T,
    path: string,
    value: unknown,
): T {
    const segs = parseDocPath(path);

    function step(node: unknown, i: number): unknown {
        if (i === segs.length) return value;
        const seg = segs[i];
        const base =
            node != null && typeof node === 'object'
                ? { ...(node as Record<string, unknown>) }
                : {};
        base[seg] = step(
            (node as Record<string, unknown> | null)?.[seg],
            i + 1,
        );
        return base;
    }

    return step(doc, 0) as T;
}

/** One marking-id → doc-path binding after config normalization. */
export interface NormalizedEntry {
    markingId: string;
    path: string;
    mode: MarkingBindingMode;
}

/**
 * Expand a {@link MarkingsToObjectConfig} into explicit entries. A bare string
 * value is shorthand for `{ path, mode: 'rendered' }`. Shared by every adapter
 * so the shorthand-expansion rule lives in one place.
 */
export function normalize(config: MarkingsToObjectConfig): NormalizedEntry[] {
    const entries: NormalizedEntry[] = [];
    for (const [markingId, raw] of Object.entries(config)) {
        if (typeof raw === 'string') {
            entries.push({ markingId, path: raw, mode: 'rendered' });
        } else {
            entries.push({ markingId, path: raw.path, mode: raw.mode });
        }
    }
    return entries;
}

/**
 * String form used in `MarkingDiffEntry.before`/`after`. Rendered strings pass
 * through unchanged; everything else gets JSON-encoded so the diff stays a pure
 * string pair the consumer can compare with `===`. Exported so every adapter
 * shares one definition.
 */
export function stringifyForDiff(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * The reactive container a doc binding drives.
 *
 * This is the doc-binding counterpart of the store's `ReactiveCell`, and the
 * only framework-specific seam in the binding: the algorithm below (path
 * walking, the round-trip dedupe, the order writes and publishes happen in)
 * runs identically for a plain object, a React state hook, a Vue `reactive()`
 * proxy or `Ref`, and an Angular `WritableSignal`. Each of those differs in
 * exactly three ways, and this interface is those three ways.
 *
 * @typeParam T - The document type.
 */
export interface ReactiveDoc<T extends object> {
    /** The current document. */
    read(): T;
    /**
     * Put `value` at `path`. The container decides whether that means mutating
     * in place (Vue's proxy is already reactive) or replacing the document with
     * a structurally shared copy (React and Angular need a fresh reference to
     * register a change); {@link writeDocPath} and {@link writeDocPathImmutable}
     * are those two implementations.
     */
    write(path: string, value: MarkingBindingValue): void;
    /**
     * Register interest in host-driven writes, and return an unsubscribe.
     *
     * `onHostWrite` runs the publish pass: it re-reads every bound path and
     * sends whatever changed to the store. Call it whenever the host may have
     * written the document by its own means; calling it when nothing changed
     * costs a read per path and publishes nothing.
     *
     * Optional, because a plain object cannot tell anyone it was mutated. A
     * container that leaves this off gets a one-way binding, store to
     * document.
     *
     * @param paths - Every bound path, for a container that watches per path.
     * @param onHostWrite - Runs the publish pass. Safe to call redundantly.
     */
    observe?(paths: readonly string[], onHostWrite: () => void): () => void;
}

/** Per-binding settings {@link createDocBinding} needs from its caller. */
export interface DocBindingOptions {
    /**
     * Prefix for every error this binding raises, naming the package and the
     * function the caller actually called, e.g. `[ezclassify/react]
     * useEzClassifyObject`.
     */
    label: string;
}

/**
 * The document-binding algorithm, once, for every adapter.
 *
 * Each entry in `config` ties one marking id to one path on the document. The
 * binding then keeps the two sides equal in both directions: a store commit is
 * written into the document, and a host write to the document is published to
 * the store.
 *
 * ## The round trip terminates
 *
 * Both directions consult `lastSeen`, which records the stringified value that
 * last moved along each path in either direction. The store subscription skips
 * a commit whose value is already what `lastSeen` holds, and the publish pass
 * skips a path whose value is likewise unchanged. So the cycle `host write →
 * publish → commit → document write → observer → publish` stops on the second
 * pass rather than running forever. It is the same identity-dedupe idea the
 * marking store uses for view-source tokens, applied at the path level.
 *
 * ## A value the store cannot take
 *
 * A rendered-mode path holding something other than a string, or an
 * assertions-mode path holding a non-array, is skipped: not published, not
 * reported through `onChange`, and not recorded in `lastSeen`. Reporting it
 * would tell a listener the store took a value it refused, and recording it
 * would mean a later correct value that happens to equal the previous one never
 * publishes at all.
 *
 * @param store - The store this document is bound to.
 * @param container - The reactive seam; see {@link ReactiveDoc}.
 * @param config - Marking id to document path, one entry per binding.
 * @param options - Error labeling; see {@link DocBindingOptions}.
 * @returns The handle each adapter shapes into its own return value.
 * @throws Error when two entries name the same path.
 */
export function createDocBinding<T extends object>(
    store: EzClassifyStore,
    container: ReactiveDoc<T>,
    config: MarkingsToObjectConfig,
    options: DocBindingOptions,
): BindMarkingsHandle<T> {
    const { label } = options;
    const entries = normalize(config);
    const byPath = new Map<string, NormalizedEntry>();
    for (const entry of entries) {
        if (byPath.has(entry.path)) {
            throw new Error(
                `${label}: duplicate path "${entry.path}" in config`,
            );
        }
        byPath.set(entry.path, entry);
    }

    const listeners = new Set<(doc: T, diff: MarkingDiffEntry[]) => void>();
    const teardown: Array<() => void> = [];
    let disposed = false;

    // Seeded from the document as it stands, so a binding built over a document
    // that already carries markings does not immediately publish them back as
    // though the host had just typed them. Note this reads the document; it
    // never writes it, so a path holding null stays null until something
    // actually commits.
    const lastSeen: Record<string, string> = {};
    for (const entry of entries) {
        lastSeen[entry.path] = stringifyForDiff(
            readDocPath(container.read(), entry.path),
        );
    }

    function fire(diff: MarkingDiffEntry[]): void {
        if (diff.length === 0) return;
        const snapshot = container.read();
        for (const listener of listeners) listener(snapshot, diff);
    }

    // Store to document.
    for (const entry of entries) {
        teardown.push(
            store.subscribe(entry.markingId, (state) => {
                if (disposed) return;
                const next =
                    entry.mode === 'rendered'
                        ? state.rendered
                        : state.assertions;
                const after = stringifyForDiff(next);
                if (after === lastSeen[entry.path]) return;
                const before = lastSeen[entry.path];
                lastSeen[entry.path] = after;
                container.write(entry.path, next);
                fire([{ path: entry.path, before, after }]);
            }),
        );
    }

    /**
     * Roll back the bookkeeping for a path whose publish never landed. The
     * `lastSeen` entry is what tells the next pass a value is already in the
     * store, so leaving it set after a rejected publish would make every later
     * write of that same value a no-op and strand the document out of sync. The
     * rollback is skipped when something newer has already claimed the path, so
     * a late rejection cannot undo a more recent edit.
     */
    function trackPublish(
        path: string,
        before: string,
        after: string,
        published: Promise<void> | void,
    ): void {
        // The store is an injected implementation, so normalize what it hands
        // back rather than trusting it to be a promise.
        void Promise.resolve(published).catch((error: unknown) => {
            if (lastSeen[path] === after) lastSeen[path] = before;
            console.error(
                `${label}: publishing "${path}" failed; the document and the store are out of sync until the next edit:`,
                error,
            );
        });
    }

    /**
     * Document to store. Walks every bound path, publishes what changed, and
     * reports the whole set to `onChange` in one call: one host write is one
     * edit, however many bound paths it happened to touch.
     */
    function publishFromDoc(): void {
        if (disposed) return;
        const current = container.read();
        const diff: MarkingDiffEntry[] = [];
        for (const entry of entries) {
            const value = readDocPath(current, entry.path);
            const after = stringifyForDiff(value);
            if (after === lastSeen[entry.path]) continue;
            if (entry.mode === 'rendered') {
                if (typeof value !== 'string') continue;
            } else if (!Array.isArray(value)) {
                continue;
            }
            const before = lastSeen[entry.path];
            lastSeen[entry.path] = after;
            const published =
                entry.mode === 'rendered'
                    ? store.publishRendered(entry.markingId, value as string)
                    : store.publishAssertions(
                          entry.markingId,
                          value as Assertion[],
                      );
            trackPublish(entry.path, before, after, published);
            diff.push({ path: entry.path, before, after });
        }
        fire(diff);
    }

    const stopObserving = container.observe?.(
        entries.map((entry) => entry.path),
        publishFromDoc,
    );
    if (stopObserving) teardown.push(stopObserving);

    return {
        onChange(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setPath(path, value) {
            if (disposed) {
                throw new Error(`${label}: handle has been disposed`);
            }
            const entry = byPath.get(path);
            if (!entry) {
                throw new Error(`${label}: no marking bound to path "${path}"`);
            }
            if (entry.mode === 'rendered') {
                if (typeof value !== 'string') {
                    throw new TypeError(
                        `${label}: setPath("${path}") expects a string for a rendered-mode binding`,
                    );
                }
            } else if (!Array.isArray(value)) {
                throw new TypeError(
                    `${label}: setPath("${path}") expects an Assertion[] for an assertions-mode binding`,
                );
            }
            // Write, then publish, rather than publishing and waiting for the
            // commit to come back: the document reflects the caller's edit at
            // once. A container that also observes its own writes runs the pass
            // a second time and finds nothing left to send.
            container.write(path, value);
            publishFromDoc();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const stop of teardown) stop();
            teardown.length = 0;
            listeners.clear();
        },
    };
}

/**
 * Wire a plain-object document to a `EzClassifyStore`. Each entry in `config`
 * binds one marking-id to a path on the doc; on every commit the store forwards
 * through, the helper updates the doc and fires any registered `onChange`
 * listeners.
 *
 * The container is a plain object with no `observe`, which is the whole of the
 * vanilla semantics described at the top of this file: `setPath` is the only
 * way a programmatic edit reaches the store, because nothing can see a direct
 * `doc.title.classification = 'X'` mutation. The framework adapters supply a
 * container that can, and get the same algorithm with the second direction
 * wired up.
 *
 * See `libs/ui/docs/binding-model.md` §10 for the canonical example and shape.
 */
export function bindEzClassifyToObject<T extends object>(
    store: EzClassifyStore,
    doc: T,
    config: MarkingsToObjectConfig,
): BindMarkingsHandle<T> {
    return createDocBinding(
        store,
        {
            read: () => doc,
            write: (path, value) => writeDocPath(doc, path, value),
        },
        config,
        { label: '[ezclassify] bindEzClassifyToObject' },
    );
}

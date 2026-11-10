import {
    Directive,
    ElementRef,
    ErrorHandler,
    Input,
    OnDestroy,
    OnChanges,
    OnInit,
    forwardRef,
    inject,
    signal,
    type Provider,
    type Signal,
} from '@angular/core';
import {
    EzClassifyUI,
    contextStoreBuckets,
    mergeProvisionOptions,
} from '@ezclassify/ui';
import type { ContextAdapter, EzClassifyStore } from '@ezclassify/ui';
import {
    AngularSignalStore,
    EZCLASSIFY_STORE,
    EZCLASSIFY_STORE_SIGNAL,
} from './angular-signal-store';
import {
    EZCLASSIFY_CONTEXT,
    EZCLASSIFY_CONTEXTS,
    EZCLASSIFY_OPTIONS,
    type EzClassifyOptions,
} from './provide-ezclassify';

/**
 * Options forwarded to EzClassifyUI. Alias of the provided
 * {@link EzClassifyOptions}: the directive's `[ezClassifyOptions]` input is an
 * override of the same shape `provideEzClassify` sets.
 */
export type EzClassifyDirectiveOptions = EzClassifyOptions;

/**
 * The error a root raises when no Context reaches it. A root without a Context
 * cannot mark anything, so it says so instead of leaving its fields inert.
 */
const NO_CONTEXT =
    '[ezclassify/angular] An ezClassify root found no Context. Add ' +
    'provideEzClassify({ context }) or provideEzClassify({ contexts }) to the ' +
    'application or route providers.';

/**
 * Lazy proxy over the directive's live store. The directive rebuilds the store
 * when its options or store input change; descendants that injected the store
 * earlier still see the current instance because every call goes through this
 * proxy. Throws if read before the root has built its store.
 */
function lazyStoreProxy(getDir: () => EzClassifyDirective): EzClassifyStore {
    const resolve = (): EzClassifyStore => {
        const store = getDir().getStore();
        if (!store) {
            throw new Error(
                '[ezclassify/angular] The ezClassify root has not built its store yet. ' +
                    'Read it after the first change detection, or use injectEzClassifyFacet, ' +
                    'which waits for it.',
            );
        }
        return store;
    };
    return new Proxy({} as EzClassifyStore, {
        get(_target, prop) {
            const store = resolve();
            const value = Reflect.get(store as object, prop);
            return typeof value === 'function' ? value.bind(store) : value;
        },
    });
}

function ezClassifyRootProviders(): Provider[] {
    return [
        {
            provide: EZCLASSIFY_STORE,
            useFactory: (dir: EzClassifyDirective) => lazyStoreProxy(() => dir),
            deps: [forwardRef(() => EzClassifyDirective)],
        },
        {
            provide: EZCLASSIFY_STORE_SIGNAL,
            useFactory: (dir: EzClassifyDirective) => dir.storeSignal,
            deps: [forwardRef(() => EzClassifyDirective)],
        },
    ];
}

/**
 * A marking root: `<form ezClassify>`.
 *
 * The host element becomes the root. Every `data-ezclassify-*` element inside
 * it is enhanced against the Context from {@link provideEzClassify}, and
 * everything is torn down when the directive is destroyed.
 *
 * Each root builds and owns its store and provides it to its descendants, so a
 * component inside the root can `inject(EZCLASSIFY_STORE)` or call
 * `injectEzClassifyFacet` and work on the same state the scanner binds. To
 * share state with UI outside the form, put one root around both.
 *
 * Two inputs cover the complex cases:
 *
 * - `[ezClassifyOptions]` overrides the provided presentation options for this
 *   root, key by key.
 * - `[ezClassifyStore]` hands the root a store the host already owns, for a
 *   component that drives its own bindings and wants the scanner on the same
 *   state. The root does not destroy a store it was given.
 *
 * Per binding-model.md §8 the store's entries are signal-backed cells: no
 * bridge layer, no mirroring.
 */
@Directive({
    selector: '[ezClassify]',
    standalone: true,
    providers: ezClassifyRootProviders(),
})
export class EzClassifyDirective implements OnInit, OnChanges, OnDestroy {
    /**
     * Presentation overrides for this root, merged over the provided options
     * key by key. Unset means the provided options unchanged.
     */
    @Input() ezClassifyOptions?: EzClassifyDirectiveOptions;

    /**
     * Store override for this root. When set, the root binds to it, hands it to
     * the scanner, and provides it to descendants; when unset the directive
     * builds and owns one. A store passed in is NOT destroyed with the
     * directive: whoever created it owns its lifetime.
     */
    @Input() ezClassifyStore?: EzClassifyStore | null;

    private readonly el = inject(ElementRef<HTMLElement>);
    private readonly errors = inject(ErrorHandler);
    private readonly context = inject(EZCLASSIFY_CONTEXT, { optional: true });
    private readonly contexts = inject(EZCLASSIFY_CONTEXTS, { optional: true });
    private readonly providedOptions = inject(EZCLASSIFY_OPTIONS, {
        optional: true,
    });
    private readonly forms = signal<EzClassifyUI | null>(null);
    private readonly store = signal<EzClassifyStore | null>(null);
    /** True while `store()` holds a store this directive built and must destroy. */
    private ownsStore = false;
    private built = false;
    private destroyed = false;
    private initToken = 0;

    /**
     * The root's live store as a signal, `null` until the root has built it.
     * Descendants are constructed before the root's first change detection, so
     * a binding that must not miss the store (`injectEzClassifyFacet`) reads
     * this through {@link EZCLASSIFY_STORE_SIGNAL} and arms itself when it turns
     * non-null, and again on every rebuild.
     */
    readonly storeSignal: Signal<EzClassifyStore | null> =
        this.store.asReadonly();

    /**
     * The root's runtime as a signal, `null` until it has mounted (a microtask
     * after the root's first change detection) and again while a rebuild
     * replaces it. Read it through {@link injectEzClassifyUI}.
     */
    readonly uiSignal: Signal<EzClassifyUI | null> = this.forms.asReadonly();

    /**
     * The live store for this root, or `null` before it is built. Used by the
     * DI proxy and by tests that need the concrete store reference.
     */
    getStore(): EzClassifyStore | null {
        return this.store();
    }

    /** The Context this root marks against; null when it holds several. */
    getContext(): ContextAdapter | null {
        return this.context;
    }

    /** The presentation options in force for this root, provided plus overrides. */
    getOptions(): EzClassifyOptions {
        return mergeProvisionOptions(
            this.providedOptions,
            this.ezClassifyOptions,
        );
    }

    /** An options or store change rebuilds the root. */
    ngOnChanges(): void {
        this.rebuild();
    }

    /**
     * A bare `<form ezClassify>` binds no input and never gets an
     * `ngOnChanges`, so the first build happens here. Angular runs
     * `ngOnChanges` before `ngOnInit`, so a root that bound an input has
     * already built by the time this runs.
     */
    ngOnInit(): void {
        if (!this.built) this.rebuild();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.teardown();
    }

    private rebuild(): void {
        this.built = true;
        // Destroy the old instance synchronously so resources are freed before
        // Angular finishes its CD pass. Store creation is synchronous (it has
        // no DOM dependency); EzClassifyUI is deferred a microtask so any
        // [(ngModel)] child bindings finish applying before the scanner runs.
        this.teardown();
        const source = this.contexts;
        if (!source) throw new Error(NO_CONTEXT);
        const token = ++this.initToken;
        const opts = this.getOptions();

        const provided = this.ezClassifyStore ?? null;
        this.ownsStore = provided === null;
        // One bucket per (Context, scheme) pair, resolved the way the runtime
        // resolves them; one Context's primary scheme is the default bucket.
        const store =
            provided ??
            new AngularSignalStore({
                buckets: contextStoreBuckets(source, { format: opts.format }),
            });
        this.store.set(store);
        Promise.resolve().then(() => {
            if (this.destroyed || token !== this.initToken) return;
            // A runtime that cannot start leaves the document without its
            // marking controls. It goes to the application's ErrorHandler, the
            // way any other failed Angular step does, rather than out of a
            // microtask as an unhandled rejection.
            try {
                this.forms.set(
                    new EzClassifyUI(source, {
                        root: this.el.nativeElement,
                        format: opts.format,
                        colorMap: opts.colorMap,
                        tooltipConceptProperty: opts.tooltipConceptProperty,
                        favorites: opts.favorites,
                        store,
                    }),
                );
            } catch (error) {
                this.errors.handleError(error);
            }
        });
    }

    private teardown(): void {
        this.forms()?.destroy();
        this.forms.set(null);
        // Only a store this directive built is this directive's to destroy.
        if (this.ownsStore) this.store()?.destroy();
        this.ownsStore = false;
        this.store.set(null);
    }
}

/**
 * The runtime of the enclosing `ezClassify` root, for code that has to reach it
 * directly: `add` and `remove` for page elements it cannot write markup for,
 * its `root` element, readiness. Marking state is better read through the store
 * or `injectEzClassifyFacet`. Call it from a component or directive inside the
 * root.
 *
 * @returns A signal holding the runtime, `null` until the root has mounted.
 * @throws When no `ezClassify` root encloses the caller.
 */
export function injectEzClassifyUI(): Signal<EzClassifyUI | null> {
    const root = inject(EzClassifyDirective, { optional: true });
    if (!root) {
        throw new Error(
            '[ezclassify/angular] injectEzClassifyUI() must be called inside an ezClassify root',
        );
    }
    return root.uiSignal;
}

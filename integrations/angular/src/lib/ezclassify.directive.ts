import {
    Directive,
    ElementRef,
    Input,
    OnDestroy,
    OnChanges,
    OnInit,
    SimpleChanges,
    forwardRef,
    inject,
    signal,
    type Provider,
    type Signal,
} from '@angular/core';
import {
    EzClassifyUI,
    contextSignature,
    mergeProvisionOptions,
    sameSignature,
} from '@ezclassify/ui';
import type { EzClassifyStore } from '@ezclassify/ui';
import {
    AngularSignalStore,
    EZCLASSIFY_STORE,
    EZCLASSIFY_STORE_SIGNAL,
} from './angular-signal-store';
import {
    EZCLASSIFY_ENGINE,
    EZCLASSIFY_OPTIONS,
    resolveSchemeAdapter,
    type EzClassifyEngine,
    type EzClassifyOptions,
    type EzClassifySchemeEngine,
} from './provide-ezclassify';

/**
 * Options forwarded to EzClassifyUI. Alias of the app-level
 * {@link EzClassifyOptions}: the directive's `[ezClassifyOptions]` input is an
 * override of the same shape `provideEzClassify` sets.
 */
export type EzClassifyDirectiveOptions = EzClassifyOptions;

/**
 * Lazy proxy over the directive's live store. The directive recreates the store
 * whenever the engine input changes; descendants that injected the store
 * earlier still see the current instance because every call goes through this
 * proxy. Throws if accessed before the directive has an engine.
 */
function lazyStoreProxy(getDir: () => EzClassifyDirective): EzClassifyStore {
    const resolve = (): EzClassifyStore => {
        const store = getDir().getStore();
        if (!store) {
            throw new Error(
                '[ezclassify/angular] EzClassifyStore not initialized. Bind [ezClassify], or provide an engine with provideEzClassify().',
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

function ezClassifyScopeProviders(): Provider[] {
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
 * Directive that initializes EzClassifyUI on a host element.
 *
 * The host element becomes the scoped root: all ezclassify-* children are
 * auto-enhanced, and cleanup runs when the directive is destroyed.
 *
 * Every input is an override. An application that called `provideEzClassify()`
 * writes `<div ezClassify>` and inherits the engine and presentation options
 * from the app config; a host that needs a different runtime or a different
 * format binds `[ezClassify]` / `[ezClassifyOptions]` and shadows the defaults
 * for itself and its descendants. `[ezClassifyStore]` goes one step further and
 * hands the scope a store the host already owns, which is what a component that
 * drives its own bindings and wants the scanner on the same state needs.
 *
 * Provides the scope's store via DI so descendant components can
 * `inject(EZCLASSIFY_STORE)` and read/write marking state against the same
 * store the runtime's scanner-driven binding pass uses. Per binding-model.md §8
 * the store's entries are signal-backed cells: no bridge layer, no mirroring.
 */
@Directive({
    selector: '[ezClassify]',
    standalone: true,
    providers: ezClassifyScopeProviders(),
})
export class EzClassifyDirective implements OnInit, OnChanges, OnDestroy {
    /**
     * Engine override for this host: a scheme adapter or a composed context.
     * Unset means the app-level engine from `provideEzClassify()`. The empty
     * string is what Angular applies for a bare `<div ezClassify>` attribute
     * and reads the same as unset.
     */
    @Input('ezClassify') engine?: EzClassifyEngine | null | '';

    /**
     * Presentation overrides for this host, merged over the app-level options
     * key by key. Unset means the app-level options unchanged.
     */
    @Input() ezClassifyOptions?: EzClassifyDirectiveOptions;

    /**
     * Store override for this host. When set, the scope binds to it, hands it
     * to the scanner, and provides it to descendants; when unset the directive
     * builds and owns one. A store passed in is NOT destroyed with the
     * directive: whoever created it owns its lifetime.
     */
    @Input() ezClassifyStore?: EzClassifyStore | null;

    private readonly el = inject(ElementRef<HTMLElement>);
    private readonly defaultEngine = inject(EZCLASSIFY_ENGINE, {
        optional: true,
    });
    private readonly defaultOptions = inject(EZCLASSIFY_OPTIONS, {
        optional: true,
    });
    private forms: EzClassifyUI | null = null;
    private readonly store = signal<EzClassifyStore | null>(null);
    private readonly engineState = signal<EzClassifySchemeEngine | null>(null);
    /** True while `store()` holds a store this directive built and must destroy. */
    private ownsStore = false;
    private built = false;
    private destroyed = false;
    private initToken = 0;
    /** Structural signature of the engine behind the last rebuild. */
    private prevSignature: readonly unknown[] | null = null;

    /**
     * The scope's live store as a signal, `null` until an engine is available.
     * Bindings that must survive a late-arriving engine
     * (`injectEzClassifyFacet`) read this through
     * {@link EZCLASSIFY_STORE_SIGNAL} and arm themselves when it turns
     * non-null.
     */
    readonly storeSignal: Signal<EzClassifyStore | null> =
        this.store.asReadonly();

    /**
     * The scope's resolved engine as a signal, `null` before one is available.
     *
     * The companion to {@link storeSignal} for the surfaces that run a marking
     * through the engine themselves rather than holding store state:
     * `<ez-marking-label>` colors its pill that way. Both change together, on
     * every rebuild, so a binding can arm itself off whichever one it actually
     * uses.
     */
    readonly engineSignal: Signal<EzClassifySchemeEngine | null> =
        this.engineState.asReadonly();

    /**
     * The live store for this directive instance, or `null` before an engine
     * has been resolved. Used by the DI proxy and by tests that need the
     * concrete store reference.
     */
    getStore(): EzClassifyStore | null {
        return this.store();
    }

    /**
     * The resolved scheme engine for this directive scope, or `null` when
     * neither the input nor the app-level provider supplies an engine. Context
     * inputs are unwrapped to their scheme adapter; bare adapter inputs pass
     * through unchanged.
     */
    getEngine(): EzClassifySchemeEngine | null {
        const engine = this.resolveEngine();
        return engine ? resolveSchemeAdapter(engine) : null;
    }

    /**
     * The presentation options in force for this scope, defaults plus
     * overrides.
     */
    getOptions(): EzClassifyOptions {
        return mergeProvisionOptions(
            this.defaultOptions,
            this.ezClassifyOptions,
        );
    }

    ngOnChanges(changes: SimpleChanges): void {
        // Angular reports the `[ezClassify]` input changed whenever its bound value
        // identity changes. A template that re-creates a Context wrapper around the
        // same underlying engine would, naively, rebuild here; dropping per-marking
        // store state and re-running the scanner. When the ONLY change is the engine
        // (options and store unchanged), gate the rebuild on the engine's structural
        // signature, the shared, framework-agnostic definition of "did the engine
        // actually change?"; so a wrapper-only change is a no-op, matching React's
        // `useStableEngineArg`. An options or store change always rebuilds. See
        // libs/ui/src/engine-signature.ts.
        //
        // Limit (see engine-signature.ts): a Context built inline from freshly
        // constructed child engines each pass still yields new component identities
        // and rebuilds; memoizing the child engine stays the consumer's job.
        if (
            this.built &&
            changes['engine'] &&
            !changes['ezClassifyOptions'] &&
            !changes['ezClassifyStore']
        ) {
            const nextSig = contextSignature(this.resolveEngine());
            if (
                this.prevSignature &&
                sameSignature(this.prevSignature, nextSig)
            )
                return;
        }
        this.rebuild();
    }

    /**
     * A host with no bound input (`<div ezClassify>` inheriting the app-level
     * engine) never gets an `ngOnChanges`, so the first build happens here.
     * Angular runs `ngOnChanges` before `ngOnInit`, so a host that DID bind
     * something has already built by the time this runs.
     */
    ngOnInit(): void {
        if (!this.built) this.rebuild();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.teardown();
    }

    /**
     * The engine this scope binds to: the host override, else the app default.
     *
     * A bare `<div ezClassify>` is a static attribute, and Angular applies `''`
     * for it. That is the shape of "no override", so anything falsy falls
     * through to the app-level engine; a real adapter is always an object.
     */
    private resolveEngine(): EzClassifyEngine | null {
        return this.engine || this.defaultEngine || null;
    }

    private rebuild(): void {
        this.built = true;
        this.prevSignature = contextSignature(this.resolveEngine());
        // Destroy the old instance synchronously so resources are freed before
        // Angular finishes its CD pass. Store creation is synchronous (it has
        // no DOM dependency); EzClassifyUI is deferred a microtask so any
        // [(ngModel)] child bindings finish applying before the scanner runs.
        this.teardown();
        const engine = this.resolveEngine();
        if (!engine) return;
        const token = ++this.initToken;
        const opts = this.getOptions();
        const schemeAdapter = resolveSchemeAdapter(engine);

        const provided = this.ezClassifyStore ?? null;
        this.ownsStore = provided === null;
        const store =
            provided ??
            new AngularSignalStore(schemeAdapter, { format: opts.format });
        this.store.set(store);
        this.engineState.set(schemeAdapter);
        Promise.resolve().then(() => {
            if (this.destroyed || token !== this.initToken) return;
            this.forms = new EzClassifyUI(engine, {
                root: this.el.nativeElement,
                rollupId: opts.rollupId,
                format: opts.format,
                colorMap: opts.colorMap,
                tooltipConceptProperty: opts.tooltipConceptProperty,
                favorites: opts.favorites,
                store,
            });
        });
    }

    private teardown(): void {
        this.forms?.destroy();
        this.forms = null;
        // Only a store this directive built is this directive's to destroy.
        if (this.ownsStore) this.store()?.destroy();
        this.ownsStore = false;
        this.store.set(null);
        this.engineState.set(null);
    }
}

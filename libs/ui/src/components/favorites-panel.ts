/**
 * Whole-marking Favorites and scoped scheme presets. MarkingField and TagInput
 * embed this list in their branding popover; marked editors use its separate
 * star control.
 *
 * The component stores nothing. A host wires `favorites.load` (and optionally
 * `save`/`remove`) on `ComponentOptions`; this module never touches
 * localStorage, cookies, or any other persistence itself. Hosts observe commits
 * the field makes when a favorite is applied through the same native events
 * every other field mutation already dispatches (Host Form Contract); there is
 * no separate favorites-specific event.
 *
 * The ★ also renders with no host wiring at all, as long as the loaded scheme
 * declares `labelPresets` for the field's scope: the panel then opens
 * read-only, offering just the "From the scheme" section (no pinned row, no
 * user-favorites section) so a scheme's curated presets are reachable even on a
 * host that never set up favorites persistence. See
 * {@link ensureFavoritesButton} and {@link schemeOffersPresets}.
 *
 * The popover owns its own list rendering (the `proto-dropdown` classes in
 * component-utils.css). A saved marking is a whole value, not a concept, so
 * favorites never appear in the field's composer list: mixing whole-marking
 * rows into a list whose Enter replaces the caret token is the ghost-accept
 * hazard keeping them apart avoids.
 */

import type {
    LabelPresetView,
    MaybePromise,
    SchemePublicView,
} from '@ezclassify/types';
import { createAnnouncer, announce, readGeometry } from './component-utils';
import { copyOverlayTheme, portalViewportOverlay } from './overlay-portal';
import { adoptStylesOnce, type AdoptedStyles } from '../styles/adopt';
import { t } from '../i18n';
import favoritesPanelCss from './favorites-panel.css?inline';
import {
    dismissStatusMarkPopover,
    refreshStatusMarkPopover,
    setStatusMarkFavorites,
} from './status-mark';

/** The scheme and presentation scope owning a host's saved markings. */
export interface FavoritesContext {
    /** The scheme that reads these markings. */
    schemeId: string;
    /** The field's effective marking scope, when declared. */
    scope?: string;
    /** The consuming field's format. */
    formatId?: string;
}

/** One saved favorite: a marking string plus an optional display label. */
export interface FavoriteEntry {
    /** The marking string, in whatever format the host stored it under. */
    marking: string;
    /** Display label; the raw marking is shown when this is omitted. */
    label?: string;
}

/**
 * Host-fed Favorites and optional storage controls. The host owns persistence
 * and the UI calls its hooks; it never writes browser or server storage.
 */
export interface FavoritesConfig {
    /**
     * Optional browser-storage consent. The host still owns every storage
     * operation.
     */
    browserStorage?: {
        /** Undefined until the visitor has chosen whether to remember Favorites. */
        enabled(): boolean | undefined;
        /**
         * Persist the choice; disabling removes stored copies but may retain
         * visit-local Favorites.
         */
        setEnabled(enabled: boolean): MaybePromise<void>;
    };
    /** Clear this scheme/scope's Favorites without changing scheme presets. */
    clear?(ctx: FavoritesContext): MaybePromise<void>;
    /**
     * Load this scheme/scope's saved markings at mount and each time the panel
     * opens. The format identifies the consuming field; saved values are read
     * through that field's adapter before application.
     */
    load(ctx: FavoritesContext): MaybePromise<FavoriteEntry[]>;
    /**
     * Persist a new favorite. Its presence (not `remove`'s) gates whether the
     * panel offers the pinned save/remove row at all.
     */
    save?(marking: string, ctx: FavoritesContext): MaybePromise<void>;
    /** Remove a saved favorite. */
    remove?(marking: string, ctx: FavoritesContext): MaybePromise<void>;
}

/** Everything a host field supplies so the panel can render and apply rows. */
export interface FavoritesPanelHost {
    /** Root for style/tooltip scoping. */
    root?: HTMLElement;
    schemeId: string;
    scope?: string;
    formatId: string;
    scheme: SchemePublicView;
    /**
     * Undefined when the host wires no persistence at all. The panel still
     * mounts in that case if the scheme offers `labelPresets` for this field's
     * scope (see {@link ensureFavoritesButton}); it just runs read-only, showing
     * "From the scheme" and nothing else: no pinned save/remove row, no
     * user-favorites section.
     */
    config?: FavoritesConfig;
    /**
     * Read a marking string through the engine in THIS field's own
     * scheme/format, as the reader's call: a saved marking is read, not
     * corrected. Used both to translate a favorite/preset into the field's
     * shape on apply and to compare against the field's current value for
     * star-fill, so favorites are format-portable by construction: a
     * banner-stored "HIGH/CTRL-A" resolves to "[[H/A]]" inside a MarkedTextArea
     * segment through this same call. Fields hand in their own richer
     * `readForFavorites` closure (which also returns assertions and applied
     * fixes), but the panel only ever reads `rendered`; the contract stays
     * narrow to what it actually consumes.
     */
    read: (marking: string) => MaybePromise<{
        rendered: string;
    }>;
    /** Expand a scheme preset through the adapter that owns its definition. */
    applyPreset: (presetId: string) => MaybePromise<{ rendered: string }>;
    /**
     * The field's current marking for star-fill comparison and the pinned row's
     * save/remove eligibility. `valid` gates the pinned row: an in-progress or
     * empty marking has nothing coherent to save.
     */
    getCurrent: () => { rendered: string; valid: boolean };
    /** Describe the caret target when a field contains several markings. */
    describeTarget?: () => string;
    /**
     * Apply a resolved marking (replace, or MTA's stamp). An asynchronous host
     * must honor cancellation before writing if the panel closes or another
     * action supersedes this one.
     */
    onApply: (marking: string, signal: AbortSignal) => MaybePromise<void>;
    /**
     * Return keyboard focus to the field's own native element (Esc's "return
     * focus to field" contract). Applying a row already moves focus itself
     * (into the field, at whatever position the apply landed the caret); this
     * hook exists for the plain "opened, then backed out" path, so Esc never
     * strands focus on a button the field's own tab order doesn't expect.
     */
    focusField: () => void;
}

/** All external state needed for row rendering. Rebuilt on every open. */
interface PanelRow {
    el: HTMLElement;
    apply: () => void;
}

/** Adopt the panel stylesheet once per root (see adoptStylesOnce). */
function injectStyles(root: HTMLElement | undefined): void {
    adoptStylesOnce(favoritesPanelCss, root);
}

/** Build the ★ glyph markup, mirroring status-mark's outline/filled toggle. */
function buildStarSvg(): string {
    return (
        '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
        '<path d="M10 1.2l2.47 5.6 6.1.62-4.62 4.13 1.32 6.02L10 14.6l-5.27 2.97 1.32-6.02L1.43 7.42l6.1-.62z"/>' +
        '</svg>'
    );
}

/**
 * Whether a scheme offers any label presets for a field's effective scope.
 *
 * Mirrors the engine's own preset scope resolution: the effective scope is the
 * field's declared scope, falling back to the scheme's `defaultScope`; a preset
 * belongs to its declared `scope`, falling back to `defaultScope`; a preset
 * that resolves to no scope (scopeless scheme) belongs to every scope.
 *
 * A field offers the presets section only when this is true: a trailing section
 * that always renders empty (e.g. an authority-block field on a scheme with
 * only classification presets) is chrome that does nothing.
 */
export function schemeOffersPresets(
    scheme:
        | Pick<SchemePublicView, 'labelPresets' | 'defaultScope'>
        | null
        | undefined,
    scope?: string,
): boolean {
    return getScopedPresets(scheme, scope).length > 0;
}

/** The `labelPresets` entries that resolve into a field's effective scope. */
export function getScopedPresets(
    scheme:
        | Pick<SchemePublicView, 'labelPresets' | 'defaultScope'>
        | null
        | undefined,
    scope?: string,
): LabelPresetView[] {
    const presets = scheme?.labelPresets ?? [];
    if (presets.length === 0) return [];
    const effective = scope ?? scheme?.defaultScope;
    if (!effective) return presets;
    return presets.filter((p) => {
        const resolved = p.scope ?? scheme?.defaultScope;
        return resolved === undefined || resolved === effective;
    });
}

/**
 * The ★ favorites button plus its popover panel. One instance per field; mount
 * with {@link ensureFavoritesButton}, which owns the "only when wired, never
 * stacked" invariant the way `ensureStatusMark` does for the status mark.
 */
export class FavoritesPanel {
    /** The ★ trigger button, mounted on the field's chrome wrap. */
    readonly button: HTMLButtonElement;
    private host: FavoritesPanelHost;
    private panel: HTMLDivElement;
    private panelItems: HTMLDivElement;
    private announcer: HTMLDivElement;
    private dropdownPortalStyle: AdoptedStyles | null;
    private wrap: HTMLElement;

    private _isOpen = false;
    private _destroyed = false;
    /**
     * Stale-load guard shared by the mount-time load and every open(): only the
     * most recent load's async result may land in `_cachedFavorites`.
     * Incremented at the start of each load attempt; a resolved load whose
     * captured value no longer matches this counter was superseded (a newer
     * load started, or the panel was destroyed) and must not write stale data
     * over whatever the newer attempt already landed.
     */
    private _openSeq = 0;
    private _rows: PanelRow[] = [];
    private _highlightIndex = -1;
    private applyAbort: AbortController | null = null;
    /**
     * The last-loaded favorites, each paired with its rendered form in THIS
     * field's own format. Loaded once at construction so the button's
     * filled/outline state is correct before the user ever opens the panel (a
     * field mounted with its value already saved as a favorite starts filled,
     * not blank-until-first-open); refreshed again on every open and reused
     * between opens by `syncStar()` so fill comparison costs no engine call
     * outside an actual load.
     */
    private _cachedFavorites: Array<{
        entry: FavoriteEntry;
        rendered: string;
    }> = [];
    /**
     * The scheme's own scoped presets, each paired with its rendered form in
     * THIS field's own format: the star-fill counterpart to `_cachedFavorites`.
     * A scheme preset is scheme-authored data, not a user favorite, but the
     * button's filled state should still read "gold" when the field's current
     * value matches one: a provider-less field (nothing in `_cachedFavorites`
     * ever) still needs SOME way to show the star filled, and a provider-wired
     * field's presets are just as much "this value is already one click away"
     * as its saved favorites are. Loaded on the same mount + every-open cadence
     * as `_cachedFavorites`, through the same stale-load guard.
     */
    private _cachedPresets: Array<{
        preset: LabelPresetView;
        rendered: string;
    }> = [];
    private boundDocPointerDown: (e: Event) => void;
    private embeddedMark: HTMLElement | null = null;
    private managing = false;

    constructor(wrap: HTMLElement, host: FavoritesPanelHost, embedded = false) {
        this.wrap = wrap;
        this.host = host;
        injectStyles(host.root);

        this.button = document.createElement('button');
        this.button.type = 'button';
        // No self-positioning: the button sits in normal flow as a flex child
        // of the field's inline chrome, mirroring status-mark.ts's 'chrome'
        // shape.
        this.button.className =
            'ez-favorites-button ez-favorites-button--chrome';
        this.button.innerHTML = buildStarSvg();
        this.button.setAttribute('aria-haspopup', 'dialog');
        this.button.setAttribute('aria-expanded', 'false');
        this.button.setAttribute('aria-label', t('aria.favorites'));
        // The button is a separate popover trigger, not part of the field's
        // native editing surface; a mouse/touch press on it must never blur
        // the field (which would fire the field's own commit/rest side
        // effects mid-interaction). Keyboard Tab reaches it normally, since
        // that only relies on tabIndex (default 0 for a <button>), never on
        // mousedown.
        this.button.addEventListener('mousedown', (e) => e.preventDefault());
        this.button.addEventListener('click', () => void this.open());
        this.button.addEventListener('keydown', (e) => this.onButtonKeydown(e));
        if (!embedded) wrap.appendChild(this.button);

        this.panel = document.createElement('div');
        this.panel.className = 'proto-dropdown ez-favorites-panel';
        this.panel.id =
            'ez-favorites-panel-' + Math.random().toString(36).slice(2, 8);
        this.panel.style.display = 'none';
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-label', t('aria.favorites'));
        this.panel.addEventListener('mousedown', (e) => e.preventDefault());

        this.panelItems = document.createElement('div');
        this.panelItems.className = 'proto-dropdown__items';
        this.panelItems.setAttribute('role', 'group');
        this.panelItems.setAttribute('aria-label', t('aria.favorites'));
        this.panelItems.id = this.panel.id + '-items';
        this.panel.appendChild(this.panelItems);
        this.panelItems.addEventListener('focusin', () => {
            this._highlightIndex = this._rows.findIndex(
                (row) => row.el === document.activeElement,
            );
            this._rows.forEach((row, index) =>
                row.el.classList.toggle(
                    'proto-dropdown-item--highlighted',
                    index === this._highlightIndex,
                ),
            );
        });
        this.panel.addEventListener('keydown', (event) => {
            if (this.embeddedMark) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close(true);
                return;
            }
            if (event.key === 'Tab') {
                const controls = this.controls();
                const edge = event.shiftKey ? controls[0] : controls.at(-1);
                if (document.activeElement === edge) {
                    if (event.shiftKey) {
                        event.preventDefault();
                        this.button.focus();
                    } else {
                        const next = [
                            ...document.querySelectorAll<HTMLElement>(
                                'a[href], button, input, select, textarea, [tabindex]',
                            ),
                        ].filter(
                            (element) =>
                                element.tabIndex >= 0 &&
                                !element.matches(':disabled') &&
                                !this.panel.contains(element) &&
                                element.getClientRects().length > 0,
                        );
                        const target = next[next.indexOf(this.button) + 1];
                        this.close(false);
                        if (target) {
                            event.preventDefault();
                            target.focus();
                        }
                    }
                }
                return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const controls = this.controls();
            const index = controls.indexOf(
                document.activeElement as HTMLElement,
            );
            const next = index + (event.key === 'ArrowDown' ? 1 : -1);
            if (next < 0) this.button.focus();
            else controls[Math.min(next, controls.length - 1)]?.focus();
        });
        this.button.setAttribute('aria-controls', this.panelItems.id);

        this.announcer = createAnnouncer();
        wrap.appendChild(this.announcer);

        this.dropdownPortalStyle = embedded
            ? null
            : portalViewportOverlay(this.panel, wrap, favoritesPanelCss);
        if (embedded) {
            adoptStylesOnce(favoritesPanelCss, document.body);
            this.embeddedMark = wrap.querySelector(':scope > .ez-status-mark');
            this.panelItems.setAttribute('role', 'group');
            this.panelItems.classList.add('ez-favorites-panel__embedded');
            setStatusMarkFavorites(wrap, {
                element: this.panelItems,
                open: () => {
                    void this.open();
                },
                close: () => {
                    this.abortApply();
                    this._isOpen = false;
                    this.managing = false;
                },
            });
        }

        this.boundDocPointerDown = (e: Event) => {
            const target = e.target as Node;
            if (
                !this.embeddedMark &&
                this._isOpen &&
                !this.panel.contains(target) &&
                !this.button.contains(target)
            ) {
                this.close(false);
            }
        };
        document.addEventListener('mousedown', this.boundDocPointerDown);

        // Load once at mount so a field whose current value is already a
        // saved favorite starts with a filled star, not an outline star that
        // only fills once the user opens the popover for the first time.
        void this.loadAndCacheFavorites().then(() => {
            if (!this._destroyed) this.syncStar();
        });
    }

    /** Refresh the closures a host rebuilds on every render pass. */
    updateHost(host: FavoritesPanelHost): void {
        this.host = host;
    }

    /**
     * Sync the button's filled/outline state against the LAST loaded favorites
     * AND scheme presets (no engine call: reuses the rendered forms cached by
     * the most recent {@link open}/mount load). A field that has never opened
     * its favorites panel simply shows the outline star until it does.
     */
    syncStar(): void {
        const current = this.host.getCurrent();
        const isFavorite =
            current.valid &&
            !!current.rendered &&
            (this._cachedFavorites.some(
                (f) => f.rendered === current.rendered,
            ) ||
                this._cachedPresets.some(
                    (p) => p.rendered === current.rendered,
                ));
        this.button.classList.toggle('ez-favorites-button--active', isFavorite);
        this.button.setAttribute(
            'aria-label',
            isFavorite ? t('aria.favoritesActive') : t('aria.favorites'),
        );
    }

    /**
     * Load `config.load`, read every returned favorite into this field's own
     * rendered form, and cache the result for star-fill comparison. Shared by
     * the mount-time load ({@link FavoritesPanel} constructor, per
     * `FavoritesConfig.load`'s documented mount + on-open cadence) and every
     * {@link open}, so both go through the identical stale-load guard: a
     * resolved load whose `_openSeq` no longer matches (a newer load started,
     * or the panel was destroyed) never overwrites the cache.
     *
     * @returns The processed list, or `null` if this load was superseded or the
     *   panel was destroyed before it landed: callers must not act on a `null`
     *   result (the newer load, or nothing, already owns the state).
     */
    private async loadAndCacheFavorites(): Promise<Array<{
        entry: FavoriteEntry;
        rendered: string;
    }> | null> {
        const seq = ++this._openSeq;

        let entries: FavoriteEntry[];
        try {
            // No config at all (presets-only mount, see ensureFavoritesButton)
            // means no user favorites to load: the panel still renders,
            // just with nothing above the scheme's own presets.
            entries = this.host.config
                ? await Promise.resolve(
                      this.host.config.load({
                          schemeId: this.host.schemeId,
                          scope: this.host.scope,
                          formatId: this.host.formatId,
                      }),
                  )
                : [];
        } catch {
            entries = [];
        }
        if (seq !== this._openSeq || this._destroyed) return null;

        const processed = await Promise.all(
            entries.map(async (entry) => {
                try {
                    const result = await Promise.resolve(
                        this.host.read(entry.marking),
                    );
                    return { entry, rendered: result.rendered };
                } catch {
                    // A favorite that no longer parses (scheme drift) still
                    // shows in the list under its raw marking; it just never
                    // matches the star-fill/dedup comparison.
                    return { entry, rendered: entry.marking };
                }
            }),
        );
        if (seq !== this._openSeq || this._destroyed) return null;

        this._cachedFavorites = processed;

        // Same treatment for the scheme's own presets, so syncStar() can
        // gold-fill against them too (see `_cachedPresets`'s doc). Kept in
        // this same load pass rather than a separate cadence: presets rarely
        // change mid-session, but reading them again alongside the favorites
        // load costs nothing extra to reason about and stays correct if a
        // host ever does hot-swap schemes.
        const scopedPresets = getScopedPresets(
            this.host.scheme,
            this.host.scope,
        );
        const processedPresets = await Promise.all(
            scopedPresets.map(async (preset) => {
                try {
                    const result = await Promise.resolve(
                        this.host.applyPreset(preset.id),
                    );
                    return { preset, rendered: result.rendered };
                } catch {
                    return { preset, rendered: '' };
                }
            }),
        );
        if (seq !== this._openSeq || this._destroyed) return null;
        this._cachedPresets = processedPresets;

        return processed;
    }

    /**
     * Open the panel: show a loading row, reload and reread the favorites list
     * (see {@link loadAndCacheFavorites}), then render the pinned row,
     * favorites, and scheme presets. Always reloads, even when already open,
     * per contract: a click on the button always opens (refreshes) the list.
     *
     * @param restoreHighlightIndex - Re-highlight this row once rendering
     *   completes. A fresh user-initiated open (button click, or the initial
     *   Enter/Space/ArrowDown while closed) leaves this unset: the list opens
     *   unhighlighted until the user arrows into it, matching the dropdown
     *   convention elsewhere in the field family. {@link togglePinned} is
     *   different: it re-opens the panel to show the save/remove it just
     *   performed, as a continuation of the same keyboard interaction rather
     *   than a fresh open, so a keyboard user who pressed Enter on the pinned
     *   row expects a second Enter to toggle it right back without an
     *   intervening arrow press.
     */
    async open(restoreHighlightIndex?: number): Promise<void> {
        if (this._destroyed) return;
        const wasOpen = this._isOpen;
        this._isOpen = true;
        this.button.setAttribute('aria-expanded', 'true');
        // mousedown preventDefault (above) suppresses the browser's normal
        // click-to-focus so a mouse press never blurs the field mid-click;
        // that means opening never focuses the button on its own either, so
        // Up/Down/Enter/Esc would have nowhere to land afterward without
        // this explicit call. A keyboard open (button already focused to
        // receive the keydown that triggered this) makes this a no-op.
        if (!this.embeddedMark && !wasOpen) this.button.focus();
        this.renderLoading();
        if (!this.embeddedMark) {
            this.showPanel();
            this.position();
        }

        const processed = await this.loadAndCacheFavorites();
        if (processed === null) return;
        // Resync the button's fill state against the fresh cache BEFORE the
        // open-state check below: the ★ button lives on the field's chrome
        // and stays visible whether or not this popover is open, so a load
        // that lands after the popover already closed (Escape, an outside
        // click, or applying a different row can all close it while this
        // await is in flight) must still correct the button's class. Only
        // the popover's OWN rows are gated on `_isOpen`: there is nothing
        // to rerender into.
        this.syncStar();
        if (!this._isOpen) return;

        this.renderRows(processed);
        if (restoreHighlightIndex !== undefined) {
            this.moveHighlight(restoreHighlightIndex);
        }
        if (this.embeddedMark) refreshStatusMarkPopover(this.embeddedMark);
        else this.position();
        announce(
            this.announcer,
            `${processed.length} favorite${processed.length === 1 ? '' : 's'} available`,
        );
    }

    /**
     * Close the panel. `returnFocusToField` moves focus to the host field's own
     * native element (Esc and apply both want this; an outside click or Tab
     * does not, the browser is already moving focus somewhere else).
     */
    close(returnFocusToField: boolean): void {
        if (!this._isOpen) return;
        this.abortApply();
        this._isOpen = false;
        this.panel.style.display = 'none';
        this.button.setAttribute('aria-expanded', 'false');
        this.button.removeAttribute('aria-activedescendant');
        this._highlightIndex = -1;
        if (this.embeddedMark) dismissStatusMarkPopover(this.embeddedMark);
        if (returnFocusToField) this.host.focusField();
    }

    /** Whether focus is moving within this field's Favorites controls. */
    contains(node: Node | null): boolean {
        return (
            !!node && (this.button.contains(node) || this.panel.contains(node))
        );
    }

    /** Whether the popover is currently showing. */
    isOpen(): boolean {
        return this._isOpen;
    }

    destroy(): void {
        this.abortApply();
        this._destroyed = true;
        embeddedPanels.delete(this.wrap);
        if (this.embeddedMark) {
            dismissStatusMarkPopover(this.embeddedMark);
            setStatusMarkFavorites(this.wrap, null);
            this.panelItems.remove();
        }
        document.removeEventListener('mousedown', this.boundDocPointerDown);
        this.panel.remove();
        this.dropdownPortalStyle?.release();
        this.dropdownPortalStyle = null;
        this.button.remove();
        this.announcer.remove();
    }

    // --- Rendering -----------------------------------------------------

    private showPanel(): void {
        this.panel.style.display = 'block';
    }

    private renderLoading(): void {
        if (this.panelItems.childElementCount > 0) return;
        this.panelItems.innerHTML = '';
        const row = document.createElement('div');
        row.className = 'proto-dropdown-item ez-favorites-panel__loading';
        // Informational text inside a listbox, not a selectable option: a
        // screen reader would otherwise skip it entirely (only role="option"
        // children are exposed) and never learn the list is still loading.
        row.setAttribute('role', 'status');
        row.textContent = t('favorites.loading');
        this.panelItems.appendChild(row);
        this._rows = [];
        this._highlightIndex = -1;
    }

    private renderRows(
        processed: Array<{ entry: FavoriteEntry; rendered: string }>,
    ): void {
        const restoreFocus = this.focusAfterRender();
        this.panelItems.innerHTML = '';
        this._rows = [];
        this._highlightIndex = -1;
        if (this.managing) {
            this.renderManagement();
            restoreFocus();
            return;
        }

        if (this.host.describeTarget) {
            const target = document.createElement('div');
            target.className = 'ez-favorites-panel__target';
            target.textContent = this.host.describeTarget();
            this.panelItems.appendChild(target);
        }
        const current = this.host.getCurrent();
        const canPin =
            !!this.host.config?.save && current.valid && !!current.rendered;
        if (canPin) {
            const isCurrentFavorite = processed.some(
                (f) => f.rendered === current.rendered,
            );
            this.addRow(
                this.buildPinnedRow(isCurrentFavorite, current.rendered),
                () =>
                    void this.togglePinned(isCurrentFavorite, current.rendered),
            );
        }

        if (this.embeddedMark && this.host.config) {
            const header = document.createElement('div');
            header.className = 'proto-dropdown-group';
            header.textContent = t('favorites.saved');
            this.panelItems.appendChild(header);
        }

        for (const [
            favoriteIndex,
            { entry, rendered },
        ] of processed.entries()) {
            const isCurrent = current.valid && rendered === current.rendered;
            const row = this.buildFavoriteRow(entry, isCurrent);
            row.dataset.favoriteMarking = entry.marking;
            this.addRow(row, () => this.applyAndClose(entry.marking));
            if (this.host.config?.remove) {
                this._rows[this._rows.length - 1].el.addEventListener(
                    'keydown',
                    (event) => {
                        if (event.key !== 'Delete') return;
                        event.preventDefault();
                        event.stopPropagation();
                        void this.removeFavorite(entry.marking, favoriteIndex);
                    },
                );
            }
        }

        const presets = getScopedPresets(this.host.scheme, this.host.scope);
        if (presets.length > 0) {
            const header = document.createElement('div');
            header.className = 'proto-dropdown-group';
            // A section boundary, not a row: it is never highlighted or
            // clicked, so role="option" would misrepresent it as a selectable
            // row. The composer's group labels take the same role.
            header.setAttribute('role', 'presentation');
            header.textContent = t('favorites.fromScheme');
            this.panelItems.appendChild(header);
            for (const preset of presets) {
                const rendered = this._cachedPresets.find(
                    (entry) => entry.preset.id === preset.id,
                )?.rendered;
                const row = this.buildPresetRow(preset, rendered);
                row.dataset.presetId = preset.id;
                this.addRow(row, () => {
                    if (rendered) this.applyAndClose(rendered);
                });
            }
        }

        // canPin always adds the pinned row first, so _rows is only empty
        // when canPin is false; the empty state needs no separate guard.
        if (this._rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'proto-dropdown-item ez-favorites-panel__empty';
            empty.setAttribute('role', 'status');
            empty.textContent = t('favorites.empty');
            this.panelItems.appendChild(empty);
        }
        if (this.host.config?.browserStorage) this.renderStorageChoice();
        restoreFocus();
    }

    private focusAfterRender(): () => void {
        const focused = document.activeElement;
        if (
            !(focused instanceof HTMLElement) ||
            !this.panelItems.contains(focused) ||
            this.panelItems.closest('[hidden]')
        )
            return () => {};
        const identity = Object.entries(focused.dataset).find(([name]) =>
            ['favoriteMarking', 'presetId', 'favoritesAction'].includes(name),
        );
        return () => {
            if (!identity || this.panelItems.closest('[hidden]')) return;
            const [name, value] = identity;
            [...this.panelItems.querySelectorAll<HTMLElement>('button, input')]
                .find((control) => control.dataset[name] === value)
                ?.focus();
        };
    }

    private settingsButton(
        label: string,
        action: (keyboard: boolean) => void,
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ez-favorites-panel__settings-action';
        button.textContent = label;
        button.dataset.favoritesAction = label;
        button.addEventListener('click', (event) => {
            this.abortApply();
            action(event.detail === 0);
        });
        return button;
    }

    private renderStorageChoice(): void {
        const storage = this.host.config!.browserStorage!;
        const footer = document.createElement('div');
        footer.className = 'ez-favorites-panel__settings';
        if (storage.enabled() === undefined) {
            const prompt = document.createElement('div');
            prompt.textContent = t('favorites.rememberPrompt');
            footer.appendChild(prompt);
            for (const [label, enabled] of [
                [t('favorites.remember'), true],
                [t('favorites.visitOnly'), false],
            ] as const) {
                footer.appendChild(
                    this.settingsButton(label, (keyboard) => {
                        const focused = document.activeElement;
                        void Promise.resolve()
                            .then(() => storage.setEnabled(enabled))
                            .then(() => {
                                if (!this._isOpen || this._destroyed) return;
                                const restoreFocus =
                                    keyboard &&
                                    document.activeElement === focused &&
                                    !this.panelItems.closest('[hidden]');
                                this.renderRows(this._cachedFavorites);
                                if (restoreFocus)
                                    this.panelItems
                                        .querySelector<HTMLButtonElement>(
                                            '.ez-favorites-panel__settings-action',
                                        )
                                        ?.focus();
                                if (this.embeddedMark)
                                    refreshStatusMarkPopover(this.embeddedMark);
                            })
                            .catch(() =>
                                announce(
                                    this.announcer,
                                    t('favorites.storageFailed'),
                                ),
                            );
                    }),
                );
            }
        } else {
            footer.appendChild(
                this.settingsButton(t('favorites.manage'), (keyboard) => {
                    this.managing = true;
                    this.renderRows(this._cachedFavorites);
                    if (keyboard)
                        this.panelItems
                            .querySelector<HTMLButtonElement>('button')
                            ?.focus();
                    if (this.embeddedMark)
                        refreshStatusMarkPopover(this.embeddedMark);
                }),
            );
        }
        this.panelItems.appendChild(footer);
    }

    private renderManagement(): void {
        const storage = this.host.config?.browserStorage;
        this.panelItems.appendChild(
            this.settingsButton(t('favorites.back'), (keyboard) => {
                this.managing = false;
                this.renderRows(this._cachedFavorites);
                if (keyboard)
                    this.panelItems
                        .querySelector<HTMLButtonElement>(
                            '.ez-favorites-panel__settings-action',
                        )
                        ?.focus();
                if (this.embeddedMark)
                    refreshStatusMarkPopover(this.embeddedMark);
            }),
        );
        if (storage) {
            const label = document.createElement('label');
            label.className = 'ez-favorites-panel__storage';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.favoritesAction = 'storage';
            input.checked = storage.enabled() === true;
            let pending = false;
            let requested = input.checked;
            input.addEventListener('change', () => {
                if (pending) {
                    input.checked = requested;
                    return;
                }
                const next = input.checked;
                requested = next;
                pending = true;
                input.setAttribute('aria-busy', 'true');
                void Promise.resolve()
                    .then(() => storage.setEnabled(next))
                    .catch(() => {
                        input.checked = storage.enabled() === true;
                        announce(this.announcer, t('favorites.storageFailed'));
                    })
                    .finally(() => {
                        pending = false;
                        input.removeAttribute('aria-busy');
                    });
            });
            const text = document.createElement('span');
            text.textContent = t('favorites.remember');
            label.append(input, text);
            this.panelItems.appendChild(label);
        }
        if (this.host.config?.clear) {
            this.panelItems.appendChild(
                this.settingsButton(t('favorites.clear'), () => {
                    void Promise.resolve()
                        .then(() => this.host.config!.clear!(this.context()))
                        .then(async () => {
                            const processed =
                                await this.loadAndCacheFavorites();
                            if (!processed || !this._isOpen || this._destroyed)
                                return;
                            announce(this.announcer, t('favorites.cleared'));
                        })
                        .catch(() =>
                            announce(
                                this.announcer,
                                t('favorites.removeFailed'),
                            ),
                        );
                }),
            );
        }
    }

    private addRow(el: HTMLElement, apply: () => void): void {
        const index = this._rows.length;
        el.setAttribute('role', 'button');
        el.id = `${this.panel.id}-row-${index}`;
        el.addEventListener('click', () => apply());
        this.panelItems.appendChild(el);
        this._rows.push({ el, apply });
    }

    private buildPinnedRow(isFavorite: boolean, marking: string): HTMLElement {
        const row = this.createRow();
        row.className = 'proto-dropdown-item ez-favorites-panel__pinned';
        row.dataset.favoritesAction = 'pin';
        if (row instanceof HTMLButtonElement)
            row.disabled = isFavorite && !this.host.config?.remove;
        const label = document.createElement('div');
        label.className = 'proto-dropdown-item__label';
        label.textContent = isFavorite
            ? t(
                  this.embeddedMark
                      ? 'favorites.unsaveCurrent'
                      : 'favorites.remove',
              )
            : this.embeddedMark
              ? t('favorites.saveCurrent')
              : t('favorites.save').replace('{marking}', marking);
        if (this.embeddedMark) {
            const star = document.createElement('span');
            star.className = 'ez-favorites-panel__star';
            star.innerHTML = buildStarSvg();
            star.classList.toggle(
                'ez-favorites-panel__star--saved',
                isFavorite,
            );
            row.appendChild(star);
        }
        row.appendChild(label);
        return row;
    }

    private buildFavoriteRow(
        entry: FavoriteEntry,
        isCurrent: boolean,
    ): HTMLElement {
        const row = this.createRow();
        row.className = 'proto-dropdown-item';
        if (isCurrent) row.classList.add('proto-dropdown-item--selected');
        const label = document.createElement('div');
        label.className = 'proto-dropdown-item__label';
        label.textContent = entry.label || entry.marking;
        row.appendChild(label);
        if (entry.label) {
            const desc = document.createElement('div');
            desc.className = 'proto-dropdown-item__desc';
            desc.textContent = entry.marking;
            row.appendChild(desc);
        }
        if (isCurrent) {
            const check = document.createElement('span');
            check.className = 'proto-dropdown-item__check';
            check.textContent = '✓';
            row.appendChild(check);
        }
        return row;
    }

    private buildPresetRow(
        preset: LabelPresetView,
        rendered?: string,
    ): HTMLElement {
        const row = this.createRow();
        row.className = 'proto-dropdown-item';
        const label = document.createElement('div');
        label.className = 'proto-dropdown-item__label';
        label.textContent = preset.label;
        row.appendChild(label);
        const desc = document.createElement('div');
        desc.className = 'proto-dropdown-item__desc';
        desc.textContent = preset.description ?? rendered ?? '';
        row.appendChild(desc);
        return row;
    }

    /** Apply a chosen marking (favorite or preset) and close the panel. */
    private abortApply(): void {
        this.applyAbort?.abort();
        this.applyAbort = null;
        this.panelItems.removeAttribute('aria-busy');
    }

    private applyAndClose(marking: string): void {
        this.abortApply();
        const controller = new AbortController();
        this.applyAbort = controller;
        try {
            const result = this.host.onApply(marking, controller.signal);
            if (!result || typeof result.then !== 'function') {
                this.applyAbort = null;
                this.close(true);
                return;
            }
            // Keep the editor's focus domain intact until its asynchronous
            // read applies to the selected marking. Closing/moving on cancels
            // that read's UI write rather than losing its caret target.
            this.panelItems.setAttribute('aria-busy', 'true');
            void Promise.resolve(result).then(
                () => {
                    if (this.applyAbort !== controller) return;
                    this.applyAbort = null;
                    this.panelItems.removeAttribute('aria-busy');
                    if (!this._destroyed) this.close(true);
                },
                () => {
                    if (this.applyAbort !== controller) return;
                    this.applyAbort = null;
                    this.panelItems.removeAttribute('aria-busy');
                    announce(this.announcer, t('favorites.applyFailed'));
                },
            );
        } catch {
            this.abortApply();
            announce(this.announcer, t('favorites.applyFailed'));
        }
    }

    private createRow(): HTMLElement {
        const button = document.createElement('button');
        button.type = 'button';
        return button;
    }

    private context(): FavoritesContext {
        return {
            schemeId: this.host.schemeId,
            scope: this.host.scope,
            formatId: this.host.formatId,
        };
    }

    private async removeFavorite(
        marking: string,
        index: number,
    ): Promise<void> {
        this.abortApply();
        const focused = document.activeElement;
        try {
            await this.host.config?.remove?.(marking, this.context());
        } catch {
            announce(this.announcer, t('favorites.removeFailed'));
            return;
        }
        if (this._destroyed) return;
        const processed = await this.loadAndCacheFavorites();
        if (!processed || !this._isOpen) return;
        const restoreFocus =
            this.panelItems.contains(focused) &&
            document.activeElement === focused &&
            !this.panelItems.closest('[hidden]');
        this.renderRows(processed);
        const favoriteRows = this._rows.filter(
            (row) => !row.el.classList.contains('ez-favorites-panel__pinned'),
        );
        const target =
            favoriteRows[Math.min(index, processed.length - 1)]?.el ??
            this._rows[0]?.el;
        if (restoreFocus) {
            if (target) target.focus();
            else {
                const tab = this.panelItems
                    .closest('.ez-marking-tools')
                    ?.querySelector<HTMLElement>(
                        '[role=tab][aria-selected=true]',
                    );
                (tab ?? this.button).focus();
            }
        }
        this.syncStar();
        if (this.embeddedMark) refreshStatusMarkPopover(this.embeddedMark);
        announce(this.announcer, t('favorites.removed'));
    }

    /** Pinned row: save the current marking, or remove it, then reload. */
    private async togglePinned(
        isFavorite: boolean,
        currentRendered: string,
    ): Promise<void> {
        this.abortApply();
        // The pinned row is always row 0. Capture whether THIS toggle came
        // from a keyboard Enter on that row (moveHighlight is the only thing
        // that sets _highlightIndex; a mouse click never does) before the
        // reload below wipes it, so the reopen can restore it and a second
        // Enter keeps working without forcing the user to arrow back onto
        // the row they just acted on.
        const restoreHighlight = this._highlightIndex === 0 ? 0 : undefined;
        const focused = document.activeElement;
        try {
            if (isFavorite) {
                const match = this._cachedFavorites.find(
                    (f) => f.rendered === currentRendered,
                );
                await Promise.resolve(
                    this.host.config?.remove?.(
                        match?.entry.marking ?? currentRendered,
                        this.context(),
                    ),
                );
            } else {
                await Promise.resolve(
                    this.host.config?.save?.(currentRendered, this.context()),
                );
            }
        } catch {
            // Persistence failure: leave the panel open on its current
            // (stale) list rather than pretending the save/remove landed.
            return;
        }
        if (this._destroyed) return;
        // This reload+resync must run unconditionally once persistence
        // resolves, even if a newer open() has started (and possibly
        // already landed) in the meantime. That newer open's own read can
        // race ahead of THIS call's write and settle first, showing
        // pre-write state: comparing against `_openSeq` here would treat
        // that earlier-landing read as "fresher" and skip the very reload
        // that's supposed to correct it once the write actually commits.
        // loadAndCacheFavorites' own `_openSeq` guard still
        // protects the CACHE from out-of-order writes: this call always
        // starts a new load, so it always ends up as the latest and wins
        // that guard on its own merits, it just must never be skipped
        // outright.
        //
        // A fast follow-up action (Escape, an outside click, applying a
        // different row) can close the popover while the save/remove call
        // above was still in flight. The popover itself has nothing left to
        // rerender into, but the ★ button is still sitting on the field's
        // chrome and must still pick up what just persisted: reload the
        // cache and resync its class without reopening the popover the user
        // already dismissed. See {@link refreshStar}.
        if (this._isOpen) {
            const restoreFocus =
                this.panelItems.contains(focused) &&
                document.activeElement === focused;
            await this.open(
                document.activeElement === focused
                    ? restoreHighlight
                    : undefined,
            );
            if (
                restoreFocus &&
                this._isOpen &&
                !this.panelItems.closest('[hidden]') &&
                (document.activeElement === document.body ||
                    document.activeElement === focused)
            )
                this._rows[0]?.el.focus();
        } else {
            void this.refreshStar();
        }
    }

    /**
     * Reload the favorites/presets cache and resync the ★ button's fill state
     * with no popover visible to rerender: the counterpart to `open()`'s reload
     * for a togglePinned save/remove that settles after the popover already
     * closed (see the call site in {@link togglePinned}). Goes through the same
     * stale-load guard as every other load.
     */
    private async refreshStar(): Promise<void> {
        const processed = await this.loadAndCacheFavorites();
        if (processed === null || this._destroyed) return;
        this.syncStar();
    }

    // --- Keyboard --------------------------------------------------------

    private onButtonKeydown(e: KeyboardEvent): void {
        if (!this._isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void this.open();
            }
            return;
        }
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                this.close(true);
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (this._rows.length)
                    this.moveHighlight(this._highlightIndex + 1);
                else this.controls()[0]?.focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.moveHighlight(Math.max(this._highlightIndex - 1, -1));
                break;
            case 'Enter':
            case ' ':
                if (this._highlightIndex >= 0) {
                    e.preventDefault();
                    this._rows[this._highlightIndex]?.apply();
                }
                break;
            case 'Tab':
                if (!e.shiftKey && this.controls().length) {
                    e.preventDefault();
                    this.controls()[0]?.focus();
                } else this.close(false);
                break;
        }
    }

    private controls(): HTMLElement[] {
        return [
            ...this.panelItems.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled)',
            ),
        ];
    }

    private moveHighlight(index: number): void {
        const clamped = Math.min(Math.max(index, -1), this._rows.length - 1);
        const prev = this._rows[this._highlightIndex];
        if (prev) prev.el.classList.remove('proto-dropdown-item--highlighted');
        this._highlightIndex = clamped;
        const next = this._rows[clamped];
        if (next) {
            next.el.classList.add('proto-dropdown-item--highlighted');
            this.button.setAttribute('aria-activedescendant', next.el.id);
            next.el.scrollIntoView({ block: 'nearest' });
            if (!this.embeddedMark) next.el.focus();
        } else {
            this.button.removeAttribute('aria-activedescendant');
        }
    }

    // --- Positioning -------------------------------------------------------

    /**
     * Position the panel under the button, flipping above when there is more
     * room there, clamped to the viewport. Deliberately independent of the
     * composer's `positionPopover`: that function anchors to a field and its
     * text input, and this panel anchors to a `<button>`; the geometry math is
     * the same shape but small enough not to warrant forcing a shared signature
     * across two different anchor element types.
     */
    private position(): void {
        const [buttonRect] = readGeometry(this.button);
        copyOverlayTheme(this.wrap, this.panel);
        const panelHeight = Math.min(this.panel.scrollHeight, 320);
        const spaceBelow = window.innerHeight - buttonRect.bottom - 8;
        const spaceAbove = buttonRect.top - 8;

        const panelWidth = this.panel.offsetWidth || 288;
        const maxLeft = window.innerWidth - panelWidth - 8;
        let left = Math.min(buttonRect.right - panelWidth, maxLeft);
        if (left < 8) left = 8;
        this.panel.style.position = 'fixed';
        this.panel.style.left = left + 'px';

        const availableHeight = Math.max(
            100,
            Math.min(320, spaceBelow >= spaceAbove ? spaceBelow : spaceAbove),
        );
        this.panelItems.style.maxHeight = availableHeight + 'px';

        if (spaceBelow >= panelHeight || spaceBelow >= spaceAbove) {
            this.panel.style.top =
                Math.max(
                    8,
                    Math.min(
                        buttonRect.bottom + 4,
                        window.innerHeight -
                            Math.min(panelHeight, availableHeight) -
                            8,
                    ),
                ) + 'px';
            this.panel.style.bottom = 'auto';
        } else {
            const visibleHeight = Math.min(panelHeight, availableHeight);
            this.panel.style.top =
                Math.max(
                    8,
                    Math.min(
                        buttonRect.top - visibleHeight - 4,
                        window.innerHeight - visibleHeight - 8,
                    ),
                ) + 'px';
            this.panel.style.bottom = 'auto';
        }
    }
}

const panelsByButton = new WeakMap<HTMLElement, FavoritesPanel>();
const embeddedPanels = new WeakMap<HTMLElement, FavoritesPanel>();

/** Mount Favorites within MarkingField and TagInput's branding popover. */
export function ensureMarkingFavorites(
    wrap: HTMLElement,
    host: FavoritesPanelHost,
): FavoritesPanel | null {
    if (!host.config && !schemeOffersPresets(host.scheme, host.scope))
        return null;
    const existing = embeddedPanels.get(wrap);
    if (existing) {
        existing.updateHost(host);
        return existing;
    }
    const panel = new FavoritesPanel(wrap, host, true);
    embeddedPanels.set(wrap, panel);
    return panel;
}

/**
 * Mount (or return the existing) favorites button on `wrap`, next to the
 * field's status mark. Renders when EITHER of two things is true: the host
 * wires `config.load` (the original contract), or the loaded scheme declares
 * `labelPresets` for this field's effective scope ({@link schemeOffersPresets}):
 * a scheme-authored preset list is worth surfacing even when no host
 * persistence exists to back user favorites. With no `config` at all, the
 * mounted panel still opens; it just runs read-only (see
 * `FavoritesPanelHost.config`'s doc). Returns `null` only when neither
 * condition holds, matching the Enhancement Status Indicator sibling contract:
 * no ★ chrome for a field with nothing behind it.
 *
 * Idempotent and safe to call on every render pass, mirroring
 * `ensureStatusMark`: a re-render never stacks a second button, and the host's
 * closures (which capture `this` and can go stale across renders) are refreshed
 * in place via {@link FavoritesPanel.updateHost}.
 */
export function ensureFavoritesButton(
    wrap: HTMLElement,
    host: FavoritesPanelHost,
): FavoritesPanel | null {
    const wired = typeof host.config?.load === 'function';
    if (!wired && !schemeOffersPresets(host.scheme, host.scope)) return null;

    const existing = wrap.querySelector<HTMLButtonElement>(
        ':scope > .ez-favorites-button',
    );
    if (existing) {
        const panel = panelsByButton.get(existing);
        if (panel) {
            panel.updateHost(host);
            return panel;
        }
    }

    const panel = new FavoritesPanel(wrap, host);
    panelsByButton.set(panel.button, panel);
    return panel;
}

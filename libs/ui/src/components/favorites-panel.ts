/**
 * The ★ favorites surface: a chrome button next to a field's status mark that
 * opens a popover of host-persisted markings, plus (when the scheme declares
 * any) a trailing "From the scheme" section of `labelPresets`.
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

/** One saved favorite: a marking string plus an optional display label. */
export interface FavoriteEntry {
    /** The marking string, in whatever format the host stored it under. */
    marking: string;
    /** Display label; the raw marking is shown when this is omitted. */
    label?: string;
}

/**
 * Host-fed favorites surface. Hosts own persistence entirely (localStorage, a
 * server, wherever); the component only ever calls these three hooks.
 */
export interface FavoritesConfig {
    /**
     * Load the favorites list for this field's scheme/scope/format. Called
     * TWICE per field lifecycle, not just on open: once at mount (so the ★
     * button starts correctly filled when the field's initial value is already
     * a saved favorite, rather than blank until the user's first open) and
     * again every time the panel opens, never cached across opens: a host with
     * server-backed favorites expects a fresh read each time the user looks,
     * and each time the field mounts.
     */
    load(ctx: {
        schemeId: string;
        scope?: string;
        formatId?: string;
    }): MaybePromise<FavoriteEntry[]>;
    /**
     * Persist a new favorite. Its presence (not `remove`'s) gates whether the
     * panel offers the pinned save/remove row at all.
     */
    save?(marking: string): MaybePromise<void>;
    /** Remove a saved favorite. */
    remove?(marking: string): MaybePromise<void>;
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
    /** Apply a resolved marking string to the field (replace, or MTA's stamp). */
    onApply: (marking: string) => void;
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

    constructor(wrap: HTMLElement, host: FavoritesPanelHost) {
        this.wrap = wrap;
        this.host = host;
        injectStyles(host.root);

        this.button = document.createElement('button');
        this.button.type = 'button';
        // No self-positioning: the button sits in normal flow as a flex child
        // of a caller-owned chrome container (a hint-row slot or the ★
        // drawer), mirroring status-mark.ts's 'chrome' shape.
        this.button.className =
            'ez-favorites-button ez-favorites-button--chrome';
        this.button.innerHTML = buildStarSvg();
        this.button.setAttribute('aria-haspopup', 'listbox');
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
        wrap.appendChild(this.button);

        this.panel = document.createElement('div');
        this.panel.className = 'proto-dropdown ez-favorites-panel';
        this.panel.id =
            'ez-favorites-panel-' + Math.random().toString(36).slice(2, 8);
        this.panel.style.display = 'none';
        this.panel.addEventListener('mousedown', (e) => e.preventDefault());

        this.panelItems = document.createElement('div');
        this.panelItems.className = 'proto-dropdown__items';
        this.panelItems.setAttribute('role', 'listbox');
        this.panelItems.setAttribute('aria-label', t('aria.favorites'));
        this.panelItems.id = this.panel.id + '-items';
        this.panel.appendChild(this.panelItems);
        this.button.setAttribute('aria-controls', this.panelItems.id);

        this.announcer = createAnnouncer();
        wrap.appendChild(this.announcer);

        this.dropdownPortalStyle = portalViewportOverlay(
            this.panel,
            wrap,
            favoritesPanelCss,
        );

        this.boundDocPointerDown = (e: Event) => {
            const target = e.target as Node;
            if (
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
        this._isOpen = true;
        this.button.setAttribute('aria-expanded', 'true');
        // mousedown preventDefault (above) suppresses the browser's normal
        // click-to-focus so a mouse press never blurs the field mid-click;
        // that means opening never focuses the button on its own either, so
        // Up/Down/Enter/Esc would have nowhere to land afterward without
        // this explicit call. A keyboard open (button already focused to
        // receive the keydown that triggered this) makes this a no-op.
        this.button.focus();
        this.renderLoading();
        this.showPanel();
        this.position();

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
        this.position();
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
        this._isOpen = false;
        this.panel.style.display = 'none';
        this.button.setAttribute('aria-expanded', 'false');
        this.button.removeAttribute('aria-activedescendant');
        this._highlightIndex = -1;
        if (returnFocusToField) this.host.focusField();
    }

    /** Whether the popover is currently showing. */
    isOpen(): boolean {
        return this._isOpen;
    }

    destroy(): void {
        this._destroyed = true;
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
        this.panelItems.innerHTML = '';
        this._rows = [];
        this._highlightIndex = -1;

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

        for (const { entry, rendered } of processed) {
            const isCurrent = current.valid && rendered === current.rendered;
            this.addRow(this.buildFavoriteRow(entry, isCurrent), () =>
                this.applyAndClose(entry.marking),
            );
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
                this.addRow(this.buildPresetRow(preset, rendered), () => {
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
    }

    private addRow(el: HTMLElement, apply: () => void): void {
        const index = this._rows.length;
        el.setAttribute('role', 'option');
        el.id = `${this.panel.id}-row-${index}`;
        el.addEventListener('click', () => apply());
        this.panelItems.appendChild(el);
        this._rows.push({ el, apply });
    }

    private buildPinnedRow(isFavorite: boolean, marking: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'proto-dropdown-item ez-favorites-panel__pinned';
        const label = document.createElement('div');
        label.className = 'proto-dropdown-item__label';
        label.textContent = isFavorite
            ? t('favorites.remove')
            : t('favorites.save').replace('{marking}', marking);
        row.appendChild(label);
        return row;
    }

    private buildFavoriteRow(
        entry: FavoriteEntry,
        isCurrent: boolean,
    ): HTMLElement {
        const row = document.createElement('div');
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
        const row = document.createElement('div');
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
    private applyAndClose(marking: string): void {
        this.host.onApply(marking);
        this.close(true);
    }

    /** Pinned row: save the current marking, or remove it, then reload. */
    private async togglePinned(
        isFavorite: boolean,
        currentRendered: string,
    ): Promise<void> {
        // The pinned row is always row 0. Capture whether THIS toggle came
        // from a keyboard Enter on that row (moveHighlight is the only thing
        // that sets _highlightIndex; a mouse click never does) before the
        // reload below wipes it, so the reopen can restore it and a second
        // Enter keeps working without forcing the user to arrow back onto
        // the row they just acted on.
        const restoreHighlight = this._highlightIndex === 0 ? 0 : undefined;
        try {
            if (isFavorite) {
                const match = this._cachedFavorites.find(
                    (f) => f.rendered === currentRendered,
                );
                await Promise.resolve(
                    this.host.config?.remove?.(
                        match?.entry.marking ?? currentRendered,
                    ),
                );
            } else {
                await Promise.resolve(
                    this.host.config?.save?.(currentRendered),
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
            void this.open(restoreHighlight);
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
                this.moveHighlight(this._highlightIndex + 1);
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
                this.close(false);
                break;
        }
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

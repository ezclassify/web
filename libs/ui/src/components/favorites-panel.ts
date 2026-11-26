/**
 * Whole-marking Favorites and scoped scheme presets, embedded in each editable
 * control's tabbed branding popover.
 *
 * The component stores nothing. A host wires `favorites.load` (and optionally
 * `save`/`remove`) on `ComponentOptions`; this module never touches
 * localStorage, cookies, or any other persistence itself. Hosts observe commits
 * the field makes when a favorite is applied through the same native events
 * every other field mutation already dispatches (Host Form Contract); there is
 * no separate favorites-specific event.
 *
 * The Favorites tab also renders with no host wiring at all, as long as the
 * loaded scheme declares `labelPresets` for the field's scope: the panel then
 * opens read-only, offering just the "From the scheme" section (no pinned row,
 * no user-favorites section) so a scheme's curated presets are reachable even
 * on a host that never set up favorites persistence. See
 * {@link ensureMarkingFavorites} and {@link schemeOffersPresets}.
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
import { createAnnouncer, announce } from './component-utils';
import { adoptStylesOnce } from '../styles/adopt';
import { t } from '../i18n';
import favoritesPanelCss from './favorites-panel.css?inline';
import type { MarkingToolsTargets } from './marking-tools';
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
     * scope (see {@link ensureMarkingFavorites}); it just runs read-only,
     * showing "From the scheme" and nothing else: no pinned save/remove row, no
     * user-favorites section.
     */
    config?: FavoritesConfig;
    /**
     * Read a marking string through the engine in THIS field's own
     * scheme/format, as the reader's call: a saved marking is read, not
     * corrected. Used both to translate a favorite/preset into the field's
     * shape on apply and to compare against the field's current value for
     * current-row matching, so favorites are format-portable by construction: a
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
     * The complete current marking for comparison and the pinned row's
     * save/remove eligibility. `valid` gates the pinned row: an in-progress or
     * empty marking has nothing coherent to save.
     */
    getCurrent: () => { rendered: string; valid: boolean };
    canApply?: () => boolean;
    /** Describe the caret target when a field contains several markings. */
    describeTarget?: () => string;
    /** Choose which entry in a multi-marking field Favorites will operate on. */
    targets?: () => MarkingToolsTargets | undefined;
    /**
     * Apply a resolved marking (replace, or MTA's stamp). An asynchronous host
     * must honor cancellation before writing if the panel closes or another
     * action supersedes this one.
     */
    onApply: (marking: string, signal: AbortSignal) => MaybePromise<void>;
    /** Return focus to the host's working control after applying a marking. */
    focusField: () => void;
    endTargetSelection?: () => void;
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

/** Star glyph for the pinned Save or Unsave action inside Favorites. */
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

/** Favorites content owned by one editable control's tabbed tools. */
export class FavoritesPanel {
    /** The existing branding button that opens the field's tools. */
    readonly button: HTMLButtonElement;
    private host: FavoritesPanelHost;
    private panelItems: HTMLDivElement;
    private announcer: HTMLDivElement;
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
     * Saved values read in the owning marking's format for current-row
     * matching.
     */
    private _cachedFavorites: Array<{
        entry: FavoriteEntry;
        rendered: string;
    }> = [];
    /** Scheme presets read in the same format as saved values. */
    private _cachedPresets: Array<{
        preset: LabelPresetView;
        rendered: string;
    }> = [];
    /** Whether the latest load of saved values failed. */
    private _loadFailed = false;
    private managing = false;

    constructor(wrap: HTMLElement, host: FavoritesPanelHost) {
        this.wrap = wrap;
        this.host = host;
        injectStyles(host.root);
        adoptStylesOnce(favoritesPanelCss, document.body);
        const mark = wrap.querySelector<HTMLButtonElement>(
            ':scope > .ez-status-mark',
        );
        if (!mark)
            throw new Error('Favorites require the field branding tools.');
        this.button = mark;
        this.panelItems = document.createElement('div');
        this.panelItems.className =
            'proto-dropdown__items ez-favorites-panel__embedded';
        this.panelItems.setAttribute('role', 'group');
        this.panelItems.setAttribute('aria-label', t('aria.favorites'));
        this.panelItems.id =
            'ez-favorites-panel-' + Math.random().toString(36).slice(2, 8);
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
        this.panelItems.addEventListener('focusout', (event) => {
            if (
                event.relatedTarget instanceof Node &&
                this.panelItems.contains(event.relatedTarget)
            )
                return;
            this.moveHighlight(-1);
        });
        this.announcer = createAnnouncer();
        wrap.appendChild(this.announcer);
        setStatusMarkFavorites(wrap, {
            element: this.panelItems,
            isApplying: () => this.applyAbort !== null,
            targets: () => {
                const targets = this.host.targets?.();
                if (!targets) return undefined;
                return {
                    ...targets,
                    select: (value) => {
                        if (this.applyAbort) return;
                        targets.select(value);
                        this.renderRows(this._cachedFavorites);
                        refreshStatusMarkPopover(this.button);
                    },
                };
            },
            count: () =>
                this._cachedFavorites.length +
                getScopedPresets(this.host.scheme, this.host.scope).length,
            open: () => {
                void this.open();
            },
            close: () => {
                this.abortApply();
                this._isOpen = false;
                this.managing = false;
                this.host.endTargetSelection?.();
            },
        });
        // Providers load at mount as well as each tools open.
        void this.loadAndCacheFavorites();
    }

    /** Refresh the closures a host rebuilds on every render pass. */
    updateHost(host: FavoritesPanelHost): void {
        this.host = host;
    }

    /**
     * Load `config.load`, read every returned favorite into this field's own
     * rendered form, and cache the result for current-row matching. Shared by
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
        let loadFailed: boolean;
        try {
            // No config at all (presets-only mount, see ensureMarkingFavorites)
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
            loadFailed = false;
        } catch {
            entries = [];
            loadFailed = true;
        }
        if (seq !== this._openSeq || this._destroyed) return null;
        this._loadFailed = loadFailed;

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
                    // matches the current-row comparison.
                    return { entry, rendered: entry.marking };
                }
            }),
        );
        if (seq !== this._openSeq || this._destroyed) return null;

        this._cachedFavorites = processed;

        // Presets and saved values share one stale-load guard.
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
     *   Enter/Space while closed) leaves this unset: the list opens
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
        this.renderLoading();
        const processed = await this.loadAndCacheFavorites();
        if (processed === null) return;
        if (!this._isOpen) return;

        this.renderRows(processed);
        if (restoreHighlightIndex !== undefined) {
            this.moveHighlight(restoreHighlightIndex);
        }
        refreshStatusMarkPopover(this.button);
        announce(
            this.announcer,
            this._loadFailed
                ? t('favorites.loadFailed')
                : `${processed.length} favorite${processed.length === 1 ? '' : 's'} available`,
        );
    }

    /**
     * Close the panel. `returnFocusToField` moves focus to the host field's own
     * native element after applying a saved value. The tools popover owns
     * dismissal keys and their focus destination.
     */
    close(returnFocusToField: boolean): void {
        if (!this._isOpen) return;
        this.abortApply();
        this._isOpen = false;
        this._highlightIndex = -1;
        dismissStatusMarkPopover(this.button);
        if (returnFocusToField) this.host.focusField();
    }

    /** Whether focus is moving within this field's Favorites controls. */
    contains(node: Node | null): boolean {
        if (!node) return false;
        const popupId = this.button.getAttribute('aria-describedby');
        return (
            this.button.contains(node) ||
            !!(popupId && document.getElementById(popupId)?.contains(node))
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
        dismissStatusMarkPopover(this.button);
        setStatusMarkFavorites(this.wrap, null);
        this.panelItems.remove();
        this.announcer.remove();
    }

    // --- Rendering -----------------------------------------------------

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
        const canApply = this.host.canApply?.() ?? true;
        const canPin =
            !!this.host.config?.save && current.valid && !!current.rendered;
        if (canPin) {
            const isCurrentFavorite = processed.some(
                (f) => f.rendered === current.rendered,
            );
            this.addRow(
                this.buildPinnedRow(isCurrentFavorite),
                () => void this.togglePinned(isCurrentFavorite),
            );
        }

        if (processed.length > 0) {
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
            row.toggleAttribute('disabled', !canApply);
            row.dataset.favoriteMarking = entry.marking;
            this.addRow(row, () => this.applyAndClose(entry.marking));
            if (this.host.config?.remove) {
                const savedRow = document.createElement('div');
                savedRow.className = 'ez-favorites-panel__saved-row';
                row.replaceWith(savedRow);
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'ez-favorites-panel__remove';
                remove.dataset.favoriteRemove = entry.marking;
                remove.setAttribute(
                    'aria-label',
                    t('favorites.removeEntry').replace(
                        '{marking}',
                        entry.marking,
                    ),
                );
                remove.innerHTML =
                    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.5 4.5l11 11M15.5 4.5l-11 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
                remove.addEventListener('click', () => {
                    void this.removeFavorite(entry.marking, favoriteIndex);
                });
                savedRow.append(row, remove);
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
                row.toggleAttribute('disabled', !canApply);
                row.dataset.presetId = preset.id;
                this.addRow(row, () => {
                    if (rendered) this.applyAndClose(rendered);
                    else announce(this.announcer, t('favorites.applyFailed'));
                });
            }
        }

        // canPin always adds the pinned row first, so _rows is only empty
        // when canPin is false; the empty state needs no separate guard.
        if (this._loadFailed || this._rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'proto-dropdown-item ez-favorites-panel__empty';
            empty.setAttribute('role', 'status');
            // A failed load is not the same fact as nothing saved.
            empty.textContent = t(
                this._loadFailed ? 'favorites.loadFailed' : 'favorites.empty',
            );
            this.panelItems.appendChild(empty);
        }
        const storage = this.host.config?.browserStorage;
        if (
            storage &&
            (processed.length > 0 || storage.enabled() !== undefined)
        )
            this.renderStorageChoice();
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
            [
                'favoriteMarking',
                'favoriteRemove',
                'presetId',
                'favoritesAction',
            ].includes(name),
        );
        // Removing a focused row sends focus outside the dialog in browsers.
        // Keep the edit suspended while replacing its controls.
        const tab = this.panelItems
            .closest('.ez-tooltip--tools')
            ?.querySelector<HTMLElement>('[role=tab][aria-selected=true]');
        (tab ?? this.button).focus({ preventScroll: true });
        return () => {
            if (!identity || this.panelItems.closest('[hidden]')) return;
            const [name, value] = identity;
            [
                ...this.panelItems.querySelectorAll<HTMLElement>(
                    'button, input, select',
                ),
            ]
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
            footer.classList.add('ez-favorites-panel__settings--choice');
            const prompt = document.createElement('div');
            prompt.className = 'ez-favorites-panel__remember-title';
            prompt.textContent = t('favorites.rememberPrompt');
            footer.appendChild(prompt);
            const choices = document.createElement('div');
            choices.className = 'ez-favorites-panel__storage-actions';
            for (const [label, enabled] of [
                [t('favorites.remember'), true],
                [t('favorites.visitOnly'), false],
            ] as const) {
                const button = this.settingsButton(label, (keyboard) => {
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
                            refreshStatusMarkPopover(this.button);
                        })
                        .catch(() =>
                            announce(
                                this.announcer,
                                t('favorites.storageFailed'),
                            ),
                        );
                });
                if (enabled)
                    button.classList.add(
                        'ez-favorites-panel__settings-action--primary',
                    );
                choices.appendChild(button);
            }
            footer.appendChild(choices);
        } else {
            footer.appendChild(
                this.settingsButton(t('favorites.manage'), (keyboard) => {
                    this.managing = true;
                    this.renderRows(this._cachedFavorites);
                    if (keyboard)
                        this.panelItems
                            .querySelector<HTMLButtonElement>('button')
                            ?.focus();
                    refreshStatusMarkPopover(this.button);
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
                refreshStatusMarkPopover(this.button);
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
                            refreshStatusMarkPopover(this.button);
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
        el.id = `${this.panelItems.id}-row-${index}`;
        el.addEventListener('click', () => apply());
        this.panelItems.appendChild(el);
        this._rows.push({ el, apply });
    }

    private buildPinnedRow(isFavorite: boolean): HTMLElement {
        const row = this.createRow();
        row.className = 'proto-dropdown-item ez-favorites-panel__pinned';
        row.dataset.favoritesAction = 'pin';
        if (row instanceof HTMLButtonElement)
            row.disabled = isFavorite && !this.host.config?.remove;
        const label = document.createElement('div');
        label.className = 'proto-dropdown-item__label';
        label.textContent = t(
            isFavorite ? 'favorites.unsaveCurrent' : 'favorites.saveCurrent',
        );
        const star = document.createElement('span');
        star.className = 'ez-favorites-panel__star';
        star.innerHTML = buildStarSvg();
        star.classList.toggle('ez-favorites-panel__star--saved', isFavorite);
        row.append(star, label);
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

    private markApplying(applying: boolean): void {
        if (applying) this.panelItems.setAttribute('aria-busy', 'true');
        else this.panelItems.removeAttribute('aria-busy');
        this.panelItems
            .closest('.ez-marking-tools')
            ?.querySelector('.ez-marking-tools__target')
            ?.setAttribute('aria-disabled', String(applying));
    }

    /** Apply a chosen marking (favorite or preset) and close the panel. */
    private abortApply(): void {
        this.applyAbort?.abort();
        this.applyAbort = null;
        this.markApplying(false);
    }

    private applyAndClose(marking: string): void {
        this.abortApply();
        const controller = new AbortController();
        this.applyAbort = controller;
        this.markApplying(true);
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
            void Promise.resolve(result).then(
                () => {
                    if (this.applyAbort !== controller) return;
                    this.applyAbort = null;
                    this.markApplying(false);
                    if (!this._destroyed) this.close(true);
                },
                () => {
                    if (this.applyAbort !== controller) return;
                    this.applyAbort = null;
                    this.markApplying(false);
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
        refreshStatusMarkPopover(this.button);
        announce(this.announcer, t('favorites.removed'));
    }

    /** Pinned row: save the current marking, or remove it, then reload. */
    private async togglePinned(isFavorite: boolean): Promise<void> {
        this.abortApply();
        // The store may have changed since this row was drawn. Keep the
        // displayed action's intent, but always act on its current marking.
        const current = this.host.getCurrent();
        // The pinned row is always row 0. Capture whether THIS toggle came
        // from focus on that row before the
        // reload below wipes it, so the reopen can restore it and a second
        // Enter keeps working without forcing the user to arrow back onto
        // the row they just acted on.
        const restoreHighlight = this._highlightIndex === 0 ? 0 : undefined;
        const focused = document.activeElement;
        try {
            if (current.valid && current.rendered) {
                if (isFavorite) {
                    const match = this._cachedFavorites.find(
                        (favorite) => favorite.rendered === current.rendered,
                    );
                    if (match)
                        await this.host.config?.remove?.(
                            match.entry.marking,
                            this.context(),
                        );
                } else {
                    await this.host.config?.save?.(
                        current.rendered,
                        this.context(),
                    );
                }
            }
        } catch {
            // Persistence failure: leave the panel open on its current list
            // rather than pretending the save or remove landed, and say so.
            if (!this._destroyed)
                announce(
                    this.announcer,
                    t(
                        isFavorite
                            ? 'favorites.removeFailed'
                            : 'favorites.saveFailed',
                    ),
                );
            return;
        }
        if (this._destroyed) return;
        // This reload must run unconditionally once persistence
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
        // A completed write must refresh the cache even after the author
        // dismisses the tools; it must not reopen them or reclaim focus.
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
            void this.loadAndCacheFavorites();
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
            next.el.scrollIntoView({ block: 'nearest' });
        }
    }
}

const embeddedPanels = new WeakMap<HTMLElement, FavoritesPanel>();

/** Mount Favorites in an editable control's existing tabbed branding popover. */
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
    const panel = new FavoritesPanel(wrap, host);
    embeddedPanels.set(wrap, panel);
    return panel;
}

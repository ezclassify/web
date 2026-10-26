/**
 * Unit tests for the ★ favorites surface: the pure scope-resolution helpers,
 * the idempotent button-mount contract (mirrors `ensureStatusMark`), open/
 * close lifecycle with the stale-open sequence guard, the pinned save/remove
 * row, star-fill, the "From the scheme" presets section, and keyboard behavior.
 * Field-specific apply semantics (replace vs. MTA's stamp-at-caret) are covered
 * in each field's own spec; this file exercises the shared panel mechanics
 * through a minimal host stub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SchemePublicView } from '@ezclassify/types';
import {
    ensureFavoritesButton,
    schemeOffersPresets,
    getScopedPresets,
    type FavoritesConfig,
    type FavoritesPanelHost,
} from './favorites-panel';

function wait(ms = 20): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function makeScheme(
    overrides: Partial<SchemePublicView> = {},
): SchemePublicView {
    return {
        id: 'test',
        version: '1.0.0',
        name: 'Test',
        referenceSurfaceLabel: {
            singular: 'Handbook',
            plural: 'Handbooks',
        },
        concepts: [],
        categories: [],
        formats: [
            {
                id: 'default',
                surface: 'default',
                mode: 'inline',
                categoryOrder: [],
            },
        ],
        defaultRenderFormat: 'default',
        labelPresets: [],
        ...overrides,
    };
}

describe('schemeOffersPresets / getScopedPresets', () => {
    const scoped = makeScheme({
        defaultScope: 'classification',
        labelPresets: [
            { id: 'secret', label: 'Secret' },
            {
                id: 'oca',
                label: 'OCA',
                scope: 'authority',
            },
        ],
    });

    it('is false without presets', () => {
        expect(schemeOffersPresets(null)).toBe(false);
        expect(schemeOffersPresets(makeScheme())).toBe(false);
        expect(schemeOffersPresets(makeScheme({ labelPresets: [] }))).toBe(
            false,
        );
    });

    it('is true for any scope on a scopeless scheme', () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'a', label: 'A' }],
        });
        expect(schemeOffersPresets(scheme)).toBe(true);
        expect(schemeOffersPresets(scheme, 'anything')).toBe(true);
    });

    it('matches presets against the effective scope', () => {
        expect(schemeOffersPresets(scoped, 'authority')).toBe(true);
        expect(schemeOffersPresets(scoped, 'classification')).toBe(true);
        expect(schemeOffersPresets(scoped, 'other')).toBe(false);
        // No field scope: falls back to defaultScope, so a scheme whose only
        // preset is authority-scoped offers nothing to a default-scope field.
        expect(
            schemeOffersPresets(
                makeScheme({
                    defaultScope: 'classification',
                    labelPresets: [
                        {
                            id: 'oca',
                            label: 'OCA',
                            scope: 'authority',
                        },
                    ],
                }),
            ),
        ).toBe(false);
    });

    it('getScopedPresets returns only the matching entries', () => {
        expect(getScopedPresets(scoped, 'authority').map((p) => p.id)).toEqual([
            'oca',
        ]);
        expect(
            getScopedPresets(scoped, 'classification').map((p) => p.id),
        ).toEqual(['secret']);
    });
});

let wrap: HTMLDivElement;

function makeHost(
    overrides: Partial<FavoritesPanelHost> = {},
): FavoritesPanelHost {
    const config: FavoritesConfig = {
        load: vi.fn(async () => []),
    };
    return {
        schemeId: 'test',
        formatId: 'default',
        scheme: makeScheme(),
        config,
        read: vi.fn(async (marking: string) => ({
            assertions: [],
            rendered: marking,
        })),
        applyPreset: vi.fn(async (presetId: string) => ({
            rendered: presetId,
        })),
        getCurrent: () => ({ rendered: '', valid: false }),
        onApply: vi.fn(),
        focusField: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    document.body.innerHTML = '';
    wrap = document.createElement('div');
    wrap.style.position = 'relative';
    document.body.appendChild(wrap);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('ensureFavoritesButton', () => {
    it('renders nothing when favorites.load is not wired', () => {
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: undefined as unknown as FavoritesConfig,
            }),
        );
        expect(panel).toBeNull();
        expect(wrap.querySelector('.ez-favorites-button')).toBeNull();
    });

    it('mounts a button once and is idempotent across repeated calls', () => {
        const first = ensureFavoritesButton(wrap, makeHost());
        const second = ensureFavoritesButton(wrap, makeHost());
        expect(first).not.toBeNull();
        expect(second).toBe(first);
        expect(wrap.querySelectorAll('.ez-favorites-button')).toHaveLength(1);
    });

    it('mounts with the chrome shape: no self-positioning, a caller-owned container places it', () => {
        // The button always sits in normal flow as a flex child of a
        // caller-owned chrome container (a hint-row slot or the ★ drawer); it
        // never self-positions absolutely over the field.
        const panel = ensureFavoritesButton(wrap, makeHost());
        expect(
            panel!.button.classList.contains('ez-favorites-button--chrome'),
        ).toBe(true);
    });

    it('mousedown on the button never blurs the field (preventDefault)', () => {
        const panel = ensureFavoritesButton(wrap, makeHost())!;
        const event = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        const prevented = !panel.button.dispatchEvent(event);
        expect(prevented).toBe(true);
    });
});

describe('open()', () => {
    it('loads on every open and renders favorite rows', async () => {
        const load = vi.fn(async () => [
            { marking: 'SECRET', label: 'Secret' },
            { marking: 'UNCLASSIFIED' },
        ]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load } }),
        )!;

        await panel.open();
        // Construction loads once to populate the star before interaction,
        // and this explicit open loads again.
        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledWith({
            schemeId: 'test',
            scope: undefined,
            formatId: 'default',
        });

        const rows = document.body.querySelectorAll(
            '.ez-favorites-panel .proto-dropdown-item',
        );
        expect(rows.length).toBe(2);
        expect(rows[0].textContent).toContain('Secret');
        // No label supplied: falls back to the raw marking string.
        expect(rows[1].textContent).toContain('UNCLASSIFIED');

        await panel.open();
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('shows a loading row before the load resolves', async () => {
        let resolveLoad!: (v: Array<{ marking: string }>) => void;
        const load = vi.fn(
            () =>
                new Promise<Array<{ marking: string }>>((r) => {
                    resolveLoad = r;
                }),
        );
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load } }),
        )!;

        const opening = panel.open();
        const loadingRow = document.body.querySelector(
            '.ez-favorites-panel__loading',
        );
        expect(loadingRow).not.toBeNull();

        resolveLoad([{ marking: 'SECRET' }]);
        await opening;
        expect(
            document.body.querySelector('.ez-favorites-panel__loading'),
        ).toBeNull();
    });

    it('discards a stale in-flight load when a newer open() supersedes it', async () => {
        const responses: Array<(v: Array<{ marking: string }>) => void> = [];
        const load = vi.fn(
            () =>
                new Promise<Array<{ marking: string }>>((r) => {
                    responses.push(r);
                }),
        );
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load } }),
        )!;
        // Index 0 is the mount-time load every construction now fires;
        // resolve it harmlessly so it isn't left dangling (it shares the same
        // stale-load guard, so an unresolved one wouldn't affect the
        // assertions below either way, but leaving no promise unsettled
        // keeps the test's intent, two OPEN loads, unambiguous).
        responses[0]([]);

        const firstOpen = panel.open();
        const secondOpen = panel.open();

        // Resolve the SECOND (current) request first, then the stale first
        // one: the stale response must never overwrite the fresh render.
        responses[2]([{ marking: 'FRESH' }]);
        await secondOpen;
        responses[1]([{ marking: 'STALE' }]);
        await firstOpen;
        await wait();

        const rows = document.body.querySelectorAll(
            '.ez-favorites-panel .proto-dropdown-item',
        );
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('FRESH');
    });

    it('empty list with no pinned row shows the empty-state message', async () => {
        const panel = ensureFavoritesButton(wrap, makeHost())!;
        await panel.open();
        expect(
            document.body.querySelector('.ez-favorites-panel__empty'),
        ).not.toBeNull();
    });

    it('a superseded in-flight load never announces once the panel has closed', async () => {
        // A load that settles after close must not announce into the live region
        // for a panel the user has dismissed.
        let resolveLoad!: (v: Array<{ marking: string }>) => void;
        const load = vi.fn(
            () =>
                new Promise<Array<{ marking: string }>>((r) => {
                    resolveLoad = r;
                }),
        );
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load } }),
        )!;
        const announcer = wrap.querySelector('.ez-sr-only') as HTMLElement;

        const opening = panel.open();
        panel.close(false);
        expect(panel.isOpen()).toBe(false);

        resolveLoad([{ marking: 'SECRET' }]);
        await opening;
        await wait(50);

        expect(panel.isOpen()).toBe(false);
        expect(announcer.textContent).not.toContain('favorite');
    });
});

describe('accessibility roles inside the listbox', () => {
    it('gives non-option rows a role so assistive tech does not skip or misread them', async () => {
        // A role="listbox" only exposes role="option" children to assistive
        // tech; anything else (loading text, the empty state, a section
        // boundary) is invisible to a screen reader unless it carries its
        // own role.
        let resolveLoad!: (v: Array<{ marking: string }>) => void;
        const load = vi.fn(
            () =>
                new Promise<Array<{ marking: string }>>((r) => {
                    resolveLoad = r;
                }),
        );
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load } }),
        )!;

        const opening = panel.open();
        const loadingRow = document.body.querySelector(
            '.ez-favorites-panel__loading',
        );
        expect(loadingRow?.getAttribute('role')).toBe('status');

        resolveLoad([]);
        await opening;
        const emptyRow = document.body.querySelector(
            '.ez-favorites-panel__empty',
        );
        expect(emptyRow?.getAttribute('role')).toBe('status');

        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'Preset One' }],
        });
        const presetPanel = ensureFavoritesButton(
            document.body.appendChild(document.createElement('div')),
            makeHost({ scheme }),
        )!;
        await presetPanel.open();
        const header = document.body.querySelector(
            '.ez-favorites-panel .proto-dropdown-group',
        );
        expect(header?.getAttribute('role')).toBe('presentation');
    });
});

describe('pinned save/remove row', () => {
    it('is absent without config.save', async () => {
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;
        await panel.open();
        expect(
            document.body.querySelector('.ez-favorites-panel__pinned'),
        ).toBeNull();
    });

    it('is absent when the field has no valid current marking', async () => {
        const save = vi.fn(async () => {});
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load: vi.fn(async () => []), save },
                getCurrent: () => ({ rendered: '', valid: false }),
            }),
        )!;
        await panel.open();
        expect(
            document.body.querySelector('.ez-favorites-panel__pinned'),
        ).toBeNull();
    });

    it('offers "Save" when the current marking is not yet a favorite, and saves + reloads on click', async () => {
        const save = vi.fn(async () => {});
        const load = vi.fn(async () => []);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load, save },
                getCurrent: () => ({ rendered: 'SECRET//NOFORN', valid: true }),
            }),
        )!;
        await panel.open();

        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned.textContent).toContain('SECRET//NOFORN');
        expect(pinned.textContent?.toLowerCase()).toContain('save');

        pinned.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(save).toHaveBeenCalledWith('SECRET//NOFORN');
        // 3: mount-time load + initial open + reload after save.
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('offers "Remove" when the current marking already matches a loaded favorite', async () => {
        const remove = vi.fn(async () => {});
        const load = vi.fn(async () => [{ marking: 'SECRET' }]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load, save: vi.fn(), remove },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
                read: vi.fn(async (marking: string) => ({
                    assertions: [],
                    rendered: marking,
                })),
            }),
        )!;
        await panel.open();

        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned.textContent?.toLowerCase()).toContain('remove');

        pinned.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();

        expect(remove).toHaveBeenCalledWith('SECRET');
    });
});

describe('★ class resyncs from an in-flight reload even after the popover closes', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('save → remove → save in quick succession: the button class always lands on the persisted truth, even when the popover closes before each reload settles', async () => {
        // Every settled reload must resync the visible star from persisted state,
        // including when an intervening action closes the popover.
        vi.useFakeTimers();

        // A network-backed FavoritesConfig: load/save/remove all settle on a
        // later tick, not synchronously.
        let saved = true;
        const NETWORK_MS = 10;
        const load = vi.fn(
            () =>
                new Promise<Array<{ marking: string }>>((r) =>
                    setTimeout(
                        () => r(saved ? [{ marking: 'SECRET' }] : []),
                        NETWORK_MS,
                    ),
                ),
        );
        const save = vi.fn(
            () =>
                new Promise<void>((r) =>
                    setTimeout(() => {
                        saved = true;
                        r();
                    }, NETWORK_MS),
                ),
        );
        const remove = vi.fn(
            () =>
                new Promise<void>((r) =>
                    setTimeout(() => {
                        saved = false;
                        r();
                    }, NETWORK_MS),
                ),
        );
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load, save, remove },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;

        // Mount-time load settles: the field's initial value is already a
        // saved favorite, so the star starts filled.
        await vi.advanceTimersByTimeAsync(NETWORK_MS);
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);

        // Open, click "Remove" on the pinned row, then close the popover
        // (Escape's own handler, `close(true)`) immediately, before
        // remove()'s own reload has any chance to land. A user or script
        // moving fast enough to dismiss the popover right after acting on
        // it is the quick-succession case.
        void panel.open();
        await vi.advanceTimersByTimeAsync(NETWORK_MS);
        const pinned1 = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned1.textContent?.toLowerCase()).toContain('remove');
        pinned1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        panel.close(true);
        expect(panel.isOpen()).toBe(false);

        // remove()'s own promise chain (persist, then reload+resync) settles
        // with the popover already closed. The class must land on
        // "removed", not stay stuck on the pre-remove state just because
        // there is no popover left to rerender.
        await vi.advanceTimersByTimeAsync(NETWORK_MS * 2);
        expect(remove).toHaveBeenCalledWith('SECRET');
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(false);

        // Reapply: open again, click "Save" on the pinned row, and again
        // close before that settles.
        void panel.open();
        await vi.advanceTimersByTimeAsync(NETWORK_MS);
        const pinned2 = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned2.textContent?.toLowerCase()).toContain('save');
        pinned2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        panel.close(true);
        expect(panel.isOpen()).toBe(false);

        await vi.advanceTimersByTimeAsync(NETWORK_MS * 2);
        expect(save).toHaveBeenCalledWith('SECRET');
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
    });
});

describe('a save still in flight when the popover reopens', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resyncs the ★ once the slower save lands, even though the reopen's faster read already settled with pre-write state", async () => {
        // A reopen can finish its read before a pending save commits. The star
        // must resync again when that save lands, even if the open sequence moved.
        vi.useFakeTimers();

        let saved = false;
        const LOAD_MS = 10;
        const SAVE_MS = 30;
        const load = vi.fn(
            () =>
                new Promise<Array<{ marking: string }>>((r) =>
                    setTimeout(
                        () => r(saved ? [{ marking: 'SECRET' }] : []),
                        LOAD_MS,
                    ),
                ),
        );
        const save = vi.fn(
            () =>
                new Promise<void>((r) =>
                    setTimeout(() => {
                        saved = true;
                        r();
                    }, SAVE_MS),
                ),
        );
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load, save },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;

        // Mount-time load: not yet a favorite.
        await vi.advanceTimersByTimeAsync(LOAD_MS);
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(false);

        // Open, click "Save" on the pinned row: the slower save() is now
        // in flight (SAVE_MS).
        void panel.open();
        await vi.advanceTimersByTimeAsync(LOAD_MS);
        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned.textContent?.toLowerCase()).toContain('save');
        pinned.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // Before that save lands, the popover reopens (a fresh button click,
        // same as the user clicking ★ again). This issues its own, faster
        // read (LOAD_MS) that resolves well before the slower save commits
        // (SAVE_MS), so it necessarily reads the not-yet-saved state.
        void panel.open();
        await vi.advanceTimersByTimeAsync(LOAD_MS);
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(false);

        // The save itself lands next: its own post-write reload must run
        // and correct the class, not be skipped because a newer `_openSeq`
        // happened to exist by then.
        await vi.advanceTimersByTimeAsync(SAVE_MS - LOAD_MS);
        expect(save).toHaveBeenCalledWith('SECRET');
        await vi.advanceTimersByTimeAsync(LOAD_MS);
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
    });
});

describe('star-fill', () => {
    it('stays outline before the mount-time load has resolved (nothing cached yet)', async () => {
        const load = vi.fn(async () => [{ marking: 'SECRET' }]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;

        // Synchronously after construction: the mount-time load fired but its
        // promise hasn't resolved yet (no await ran), so there is still
        // nothing cached to compare against.
        panel.syncStar();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(false);

        await panel.open();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
    });

    it('fills at mount when the initial value is already a saved favorite, before any open() or interaction', async () => {
        // The mount-time load must fill the star for an already saved initial
        // value before the user opens the popover.
        const load = vi.fn(async () => [{ marking: 'SECRET' }]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;

        // Let the mount-time load's microtask chain settle, then re-sync:
        // mirroring what a field's own render pass does after a value
        // commits, WITHOUT ever calling panel.open().
        await wait();
        panel.syncStar();

        expect(load).toHaveBeenCalledTimes(1);
        expect(panel.isOpen()).toBe(false);
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
    });

    it('unfills when the field is edited away from the favorite, and refills when edited back', async () => {
        const load = vi.fn(async () => [{ marking: 'SECRET' }]);
        let current = 'SECRET';
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load },
                getCurrent: () => ({ rendered: current, valid: true }),
            }),
        )!;
        await wait();
        panel.syncStar();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);

        // Edit away: a host calls syncStar() again on every committed value
        // change (see e.g. MarkedInput.renderDisplay/MarkingField.render).
        current = 'UNCLASSIFIED';
        panel.syncStar();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(false);

        // Edit back: fills again, still with no second load() call needed:
        // the mount-time cache already has what it needs.
        current = 'SECRET';
        panel.syncStar();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('compares PROCESSED forms, not raw strings: a favorite stored in a different format still matches', async () => {
        const load = vi.fn(async () => [{ marking: 'SECRET//NOFORN' }]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load },
                // The field's own rendered form is the short part mark;
                // read() is what translates the stored favorite into it.
                read: vi.fn(async () => ({
                    assertions: [],
                    rendered: '(S//NF)',
                })),
                getCurrent: () => ({ rendered: '(S//NF)', valid: true }),
            }),
        )!;
        await panel.open();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
    });
});

describe('applying a row', () => {
    it('clicking a favorite row calls onApply with its raw marking and closes the panel', async () => {
        const onApply = vi.fn();
        const load = vi.fn(async () => [{ marking: 'SECRET//NOFORN' }]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load }, onApply }),
        )!;
        await panel.open();

        const row = document.body.querySelector(
            '.ez-favorites-panel .proto-dropdown-item',
        ) as HTMLElement;
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(onApply).toHaveBeenCalledWith('SECRET//NOFORN');
        expect(panel.isOpen()).toBe(false);
    });

    it('the "From the scheme" section lists scoped presets and applies by marking on click', async () => {
        const onApply = vi.fn();
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'Preset One' }],
        });
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                scheme,
                onApply,
                applyPreset: vi.fn(async () => ({ rendered: 'SECRET' })),
            }),
        )!;
        await panel.open();

        const header = Array.from(
            document.body.querySelectorAll(
                '.ez-favorites-panel .proto-dropdown-group',
            ),
        ).find((el) => el.textContent === 'From the scheme');
        expect(header).toBeTruthy();

        const presetRow = header!.nextElementSibling as HTMLElement;
        expect(presetRow.textContent).toContain('Preset One');
        presetRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onApply).toHaveBeenCalledWith('SECRET');
    });

    it('omits the "From the scheme" section when the scheme offers no presets in scope', async () => {
        const panel = ensureFavoritesButton(wrap, makeHost())!;
        await panel.open();
        expect(
            document.body.querySelector(
                '.ez-favorites-panel .proto-dropdown-group',
            ),
        ).toBeNull();
    });
});

describe('keyboard', () => {
    it('ArrowDown/ArrowUp move the highlight and Enter applies the highlighted row', async () => {
        const onApply = vi.fn();
        const load = vi.fn(async () => [{ marking: 'A' }, { marking: 'B' }]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: { load }, onApply }),
        )!;
        await panel.open();

        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );

        expect(onApply).toHaveBeenCalledWith('B');
    });

    it('Enter on the pinned row toggles save then remove without an extra arrow press in between', async () => {
        // After save or remove rerenders the pinned row, preserve its keyboard
        // highlight so the next Enter toggles it without an extra arrow press.
        let saved = false;
        const save = vi.fn(async () => {
            saved = true;
        });
        const remove = vi.fn(async () => {
            saved = false;
        });
        const load = vi.fn(async () => (saved ? [{ marking: 'SECRET' }] : []));
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                config: { load, save, remove },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;
        await panel.open();

        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await wait();
        expect(save).toHaveBeenCalledWith('SECRET');

        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await wait();
        expect(remove).toHaveBeenCalledWith('SECRET');
    });

    it('Escape closes the panel and returns focus to the field', async () => {
        const focusField = vi.fn();
        const panel = ensureFavoritesButton(wrap, makeHost({ focusField }))!;
        await panel.open();
        expect(panel.isOpen()).toBe(true);

        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        expect(panel.isOpen()).toBe(false);
        expect(focusField).toHaveBeenCalledTimes(1);
    });

    it('a mousedown outside the button and panel closes it', async () => {
        const panel = ensureFavoritesButton(wrap, makeHost())!;
        await panel.open();
        expect(panel.isOpen()).toBe(true);

        document.body.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true }),
        );
        expect(panel.isOpen()).toBe(false);
    });
});

describe('presets-only mount (no host favorites wiring)', () => {
    it('renders NO ★ when neither config nor scheme presets are wired (unchanged baseline)', () => {
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ config: undefined }),
        );
        expect(panel).toBeNull();
        expect(wrap.querySelector('.ez-favorites-button')).toBeNull();
    });

    it('renders the ★ when the scheme declares scoped presets, even with no config at all', () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'Preset One' }],
        });
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ scheme, config: undefined }),
        );
        expect(panel).not.toBeNull();
        expect(wrap.querySelector('.ez-favorites-button')).not.toBeNull();
    });

    it('opens read-only: "From the scheme" only, no pinned row, no user-favorites section', async () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'Preset One' }],
        });
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                scheme,
                config: undefined,
                applyPreset: vi.fn(async () => ({ rendered: 'SECRET' })),
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;
        await panel.open();

        expect(
            document.body.querySelector('.ez-favorites-panel__pinned'),
        ).toBeNull();
        const header = document.body.querySelector(
            '.ez-favorites-panel .proto-dropdown-group',
        );
        expect(header?.textContent).toBe('From the scheme');
        const rows = document.body.querySelectorAll(
            '.ez-favorites-panel .proto-dropdown-item',
        );
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('Preset One');
    });

    it('star fills gold when the current marking matches a scheme preset, with no provider wired', async () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'Preset One' }],
        });
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                scheme,
                config: undefined,
                applyPreset: vi.fn(async () => ({ rendered: 'SECRET' })),
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;

        // The mount-time load (which now also processes scoped presets, see
        // `_cachedPresets`) needs a tick to settle before syncStar has
        // anything to compare against.
        await wait();
        panel.syncStar();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(true);
    });

    it('star stays outline when the current marking matches no preset', async () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'Preset One' }],
        });
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                scheme,
                config: undefined,
                getCurrent: () => ({ rendered: 'CONFIDENTIAL', valid: true }),
            }),
        )!;
        await wait();
        panel.syncStar();
        expect(
            panel.button.classList.contains('ez-favorites-button--active'),
        ).toBe(false);
    });
});

describe('provider-wired panel with both user favorites and scheme presets', () => {
    it('lists the user favorites section before the "From the scheme" section, in that DOM/keyboard order', async () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'A Preset' }],
        });
        const load = vi.fn(async () => [
            { marking: 'FAV-MARKING', label: 'A Favorite' },
        ]);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({ scheme, config: { load } }),
        )!;
        await panel.open();

        const items = Array.from(
            document.body.querySelectorAll(
                '.ez-favorites-panel .proto-dropdown__items > *',
            ),
        );
        const favIndex = items.findIndex((el) =>
            el.textContent?.includes('A Favorite'),
        );
        const headerIndex = items.findIndex(
            (el) => el.textContent === 'From the scheme',
        );
        const presetIndex = items.findIndex((el) =>
            el.textContent?.includes('A Preset'),
        );
        expect(favIndex).toBeGreaterThanOrEqual(0);
        expect(headerIndex).toBeGreaterThan(favIndex);
        expect(presetIndex).toBeGreaterThan(headerIndex);

        // Keyboard order follows visual order: the first ArrowDown lands on
        // the user favorite, not the scheme preset.
        panel.button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        );
        const highlighted = document.body.querySelector(
            '.proto-dropdown-item--highlighted',
        );
        expect(highlighted?.textContent).toContain('A Favorite');
    });
});

describe('scheme presets are never removable', () => {
    it('a preset row carries no remove/✕ control', async () => {
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'A Preset' }],
        });
        const load = vi.fn(async () => []);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                scheme,
                config: { load, save: vi.fn(), remove: vi.fn() },
            }),
        )!;
        await panel.open();

        const presetRow = Array.from(
            document.body.querySelectorAll(
                '.ez-favorites-panel .proto-dropdown-item',
            ),
        ).find((el) => el.textContent?.includes('A Preset'))!;
        expect(presetRow).toBeTruthy();
        expect(
            presetRow.querySelector('.proto-dropdown-item__check'),
        ).toBeNull();
        expect(presetRow.textContent?.toLowerCase()).not.toContain('remove');
    });

    it('the pinned row never offers removal for a marking that matches only a scheme preset, not a saved favorite', async () => {
        // The current value equals a scheme preset's marking, but it was
        // never actually saved as a user favorite (config.load returns
        // nothing matching it). The pinned row must offer "Save" (adding it
        // as a real favorite), never "Remove": removal is reserved for
        // entries that came back from config.load, and presets never do.
        const scheme = makeScheme({
            labelPresets: [{ id: 'p1', label: 'A Preset' }],
        });
        const save = vi.fn(async () => {});
        const remove = vi.fn(async () => {});
        const load = vi.fn(async () => []);
        const panel = ensureFavoritesButton(
            wrap,
            makeHost({
                scheme,
                config: { load, save, remove },
                getCurrent: () => ({ rendered: 'SECRET', valid: true }),
            }),
        )!;
        await panel.open();

        const pinned = document.body.querySelector(
            '.ez-favorites-panel__pinned',
        ) as HTMLElement;
        expect(pinned.textContent?.toLowerCase()).toContain('save');
        expect(pinned.textContent?.toLowerCase()).not.toContain('remove');

        pinned.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await wait();
        expect(save).toHaveBeenCalledWith('SECRET');
        expect(remove).not.toHaveBeenCalled();
    });
});

describe('destroy', () => {
    it('removes the button, panel, and document listeners', async () => {
        const panel = ensureFavoritesButton(wrap, makeHost())!;
        await panel.open();
        panel.destroy();

        expect(wrap.querySelector('.ez-favorites-button')).toBeNull();
        expect(document.body.querySelector('.ez-favorites-panel')).toBeNull();

        // A destroyed panel's document listener must not still be live.
        document.body.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true }),
        );
        // No assertion beyond "doesn't throw": destroy() must be safe to
        // leave no dangling listener behind, this just exercises that path.
    });
});

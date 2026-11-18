/** Embedded Favorites behavior through the field's real tabbed branding tools. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SchemePublicView } from '@ezclassify/types';
import {
    ensureMarkingFavorites,
    type FavoriteEntry,
    type FavoritesPanel,
    schemeOffersPresets,
    getScopedPresets,
    type FavoritesPanelHost,
} from './favorites-panel';
import { ensureStatusMark } from './status-mark';
import { cleanupTooltipForRoot } from './tooltip-manager';

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
const panels: FavoritesPanel[] = [];
function makeHost(
    overrides: Partial<FavoritesPanelHost> = {},
): FavoritesPanelHost {
    return {
        schemeId: 'test',
        formatId: 'default',
        scheme: makeScheme(),
        config: { load: vi.fn(async () => []) },
        read: vi.fn(async (marking) => ({ rendered: marking })),
        applyPreset: vi.fn(async (presetId) => ({ rendered: presetId })),
        getCurrent: () => ({ rendered: '', valid: false }),
        onApply: vi.fn(),
        focusField: vi.fn(),
        ...overrides,
    };
}
function mount(host = makeHost()): FavoritesPanel {
    const panel = ensureMarkingFavorites(wrap, host)!;
    panels.push(panel);
    return panel;
}
function press(element: HTMLElement, key: string): void {
    element.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
}
function favoriteTab(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(
        '[role=tab][aria-selected=true]',
    )!;
}
function startOpen(panel: FavoritesPanel): void {
    panel.button.click();
    expect(favoriteTab().getAttribute('aria-label')).toBe('Favorites');
}
async function open(panel: FavoritesPanel): Promise<void> {
    startOpen(panel);
    await wait();
}
function pinned(): HTMLButtonElement | null {
    return document.querySelector('.ez-favorites-panel__pinned');
}
function favorite(marking: string): HTMLButtonElement {
    return [
        ...document.querySelectorAll<HTMLButtonElement>(
            '[data-favorite-marking]',
        ),
    ].find((row) => row.dataset.favoriteMarking === marking)!;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
beforeEach(() => {
    document.body.replaceChildren();
    wrap = document.createElement('div');
    document.body.appendChild(wrap);
    ensureStatusMark(wrap, {
        shape: 'chrome',
        tools: true,
        root: document.body,
    });
    Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
    panels.splice(0).forEach((panel) => panel.destroy());
    cleanupTooltipForRoot(document.body);
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('embedded Favorites ownership', () => {
    it('removes an unrelated Favorite by its visible button without applying it or changing the current marking', async () => {
        let entries = [{ marking: 'CURRENT' }, { marking: 'OTHER' }];
        let current = 'CURRENT';
        const onApply = vi.fn((marking: string) => {
            current = marking;
        });
        const remove = vi.fn((marking: string) => {
            entries = entries.filter((entry) => entry.marking !== marking);
        });
        const panel = mount(
            makeHost({
                config: { load: () => entries, remove },
                getCurrent: () => ({ rendered: current, valid: true }),
                onApply,
            }),
        );
        await open(panel);
        expect(favoriteTab().getAttribute('aria-description')).toBe(
            '2 entries',
        );
        const button = document.querySelector<HTMLButtonElement>(
            '[data-favorite-remove="OTHER"]',
        )!;
        expect(button.getAttribute('aria-label')).toBe('Remove Favorite OTHER');
        expect(button.parentElement).toBe(favorite('OTHER').parentElement);
        expect(button.parentElement?.tagName).toBe('DIV');
        button.click();
        await wait();
        expect(remove).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith('OTHER', expect.any(Object));
        expect(onApply).not.toHaveBeenCalled();
        expect(current).toBe('CURRENT');
        expect(favorite('OTHER')).toBeUndefined();
        expect(favorite('CURRENT')).toBeDefined();
        expect(favoriteTab().getAttribute('aria-description')).toBe('1 entry');
    });

    it('keeps removal Tab-reachable and pairs row focus while vertical arrows follow markings', async () => {
        const panel = mount(
            makeHost({
                config: {
                    load: () => [{ marking: 'A' }, { marking: 'B' }],
                    remove: vi.fn(),
                },
            }),
        );
        await open(panel);
        const first = favorite('A');
        const remove = document.querySelector<HTMLButtonElement>(
            '[data-favorite-remove="A"]',
        )!;
        expect(remove.tabIndex).toBe(0);
        first.focus();
        press(first, 'ArrowDown');
        expect(document.activeElement).toBe(favorite('B'));
        remove.focus();
        press(remove, 'ArrowDown');
        expect(document.activeElement).toBe(favorite('B'));
        first.focus();
        press(first, 'ArrowRight');
        expect(document.activeElement).toBe(remove);
        press(remove, 'ArrowLeft');
        expect(document.activeElement).toBe(first);
        expect(favoriteTab().getAttribute('aria-label')).toBe('Favorites');
        press(first, 'ArrowLeft');
        expect(favoriteTab().getAttribute('aria-label')).toBe('Corrections');
        expect(document.activeElement).toBe(
            document.querySelector('.ez-marking-tools__section:not([hidden])'),
        );
    });

    it('offers no removal buttons without a remove provider or beside scheme presets', async () => {
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'A' }] },
                scheme: makeScheme({
                    labelPresets: [{ id: 'preset', label: 'Preset' }],
                }),
            }),
        );
        await open(panel);
        expect(
            document.querySelectorAll('[data-favorite-remove]'),
        ).toHaveLength(0);
        expect(document.querySelectorAll('[data-preset-id]')).toHaveLength(1);
    });

    it('offers no Favorites tab without persistence or presets', () => {
        expect(
            ensureMarkingFavorites(wrap, makeHost({ config: undefined })),
        ).toBeNull();
        wrap.querySelector<HTMLButtonElement>('.ez-status-mark')!.click();
        expect(
            [...document.querySelectorAll('[role=tab]')].map((tab) =>
                tab.getAttribute('aria-label'),
            ),
        ).toEqual(['Corrections']);
    });
    it('reuses the existing branding button and refreshes host closures', async () => {
        const original = wrap.querySelector('.ez-status-mark');
        const panel = mount();
        const apply = vi.fn();
        expect(
            ensureMarkingFavorites(
                wrap,
                makeHost({
                    config: { load: () => [{ marking: 'A' }] },
                    onApply: apply,
                }),
            ),
        ).toBe(panel);
        expect(panel.button).toBe(original);
        expect(wrap.querySelectorAll('.ez-status-mark')).toHaveLength(1);
        await open(panel);
        favorite('A').click();
        expect(apply).toHaveBeenCalledWith('A', expect.any(AbortSignal));
    });
    it('loads at mount and every open with the complete host context', async () => {
        const load = vi.fn(() => [{ marking: 'A', label: 'First' }]);
        const panel = mount(makeHost({ scope: 'whole', config: { load } }));
        expect(load).toHaveBeenCalledOnce();
        await open(panel);
        expect(load).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenLastCalledWith({
            schemeId: 'test',
            scope: 'whole',
            formatId: 'default',
        });
        expect(favorite('A').textContent).toBe('FirstA');
        press(favoriteTab(), 'Escape');
        await open(panel);
        expect(load).toHaveBeenCalledTimes(3);
    });
    it('destroys its content without removing the field branding button', async () => {
        const panel = mount();
        await open(panel);
        panel.destroy();
        expect(wrap.querySelector('.ez-status-mark')).toBe(panel.button);
        expect(
            document.querySelector('.ez-favorites-panel__embedded'),
        ).toBeNull();
        expect(panel.isOpen()).toBe(false);
    });
});

describe('loads and races', () => {
    it('shows accessible loading then an accessible empty state', async () => {
        const pending = deferred<FavoriteEntry[]>();
        const panel = mount(
            makeHost({ config: { load: () => pending.promise } }),
        );
        startOpen(panel);
        expect(
            document.querySelector('.ez-favorites-panel__loading[role=status]')
                ?.textContent,
        ).toContain('Loading');
        pending.resolve([]);
        await wait();
        expect(
            document
                .querySelector('.ez-favorites-panel__empty')
                ?.getAttribute('role'),
        ).toBe('status');
        expect(pinned()).toBeNull();
    });
    it('does not let a late mount load replace the newer open result', async () => {
        const mountLoad = deferred<FavoriteEntry[]>();
        const load = vi
            .fn()
            .mockReturnValueOnce(mountLoad.promise)
            .mockResolvedValue([{ marking: 'NEW' }]);
        const panel = mount(makeHost({ config: { load } }));
        await open(panel);
        mountLoad.resolve([{ marking: 'OLD' }]);
        await wait();
        expect(favorite('NEW')).toBeDefined();
        expect(favorite('OLD')).toBeUndefined();
    });
    it('ignores an earlier open that resolves after a subsequent open', async () => {
        const old = deferred<FavoriteEntry[]>();
        const latest = deferred<FavoriteEntry[]>();
        const load = vi
            .fn()
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(old.promise)
            .mockReturnValueOnce(latest.promise);
        const panel = mount(makeHost({ config: { load } }));
        startOpen(panel);
        press(favoriteTab(), 'Escape');
        startOpen(panel);
        latest.resolve([{ marking: 'NEW' }]);
        await wait();
        old.resolve([{ marking: 'OLD' }]);
        await wait();
        expect(favorite('NEW')).toBeDefined();
        expect(favorite('OLD')).toBeUndefined();
    });
    it('never reopens or announces a load after dismissal', async () => {
        const pending = deferred<FavoriteEntry[]>();
        const panel = mount(
            makeHost({ config: { load: () => pending.promise } }),
        );
        startOpen(panel);
        press(favoriteTab(), 'Escape');
        pending.resolve([{ marking: 'A' }]);
        await wait();
        expect(panel.isOpen()).toBe(false);
        expect(
            document.querySelector<HTMLElement>('.ez-tooltip--tools')?.hidden ??
                true,
        ).toBe(true);
        expect(panel.button.getAttribute('aria-expanded')).toBe('false');
        expect(document.body.textContent).not.toContain('1 favorite available');
    });
    it('renders raw saved values if reading a Favorite fails', async () => {
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'UNREADABLE' }] },
                read: () => {
                    throw new Error('Unreadable');
                },
            }),
        );
        await open(panel);
        expect(favorite('UNREADABLE').textContent).toBe('UNREADABLE');
    });
});

describe('current marking and persistence', () => {
    it.each([false, true])(
        'omits Save for an empty marking with valid=%s',
        async (valid) => {
            const panel = mount(
                makeHost({
                    config: { load: () => [], save: vi.fn() },
                    getCurrent: () => ({ rendered: '', valid }),
                }),
            );
            await open(panel);
            expect(pinned()).toBeNull();
        },
    );
    it('omits Save for an invalid current marking or a read-only provider', async () => {
        const panel = mount(
            makeHost({
                config: { load: () => [], save: vi.fn() },
                getCurrent: () => ({ rendered: 'A', valid: false }),
            }),
        );
        await open(panel);
        expect(pinned()).toBeNull();
        panel.updateHost(
            makeHost({ getCurrent: () => ({ rendered: 'A', valid: true }) }),
        );
        press(favoriteTab(), 'Escape');
        await open(panel);
        expect(pinned()).toBeNull();
    });
    it('saves then unsaves through the pinned row and retains keyboard focus', async () => {
        let entries: FavoriteEntry[] = [];
        const save = vi.fn((marking: string) => {
            entries = [{ marking }];
        });
        const remove = vi.fn(() => {
            entries = [];
        });
        const panel = mount(
            makeHost({
                config: { load: () => entries, save, remove },
                getCurrent: () => ({ rendered: 'A', valid: true }),
            }),
        );
        await open(panel);
        press(favoriteTab(), 'ArrowDown');
        expect(document.activeElement).toBe(pinned());
        pinned()!.click();
        await wait();
        expect(save).toHaveBeenCalledWith('A', {
            schemeId: 'test',
            scope: undefined,
            formatId: 'default',
        });
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
        expect(document.activeElement).toBe(pinned());
        pinned()!.click();
        await wait();
        expect(remove).toHaveBeenCalledWith('A', expect.any(Object));
        expect(pinned()?.textContent).toBe('Save Current Marking');
        expect(document.activeElement).toBe(pinned());
    });
    it('saves the complete marking held at action time after the store changes', async () => {
        let current = 'CURRENT';
        const save = vi.fn();
        const remove = vi.fn();
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'NEXT' }], save, remove },
                getCurrent: () => ({ rendered: current, valid: true }),
            }),
        );
        await open(panel);
        expect(pinned()?.textContent).toBe('Save Current Marking');
        current = 'NEXT';
        pinned()!.click();
        await wait();
        expect(save).toHaveBeenCalledWith('NEXT', expect.any(Object));
        expect(remove).not.toHaveBeenCalled();
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
    });

    it('never unsaves the old marking after the current store value changes', async () => {
        let current = 'A';
        const save = vi.fn();
        const remove = vi.fn();
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'A' }], save, remove },
                getCurrent: () => ({ rendered: current, valid: true }),
            }),
        );
        await open(panel);
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
        current = 'B';
        pinned()!.click();
        await wait();
        expect(remove).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(favorite('A')).toBeDefined();
        expect(pinned()?.textContent).toBe('Save Current Marking');
    });

    it('matches rendered forms and removes the saved source string', async () => {
        const remove = vi.fn();
        const panel = mount(
            makeHost({
                config: {
                    load: () => [{ marking: 'LONG' }],
                    save: vi.fn(),
                    remove,
                },
                read: () => ({ rendered: 'SHORT' }),
                getCurrent: () => ({ rendered: 'SHORT', valid: true }),
            }),
        );
        await open(panel);
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
        expect(
            favorite('LONG').classList.contains(
                'proto-dropdown-item--selected',
            ),
        ).toBe(true);
        pinned()!.click();
        await wait();
        expect(remove).toHaveBeenCalledWith('LONG', expect.any(Object));
    });
    it('updates current-row matching after the host marking changes', async () => {
        let current = 'A';
        const panel = mount(
            makeHost({
                config: {
                    load: () => [{ marking: 'A' }],
                    save: vi.fn(),
                    remove: vi.fn(),
                },
                getCurrent: () => ({ rendered: current, valid: true }),
            }),
        );
        await open(panel);
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
        press(favoriteTab(), 'Escape');
        current = 'B';
        await open(panel);
        expect(pinned()?.textContent).toBe('Save Current Marking');
        expect(
            favorite('A').classList.contains('proto-dropdown-item--selected'),
        ).toBe(false);
    });
    it('leaves the list available when persistence fails', async () => {
        const panel = mount(
            makeHost({
                config: {
                    load: () => [],
                    save: () => Promise.reject(new Error('Offline')),
                },
                getCurrent: () => ({ rendered: 'A', valid: true }),
            }),
        );
        await open(panel);
        pinned()!.click();
        await wait();
        expect(panel.isOpen()).toBe(true);
        expect(pinned()?.textContent).toBe('Save Current Marking');
    });
    it('reloads a completed save even when a faster reopen read preceded the write', async () => {
        const write = deferred<void>();
        let saved = false;
        const load = vi.fn(() => (saved ? [{ marking: 'A' }] : []));
        const panel = mount(
            makeHost({
                config: {
                    load,
                    save: async () => {
                        await write.promise;
                        saved = true;
                    },
                    remove: vi.fn(),
                },
                getCurrent: () => ({ rendered: 'A', valid: true }),
            }),
        );
        await open(panel);
        pinned()!.click();
        press(favoriteTab(), 'Escape');
        await open(panel);
        expect(pinned()?.textContent).toBe('Save Current Marking');
        write.resolve();
        await wait();
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
        expect(favorite('A')).toBeDefined();
    });
    it('settles a write after dismissal without reopening or taking focus', async () => {
        const write = deferred<void>();
        let saved = false;
        const panel = mount(
            makeHost({
                config: {
                    load: () => (saved ? [{ marking: 'A' }] : []),
                    save: async () => {
                        await write.promise;
                        saved = true;
                    },
                    remove: vi.fn(),
                },
                getCurrent: () => ({ rendered: 'A', valid: true }),
            }),
        );
        await open(panel);
        pinned()!.click();
        press(favoriteTab(), 'Escape');
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        write.resolve();
        await wait();
        expect(panel.isOpen()).toBe(false);
        expect(document.activeElement).toBe(outside);
        await open(panel);
        expect(pinned()?.textContent).toBe('Unsave Current Marking');
    });
});

describe('presets and native rows', () => {
    it('offers scoped scheme presets without a persistence provider', async () => {
        const onApply = vi.fn();
        const panel = mount(
            makeHost({
                config: undefined,
                scope: 'whole',
                scheme: makeScheme({
                    defaultScope: 'whole',
                    labelPresets: [
                        { id: 'a', label: 'Preset A' },
                        { id: 'b', label: 'Other scope', scope: 'other' },
                    ],
                }),
                applyPreset: () => ({ rendered: 'PRESET' }),
                onApply,
            }),
        );
        await open(panel);
        expect(document.querySelectorAll('[data-preset-id]')).toHaveLength(1);
        expect(pinned()).toBeNull();
        expect(document.body.textContent).not.toContain('Saved Favorites');
        document
            .querySelector<HTMLButtonElement>('[data-preset-id=a]')!
            .click();
        expect(onApply).toHaveBeenCalledWith('PRESET', expect.any(AbortSignal));
    });
    it('does not treat matching a scheme preset as a saved user Favorite', async () => {
        const panel = mount(
            makeHost({
                scheme: makeScheme({
                    labelPresets: [{ id: 'a', label: 'Preset A' }],
                }),
                config: { load: () => [], save: vi.fn(), remove: vi.fn() },
                applyPreset: () => ({ rendered: 'A' }),
                getCurrent: () => ({ rendered: 'A', valid: true }),
            }),
        );
        await open(panel);
        expect(pinned()?.textContent).toBe('Save Current Marking');
        expect(document.querySelector('[data-preset-id=a] button')).toBeNull();
    });
    it('arrows pass from the tab through Save and saved values before presets', async () => {
        const panel = mount(
            makeHost({
                scheme: makeScheme({
                    labelPresets: [{ id: 'preset', label: 'Preset' }],
                }),
                config: { load: () => [{ marking: 'A' }], save: vi.fn() },
                getCurrent: () => ({ rendered: 'B', valid: true }),
            }),
        );
        await open(panel);
        press(favoriteTab(), 'ArrowDown');
        expect(document.activeElement).toBe(pinned());
        press(pinned()!, 'ArrowDown');
        expect(document.activeElement).toBe(favorite('A'));
        press(favorite('A'), 'ArrowDown');
        expect((document.activeElement as HTMLElement).dataset.presetId).toBe(
            'preset',
        );
        press(document.activeElement as HTMLElement, 'ArrowUp');
        expect(document.activeElement).toBe(favorite('A'));
    });
    it('keeps highlight on the natively focused row', async () => {
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'A' }, { marking: 'B' }] },
            }),
        );
        await open(panel);
        favorite('A').focus();
        expect(
            favorite('A').classList.contains(
                'proto-dropdown-item--highlighted',
            ),
        ).toBe(true);
        favorite('B').focus();
        expect(
            favorite('A').classList.contains(
                'proto-dropdown-item--highlighted',
            ),
        ).toBe(false);
        expect(
            favorite('B').classList.contains(
                'proto-dropdown-item--highlighted',
            ),
        ).toBe(true);
    });
    it('deletes an unrelated Favorite without applying it and focuses its neighbor', async () => {
        let entries = [{ marking: 'A' }, { marking: 'B' }];
        const remove = vi.fn((marking) => {
            entries = entries.filter((entry) => entry.marking !== marking);
        });
        const onApply = vi.fn();
        const panel = mount(
            makeHost({ config: { load: () => entries, remove }, onApply }),
        );
        await open(panel);
        favorite('A').focus();
        press(favorite('A'), 'Delete');
        await wait();
        expect(remove).toHaveBeenCalledWith('A', expect.any(Object));
        expect(onApply).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(favorite('B'));
    });
});

describe('browser persistence controls', () => {
    it('refreshes the Favorites count immediately after Clear Saved while retaining scoped scheme presets', async () => {
        let entries: FavoriteEntry[] = [{ marking: 'A' }, { marking: 'B' }];
        const clear = vi.fn(() => {
            entries = [];
        });
        const panel = mount(
            makeHost({
                scope: 'report',
                scheme: makeScheme({
                    labelPresets: [
                        {
                            id: 'report-preset',
                            label: 'Report Preset',
                            scope: 'report',
                        },
                        {
                            id: 'other-preset',
                            label: 'Other Preset',
                            scope: 'other',
                        },
                    ],
                }),
                config: {
                    load: () => entries,
                    clear,
                    browserStorage: {
                        enabled: () => true,
                        setEnabled: vi.fn(),
                    },
                },
            }),
        );
        await open(panel);
        const tab = favoriteTab();
        expect(tab.getAttribute('aria-description')).toBe('3 entries');
        const action = (label: string) =>
            [
                ...document.querySelectorAll<HTMLButtonElement>(
                    '.ez-favorites-panel__settings-action',
                ),
            ].find((button) => button.textContent === label)!;
        action('Manage Favorites').click();
        action('Clear Saved Favorites').click();
        await wait();
        expect(clear).toHaveBeenCalledWith({
            schemeId: 'test',
            scope: 'report',
            formatId: 'default',
        });
        expect(tab.getAttribute('aria-description')).toBe('1 entry');
        expect(tab.querySelector('.ez-marking-tools__count')?.textContent).toBe(
            '1',
        );
        // The badge is current before leaving management; returning keeps the scheme entry.
        action('Back to Favorites').click();
        expect(
            document.querySelectorAll('[data-favorite-marking]'),
        ).toHaveLength(0);
        expect(
            document.querySelectorAll('[data-preset-id="report-preset"]'),
        ).toHaveLength(1);
        expect(
            document.querySelector('[data-preset-id="other-preset"]'),
        ).toBeNull();
    });

    it('shows no storage choice before saving and supports native opt-in and management', async () => {
        let entries: FavoriteEntry[] = [];
        let enabled: boolean | undefined;
        const panel = mount(
            makeHost({
                config: {
                    load: () => entries,
                    save: (marking) => {
                        entries = [{ marking }];
                    },
                    remove: () => {
                        entries = [];
                    },
                    browserStorage: {
                        enabled: () => enabled,
                        setEnabled: (value) => {
                            enabled = value;
                        },
                    },
                },
                getCurrent: () => ({ rendered: 'A', valid: true }),
            }),
        );
        await open(panel);
        expect(document.body.textContent).not.toContain(
            'Keep Favorites for Your Next Visit?',
        );
        press(favoriteTab(), 'ArrowDown');
        pinned()!.click();
        await wait();
        const remember = [
            ...document.querySelectorAll<HTMLButtonElement>('button'),
        ].find(
            (button) =>
                button.textContent === 'Remember Favorites on This Browser',
        )!;
        remember.focus();
        remember.click();
        await wait();
        expect(enabled).toBe(true);
        const manage = [
            ...document.querySelectorAll<HTMLButtonElement>('button'),
        ].find((button) => button.textContent === 'Manage Favorites')!;
        expect(document.activeElement).toBe(manage);
        manage.click();
        const checkbox = document.querySelector<HTMLInputElement>(
            '.ez-favorites-panel__storage input',
        )!;
        expect(checkbox.checked).toBe(true);
        checkbox.click();
        await wait();
        expect(enabled).toBe(false);
    });
});

describe('asynchronous application', () => {
    it('retains focus until the selected marking applies', async () => {
        const apply = deferred<void>();
        const focusField = vi.fn();
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'A' }] },
                onApply: () => apply.promise,
                focusField,
            }),
        );
        await open(panel);
        favorite('A').focus();
        favorite('A').click();
        expect(panel.isOpen()).toBe(true);
        expect(document.querySelector('[aria-busy=true]')).not.toBeNull();
        expect(focusField).not.toHaveBeenCalled();
        apply.resolve();
        await wait();
        expect(panel.isOpen()).toBe(false);
        expect(focusField).toHaveBeenCalledOnce();
    });
    it('cancels superseded and dismissed reads without stealing later focus', async () => {
        const pending: Array<{
            signal: AbortSignal;
            write: ReturnType<typeof deferred<void>>;
        }> = [];
        const onApply = vi.fn((_marking, signal: AbortSignal) => {
            const write = deferred<void>();
            pending.push({ signal, write });
            return write.promise;
        });
        const focusField = vi.fn();
        const panel = mount(
            makeHost({
                config: { load: () => [{ marking: 'A' }, { marking: 'B' }] },
                onApply,
                focusField,
            }),
        );
        await open(panel);
        favorite('A').click();
        favorite('B').click();
        expect(pending[0].signal.aborted).toBe(true);
        press(favoriteTab(), 'Escape');
        expect(pending[1].signal.aborted).toBe(true);
        pending.forEach((entry) => entry.write.resolve());
        await wait();
        expect(focusField).not.toHaveBeenCalled();
        expect(panel.isOpen()).toBe(false);
    });
    it('keeps a failed application available for retry', async () => {
        const onApply = vi
            .fn()
            .mockRejectedValueOnce(new Error('Offline'))
            .mockResolvedValue(undefined);
        const panel = mount(
            makeHost({ config: { load: () => [{ marking: 'A' }] }, onApply }),
        );
        await open(panel);
        favorite('A').click();
        await wait();
        expect(panel.isOpen()).toBe(true);
        favorite('A').click();
        await wait();
        expect(onApply).toHaveBeenCalledTimes(2);
        expect(panel.isOpen()).toBe(false);
    });
});

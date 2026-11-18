import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemePublicView } from '@ezclassify/types';
import {
    ensureMarkingFavorites,
    type FavoriteEntry,
    type FavoritesPanel,
    type FavoritesConfig,
} from './favorites-panel';
import {
    ensureStatusMark,
    statusMarkOwnsNode,
    setStatusMarkFixes,
    setStatusMarkFavorites,
    setStatusMarkError,
} from './status-mark';
import { isMacPlatform } from './dom-helpers';
import { cleanupTooltipForRoot } from './tooltip-manager';

let panel: FavoritesPanel | null;
beforeEach(() => {
    document.body.replaceChildren();
    HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
    panel?.destroy();
    cleanupTooltipForRoot(document.body);
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const press = (element: HTMLElement, key: string) =>
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('branding-popover Favorites', () => {
    function mount(
        entries: FavoriteEntry[] = [{ marking: 'LOW' }, { marking: 'HIGH' }],
        overrides: Partial<FavoritesConfig> = {},
        provider = true,
        presets = true,
        validCurrent = true,
    ) {
        const wrap = document.createElement('div');
        document.body.append(wrap);
        const mark = ensureStatusMark(wrap, { shape: 'chrome', tools: true });
        const onApply = vi.fn();
        const focusField = vi.fn();
        const remove = vi.fn((marking: string) => {
            entries = entries.filter((entry) => entry.marking !== marking);
        });
        const scheme = {
            id: 'sample',
            labelPresets: presets
                ? [{ id: 'preset', label: 'Scheme Preset' }]
                : [],
        } as SchemePublicView;
        panel = ensureMarkingFavorites(wrap, {
            schemeId: 'sample',
            scope: 'whole',
            formatId: 'banner',
            scheme,
            config: provider
                ? { load: () => entries, save: vi.fn(), remove, ...overrides }
                : undefined,
            read: (marking) => ({ rendered: marking }),
            applyPreset: () => ({ rendered: 'PRESET' }),
            getCurrent: () => ({
                rendered: validCurrent ? 'CURRENT' : '',
                valid: validCurrent,
            }),
            onApply,
            focusField,
        });
        return { mark, wrap, remove, onApply, focusField };
    }

    it('updates the Favorites tab count after loading and removing saved entries, including scoped presets', async () => {
        const { mark } = mount();
        mark.click();
        await settle();
        const tabs = [...document.querySelectorAll<HTMLElement>('[role=tab]')];
        const favorites = tabs.find(
            (tab) => tab.getAttribute('aria-label') === 'Favorites',
        )!;
        const corrections = tabs.find(
            (tab) => tab.getAttribute('aria-label') === 'Corrections',
        )!;
        expect(corrections.getAttribute('aria-description')).toBe('0 entries');
        expect(favorites.getAttribute('aria-description')).toBe('3 entries');
        const low = document.querySelector<HTMLButtonElement>(
            '[data-favorite-marking="LOW"]',
        )!;
        low.focus();
        press(low, 'Delete');
        await settle();
        expect(favorites.getAttribute('aria-description')).toBe('2 entries');
        const high = document.querySelector<HTMLButtonElement>(
            '[data-favorite-marking="HIGH"]',
        )!;
        high.focus();
        press(high, 'Delete');
        await settle();
        expect(favorites.getAttribute('aria-description')).toBe('1 entry');
        expect(document.querySelectorAll('[data-preset-id]')).toHaveLength(1);
        expect(
            document.querySelectorAll('[data-favorite-marking]'),
        ).toHaveLength(0);
    });

    it('keeps a pending Favorite row owned through new corrections and error refresh until normal completion', async () => {
        const { mark, wrap, onApply, focusField } = mount();
        let resolve!: () => void;
        onApply.mockImplementation(
            () =>
                new Promise<void>((done) => {
                    resolve = done;
                }),
        );
        mark.click();
        await settle();
        const row = document.querySelector<HTMLElement>(
            '[data-favorite-marking="HIGH"]',
        )!;
        row.focus();
        row.click();
        setStatusMarkFixes(wrap, [
            {
                action: 'add',
                ruleId: 'new',
                message: 'Added value',
                add: [{ conceptId: 'HIGH', categoryId: 'level' }],
            },
        ]);
        setStatusMarkError(wrap, 'Updated report');
        expect(mark.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(row);
        expect(row.isConnected).toBe(true);
        resolve();
        await settle();
        expect(focusField).toHaveBeenCalledOnce();
        expect(mark.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps ArrowDown on a plain branding control without activating Tools', async () => {
        const { mark } = mount();
        mark.focus();
        const clicked = vi.fn();
        mark.addEventListener('click', clicked);
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
        });
        mark.dispatchEvent(event);
        await settle();
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(mark);
        expect(clicked).not.toHaveBeenCalled();
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        expect(
            document.querySelector('.ez-tooltip--tools:not([hidden])'),
        ).toBeNull();
    });

    it('keeps the branding button reachable on a valid field and places Save inside Favorites', async () => {
        const { mark, wrap } = mount();
        expect(mark.tabIndex).toBe(0);
        expect(wrap.querySelectorAll('button')).toHaveLength(1);
        mark.click();
        await settle();
        expect(document.querySelector('.ez-tooltip--tools')).not.toBeNull();
        const tab = document.querySelector<HTMLButtonElement>(
            '[role=tab][aria-selected=true]',
        )!;
        expect(tab.getAttribute('aria-label')).toBe('Favorites');
        press(tab, 'ArrowDown');
        expect(document.activeElement?.textContent).toContain(
            'Save Current Marking',
        );
        press(document.activeElement as HTMLElement, 'ArrowDown');
        expect(document.activeElement?.textContent).toContain('LOW');
    });

    it('describes the available tools and platform shortcut without opening the window', () => {
        const { mark, wrap } = mount();
        const shortcut = `${isMacPlatform() ? 'Cmd' : 'Ctrl'}+Shift+Enter`;
        expect(mark.title).toBe(`Corrections and Favorites (${shortcut})`);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
        setStatusMarkFavorites(wrap, null);
        expect(mark.title).toBe(`Corrections (${shortcut})`);
        expect(mark.getAttribute('aria-expanded')).toBe('false');
    });

    it.each(['ctrlKey', 'metaKey'] as const)(
        'opens the current tools tab from its field with %s',
        async (modifier) => {
            const { mark, wrap } = mount();
            const input = document.createElement('input');
            wrap.append(input);
            expect(mark.getAttribute('aria-keyshortcuts')).toBe(
                'Control+Shift+Enter Meta+Shift+Enter',
            );
            input.focus();
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    shiftKey: true,
                    [modifier]: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
            await settle();
            expect(document.activeElement?.getAttribute('aria-label')).toBe(
                'Favorites',
            );
            const corrections = [
                ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            ].find((tab) => tab.getAttribute('aria-label') === 'Corrections')!;
            corrections.click();
            // The branding button remains in the open tools domain. Asking
            // there keeps the current section and does not toggle closed.
            mark.focus();
            mark.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    shiftKey: true,
                    [modifier]: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
            expect(document.activeElement).toBe(corrections);
            expect(mark.getAttribute('aria-expanded')).toBe('true');
        },
    );

    it('places the synchronous Favorites loading row before checking clearance', () => {
        const { mark, wrap } = mount();
        wrap.classList.add('marked-textarea-wrap');
        vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(45.59375, 347.375, 298.796875, 276),
        );
        vi.spyOn(mark, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(264.390625, 363.375, 20, 20),
        );
        const originalRect = HTMLElement.prototype.getBoundingClientRect;
        const geometry = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(function (this: HTMLElement) {
                if (!this.classList.contains('ez-tooltip'))
                    return originalRect.call(this);
                const height = this.querySelector(
                    '.ez-favorites-panel__loading',
                )
                    ? 121
                    : 77;
                return new DOMRect(
                    Number.parseFloat(this.style.left) || 0,
                    Number.parseFloat(this.style.top) || 0,
                    346,
                    height,
                );
            });
        try {
            mark.click();
            const tipId = mark.getAttribute('aria-describedby');
            const tip = tipId ? document.getElementById(tipId) : null;
            expect(tip).not.toBeNull();
            expect(tip?.hidden).toBe(false);
            expect(
                tip?.querySelector('.ez-favorites-panel__loading'),
            ).not.toBeNull();
            expect(tip?.style.top).toBe('220.375px');
            expect(tip!.getBoundingClientRect().bottom).toBeLessThan(
                wrap.getBoundingClientRect().top,
            );
            expect(document.activeElement?.getAttribute('role')).toBe('tab');
        } finally {
            geometry.mockRestore();
        }
    });

    it('moves pointer focus from the input to the selected tab when opening the tools', async () => {
        const input = document.createElement('textarea');
        document.body.append(input);
        const wrap = document.createElement('div');
        document.body.append(wrap);
        const opened = vi.fn();
        const mark = ensureStatusMark(wrap, {
            shape: 'chrome',
            tools: true,
            onToolsOpen: opened,
        });
        input.focus();
        mark.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                detail: 1,
            }),
        );
        mark.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                detail: 1,
            }),
        );
        expect(opened).toHaveBeenCalledOnce();
        expect(document.activeElement).not.toBe(input);
        expect(document.activeElement?.getAttribute('aria-label')).toBe(
            'Corrections',
        );
    });

    it('offers browser persistence only after a Favorite is saved', async () => {
        const entries: FavoriteEntry[] = [];
        const { mark } = mount(entries, {
            save: (marking) => {
                entries.push({ marking });
            },
            browserStorage: { enabled: () => undefined, setEnabled: () => {} },
        });
        mark.click();
        await settle();
        const content = document.querySelector(
            '.ez-favorites-panel__embedded',
        )!;
        expect(content.textContent).not.toContain('Saved Favorites');
        expect(content.textContent).not.toContain(
            'Keep Favorites for Your Next Visit?',
        );
        content
            .querySelector<HTMLButtonElement>('.ez-favorites-panel__pinned')!
            .click();
        await settle();
        expect(content.textContent).toContain('Saved Favorites');
        expect(content.textContent).toContain(
            'Keep Favorites for Your Next Visit?',
        );
        expect(
            content.querySelector('.ez-favorites-panel__settings--choice'),
        ).not.toBeNull();
    });

    it('keeps tools reachable when the control fills the viewport', async () => {
        const { mark, wrap } = mount();
        const realRect = HTMLElement.prototype.getBoundingClientRect;
        const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
        rects.mockImplementation(function (this: HTMLElement) {
            if (this === wrap)
                return new DOMRect(0, 0, window.innerWidth, 2000);
            if (this === mark)
                return new DOMRect(window.innerWidth - 40, 36, 24, 24);
            if (this.classList.contains('ez-tooltip'))
                return new DOMRect(
                    Number.parseFloat(this.style.left) || 0,
                    Number.parseFloat(this.style.top) || 0,
                    200,
                    121,
                );
            return realRect.call(this);
        });
        try {
            mark.click();
            await settle();
            const popup =
                document.querySelector<HTMLElement>('.ez-tooltip--tools')!;
            expect(popup.hidden).toBe(false);
            expect(document.activeElement?.getAttribute('role')).toBe('tab');
            expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
            expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(
                window.innerHeight,
            );
        } finally {
            rects.mockRestore();
        }
    });

    it('recognizes outgoing tools focus after pointer dismissal', async () => {
        const { mark } = mount();
        mark.click();
        await settle();
        const tab = document.activeElement!;
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        expect(mark.hasAttribute('aria-describedby')).toBe(false);
        expect(statusMarkOwnsNode(mark, tab)).toBe(true);
        expect(statusMarkOwnsNode(mark, outside)).toBe(false);
    });

    it.each(['pointer', 'keyboard'] as const)(
        'closes tools when %s interaction returns to the editor',
        async (mode) => {
            const { mark, wrap } = mount();
            const input = document.createElement('textarea');
            wrap.append(input);
            mark.click();
            await settle();
            const popup =
                document.querySelector<HTMLElement>('.ez-tooltip--tools')!;
            expect(popup.hidden).toBe(false);
            if (mode === 'pointer')
                input.dispatchEvent(
                    new MouseEvent('pointerdown', { bubbles: true }),
                );
            input.focus();
            expect(popup.hidden).toBe(true);
            expect(document.activeElement).toBe(input);
        },
    );

    it('does not open a tools dialog on hover while a field is focused', async () => {
        const { mark } = mount();
        const input = document.createElement('textarea');
        document.body.append(input);
        input.focus();
        setStatusMarkFixes(mark.parentElement!, [
            {
                action: 'add',
                ruleId: 'rule',
                message: 'Added value',
                add: [{ conceptId: 'HIGH', categoryId: 'level' }],
            },
        ]);
        mark.dispatchEvent(new MouseEvent('mouseenter'));
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(document.querySelector('.ez-tooltip--tools')).toBeNull();
        expect(document.activeElement).toBe(input);
    });

    it('Delete removes an unselected saved marking, focuses the next row, and never applies it', async () => {
        const { mark, remove, onApply } = mount();
        mark.click();
        await settle();
        const rows = [
            ...document.querySelectorAll<HTMLButtonElement>(
                '.ez-favorites-panel__embedded button',
            ),
        ];
        const low = rows.find((row) => row.textContent === 'LOW')!;
        low.focus();
        press(low, 'Delete');
        await settle();
        expect(remove).toHaveBeenCalledWith('LOW', {
            schemeId: 'sample',
            scope: 'whole',
            formatId: 'banner',
        });
        expect(onApply).not.toHaveBeenCalled();
        expect(document.activeElement?.textContent).toBe('HIGH');
        const preset = [
            ...document.querySelectorAll<HTMLButtonElement>(
                '.ez-favorites-panel__embedded button',
            ),
        ].find((row) => row.textContent?.includes('Scheme Preset'))!;
        preset.focus();
        press(preset, 'Delete');
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('opens unseen corrections first without mixing Favorites into their list', async () => {
        const { mark, wrap } = mount();
        setStatusMarkFixes(wrap, [
            {
                action: 'add',
                ruleId: 'rule',
                message: 'Added value',
                add: [{ conceptId: 'x', categoryId: 'level' }],
            },
        ]);
        mark.click();
        await settle();
        expect(
            document
                .querySelector('[role=tab][aria-selected=true]')
                ?.getAttribute('aria-label'),
        ).toBe('Corrections');
        expect(
            document
                .querySelector('[role=tab][aria-selected=true]')
                ?.getAttribute('aria-description'),
        ).toBe('1 entry');
        expect(
            document.querySelector('.ez-status-list')?.textContent,
        ).not.toContain('LOW');
        expect(mark.classList.contains('ez-status-mark--seen')).toBe(true);
    });

    it('offers scheme presets with no host provider', async () => {
        const { mark } = mount([], {}, false);
        mark.click();
        await settle();
        expect(
            document
                .querySelector('[role=tab][aria-selected=true]')
                ?.getAttribute('aria-label'),
        ).toBe('Favorites');
        expect(
            document.querySelector('.ez-favorites-panel__pinned'),
        ).toBeNull();
        expect(
            document.querySelector('.ez-favorites-panel__embedded')
                ?.textContent,
        ).toContain('Scheme Preset');
    });

    it('moves focus to the previous Favorite when deleting the last one', async () => {
        const { mark } = mount();
        mark.click();
        await settle();
        const high = [
            ...document.querySelectorAll<HTMLButtonElement>(
                '.ez-favorites-panel__embedded button',
            ),
        ].find((row) => row.textContent === 'HIGH')!;
        high.focus();
        press(high, 'Delete');
        await settle();
        expect(document.activeElement?.textContent).toBe('LOW');
    });

    it('returns focus to the Favorites tab when deletion leaves an empty list', async () => {
        const { mark } = mount([{ marking: 'LOW' }], {}, true, false, false);
        mark.click();
        await settle();
        const low = document.querySelector<HTMLButtonElement>(
            '[data-favorite-marking="LOW"]',
        )!;
        low.focus();
        press(low, 'Delete');
        await settle();
        expect(document.activeElement?.getAttribute('role')).toBe('tab');
        expect(document.activeElement?.getAttribute('aria-label')).toBe(
            'Favorites',
        );
    });

    it('does not reclaim focus after a pending consent choice', async () => {
        let finish!: () => void;
        let choice: boolean | undefined;
        const pending = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const { mark } = mount(undefined, {
            browserStorage: {
                enabled: () => choice,
                setEnabled: async (enabled) => {
                    await pending;
                    choice = enabled;
                },
            },
        });
        mark.click();
        await settle();
        const content = document.querySelector(
            '.ez-favorites-panel__embedded',
        )!;
        const choose = [
            ...content.querySelectorAll<HTMLButtonElement>('button'),
        ].find(
            (button) =>
                button.textContent === 'Remember Favorites on This Browser',
        )!;
        choose.focus();
        choose.click();
        document
            .querySelector<HTMLButtonElement>('[data-favorite-marking="HIGH"]')!
            .focus();
        finish();
        await settle();
        expect(document.activeElement?.textContent).toBe('HIGH');
    });

    it('replaces the consent prompt with Manage after a durable host choice', async () => {
        let choice: boolean | undefined;
        const { mark } = mount([{ marking: 'LOW' }], {
            browserStorage: {
                enabled: () => choice,
                setEnabled: (enabled) => {
                    choice = enabled;
                },
            },
        });
        mark.click();
        await settle();
        const content = document.querySelector(
            '.ez-favorites-panel__embedded',
        )!;
        expect(content.textContent).toContain(
            'Keep Favorites for Your Next Visit?',
        );
        [...content.querySelectorAll<HTMLButtonElement>('button')]
            .find(
                (button) =>
                    button.textContent === 'Remember Favorites on This Browser',
            )!
            .click();
        await settle();
        expect(choice).toBe(true);
        expect(content.textContent).not.toContain(
            'Keep Favorites for Your Next Visit?',
        );
        expect(content.textContent).toContain('Manage Favorites');
        expect(content.querySelector('input[type=checkbox]')).toBeNull();
    });

    it.each(['save', 'remove'] as const)(
        'retains the user’s later focus while %s is pending',
        async (operation) => {
            let finish!: () => void;
            const pending = new Promise<void>((resolve) => {
                finish = resolve;
            });
            const { mark } = mount(undefined, { [operation]: () => pending });
            mark.click();
            await settle();
            const buttons = [
                ...document.querySelectorAll<HTMLButtonElement>(
                    '.ez-favorites-panel__embedded button',
                ),
            ];
            const target = buttons.find((row) =>
                operation === 'save'
                    ? row.classList.contains('ez-favorites-panel__pinned')
                    : row.textContent === 'LOW',
            )!;
            target.focus();
            if (operation === 'save') target.click();
            else press(target, 'Delete');
            buttons.find((row) => row.textContent === 'HIGH')!.focus();
            finish();
            await settle();
            expect(document.activeElement?.textContent).toBe('HIGH');
        },
    );
});

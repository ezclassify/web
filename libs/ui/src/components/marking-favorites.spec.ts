import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemePublicView } from '@ezclassify/types';
import {
    ensureMarkingFavorites,
    type FavoriteEntry,
    type FavoritesPanel,
    type FavoritesConfig,
} from './favorites-panel';
import { ensureStatusMark, setStatusMarkFixes } from './status-mark';
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
            focusField: vi.fn(),
        });
        return { mark, wrap, remove, onApply };
    }

    it('keeps the branding button reachable on a valid field and places Save inside Favorites', async () => {
        const { mark, wrap } = mount();
        expect(mark.tabIndex).toBe(0);
        expect(wrap.querySelector('.ez-favorites-button')).toBeNull();
        mark.click();
        await settle();
        expect(document.querySelector('.ez-tooltip--tools')).not.toBeNull();
        const tab = document.querySelector<HTMLButtonElement>(
            '[role=tab][aria-selected=true]',
        )!;
        expect(tab.textContent).toBe('Favorites');
        press(tab, 'ArrowDown');
        expect(document.activeElement?.textContent).toContain(
            'Save Current Marking',
        );
        press(document.activeElement as HTMLElement, 'ArrowDown');
        expect(document.activeElement?.textContent).toContain('LOW');
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
            document.querySelector('[role=tab][aria-selected=true]')
                ?.textContent,
        ).toBe('Corrections');
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
            document.querySelector('[role=tab][aria-selected=true]')
                ?.textContent,
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
        expect(document.activeElement?.textContent).toBe('Favorites');
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
        const { mark } = mount([], {
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

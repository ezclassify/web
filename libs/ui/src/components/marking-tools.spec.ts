import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMarkingTools } from './marking-tools';

function press(element: HTMLElement, key: string): void {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

afterEach(() => document.body.replaceChildren());
beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('marking tools keyboard navigation', () => {
    function mount(withFavorites = true) {
        const corrections = document.createElement('div');
        const undo = document.createElement('button');
        undo.textContent = 'Undo';
        corrections.append(undo);
        const favorites = document.createElement('div');
        const save = document.createElement('button');
        save.textContent = 'Save Current Marking';
        const heading = document.createElement('h3');
        heading.textContent = 'Saved Favorites';
        const saved = document.createElement('button');
        saved.textContent = 'Saved Marking';
        favorites.append(save, heading, saved);
        const viewed = vi.fn();
        const tools = buildMarkingTools({
            corrections,
            favorites: withFavorites ? favorites : undefined,
            showCorrections: true,
            onCorrectionsViewed: viewed,
            onResize: vi.fn(),
            onClose: vi.fn(),
        });
        document.body.append(tools);
        const tabs = [
            ...tools.querySelectorAll<HTMLButtonElement>('[role=tab]'),
        ];
        return { tools, tabs, save, saved, undo, viewed };
    }

    it('moves from tabs into actions and across section headings with arrow keys', () => {
        const { tabs, save, saved } = mount();
        tabs[0].focus();
        press(tabs[0], 'ArrowRight');
        expect(document.activeElement).toBe(tabs[1]);
        press(tabs[1], 'ArrowDown');
        expect(document.activeElement).toBe(save);
        press(save, 'ArrowDown');
        expect(document.activeElement).toBe(saved);
        press(saved, 'ArrowUp');
        expect(document.activeElement).toBe(save);
        press(save, 'ArrowUp');
        expect(document.activeElement).toBe(tabs[1]);
    });

    it('retains only the active tab in the tab order and acknowledges visible corrections', () => {
        const { tabs, undo, viewed } = mount();
        tabs[1].click();
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
        expect(viewed).not.toHaveBeenCalled();
        press(tabs[1], 'Home');
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
        expect(viewed).toHaveBeenCalledOnce();
        press(tabs[0], 'ArrowDown');
        expect(document.activeElement).toBe(undo);
    });

    it('offers no Favorites tab without provider content or scoped presets', () => {
        const { tabs } = mount(false);
        expect(tabs).toHaveLength(1);
        expect(tabs[0].textContent).toBe('Corrections');
    });
});

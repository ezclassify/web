import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    bindMarkingToolsShortcut,
    buildMarkingTools,
    updateMarkingToolsCounts,
} from './marking-tools';

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
        expect(tabs[0].getAttribute('aria-label')).toBe('Corrections');
    });

    it.each([true, false])(
        'includes Close in the header arrow cycle (Favorites: %s)',
        (withFavorites) => {
            const { tools, tabs } = mount(withFavorites);
            const close = tools.querySelector<HTMLButtonElement>(
                '.ez-marking-tools__close',
            )!;
            tabs[0].focus();
            for (const tab of tabs.slice(1)) {
                press(document.activeElement as HTMLElement, 'ArrowRight');
                expect(document.activeElement).toBe(tab);
            }
            press(document.activeElement as HTMLElement, 'ArrowRight');
            expect(document.activeElement).toBe(close);
            expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe(
                'true',
            );
            press(close, 'ArrowRight');
            expect(document.activeElement).toBe(tabs[0]);
            press(tabs[0], 'ArrowLeft');
            expect(document.activeElement).toBe(close);
            for (const tab of [...tabs].reverse()) {
                press(document.activeElement as HTMLElement, 'ArrowLeft');
                expect(document.activeElement).toBe(tab);
            }
        },
    );

    it('switches sections from actions and the close button, returning focus to the selected tab', () => {
        const { tools, tabs, save, saved, undo, viewed } = mount();
        undo.focus();
        press(undo, 'ArrowRight');
        expect(document.activeElement).toBe(tabs[1]);
        save.focus();
        press(save, 'ArrowLeft');
        expect(document.activeElement).toBe(tabs[0]);
        expect(viewed).toHaveBeenCalledOnce();
        tabs[1].click();
        saved.focus();
        press(saved, 'ArrowRight');
        expect(document.activeElement).toBe(tabs[0]);
        const close = tools.querySelector<HTMLButtonElement>(
            '.ez-marking-tools__close',
        )!;
        close.focus();
        press(close, 'ArrowLeft');
        expect(document.activeElement).toBe(tabs[1]);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    });

    it('moves between a saved marking and its remove action, then into Corrections', () => {
        const { tools, tabs, saved, undo } = mount();
        const pair = document.createElement('div');
        pair.className = 'ez-favorites-panel__saved-row';
        saved.dataset.favoriteMarking = 'HIGH';
        saved.replaceWith(pair);
        const remove = document.createElement('button');
        remove.className = 'ez-favorites-panel__remove';
        remove.setAttribute('aria-label', 'Remove Favorite: HIGH');
        pair.append(saved, remove);
        tabs[1].click();
        saved.focus();
        press(saved, 'ArrowRight');
        expect(document.activeElement).toBe(remove);
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        press(remove, 'ArrowLeft');
        expect(document.activeElement).toBe(saved);
        press(saved, 'ArrowLeft');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(undo);
        undo.remove();
        tabs[1].click();
        saved.focus();
        press(saved, 'ArrowLeft');
        expect(document.activeElement).toBe(
            tools.querySelector('[role="tabpanel"]'),
        );
    });

    it('moves focus before hiding the outgoing panel, including an empty section', () => {
        const { tools, tabs, saved, undo } = mount();
        const panels = [
            ...tools.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
        ];
        const outgoingVisibility: boolean[] = [];
        for (const panel of panels)
            panel.addEventListener('focusout', () => {
                outgoingVisibility.push(!panel.hidden);
            });
        tabs[1].click();
        saved.focus();
        press(saved, 'ArrowRight');
        expect(document.activeElement).toBe(tabs[0]);
        expect(outgoingVisibility).toEqual([true]);
        undo.remove();
        panels[0].focus();
        press(panels[0], 'ArrowRight');
        expect(document.activeElement).toBe(tabs[1]);
        expect(outgoingVisibility).toEqual([true, true]);
    });

    it('counts only correction entries and exposes updated counts without changing tab names', () => {
        const { tools, tabs, undo } = mount();
        expect(tabs[0].getAttribute('aria-description')).toBe('0 entries');
        expect(tabs[1].getAttribute('aria-description')).toBe('0 entries');
        const change = document.createElement('li');
        change.className = 'ez-status-list__change';
        undo.parentElement!.append(change);
        updateMarkingToolsCounts(tools, 3);
        expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
            'Corrections',
            'Favorites',
        ]);
        expect(tabs.map((tab) => tab.getAttribute('aria-description'))).toEqual(
            ['1 entry', '3 entries'],
        );
        expect(
            tabs.map(
                (tab) =>
                    tab.querySelector('.ez-marking-tools__count')?.textContent,
            ),
        ).toEqual(['1', '3']);
        change.remove();
        updateMarkingToolsCounts(tools, 0);
        expect(tabs.map((tab) => tab.getAttribute('aria-description'))).toEqual(
            ['0 entries', '0 entries'],
        );
    });
});

describe('field tools shortcut', () => {
    it.each(['ctrlKey', 'metaKey'] as const)(
        'opens from a control with %s and prevents Enter from reaching its editor',
        (modifier) => {
            const root = document.createElement('div');
            const input = document.createElement('input');
            const mark = document.createElement('button');
            mark.className = 'ez-status-mark--tools';
            root.append(input, mark);
            document.body.append(root);
            const open = vi.fn();
            const commit = vi.fn();
            mark.addEventListener('click', open);
            input.addEventListener('keydown', commit);
            bindMarkingToolsShortcut(root);
            bindMarkingToolsShortcut(root);
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
                [modifier]: true,
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(event);
            expect(open).toHaveBeenCalledOnce();
            expect(commit).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(true);
            mark.remove();
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    shiftKey: true,
                    [modifier]: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
            expect(open).toHaveBeenCalledOnce();
            expect(commit).toHaveBeenCalledOnce();
        },
    );

    it('does not intercept other modifiers, composing input, or keys outside the control', () => {
        const root = document.createElement('div');
        root.innerHTML =
            '<input><button class="ez-status-mark--tools"></button>';
        const outside = document.createElement('input');
        document.body.append(root, outside);
        const open = vi.fn();
        root.querySelector('button')!.addEventListener('click', open);
        bindMarkingToolsShortcut(root);
        for (const options of [
            { ctrlKey: true },
            { shiftKey: true },
            { ctrlKey: true, shiftKey: true, altKey: true },
            { ctrlKey: true, shiftKey: true, isComposing: true },
        ]) {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
                ...options,
            });
            root.querySelector('input')!.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
        }
        outside.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
            }),
        );
        expect(open).not.toHaveBeenCalled();
    });

    it('routes nested controls to the nearest tools owner', () => {
        const outer = document.createElement('div');
        outer.innerHTML =
            '<button class="ez-status-mark--tools"></button><div><input><button class="ez-status-mark--tools"></button></div>';
        document.body.append(outer);
        const inner = outer.querySelector('div')!;
        const outerOpen = vi.fn();
        const innerOpen = vi.fn();
        outer.querySelector('button')!.addEventListener('click', outerOpen);
        inner.querySelector('button')!.addEventListener('click', innerOpen);
        bindMarkingToolsShortcut(outer);
        bindMarkingToolsShortcut(inner);
        inner.querySelector('input')!.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
            }),
        );
        expect(innerOpen).toHaveBeenCalledOnce();
        expect(outerOpen).not.toHaveBeenCalled();
    });
});

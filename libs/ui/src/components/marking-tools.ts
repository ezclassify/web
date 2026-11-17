/**
 * Tabbed field helpers. Favorites remain whole-marking actions, outside the
 * composer.
 */
import { t } from '../i18n';

/** Content supplied by a field to its branding popover. */
export interface MarkingToolsContent {
    /** Current error, applied changes, and available undo. */
    corrections: HTMLElement;
    /** Host favorites and scheme presets, when either is available. */
    favorites?: HTMLElement;
    /** Show unseen corrections before offering saved markings. */
    showCorrections: boolean;
    /** Acknowledge changes only when their section is actually visible. */
    onCorrectionsViewed: () => void;
    /** Reposition after changing sections. */
    onResize: () => void;
    /** Dismiss the popover and return focus to its branding button. */
    onClose: () => void;
    /** Continue the host form's tab order after the popover's final action. */
    onExit?: (backward: boolean) => void;
}

/** Build the popover's tabs, close button, and keyboard-navigable sections. */
export function buildMarkingTools(content: MarkingToolsContent): HTMLElement {
    const tools = document.createElement('div');
    tools.className = 'ez-marking-tools';
    // Pointer use must not blur and commit the field's draft mid-action.
    tools.addEventListener('mousedown', (event) => event.preventDefault());
    const header = document.createElement('div');
    header.className = 'ez-marking-tools__header';
    const tablist = document.createElement('div');
    tablist.className = 'ez-marking-tools__tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', t('tools.sections'));
    header.appendChild(tablist);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ez-marking-tools__close';
    close.setAttribute('aria-label', t('tools.close'));
    close.textContent = '×';
    close.addEventListener('click', content.onClose);
    header.appendChild(close);
    tools.appendChild(header);

    const sections = [
        { label: t('tools.corrections'), element: content.corrections },
        ...(content.favorites
            ? [{ label: t('aria.favorites'), element: content.favorites }]
            : []),
    ];
    const tabs: HTMLButtonElement[] = [];
    const panels: HTMLElement[] = [];
    const id = 'ez-tools-' + Math.random().toString(36).slice(2, 10);
    let selected = content.showCorrections || !content.favorites ? 0 : 1;
    const actions = (panel: HTMLElement) =>
        [
            ...panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
                'button, input',
            ),
        ].filter((button) => !button.disabled && !button.closest('[hidden]'));
    const select = (index: number, focus: boolean) => {
        selected = index;
        tabs.forEach((tab, i) => {
            tab.tabIndex = i === index ? 0 : -1;
            tab.setAttribute('aria-selected', String(i === index));
            panels[i].hidden = i !== index;
        });
        if (index === 0 && tools.isConnected) content.onCorrectionsViewed();
        if (focus) tabs[index].focus();
        if (tools.isConnected) content.onResize();
    };
    sections.forEach(({ label, element }, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'ez-marking-tools__tab';
        tab.id = `${id}-tab-${index}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `${id}-panel-${index}`);
        tab.textContent = label;
        const panel = document.createElement('div');
        panel.className = 'ez-marking-tools__section';
        panel.id = `${id}-panel-${index}`;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        panel.tabIndex = -1;
        panel.appendChild(element);
        tabs.push(tab);
        panels.push(panel);
        tablist.appendChild(tab);
        tools.appendChild(panel);
        tab.addEventListener('click', () => select(index, false));
        tab.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                (actions(panel)[0] ?? panel).focus();
                return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                return;
            event.preventDefault();
            const next =
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (index +
                            (event.key === 'ArrowRight' ? 1 : -1) +
                            tabs.length) %
                        tabs.length;
            select(next, true);
        });
        panel.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const rows = actions(panel);
            const current = rows.indexOf(
                event.target as HTMLButtonElement | HTMLInputElement,
            );
            if (current < 0 && event.target !== panel) return;
            event.preventDefault();
            if (event.key === 'ArrowUp' && current <= 0) tabs[selected].focus();
            else {
                const next = Math.min(
                    rows.length - 1,
                    current + (event.key === 'ArrowDown' ? 1 : -1),
                );
                rows[next]?.focus();
                rows[next]?.scrollIntoView({ block: 'nearest' });
            }
        });
    });
    select(selected, false);
    tools.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || !content.onExit) return;
        if (
            event.target === panels[selected] &&
            actions(panels[selected]).length === 0
        ) {
            event.preventDefault();
            if (event.shiftKey) close.focus();
            else content.onExit(false);
            return;
        }
        const controls = [
            ...tools.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
                'button, input',
            ),
        ].filter(
            (control) =>
                !control.disabled &&
                control.tabIndex >= 0 &&
                !control.closest('[hidden]'),
        );
        const edge = event.shiftKey
            ? controls[0]
            : controls[controls.length - 1];
        if (event.target !== edge) return;
        event.preventDefault();
        content.onExit(event.shiftKey);
    });
    return tools;
}

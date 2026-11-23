/**
 * Tabbed field helpers. Favorites remain whole-marking actions, outside the
 * composer.
 */
import { t } from '../i18n';

const shortcutRoots = new WeakSet<HTMLElement>();

/** Bind the field's tools shortcut without retaining a component instance. */
export function bindMarkingToolsShortcut(root: HTMLElement): void {
    if (shortcutRoots.has(root)) return;
    shortcutRoots.add(root);
    root.addEventListener(
        'keydown',
        (event) => {
            if (
                event.key !== 'Enter' ||
                !event.shiftKey ||
                event.altKey ||
                event.isComposing ||
                event.ctrlKey === event.metaKey
            )
                return;
            const owner = event
                .composedPath()
                .find(
                    (node) =>
                        node instanceof HTMLElement && shortcutRoots.has(node),
                );
            if (owner !== root) return;
            const mark = root.querySelector<HTMLButtonElement>(
                '.ez-status-mark--tools',
            );
            if (!mark || mark.disabled) return;
            event.preventDefault();
            event.stopPropagation();
            if (mark.getAttribute('aria-expanded') !== 'true') mark.click();
            focusMarkingTools(mark);
        },
        true,
    );
}

/** Focus the enabled remedy for an unresolved error, or the selected tab. */
export function focusMarkingTools(mark: HTMLElement): void {
    const doc = mark.ownerDocument;
    const popup = doc.getElementById(
        mark.getAttribute('aria-describedby') ?? '',
    );
    const target = popup?.querySelector<HTMLElement>(
        '.ez-marking-tools__target',
    );
    if (target) {
        target.focus({ preventScroll: true });
        return;
    }
    const tab = popup?.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
    );
    const panel = doc.getElementById(tab?.getAttribute('aria-controls') ?? '');
    const hasError = panel?.querySelector(
        '.ez-validation-errors__item:not(.ez-validation-errors__item--warning)',
    );
    const fix = hasError
        ? panel?.querySelector<HTMLElement>(
              '.ez-validation-errors__fix:not(:disabled)',
          )
        : null;
    (fix ?? tab)?.focus({ preventScroll: true });
}

/** Markings offered by a field that contains several independent entries. */
export interface MarkingToolsTargets {
    selected: string;
    options: readonly {
        value: string;
        label: string;
        disabled?: boolean;
        invalid?: boolean;
    }[];
    select: (value: string) => void;
}

/** Content supplied by a field to its branding popover. */
export interface MarkingToolsContent {
    /** Unresolved errors, warnings, and available remedies. */
    attention?: HTMLElement;
    preferAttention?: boolean;
    targets?: MarkingToolsTargets;
    /** Field-wide notice kept separate from the selected marking's findings. */
    fieldNotice?: string;
    /** Applied changes and available undo. */
    corrections: HTMLElement;
    /** Host favorites and scheme presets, when either is available. */
    favorites?: HTMLElement;
    /** Saved markings and scoped scheme presets, excluding helper actions. */
    favoritesCount?: number;
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

/**
 * Refresh tab badges from the displayed correction rows and available saved
 * markings.
 */
export function updateMarkingToolsCounts(
    tools: HTMLElement,
    favoritesCount: number,
): void {
    tools.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
        const panel = tools.querySelector(
            `[data-tools-panel="${tab.dataset.toolsTab}"]`,
        );
        const count =
            tab.dataset.toolsTab === 'favorites'
                ? favoritesCount
                : (panel?.querySelectorAll(
                      '.ez-status-list__change, .ez-status-list__error, .ez-validation-errors__item',
                  ).length ?? 0);
        const badge = tab.querySelector('.ez-marking-tools__count');
        if (badge) badge.textContent = String(count);
        tab.setAttribute(
            'aria-description',
            t(count === 1 ? 'tools.entryOne' : 'tools.entryMany').replace(
                '{count}',
                String(count),
            ),
        );
    });
}

/** Select an entry without moving the native editor's saved caret. */
function markingTargetSelector(
    targets: MarkingToolsTargets,
    id: string,
    focusTab: () => void,
) {
    const region = document.createElement('div');
    region.className = 'ez-marking-tools__target-region';
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'ez-marking-tools__target';
    target.setAttribute('role', 'combobox');
    target.setAttribute('aria-label', t('favorites.target'));
    target.setAttribute('aria-expanded', 'false');
    target.setAttribute('aria-controls', id + '-entries');
    const value = document.createElement('span');
    value.id = id + '-target-value';
    value.className = 'ez-marking-tools__target-value';
    target.setAttribute('aria-describedby', value.id);
    target.appendChild(value);
    const list = document.createElement('div');
    list.id = id + '-entries';
    list.className = 'ez-marking-tools__target-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('favorites.target'));
    list.hidden = true;
    let selected = targets.options.findIndex(
        ({ value }) => value === targets.selected,
    );
    let active = selected;
    const options = targets.options.map(
        ({ label, disabled, invalid }, index) => {
            const option = document.createElement('div');
            option.id = list.id + '-' + index;
            option.setAttribute('role', 'option');
            if (disabled) option.setAttribute('aria-disabled', 'true');
            if (invalid) {
                option.dataset.invalid = '';
                option.setAttribute(
                    'aria-description',
                    t('tools.unresolvedEntry'),
                );
            }
            option.textContent = label;
            option.addEventListener('click', () => choose(index));
            list.appendChild(option);
            return option;
        },
    );
    const showSelection = () => {
        value.textContent =
            targets.options[selected]?.label ?? t('favorites.chooseTarget');
        options.forEach((option, index) =>
            option.setAttribute('aria-selected', String(index === selected)),
        );
    };
    const activate = (index: number) => {
        active = Math.min(Math.max(index, 0), options.length - 1);
        options.forEach((option, key) =>
            option.toggleAttribute('data-active', key === active),
        );
        const option = options[active];
        target.setAttribute('aria-activedescendant', option.id);
        const bottom = option.offsetTop + option.offsetHeight;
        if (option.offsetTop < list.scrollTop)
            list.scrollTop = option.offsetTop;
        else if (bottom > list.scrollTop + list.clientHeight)
            list.scrollTop = bottom - list.clientHeight;
    };
    const setOpen = (open: boolean) => {
        if (
            list.hidden === !open ||
            (open && target.getAttribute('aria-disabled') === 'true')
        )
            return;
        list.hidden = !open;
        target.setAttribute('aria-expanded', String(open));
        if (open) activate(selected);
        else target.removeAttribute('aria-activedescendant');
    };
    function choose(index: number) {
        if (
            targets.options[index].disabled ||
            target.getAttribute('aria-disabled') === 'true'
        )
            return;
        const changed = selected !== index;
        selected = index;
        showSelection();
        setOpen(false);
        if (changed) targets.select(targets.options[selected].value);
    }
    target.addEventListener('click', () => setOpen(list.hidden));
    target.addEventListener('blur', () => setOpen(false));
    target.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
            return;
        const { key } = event;
        if (key === 'Enter' || key === ' ') {
            if (list.hidden) setOpen(true);
            else choose(active);
        } else if (key === 'ArrowDown' || key === 'ArrowUp') {
            if (!list.hidden) activate(active + (key === 'ArrowDown' ? 1 : -1));
            else if (key === 'ArrowDown') focusTab();
        } else if (key === 'Escape' && !list.hidden) {
            setOpen(false);
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    });
    showSelection();
    region.append(target);
    return { region, target, list };
}

/** Build the popover's tabs, close button, and keyboard-navigable sections. */
export function buildMarkingTools(content: MarkingToolsContent): HTMLElement {
    const tools = document.createElement('div');
    tools.className = 'ez-marking-tools';
    // Actions manage their own focus, without a transient container focus.
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
    if (content.fieldNotice !== undefined) {
        const notice = document.createElement('div');
        notice.className = 'ez-marking-tools__field-notice';
        notice.textContent = content.fieldNotice;
        header.appendChild(notice);
    }
    tools.appendChild(header);

    const sections = [
        ...(content.attention
            ? [
                  {
                      kind: 'attention',
                      label: t('tools.findings'),
                      element: content.attention,
                  },
              ]
            : []),
        {
            kind: 'corrections',
            label: t('tools.corrections'),
            element: content.corrections,
        },
        ...(content.favorites
            ? [
                  {
                      kind: 'favorites',
                      label: t('aria.favorites'),
                      element: content.favorites,
                  },
              ]
            : []),
    ];
    const tabs: HTMLButtonElement[] = [];
    const panels: HTMLElement[] = [];
    const id = 'ez-tools-' + Math.random().toString(36).slice(2, 10);
    let selected =
        content.attention && content.preferAttention !== false
            ? 0
            : content.showCorrections || !content.favorites
              ? sections.findIndex(({ kind }) => kind === 'corrections')
              : sections.length - 1;
    const selector =
        content.targets &&
        (content.targets.options.length > 1 || !content.targets.selected)
            ? markingTargetSelector(content.targets, id, () =>
                  tabs[selected].focus({ preventScroll: true }),
              )
            : undefined;
    if (selector) {
        tools.classList.add('ez-marking-tools--with-target');
        tools.prepend(selector.region, selector.list);
        close.addEventListener('keydown', (event) => {
            if (
                event.key !== 'ArrowUp' ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.isComposing
            )
                return;
            event.preventDefault();
            selector.target.focus({ preventScroll: true });
        });
    }
    const actions = (panel: HTMLElement) =>
        [
            ...panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
                'button, input, select',
            ),
        ].filter(
            (button) =>
                !button.disabled &&
                !button.closest('[hidden]') &&
                !button.classList.contains('ez-favorites-panel__remove'),
        );
    const select = (index: number, focus: boolean) => {
        const leavingPanel = panels.some(
            (panel, i) => i !== index && panel.contains(document.activeElement),
        );
        selected = index;
        tabs.forEach((tab, i) => {
            tab.tabIndex = i === index ? 0 : -1;
            tab.setAttribute('aria-selected', String(i === index));
        });
        // Keep outgoing focus in the visible tools domain until the next
        // target owns it. Hiding a focused panel first can commit a held draft.
        if (focus || leavingPanel) tabs[index].focus({ preventScroll: true });
        panels.forEach((panel, i) => {
            panel.hidden = i !== index;
        });
        if (sections[index].kind === 'corrections' && tools.isConnected)
            content.onCorrectionsViewed();
        if (tools.isConnected) content.onResize();
    };
    sections.forEach(({ kind, label, element }, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'ez-marking-tools__tab';
        tab.id = `${id}-tab-${index}`;
        tab.setAttribute('role', 'tab');
        tab.dataset.toolsTab = kind;
        tab.setAttribute('aria-label', label);
        tab.setAttribute('aria-controls', `${id}-panel-${index}`);
        tab.textContent = label;
        const count = document.createElement('span');
        count.className = 'ez-marking-tools__count';
        count.setAttribute('aria-hidden', 'true');
        tab.appendChild(count);
        const panel = document.createElement('div');
        panel.className = 'ez-marking-tools__section';
        panel.id = `${id}-panel-${index}`;
        panel.setAttribute('role', 'tabpanel');
        panel.dataset.toolsPanel = kind;
        panel.setAttribute('aria-labelledby', tab.id);
        panel.tabIndex = -1;
        panel.appendChild(element);
        tabs.push(tab);
        panels.push(panel);
        tablist.appendChild(tab);
        tools.appendChild(panel);
        tab.addEventListener('click', () => select(index, true));
        tab.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowUp') {
                if (
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.isComposing
                )
                    return;
                event.preventDefault();
                event.stopPropagation();
                if (selector) selector.target.focus({ preventScroll: true });
                else content.onClose();
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                (actions(panel)[0] ?? panel).focus();
                return;
            }
            if (event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : tabs.length - 1;
            select(next, true);
        });
        panel.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const rows = actions(panel);
            const target = event.target as HTMLElement;
            const current = rows.indexOf(
                (target.classList.contains('ez-favorites-panel__remove')
                    ? target.parentElement?.querySelector(
                          '[data-favorite-marking]',
                      )
                    : target) as HTMLButtonElement | HTMLInputElement,
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
                rows[next]?.scrollIntoView?.({ block: 'nearest' });
            }
        });
    });
    select(selected, false);
    updateMarkingToolsCounts(tools, content.favoritesCount ?? 0);
    tools.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            if (
                event.target === selector?.target ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.isComposing
            )
                return;
            event.preventDefault();
            event.stopPropagation();
            const control =
                event.target instanceof Element
                    ? event.target.closest<HTMLElement>('button, input')
                    : null;
            const favorite = control?.matches('[data-favorite-marking]')
                ? control
                : null;
            const removal = control?.matches('.ez-favorites-panel__remove')
                ? control
                : null;
            if (favorite && event.key === 'ArrowLeft') {
                const previous = selected - 1;
                select(previous, false);
                (actions(panels[previous])[0] ?? panels[previous]).focus();
                return;
            }
            if (favorite && event.key === 'ArrowRight') {
                const paired = favorite
                    .closest('.ez-favorites-panel__saved-row')
                    ?.querySelector<HTMLButtonElement>(
                        '.ez-favorites-panel__remove',
                    );
                if (paired && !paired.disabled) {
                    paired.focus();
                    return;
                }
            }
            if (removal && event.key === 'ArrowLeft') {
                const paired = removal
                    .closest('.ez-favorites-panel__saved-row')
                    ?.querySelector<HTMLButtonElement>(
                        '[data-favorite-marking]',
                    );
                if (paired && !paired.disabled) {
                    paired.focus();
                    return;
                }
            }
            const headerIndex =
                control === close
                    ? tabs.length
                    : tabs.indexOf(control as HTMLButtonElement);
            if (headerIndex >= 0) {
                const next =
                    (headerIndex +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        tabs.length +
                        1) %
                    (tabs.length + 1);
                if (next === tabs.length) close.focus();
                else select(next, true);
                return;
            }
            select(
                (selected +
                    (event.key === 'ArrowRight' ? 1 : -1) +
                    tabs.length) %
                    tabs.length,
                true,
            );
            return;
        }
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
                'button, input, select',
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

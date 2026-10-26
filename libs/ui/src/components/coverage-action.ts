import type { CoverageReport } from '@ezclassify/types';
import type { FormsContext } from '../forms/types';
import { adoptStylesOnce } from '../styles/adopt';
import coverageActionCss from './coverage-action.css?inline';

interface CoverageActionState {
    required: string;
    current: string;
    groupId: string;
    signature: string;
}

const states = new WeakMap<HTMLElement, CoverageActionState>();
const mounts = new WeakMap<HTMLElement, HTMLElement>();

function glyph(): string {
    return (
        '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
        '<rect x="1" y="3" width="9" height="2" rx="1" fill="currentColor"/>' +
        '<rect x="1" y="7" width="11" height="2" rx="1" fill="currentColor"/>' +
        '<rect x="1" y="11" width="7" height="2" rx="1" fill="currentColor"/>' +
        '<path class="ez-coverage-action__spark" d="M13 1.2 L13.8 3.2 L15.8 4 L13.8 4.8 L13 6.8 L12.2 4.8 L10.2 4 L12.2 3.2 Z"/>' +
        '</svg>'
    );
}

/**
 * One rollup pass's lookup of authorable wholes and coverage-owning fields.
 * Component, autocomplete, then plain-field order matches the former scans.
 */
export interface CoverageTargetIndex {
    /**
     * First authorable field matching this id or parent in component-first
     * order.
     */
    writable(wholeId: string, parent: HTMLElement): HTMLElement | null;
    /** Whether an enhanced field judges this whole against its parts. */
    owns(wholeId: string, parent: HTMLElement): boolean;
    /** Whether a component or autocomplete can author this named whole. */
    hasInteractiveAuthor(wholeId: string): boolean;
}

/** Index coverage targets once for one partition pass. */
export function indexCoverageTargets(ctx: FormsContext): CoverageTargetIndex {
    type Target = { el: HTMLElement; order: number };
    const writableByName = new Map<string, Target>();
    const writableByElement = new Map<HTMLElement, Target>();
    const ownerNames = new Set<string>();
    const ownerElements = new Set<HTMLElement>();
    const interactiveNames = new Set<string>();
    let order = 0;

    const add = (
        el: HTMLElement,
        authorable: boolean,
        ownsCoverage: boolean,
        interactive: boolean,
    ) => {
        const id = el.id;
        const boundTo = el.getAttribute('data-ezclassify-bound-to');
        const names =
            id && boundTo && id !== boundTo ? [id, boundTo] : [id || boundTo];
        if (authorable) {
            const target = { el, order };
            if (!writableByElement.has(el)) writableByElement.set(el, target);
            for (const name of names) {
                if (name && !writableByName.has(name))
                    writableByName.set(name, target);
            }
            if (interactive) {
                for (const name of names) {
                    if (name) interactiveNames.add(name);
                }
            }
        }
        if (ownsCoverage) {
            ownerElements.add(el);
            for (const name of names) {
                if (name) ownerNames.add(name);
            }
        }
        order++;
    };

    for (const [el, component] of ctx.mounted) {
        add(
            el,
            component.authorsWhole !== false,
            !!component.coversParts,
            true,
        );
    }
    for (const [el, component] of ctx.autocompleters) {
        add(
            el,
            true,
            !!component.coversParts,
            ctx.mounted.get(el)?.authorsWhole !== false,
        );
    }
    for (const field of ctx.fields) add(field, true, false, false);

    return {
        writable(wholeId, parent) {
            const byName = writableByName.get(wholeId);
            const byElement = writableByElement.get(parent);
            if (!byName) return byElement?.el ?? null;
            if (!byElement || byName.order < byElement.order) return byName.el;
            return byElement.el;
        },
        owns: (wholeId, parent) =>
            ownerElements.has(parent) || ownerNames.has(wholeId),
        hasInteractiveAuthor: (wholeId) => interactiveNames.has(wholeId),
    };
}

/**
 * Take a whole's correction action out, if one was mounted, for a whole whose
 * field now reports coverage itself.
 */
export function removeCoverageAction(writable: HTMLElement | null): void {
    if (!writable) return;
    const root = mounts.get(writable);
    if (!root) return;
    states.delete(root);
    root.remove();
    mounts.delete(writable);
}

function writableComponent(ctx: FormsContext, el: HTMLElement) {
    return (
        ctx.mounted.get(el) ?? ctx.autocompleters.get(el as HTMLInputElement)
    );
}

function mount(
    ctx: FormsContext,
    writable: HTMLElement,
    wholeId: string,
): HTMLElement {
    const mounted = mounts.get(writable);
    if (mounted?.isConnected) return mounted;

    const visual =
        writable.closest<HTMLElement>(
            '.marking-field-wrap, .marked-input-wrap, .marked-textarea-wrap',
        ) ??
        (writable.nextElementSibling?.hasAttribute('data-ezclassify-mount')
            ? (writable.nextElementSibling as HTMLElement)
            : writable);
    const existing = visual.parentElement?.querySelector<HTMLElement>(
        `:scope > .ez-coverage-action[data-ezclassify-for="${wholeId}"]`,
    );
    if (existing) {
        mounts.set(writable, existing);
        return existing;
    }

    adoptStylesOnce(coverageActionCss, ctx.root);
    const root = writable.ownerDocument.createElement('span');
    root.className = 'ez-coverage-action ez-coverage-action--quiet';
    root.dataset.ezclassifyFor = wholeId;
    root.setAttribute('data-ezclassify', '');

    const trigger = writable.ownerDocument.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ez-coverage-action__trigger';
    trigger.setAttribute('aria-label', 'Overall marking covers all parts');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML =
        glyph() +
        '<span class="ez-coverage-action__dot" aria-hidden="true"></span>';

    const popover = writable.ownerDocument.createElement('span');
    popover.className = 'ez-coverage-action__popover';
    popover.hidden = true;
    popover.setAttribute('role', 'status');

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = popover.hidden;
        popover.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        if (open && states.has(root)) {
            root.classList.remove('ez-coverage-action--unseen');
            root.classList.add('ez-coverage-action--seen');
        }
    });
    root.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
    });

    root.append(trigger, popover);
    visual.insertAdjacentElement('afterend', root);
    mounts.set(writable, root);
    return root;
}

async function apply(
    ctx: FormsContext,
    writable: HTMLElement,
    root: HTMLElement,
): Promise<void> {
    const state = states.get(root);
    if (!state) return;
    const component = writableComponent(ctx, writable);
    if (component) {
        await Promise.resolve(component.setValue(state.required));
    } else if (/^(INPUT|TEXTAREA|SELECT)$/.test(writable.tagName)) {
        const field = writable as HTMLInputElement;
        field.value = state.required;
        field.dispatchEvent(
            new field.ownerDocument.defaultView!.Event('input', {
                bubbles: true,
            }),
        );
        field.dispatchEvent(
            new field.ownerDocument.defaultView!.Event('change', {
                bubbles: true,
            }),
        );
    }
    writable.dispatchEvent(
        new writable.ownerDocument.defaultView!.CustomEvent(
            'ezclassify:coverage-applied',
            {
                bubbles: true,
                detail: {
                    groupId: state.groupId,
                    previous: state.current,
                    applied: state.required,
                },
            },
        ),
    );
}

/**
 * Say why the declared overall does not cover its parts: what it is missing,
 * what it carries beyond what the parts allow, or, when the engine named
 * neither, the marking the parts require.
 */
function coverageText(report: CoverageReport): string {
    const reasons: string[] = [];
    if (report.missingLabels.length > 0) {
        reasons.push(`is missing ${report.missingLabels.join(', ')}`);
    }
    if (report.excessLabels.length > 0) {
        reasons.push(
            `carries ${report.excessLabels.join(', ')} beyond what the parts allow`,
        );
    }
    return reasons.length > 0
        ? `The declared overall does not cover the parts. It ${reasons.join(' and ')}.`
        : `The declared overall does not cover the parts. The required marking is ${report.rendered}.`;
}

/**
 * Synchronize the reusable authored-whole correction affordance for one parts
 * group.
 *
 * @param ctx - Owning forms runtime
 * @param groupId - Whole marking id named by the contributing parts
 * @param writable - Authorable whole field resolved by the partition index
 * @param current - Current authored whole marking
 * @param report - Engine coverage result for the parts against that whole
 */
export function syncCoverageAction(
    ctx: FormsContext,
    groupId: string,
    writable: HTMLElement | null,
    current: string,
    report: CoverageReport | null,
): void {
    if (!writable) return;
    const root = mount(ctx, writable, groupId);
    const trigger = root.querySelector<HTMLButtonElement>(
        '.ez-coverage-action__trigger',
    )!;
    const popover = root.querySelector<HTMLElement>(
        '.ez-coverage-action__popover',
    )!;

    if (!report || report.covered || !report.rendered) {
        states.delete(root);
        root.className = 'ez-coverage-action ez-coverage-action--quiet';
        trigger.setAttribute('aria-label', 'Overall marking covers all parts');
        popover.hidden = true;
        popover.replaceChildren(
            Object.assign(writable.ownerDocument.createElement('span'), {
                className: 'ez-coverage-action__text',
                textContent: 'The declared overall covers every part.',
            }),
        );
        return;
    }

    const signature = `${current}\u001f${report.rendered}\u001f${report.missingLabels.join('\u001f')}`;
    const previous = states.get(root);
    states.set(root, {
        required: report.rendered,
        current,
        groupId,
        signature,
    });
    root.className =
        previous?.signature === signature &&
        root.classList.contains('ez-coverage-action--seen')
            ? 'ez-coverage-action ez-coverage-action--seen'
            : 'ez-coverage-action ez-coverage-action--unseen';
    trigger.setAttribute(
        'aria-label',
        'Overall marking does not cover all parts; review suggested correction',
    );

    const text = writable.ownerDocument.createElement('span');
    text.className = 'ez-coverage-action__text';
    text.textContent = coverageText(report);
    const source = writable.ownerDocument.createElement('span');
    source.className = 'ez-coverage-action__source';
    source.textContent = 'whole-over-parts coverage';
    const button = writable.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'ez-coverage-action__apply';
    button.textContent = 'Apply the required marking';
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void apply(ctx, writable, root);
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    });
    popover.replaceChildren(text, source, button);
}

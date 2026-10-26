/**
 * AccessHandbook Component
 *
 * A browsable reference panel that displays the authorization rules from the
 * loaded access policy, grouped into "always-applied" (unconditional) and
 * "conditional" (fired only when the marking contains certain concepts). For
 * each rule it shows the plain-English requirement, the conditional trigger
 * when present, and the user attributes the engine will inspect.
 *
 * Collapses by default. A search input filters rules across both groups by
 * name, requirement text, and attribute names.
 *
 * When no access engine is bound to the Context, renders an empty-state message
 * instead of throwing.
 */

import type {
    AccessRuleDescription,
    AccessEngineAdapter,
    ReferenceSurfaceLabel,
} from '@ezclassify/types';
import {
    ReadOnlyComponentBase,
    type ComponentEngineSource,
    type ComponentOptions,
} from './component-base-readonly';
import {
    buildSearchInput,
    announceMatchCount,
    resolveReferenceSurfaceOverride,
} from './browser-component-base';
import accessHandbookCss from './access-handbook.css?inline';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Local `AccessEngine` instances expose a resolved `referenceSurfaceLabel`
 * getter (the access policy's own word for its Access Handbook) beyond what the
 * public `AccessEngineAdapter` contract declares, and remote adapters do not
 * carry it. Read it defensively rather than widening the shared interface for a
 * field only the local engine populates.
 */
type AccessEngineWithSurfaceLabel = AccessEngineAdapter & {
    referenceSurfaceLabel?: ReferenceSurfaceLabel;
};

/** Options specific to the AccessHandbook component. */
export interface AccessHandbookOptions extends ComponentOptions {
    /** If true, all groups start expanded (default: false). */
    expandAll?: boolean;
}

/** A labeled group of rules rendered as one collapsible section. */
interface RuleGroup {
    id: string;
    label: string;
    rules: AccessRuleDescription[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Case-insensitive substring match over the user-visible fields of a rule. */
function matchesFilter(rule: AccessRuleDescription, lower: string): boolean {
    if (rule.name.toLowerCase().includes(lower)) return true;
    if (rule.requirementText.toLowerCase().includes(lower)) return true;
    if (rule.description?.toLowerCase().includes(lower)) return true;
    if (rule.whenText?.toLowerCase().includes(lower)) return true;
    for (const attr of rule.attributesNeeded) {
        if (attr.toLowerCase().includes(lower)) return true;
    }
    return false;
}

/**
 * Split rules into logical groups.
 *
 * Rules with no `whenText` are always evaluated: they express baseline access
 * requirements regardless of what a document contains. Rules with `whenText`
 * are conditional; they fire only when the document matches a particular
 * concept or category predicate. This split maps directly to how an operator
 * would reason about the policy: "what do I always need?" vs "what extra rules
 * kick in for restricted content?"
 */
function buildGroups(rules: AccessRuleDescription[]): RuleGroup[] {
    const always: AccessRuleDescription[] = [];
    const conditional: AccessRuleDescription[] = [];

    for (const rule of rules) {
        if (rule.whenText) {
            conditional.push(rule);
        } else {
            always.push(rule);
        }
    }

    const groups: RuleGroup[] = [];
    if (always.length > 0) {
        groups.push({ id: 'always', label: 'Always evaluated', rules: always });
    }
    if (conditional.length > 0) {
        groups.push({
            id: 'conditional',
            label: 'Conditional',
            rules: conditional,
        });
    }
    return groups;
}

// ── Component ──────────────────────────────────────────────────────────────

const ACCESS_HANDBOOK_CSS: string = accessHandbookCss;
const ROOT_CLASS = 'ez-access-handbook';

/**
 * Browsable reference panel showing access rules with requirements and user
 * attributes needed.
 */
export class AccessHandbook extends ReadOnlyComponentBase {
    /**
     * Mount the component.
     *
     * Narrows the inherited signature to {@link AccessHandbookOptions} so a
     * caller can pass this component's own options without widening them to the
     * shared shape first.
     *
     * @param container - Element to render into
     * @param engineOrContext - Scheme adapter or composed context; resolved
     *   from the container when omitted
     * @param options - This component's options
     */
    override async init(
        container: HTMLDivElement,
        engineOrContext?: ComponentEngineSource | null,
        options?: AccessHandbookOptions,
    ): Promise<void> {
        await super.init(container, engineOrContext, options);
    }

    private groups: RuleGroup[] = [];
    private expanded = new Set<string>();
    private body!: HTMLDivElement;
    private searchInputEl!: HTMLInputElement;
    private announcer!: HTMLElement;
    /** Live DOM group sections keyed by group id, for targeted filter updates. */
    private groupSections = new Map<string, HTMLElement>();
    private ruleByEntry = new WeakMap<HTMLElement, AccessRuleDescription>();
    /** Set by {@link destroy}; guards the async panel build against a teardown. */
    private _destroyed = false;

    protected setup(): void {
        this.injectComponentStyles(ACCESS_HANDBOOK_CSS);

        const accessEngine = this.context?.access ?? null;

        if (!accessEngine) {
            const empty = document.createElement('div');
            empty.className = `${ROOT_CLASS}__empty`;
            empty.setAttribute('role', 'status');
            empty.textContent = 'No access policy loaded for this context.';
            this.container.appendChild(empty);
            return;
        }

        // This component shows every rule in the loaded policy, unconditionally.
        // It is a static reference panel, like a printed handbook, not a
        // marking-aware advisor. Operators read the full ruleset; the "Conditional"
        // group label already tells them which rules have prerequisites. No
        // doc-marking store subscription belongs here; a per-marking filter
        // would need an access-engine method that describes the rules
        // applicable to one marking.
        //
        // The rule list is the only thing this panel waits on, and it may be a
        // promise: an in-process policy answers immediately, a policy behind a
        // runtime answers over the wire. Resolve it, then build. A rejection
        // gets its own visible state: an authorization panel that renders as an
        // empty region on a failed fetch reads as "no rules apply", which is
        // the opposite of the truth.
        void Promise.resolve(accessEngine.describeAllAccessRules()).then(
            (allRules) => this.buildPanel(accessEngine, allRules),
            (error: unknown) => this.buildUnavailable(error),
        );
    }

    /**
     * Paint the failure state for a rule list that never arrived. Worded and
     * classed apart from the two empty states on purpose: "this policy has no
     * rules" and "we could not read this policy" are different facts, and an
     * operator deciding whether they may handle a document needs to know which
     * one they are looking at.
     */
    private buildUnavailable(error: unknown): void {
        if (this._destroyed) return;

        console.error(
            '[AccessHandbook] could not load the access rule list:',
            error,
        );

        const failed = document.createElement('div');
        failed.className = `${ROOT_CLASS}__error`;
        failed.setAttribute('role', 'alert');
        failed.textContent =
            'Access policy unavailable. The rules could not be loaded, so this is not a complete list of what applies.';
        this.container.appendChild(failed);
    }

    /**
     * Build the panel once the rule list has resolved. Split out of
     * {@link setup} because the list arrives asynchronously against a remote
     * policy, and `setup` is synchronous by contract.
     */
    private buildPanel(
        accessEngine: AccessEngineAdapter,
        allRules: AccessRuleDescription[],
    ): void {
        // A remote policy can answer after the host has already torn the panel
        // down; building into a destroyed container would resurrect it.
        if (this._destroyed) return;

        if (allRules.length === 0) {
            const empty = document.createElement('div');
            empty.className = `${ROOT_CLASS}__empty`;
            empty.setAttribute('role', 'status');
            empty.textContent = 'This access policy defines no rules.';
            this.container.appendChild(empty);
            return;
        }

        this.groups = buildGroups(allRules);
        const opts = this.options as AccessHandbookOptions;

        if (opts.expandAll) {
            for (const g of this.groups) this.expanded.add(g.id);
        }

        // Reference-surface noun: the access policy's own word for its
        // Access Handbook (e.g. "Front Desk Clearance Guide"), or `undefined`
        // when it declares none; see resolveReferenceSurfaceOverride's doc
        // comment for why that case leaves the hardcoded string below alone.
        const surfaceOverride = resolveReferenceSurfaceOverride(
            (accessEngine as AccessEngineWithSurfaceLabel)
                .referenceSurfaceLabel,
            'accessHandbook',
        );

        const root = document.createElement('div');
        root.className = ROOT_CLASS;
        root.setAttribute('role', 'region');
        root.setAttribute(
            'aria-label',
            surfaceOverride ? surfaceOverride.singular : 'Access handbook',
        );

        // Overview strip showing policy name + rule count
        const overview = this.buildOverview(accessEngine, allRules.length);
        root.appendChild(overview);

        // Search
        const { wrap, input, announcer } = buildSearchInput({
            rootClass: ROOT_CLASS,
            placeholder: 'Search rules…',
            ariaLabel: surfaceOverride
                ? `Search ${surfaceOverride.singular} rules`
                : 'Search access rules',
            onInput: (q) => this.onSearch(q),
        });
        this.searchInputEl = input;
        this.announcer = announcer;
        root.appendChild(wrap);

        // Body
        this.body = document.createElement('div');
        this.body.className = `${ROOT_CLASS}__body`;
        this.body.setAttribute('role', 'list');
        root.appendChild(this.body);

        this.container.appendChild(root);
        this.render();
    }

    destroy(): void {
        this.removeRuleErrors();
        this._destroyed = true;
        this.ruleByEntry = new WeakMap();
        this.container.innerHTML = '';
    }

    protected render(): void {
        this.body.innerHTML = '';
        this.groupSections.clear();
        this.ruleByEntry = new WeakMap();

        for (const group of this.groups) {
            const open = this.expanded.has(group.id);
            const section = document.createElement('div');
            section.className = `${ROOT_CLASS}__group`;
            section.setAttribute('role', 'listitem');
            section.dataset.groupId = group.id;

            // Group header button
            const header = document.createElement('button');
            header.type = 'button';
            header.className = `${ROOT_CLASS}__group-header`;
            header.setAttribute('aria-expanded', String(open));
            header.setAttribute(
                'aria-controls',
                `${ROOT_CLASS}-body-${group.id}`,
            );

            const arrow = document.createElement('span');
            arrow.className = `${ROOT_CLASS}__group-arrow`;
            arrow.setAttribute('aria-hidden', 'true');
            arrow.textContent = open ? '▼' : '▶';

            const labelEl = document.createElement('span');
            labelEl.textContent = group.label;

            const countEl = document.createElement('span');
            countEl.className = `${ROOT_CLASS}__group-count`;
            countEl.textContent = `(${group.rules.length})`;

            header.append(arrow, labelEl, countEl);
            header.addEventListener('click', () => this.toggleGroup(group.id));
            section.appendChild(header);

            // Group body
            const bodyEl = document.createElement('div');
            bodyEl.className = `${ROOT_CLASS}__group-body`;
            bodyEl.id = `${ROOT_CLASS}-body-${group.id}`;
            if (!open)
                bodyEl.classList.add(`${ROOT_CLASS}__group-body--collapsed`);

            for (const rule of group.rules) {
                bodyEl.appendChild(this.renderEntry(rule));
            }
            section.appendChild(bodyEl);

            this.body.appendChild(section);
            this.groupSections.set(group.id, section);
        }
    }

    private toggleGroup(groupId: string): void {
        if (this.expanded.has(groupId)) this.expanded.delete(groupId);
        else this.expanded.add(groupId);

        // Surgical in-place update: toggle CSS class + ARIA attributes on the existing
        // section elements without rebuilding the DOM. A full innerHTML rebuild would
        // destroy the focused header button and eject the keyboard user to document.body.
        const open = this.expanded.has(groupId);
        const section = this.groupSections.get(groupId);
        if (section) {
            const header = section.querySelector<HTMLButtonElement>(
                `.${ROOT_CLASS}__group-header`,
            );
            const arrow = section.querySelector<HTMLElement>(
                `.${ROOT_CLASS}__group-arrow`,
            );
            const bodyEl = section.querySelector<HTMLElement>(
                `.${ROOT_CLASS}__group-body`,
            );
            if (header) header.setAttribute('aria-expanded', String(open));
            if (arrow) arrow.textContent = open ? '▼' : '▶';
            if (bodyEl)
                bodyEl.classList.toggle(
                    `${ROOT_CLASS}__group-body--collapsed`,
                    !open,
                );
        }

        // Re-apply any active search so filter state survives the toggle.
        const q = this.searchInputEl.value.trim();
        if (q) this.onSearch(q);
    }

    /** Filter rule entries inside each group without rebuilding the full tree. */
    private onSearch(query: string): void {
        const lower = query.toLowerCase();
        const active = lower.length > 0;
        let totalVisible = 0;

        for (const [groupId, section] of this.groupSections) {
            const bodyEl = section.querySelector<HTMLElement>(
                `.${ROOT_CLASS}__group-body`,
            );
            const headerEl = section.querySelector<HTMLButtonElement>(
                `.${ROOT_CLASS}__group-header`,
            );
            const arrowEl = section.querySelector<HTMLElement>(
                `.${ROOT_CLASS}__group-arrow`,
            );

            if (!bodyEl) continue;

            let groupVisible = 0;

            const entries = bodyEl.querySelectorAll<HTMLElement>(
                `.${ROOT_CLASS}__entry`,
            );
            for (const entry of entries) {
                const rule = this.ruleByEntry.get(entry);
                if (!rule) continue;

                const visible = !active || matchesFilter(rule, lower);
                entry.classList.toggle(
                    `${ROOT_CLASS}__entry--hidden`,
                    !visible,
                );
                if (visible) groupVisible++;
            }

            totalVisible += groupVisible;

            if (active) {
                // Hide group completely when no rules survive the filter.
                section.classList.toggle(
                    `${ROOT_CLASS}__group--hidden`,
                    groupVisible === 0,
                );
                // Auto-expand groups that have visible hits.
                if (groupVisible > 0 && !this.expanded.has(groupId)) {
                    this.expanded.add(groupId);
                    bodyEl.classList.remove(
                        `${ROOT_CLASS}__group-body--collapsed`,
                    );
                    headerEl?.setAttribute('aria-expanded', 'true');
                    if (arrowEl) arrowEl.textContent = '▼';
                }
            } else {
                section.classList.remove(`${ROOT_CLASS}__group--hidden`);
            }
        }

        announceMatchCount(this.announcer, totalVisible, query, 'rule');
    }

    private renderEntry(rule: AccessRuleDescription): HTMLElement {
        const el = document.createElement('div');
        el.className = `${ROOT_CLASS}__entry`;
        this.ruleByEntry.set(el, rule);
        el.setAttribute('role', 'article');
        el.setAttribute('aria-label', rule.name);

        const nameEl = document.createElement('div');
        nameEl.className = `${ROOT_CLASS}__entry-name`;
        nameEl.textContent = rule.name;
        el.appendChild(nameEl);

        if (rule.requirementText) {
            const reqLabel = document.createElement('div');
            reqLabel.className = `${ROOT_CLASS}__section-label`;
            reqLabel.textContent = 'Requirement';
            el.appendChild(reqLabel);
            const reqText = document.createElement('div');
            reqText.className = `${ROOT_CLASS}__section-text`;
            reqText.textContent = rule.requirementText;
            el.appendChild(reqText);
        }

        if (rule.whenText) {
            const whenLabel = document.createElement('div');
            whenLabel.className = `${ROOT_CLASS}__section-label`;
            whenLabel.textContent = 'When';
            el.appendChild(whenLabel);
            const whenText = document.createElement('div');
            whenText.className = `${ROOT_CLASS}__section-text`;
            whenText.textContent = rule.whenText;
            el.appendChild(whenText);
        }

        if (rule.attributesNeeded.length > 0) {
            const attrLabel = document.createElement('div');
            attrLabel.className = `${ROOT_CLASS}__section-label`;
            attrLabel.textContent = 'User attributes checked';
            el.appendChild(attrLabel);
            const attrList = document.createElement('div');
            attrList.className = `${ROOT_CLASS}__attributes`;
            for (const attr of rule.attributesNeeded) {
                const chip = document.createElement('span');
                chip.className = `${ROOT_CLASS}__attribute`;
                chip.textContent = attr;
                attrList.appendChild(chip);
            }
            el.appendChild(attrList);
        }

        return el;
    }

    private buildOverview(
        accessEngine: AccessEngineAdapter,
        ruleCount: number,
    ): HTMLElement {
        const el = document.createElement('div');
        el.className = `${ROOT_CLASS}__overview`;

        const name = document.createElement('div');
        name.className = `${ROOT_CLASS}__overview-name`;
        name.textContent = 'Access policy';
        el.appendChild(name);

        const meta = document.createElement('div');
        meta.className = `${ROOT_CLASS}__overview-meta`;
        const parts: string[] = [];
        if (accessEngine.schemeId)
            parts.push(`scheme: ${accessEngine.schemeId}`);
        parts.push(`${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`);
        meta.textContent = parts.join(' · ');
        el.appendChild(meta);

        return el;
    }
}

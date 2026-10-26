import type { ConceptView } from '@ezclassify/types';
import type { FormsContext } from './forms/types';
import { escHtml, getFormat } from './forms/state';
import { getControllerStyles } from './forms/styles';
import {
    copyOverlayTheme,
    portalViewportOverlay,
} from './components/overlay-portal';
import type { AdoptedStyles } from './styles/adopt';

const tooltipPortalStyles = new WeakMap<HTMLElement, AdoptedStyles>();

/**
 * Display a floating tooltip near the cursor showing concept metadata (name,
 * views, categories, flags).
 *
 * This is separate from components/tooltip-manager.ts and cannot delegate to it
 * because:
 *
 * 1. Content model: This tooltip uses innerHTML with formatted HTML (bold concept
 *    name, view/category/parent/flag lists). The component tooltip-manager
 *    parses plain-text lines into structured sections (Description:, Rules:,
 *    Usage:). The content pipelines are incompatible without an HTML-vs-text
 *    abstraction that would add complexity with no benefit.
 * 2. Positioning: This tooltip positions at fixed mouse coordinates
 *    (clientX/clientY offset). The component tooltip-manager positions relative
 *    to a target element's bounding rect with viewport-aware flipping. The
 *    positioning strategies are different by design.
 * 3. Lifecycle: This tooltip is stored as ctx.tooltipEl (one per FormsContext,
 *    created/destroyed on hover). The component tooltip-manager uses a per-root
 *    WeakMap with persistent tooltip elements, Escape key dismissal, and
 *    hover-delay/polling for async content.
 */
export async function showConceptTooltip(
    ctx: FormsContext,
    field: HTMLInputElement,
    conceptId: string,
    x: number,
    y: number,
): Promise<void> {
    hideConceptTooltip(ctx);
    const allCategories = ctx.engine.listCategories();
    // One walk of the categories, indexed by concept id, instead of one walk to
    // find the hovered concept and another for each of its parents. Built per
    // hover so a live-edited scheme is always read fresh.
    const conceptsById = new Map<string, ConceptView>();
    for (const cat of allCategories) {
        for (const c of ctx.engine.getConceptsInCategory(cat.id)) {
            if (!conceptsById.has(c.id)) conceptsById.set(c.id, c);
        }
    }
    const concept = conceptsById.get(conceptId);
    if (!concept) return;

    const tip = document.createElement('div');
    tip.className = 'ez-concept-tooltip';

    const lines: string[] = [`<b>${escHtml(concept.name)}</b>`];
    const views = Object.entries(concept.views)
        .map(([k, v]) => `${escHtml(k)}: ${escHtml(v as string)}`)
        .join(', ');
    if (views) lines.push(`Views: ${views}`);
    if (concept.categories.length > 0) {
        const names = concept.categories.map(
            (fid) => allCategories.find((f) => f.id === fid)?.label ?? fid,
        );
        lines.push(`Categories: ${names.map((n) => escHtml(n)).join(', ')}`);
    }
    if (concept.parents.length > 0) {
        const names = concept.parents.map(
            (pid) => conceptsById.get(pid)?.name ?? pid,
        );
        lines.push(`Parents: ${names.map((n) => escHtml(n)).join(', ')}`);
    }
    const tags: string[] = [];
    if (concept.deprecated) tags.push('deprecated');
    // Only the assertion's source is wanted here, and an empty marking has no
    // assertions to read it from: skip the call rather than pay a round trip
    // under a remote engine to be told so.
    const validated = ctx.lastValidated.get(field) ?? '';
    if (validated) {
        const result = await Promise.resolve(
            ctx.engine.process(validated, {
                outputFormat: getFormat(ctx, field),
            }),
        );
        const assertion = result.assertions.find(
            (a) => a.conceptId === conceptId,
        );
        if (assertion?.source === 'infer') tags.push('inferred');
    }
    if (tags.length > 0) lines.push(`Flags: ${tags.join(', ')}`);

    tip.innerHTML = lines.join('<br>');
    const portalStyle = portalViewportOverlay(
        tip,
        field,
        getControllerStyles(),
    );
    if (portalStyle) tooltipPortalStyles.set(tip, portalStyle);
    copyOverlayTheme(field, tip);
    const margin = 8;
    const rect = tip.getBoundingClientRect();
    tip.style.left =
        Math.max(
            margin,
            Math.min(x + margin, window.innerWidth - rect.width - margin),
        ) + 'px';
    tip.style.top =
        Math.max(
            margin,
            Math.min(y + margin, window.innerHeight - rect.height - margin),
        ) + 'px';
    ctx.tooltipEl = tip;
}

/** Remove the concept metadata tooltip from the DOM. */
export function hideConceptTooltip(ctx: FormsContext): void {
    if (ctx.tooltipEl) {
        tooltipPortalStyles.get(ctx.tooltipEl)?.release();
        tooltipPortalStyles.delete(ctx.tooltipEl);
        ctx.tooltipEl.remove();
        ctx.tooltipEl = null;
    }
}

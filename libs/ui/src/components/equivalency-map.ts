/**
 * EquivalencyMap: read-only cross-profile mapping table.
 *
 * Renders a two-column table showing how concepts from one profile map to
 * concepts in another, with confidence indicators (exact / approximate /
 * no-equivalent). Consumes pre-computed equivalency data passed via the
 * `data-ezclassify-equivalency-equivalencies` JSON attribute.
 *
 * The forms library operates on a single engine instance per form, so this
 * component does not call the equivalency API directly. Instead, the hosting
 * code (React demo, vanilla JS, etc.) computes the equivalencies with whatever
 * engine it holds and passes the result array as a data attribute.
 *
 * Attribute: `data-ezclassify-controller="equivalency"` Config:
 * `data-ezclassify-equivalency-equivalencies`: JSON array of `{ source, target,
 * confidence }`. `data-ezclassify-equivalency-source-label`: header label for
 * the source column. `data-ezclassify-equivalency-target-label`, header label
 * for the target column.
 */

import { ReadOnlyComponentBase } from './component-base-readonly';
import { escHtml } from '../text-utils';
import equivalencyMapCss from './equivalency-map.css?inline';
import { t } from '../i18n';

/** A single row in the equivalency table. */
export interface EquivalencyEntry {
    source: string;
    target: string;
    confidence: 'exact' | 'approximate' | 'no-equivalent';
}

/**
 * Read-only table rendering cross-profile concept equivalencies with confidence
 * indicators.
 */
export class EquivalencyMap extends ReadOnlyComponentBase {
    private tableEl!: HTMLDivElement;

    protected setup(): void {
        this.injectComponentStyles(equivalencyMapCss);

        const entries = this.parseEntries();
        const sourceLabel =
            this.container.getAttribute(
                'data-ezclassify-equivalency-source-label',
            ) ?? 'Source';
        const targetLabel =
            this.container.getAttribute(
                'data-ezclassify-equivalency-target-label',
            ) ?? 'Target';

        this.tableEl = document.createElement('div');
        this.tableEl.className = 'ez-equivalency-map';
        this.tableEl.setAttribute('role', 'table');
        this.tableEl.setAttribute(
            'aria-label',
            `${sourceLabel} to ${targetLabel} mapping`,
        );

        // Header
        const header = document.createElement('div');
        header.className = 'ez-equivalency-map__header';
        header.setAttribute('role', 'row');
        header.innerHTML =
            `<span role="columnheader">${escHtml(sourceLabel)}</span>` +
            `<span role="columnheader">${escHtml(targetLabel)}</span>` +
            `<span role="columnheader">${escHtml(t('equivalency.confidence'))}</span>`;
        this.tableEl.appendChild(header);

        // Rows
        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = 'ez-equivalency-map__row';
            row.setAttribute('role', 'row');

            const src = document.createElement('span');
            src.className = 'ez-equivalency-map__source';
            src.setAttribute('role', 'cell');
            src.textContent = entry.source;
            row.appendChild(src);

            const tgt = document.createElement('span');
            tgt.className = 'ez-equivalency-map__target';
            tgt.setAttribute('role', 'cell');
            tgt.textContent = entry.target;
            row.appendChild(tgt);

            const conf = document.createElement('span');
            conf.className = 'ez-equivalency-map__confidence';
            conf.setAttribute('role', 'cell');
            const badge = document.createElement('span');
            badge.className = 'ez-equivalency-map__badge';
            badge.dataset.confidence = entry.confidence;
            badge.textContent =
                entry.confidence === 'no-equivalent'
                    ? 'none'
                    : entry.confidence;
            conf.appendChild(badge);
            row.appendChild(conf);

            this.tableEl.appendChild(row);
        }

        this.container.appendChild(this.tableEl);
    }

    destroy(): void {
        this.removeRuleErrors();
        this.container.innerHTML = '';
    }

    protected render(): void {
        // Static table: no re-render needed on assertion changes
    }

    private parseEntries(): EquivalencyEntry[] {
        const attr = this.container.getAttribute(
            'data-ezclassify-equivalency-equivalencies',
        );
        if (!attr) return [];
        try {
            const parsed = JSON.parse(attr);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(
                (e: unknown): e is EquivalencyEntry =>
                    typeof e === 'object' &&
                    e !== null &&
                    'source' in e &&
                    'target' in e &&
                    'confidence' in e,
            );
        } catch {
            return [];
        }
    }
}

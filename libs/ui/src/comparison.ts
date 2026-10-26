import type { SchemeEngineAdapter } from '@ezclassify/types';
import { escHtml } from './text-utils';
import { adoptStylesOnce } from './styles/adopt';

/**
 * Before/after rendering with the relationship direction and concept-level
 * diffs.
 */
export interface ComparisonResult {
    before: string;
    after: string;
    relationship: 'identical' | 'upgrade' | 'downgrade' | 'lateral';
    addedConcepts: string[];
    removedConcepts: string[];
}

/**
 * Read two marking strings through the engine and determine how they differ
 * (upgrade, downgrade, lateral, or identical). A comparison reads both markings
 * and corrects neither, so it asks the reader's call.
 */
export async function compareRenderings(
    beforeInput: string,
    afterInput: string,
    engine: SchemeEngineAdapter,
): Promise<ComparisonResult> {
    const beforeResult = await Promise.resolve(engine.validate(beforeInput));
    const afterResult = await Promise.resolve(engine.validate(afterInput));

    const beforeConcepts = new Set(
        beforeResult.assertions.map((a) => a.conceptId),
    );
    const afterConcepts = new Set(
        afterResult.assertions.map((a) => a.conceptId),
    );

    const addedConcepts: string[] = [];
    const removedConcepts: string[] = [];

    for (const c of afterConcepts) {
        if (!beforeConcepts.has(c)) addedConcepts.push(c);
    }
    for (const c of beforeConcepts) {
        if (!afterConcepts.has(c)) removedConcepts.push(c);
    }

    let relationship: ComparisonResult['relationship'];
    if (addedConcepts.length === 0 && removedConcepts.length === 0) {
        relationship = 'identical';
    } else {
        const beforeMaxOrder = Math.max(
            0,
            ...beforeResult.assertions.map(
                (a) => (a.metadata?.order as number) ?? 0,
            ),
        );
        const afterMaxOrder = Math.max(
            0,
            ...afterResult.assertions.map(
                (a) => (a.metadata?.order as number) ?? 0,
            ),
        );

        if (afterMaxOrder > beforeMaxOrder) {
            relationship = 'upgrade';
        } else if (afterMaxOrder < beforeMaxOrder) {
            relationship = 'downgrade';
        } else {
            relationship = 'lateral';
        }
    }

    return {
        before: beforeResult.rendered,
        after: afterResult.rendered,
        relationship,
        addedConcepts,
        removedConcepts,
    };
}

function renderComparison(
    result: ComparisonResult,
    container: HTMLElement,
): void {
    const relationshipLabels: Record<string, string> = {
        identical: 'Identical',
        upgrade: 'Upgrade',
        downgrade: 'Downgrade',
        lateral: 'Lateral Change',
    };

    const label = relationshipLabels[result.relationship];

    let html = '';

    adoptStylesOnce(COMPARISON_CSS, container);

    html += `<div class="ez-comparison-header">`;
    html += `<span class="ez-comparison-dot ez-comparison-dot--${result.relationship}"></span>`;
    html += `<strong class="ez-comparison-label ez-comparison-label--${result.relationship}">${label}</strong>`;
    html += `</div>`;

    html += `<div class="ez-comparison-panels">`;
    html += `<div class="ez-comparison-panel">`;
    html += `<div class="ez-comparison-panel-title">Before</div>`;
    html += `<div class="ez-comparison-panel-value">${escHtml(result.before)}</div>`;
    html += `</div>`;
    html += `<div class="ez-comparison-panel">`;
    html += `<div class="ez-comparison-panel-title">After</div>`;
    html += `<div class="ez-comparison-panel-value">${escHtml(result.after)}</div>`;
    html += `</div>`;
    html += `</div>`;

    if (result.addedConcepts.length > 0) {
        html += `<div class="ez-comparison-concepts">`;
        html += `<span class="ez-comparison-concepts-label">Added: </span>`;
        for (const c of result.addedConcepts) {
            html += `<span class="ez-comparison-tag ez-comparison-tag--added">${escHtml(c)}</span>`;
        }
        html += `</div>`;
    }

    if (result.removedConcepts.length > 0) {
        html += `<div class="ez-comparison-concepts">`;
        html += `<span class="ez-comparison-concepts-label">Removed: </span>`;
        for (const c of result.removedConcepts) {
            html += `<span class="ez-comparison-tag ez-comparison-tag--removed">${escHtml(c)}</span>`;
        }
        html += `</div>`;
    }

    container.innerHTML = html;
}

const COMPARISON_CSS = `
.ez-comparison-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.ez-comparison-dot {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}
.ez-comparison-dot--identical { background: #888; }
.ez-comparison-dot--upgrade { background: #ff9800; }
.ez-comparison-dot--downgrade { background: #4caf50; }
.ez-comparison-dot--lateral { background: #2196f3; }
.ez-comparison-label--identical { color: #888; }
.ez-comparison-label--upgrade { color: #ff9800; }
.ez-comparison-label--downgrade { color: #4caf50; }
.ez-comparison-label--lateral { color: #2196f3; }
.ez-comparison-panels {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.ez-comparison-panel {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #444;
  border-radius: 0.25rem;
  background: #1c1c1c;
}
.ez-comparison-panel-title {
  font-size: 0.6875rem;
  color: #888;
  margin-bottom: 0.25rem;
}
.ez-comparison-panel-value {
  font-family: monospace;
  font-size: 0.8125rem;
}
.ez-comparison-concepts {
  margin-bottom: 0.5rem;
}
.ez-comparison-concepts-label {
  font-size: 0.75rem;
  color: #888;
}
.ez-comparison-tag {
  display: inline-block;
  padding: 2px 0.375rem;
  margin: 0.125rem;
  border-radius: 3px;
  font-size: 0.75rem;
}
.ez-comparison-tag--added {
  background: #1b5e20;
  color: #a5d6a7;
}
.ez-comparison-tag--removed {
  background: #b71c1c;
  color: #ef9a9a;
}
.ez-comparison-error {
  color: #f44336;
  font-size: 0.75rem;
}
`;

/**
 * Bind two input fields so that changes automatically render a visual diff in
 * the result container.
 */
export function initComparison(
    fieldA: HTMLInputElement,
    fieldB: HTMLInputElement,
    resultContainer: HTMLElement,
    engine: SchemeEngineAdapter,
): { destroy: () => void } {
    // Comparisons can be in flight at once and a remote engine need not answer
    // in the order it was asked. Only the newest request may paint, so a slower
    // earlier one cannot leave a diff of text the fields no longer hold.
    let latest = 0;
    let destroyed = false;

    async function update(): Promise<void> {
        const valA = fieldA.value.trim();
        const valB = fieldB.value.trim();
        const seq = ++latest;

        if (!valA || !valB) {
            resultContainer.innerHTML = '';
            resultContainer.style.display = 'none';
            return;
        }

        try {
            const result = await compareRenderings(valA, valB, engine);
            if (destroyed || seq !== latest) return;
            resultContainer.style.display = 'block';
            renderComparison(result, resultContainer);
        } catch {
            if (destroyed || seq !== latest) return;
            resultContainer.innerHTML =
                '<div class="ez-comparison-error">Unable to compare renderings</div>';
            resultContainer.style.display = 'block';
        }
    }

    function onFieldInput(): void {
        void update();
    }

    fieldA.addEventListener('input', onFieldInput);
    fieldB.addEventListener('input', onFieldInput);

    // Initial render if both fields already have values
    void update();

    return {
        destroy(): void {
            destroyed = true;
            fieldA.removeEventListener('input', onFieldInput);
            fieldB.removeEventListener('input', onFieldInput);
            resultContainer.innerHTML = '';
        },
    };
}

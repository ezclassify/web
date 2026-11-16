/**
 * A store view reading a marking's `rendered` sees what the field that owns the
 * marking shows. MarkedInput and MarkedTextArea both write parts, so the same
 * facts read the same from either one's store entry: the field's part output,
 * without the field's delimiters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EzClassifyUI } from './ezclassify-ui';
import { loadMultiScopeRegression } from '../test-fixtures/load-multi-scope-regression';
import type { MarkedTextArea } from './components/marked-text-area';
import { asContext } from '../test-fixtures/as-context';
import { demoRuntimeSettled } from '../../../test-support/demo-runtime';

let ui: EzClassifyUI | undefined;
afterEach(() => {
    ui?.destroy();
    ui = undefined;
    document.body.innerHTML = '';
});

async function settled(): Promise<void> {
    await demoRuntimeSettled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await demoRuntimeSettled();
}

describe('the store rendering of a body field', () => {
    it('is the part the field writes, the same for MarkedInput and MarkedTextArea', async () => {
        document.body.innerHTML =
            '<div id="root">' +
            '<input id="title" type="text" value="(ST) Quarterly title" data-ezclassify-controller="marked-input">' +
            '<textarea id="body" data-ezclassify-controller="marked-textarea">(ST) First body.</textarea>' +
            '</div>';
        const engine = await loadMultiScopeRegression();
        ui = new EzClassifyUI(asContext(engine), {
            root: document.querySelector<HTMLElement>('#root')!,
        });
        await settled();
        const textarea = document.querySelector<HTMLElement>('#body')!;
        const body = await vi.waitFor(() => {
            const component = ui!.components.get(textarea) as
                MarkedTextArea | undefined;
            expect(component).toBeDefined();
            return component!;
        });
        await settled();
        const entry = body.getEntryIds()[0];
        const fromInput = ui.store.get('title');
        const fromBody = ui.store.get(entry);
        // The same facts in both: the mark the author wrote, with the
        // defaults the engine settles.
        const facts = (state: typeof fromInput) =>
            state.assertions.map((a) => a.conceptId).sort();
        expect(facts(fromInput)).toContain('STUDENTS');
        expect(facts(fromInput)).toEqual(facts(fromBody));
        // Published identically, in the part output the fields write ("ST"),
        // not the whole one ("STUDENTS"), and without the parentheses the
        // fields put around it.
        expect(fromInput.rendered).toBe(fromBody.rendered);
        expect(fromInput.rendered).toMatch(/^ST\b/);
        expect(fromInput.rendered).not.toContain('STUDENTS');
        expect(fromInput.rendered).not.toContain('(');
    });
});

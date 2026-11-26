/**
 * A host that wraps a field in its own `<label>` has the field's chrome buttons
 * inside that label. Each enhanced field must still be named by the label's
 * words alone, and the chrome buttons keep their own names.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ContextAdapter } from '@ezclassify/ui';
import { EzClassify, EzClassifyProvider } from './index';
import { createUnverifiableContext } from '../../../libs/ui/test-fixtures/unverifiable-context';

async function flush(): Promise<void> {
    await act(async () => {
        for (let index = 0; index < 8; index++)
            await new Promise<void>((tick) => setTimeout(tick, 25));
    });
}

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe('fields inside a wrapping label', () => {
    it.each(['marking', 'tags', 'marked-input'] as const)(
        'name the %s control from the label alone and keep the chrome names',
        async (controller) => {
            const context = (await createUnverifiableContext({
                down: false,
            })) as unknown as ContextAdapter;
            render(
                <EzClassifyProvider context={context}>
                    <EzClassify>
                        <label>
                            Review <b>marking</b>
                            <input
                                id="f"
                                data-ezclassify-controller={controller}
                            />
                        </label>
                    </EzClassify>
                </EzClassifyProvider>,
            );
            await flush();
            const named = (name: string | RegExp) =>
                ['combobox', 'textbox'].flatMap((role) =>
                    screen.queryAllByRole(role, { name, hidden: true }),
                );
            expect(named('Review marking').length).toBeGreaterThan(0);
            // No control is named with the chrome's button names.
            expect(named(/Enhanced by EzClassify|Clear/)).toHaveLength(0);
            // The chrome keeps its own button names.
            expect(
                screen.getAllByRole('button', { name: /clear/i }).length,
            ).toBeGreaterThan(0);
        },
    );
});

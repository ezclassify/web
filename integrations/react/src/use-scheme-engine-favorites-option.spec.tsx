/**
 * Coverage for `useSchemeEngine`'s `favorites` option.
 *
 * `docs/attributes.md` in `@ezclassify/ui` says framework integrations "accept
 * and forward the same option" as the vanilla `EzClassifyUI` constructor's
 * `favorites` config. This pins that for React: `UseSchemeEngineOptions`
 * carries `favorites`, and the hook threads it into the `new EzClassifyUI(...)`
 * call, so a React host can turn the ★ surface on (see
 * `libs/ui/src/ezclassify-ui-favorites-option.spec.ts` for the equivalent
 * vanilla-declarative coverage this mirrors).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Context } from '@ezclassify/engine';
import type { LocalSchemeEngineAdapter } from '@ezclassify/types';
import type { FavoritesConfig } from '@ezclassify/ui';
import { useSchemeEngine } from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../vendor/spec/fixtures/v1');

function loadScheme(): unknown {
    return JSON.parse(
        readFileSync(resolve(fixturesDir, 'ref-scheme-1.json'), 'utf8'),
    );
}

function makeEngine(): LocalSchemeEngineAdapter {
    return Context.fromComponents({ scheme: loadScheme() })
        .scheme as LocalSchemeEngineAdapter;
}

const noopFavorites: FavoritesConfig = { load: () => [] };

async function flush(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 4; i++) {
            await new Promise<void>((r) => setTimeout(r, 25));
        }
    });
}

afterEach(() => cleanup());

function TagsField({
    engine,
    favorites,
}: {
    engine: LocalSchemeEngineAdapter;
    favorites?: FavoritesConfig;
}) {
    const { ref } = useSchemeEngine(engine, { favorites });
    return (
        <div ref={ref} data-testid="region">
            <input data-ezclassify-controller="tags" id="tags-field" />
        </div>
    );
}

describe('useSchemeEngine({ favorites })', () => {
    it('forwards favorites through to EzClassifyUI: the ★ button renders on a scanner-mounted field', async () => {
        const { container } = render(
            <TagsField engine={makeEngine()} favorites={noopFavorites} />,
        );
        await flush();

        expect(container.querySelector('.ez-favorites-button')).not.toBeNull();
    });

    it('renders no ★ button when favorites is omitted (default, unchanged)', async () => {
        const { container } = render(<TagsField engine={makeEngine()} />);
        await flush();

        expect(container.querySelector('.ez-favorites-button')).toBeNull();
    });
});

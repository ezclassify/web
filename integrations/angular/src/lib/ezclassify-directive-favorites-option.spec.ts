/**
 * Regression coverage for `EzClassifyDirective`'s `favorites` option.
 *
 * `docs/attributes.md` in `@ezclassify/ui` claims framework integrations
 * "accept and forward the same option" as the vanilla `EzClassifyUI`
 * constructor's `favorites` config. Before this test existed that claim was
 * false for Angular too: `EzClassifyDirectiveOptions` had no `favorites` field
 * and the `new EzClassifyUI(...)` call never threaded one through, so an
 * Angular host had no way to turn the ★ surface on (mirrors
 * `use-scheme-engine-favorites-option.spec.tsx` in `@ezclassify/react` and
 * `use-ez-classify-favorites-option.spec.ts` in `@ezclassify/vue`).
 */
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { SchemeEngine } from '@ezclassify/engine';
import type { FavoritesConfig } from '@ezclassify/ui';
import {
    EzClassifyDirective,
    type EzClassifyDirectiveOptions,
} from './ezclassify.directive';

const MINIMAL_SCHEME = {
    scheme: {
        id: 'test',
        version: '1.0.0',
        default_scope: 'marking',
        scopes: [{ id: 'marking', label: 'Marking' }],
        name: 'Test',
        description: '',
        data: {
            categories: [
                {
                    id: 'level',
                    label: 'Level',
                    required: true,
                    single: true,
                    rollup: 'max',
                    position: 0,
                    hierarchy_root: true,
                },
            ],
            concepts: {
                inline: [
                    {
                        id: 'HIGH',
                        name: 'High',
                        views: { default: 'HIGH' },
                        categories: ['level'],
                        parents: [],
                        aliases: [],
                        position: 0,
                        rank: 0,
                    },
                ],
            },
        },
        rules: [],
        parse: {
            case_sensitive: false,
            strip_whitespace: true,
        },
        render: {
            default: 'default',
            formats: [
                {
                    id: 'default',
                    surface: 'marking',
                    mode: 'inline',
                    separator: '//',
                    fields: [{ category: 'level', separator: '/' }],
                },
            ],
        },
    },
};

const noopFavorites: FavoritesConfig = { load: () => [] };

@Component({
    selector: 'test-favorites-host',
    standalone: true,
    imports: [EzClassifyDirective],
    template: `<div [ezClassify]="engine" [ezClassifyOptions]="options">
        <input data-ezclassify-controller="tags" />
    </div>`,
})
class FavoritesHostComponent {
    engine?: SchemeEngine | null;
    options?: EzClassifyDirectiveOptions;
}

async function flush(): Promise<void> {
    // The directive constructs EzClassifyUI inside a deferred Promise.resolve()
    // (see ezclassify.directive.ts), then the field component's own mount is
    // itself async: flush both.
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((r) => setTimeout(r, 25));
    }
}

describe('EzClassifyDirective ezClassifyOptions.favorites', () => {
    it('forwards favorites through to EzClassifyUI: the ★ button renders on a scanner-mounted field', async () => {
        await TestBed.configureTestingModule({
            imports: [FavoritesHostComponent],
        }).compileComponents();
        const engine = Context.fromComponents({ scheme: MINIMAL_SCHEME })
            .scheme as SchemeEngine;
        const fixture = TestBed.createComponent(FavoritesHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.componentInstance.options = { favorites: noopFavorites };
        fixture.detectChanges(false);
        await flush();

        expect(
            fixture.nativeElement.querySelector('.ez-favorites-button'),
        ).not.toBeNull();
    });

    it('renders no ★ button when favorites is omitted (default, unchanged)', async () => {
        await TestBed.configureTestingModule({
            imports: [FavoritesHostComponent],
        }).compileComponents();
        const engine = Context.fromComponents({ scheme: MINIMAL_SCHEME })
            .scheme as SchemeEngine;
        const fixture = TestBed.createComponent(FavoritesHostComponent);
        fixture.componentInstance.engine = engine;
        fixture.detectChanges(false);
        await flush();

        expect(
            fixture.nativeElement.querySelector('.ez-favorites-button'),
        ).toBeNull();
    });
});

/**
 * `[ezClassifyOptions]` forwards `favorites` to the UI runtime, the same option
 * the vanilla `EzClassifyUI` constructor takes. A root that sets it shows the
 * favorites button on its scanner-mounted fields; one that does not, shows
 * none.
 */
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Context } from '@ezclassify/engine';
import type { FavoritesConfig } from '@ezclassify/ui';
import {
    EzClassifyDirective,
    type EzClassifyDirectiveOptions,
} from './ezclassify.directive';
import { provideEzClassify } from './provide-ezclassify';

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
            concepts: [
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
        rules: [],
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
    template: `<div [ezClassifyOptions]="options" ezClassify>
        <input data-ezclassify-controller="tags" />
    </div>`,
})
class FavoritesHostComponent {
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
            providers: [
                provideEzClassify({
                    context: Context.fromComponents({ scheme: MINIMAL_SCHEME }),
                }),
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(FavoritesHostComponent);
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
            providers: [
                provideEzClassify({
                    context: Context.fromComponents({ scheme: MINIMAL_SCHEME }),
                }),
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(FavoritesHostComponent);
        fixture.detectChanges(false);
        await flush();

        expect(
            fixture.nativeElement.querySelector('.ez-favorites-button'),
        ).toBeNull();
    });
});

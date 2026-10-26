import { describe, it, expect } from 'vitest';
import { HostTree } from '@angular-devkit/schematics';
import type { SchematicContext, Tree } from '@angular-devkit/schematics';
import {
    addModuleImport,
    findImportsArrayBounds,
    resolveSourceRoot,
} from './index';

// Minimal context: the rule only reaches for context.logger.
const ctx = {
    logger: { info: () => {}, warn: () => {} },
} as unknown as SchematicContext;

function runAddModuleImport(source: string): string {
    const tree = new HostTree();
    tree.create('/src/app/app.module.ts', source);
    const result = addModuleImport({})(tree, ctx) as Tree;
    return result.read('/src/app/app.module.ts')!.toString('utf-8');
}

describe('findImportsArrayBounds', () => {
    it('spans a nested array instead of stopping at the first inner bracket', () => {
        const src = `@NgModule({
  imports: [
    BrowserModule,
    RouterModule.forRoot([{ path: '', component: AppComponent }]),
  ],
})`;
        const bounds = findImportsArrayBounds(src)!;
        expect(bounds).not.toBeNull();
        // The matched slice must contain the whole nested forRoot array.
        const slice = src.slice(bounds.open, bounds.close + 1);
        expect(slice).toContain('RouterModule.forRoot');
        expect(slice.endsWith(']')).toBe(true);
        // The character after close must be the trailing comma of the array,
        // proving we matched the outer bracket, not the inner forRoot one.
        expect(src.slice(bounds.close + 1, bounds.close + 2)).toBe(',');
    });

    it('returns null when there is no NgModule decorator', () => {
        expect(
            findImportsArrayBounds('export const x = [1, 2, 3];'),
        ).toBeNull();
    });
});

describe('addModuleImport', () => {
    it('inserts EzClassifyDirective into a routed AppModule without corrupting forRoot', () => {
        const source = `import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AppComponent } from './app.component';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    RouterModule.forRoot([{ path: '', component: AppComponent }]),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
`;
        const out = runAddModuleImport(source);

        // The module import statement was added.
        expect(out).toContain(
            "import { EzClassifyDirective } from '@ezclassify/angular';",
        );
        // EzClassifyDirective joined the outer imports array.
        expect(out).toContain('EzClassifyDirective,');
        // The routed forRoot array is intact (not split by the insertion).
        expect(out).toContain(
            "RouterModule.forRoot([{ path: '', component: AppComponent }])",
        );
        // The insertion landed after the forRoot entry, at the array tail,
        // not inside forRoot's argument array.
        const forRootIdx = out.indexOf('RouterModule.forRoot');
        const ezIdx = out.indexOf('EzClassifyDirective,', forRootIdx);
        expect(ezIdx).toBeGreaterThan(forRootIdx);
    });

    it('handles an empty imports array', () => {
        const source = `import { NgModule } from '@angular/core';

@NgModule({
  imports: [],
})
export class AppModule {}
`;
        const out = runAddModuleImport(source);
        expect(out).toContain('EzClassifyDirective,');
        expect(out).toContain(
            "import { EzClassifyDirective } from '@ezclassify/angular';",
        );
    });
});

// ─── --project ───────────────────────────────────────────────────────────────

const APP_MODULE = `import { NgModule } from '@angular/core';

@NgModule({
  imports: [],
})
export class AppModule {}
`;

/**
 * A workspace shaped like `ng new --create-application=false` plus two apps:
 * neither one sits at /src, so a schematic that hardcodes /src writes nothing
 * and reports success.
 */
function multiProjectTree(): Tree {
    const tree = new HostTree();
    tree.create(
        '/angular.json',
        JSON.stringify({
            version: 1,
            projects: {
                storefront: {
                    root: 'projects/storefront',
                    sourceRoot: 'projects/storefront/src',
                },
                admin: {
                    root: 'projects/admin',
                    sourceRoot: 'projects/admin/src',
                },
            },
        }),
    );
    tree.create('/projects/storefront/src/app/app.module.ts', APP_MODULE);
    tree.create('/projects/admin/src/app/app.module.ts', APP_MODULE);
    return tree;
}

function moduleAt(tree: Tree, path: string): string {
    return tree.read(path)!.toString('utf-8');
}

describe('ng-add --project', () => {
    it('declares the directive in the named project, not the other one', () => {
        const tree = multiProjectTree();
        addModuleImport({ project: 'admin' })(tree, ctx);

        expect(
            moduleAt(tree, '/projects/admin/src/app/app.module.ts'),
        ).toContain('EzClassifyDirective,');
        expect(
            moduleAt(tree, '/projects/storefront/src/app/app.module.ts'),
        ).not.toContain('EzClassifyDirective');
    });

    it('follows the workspace default project when none is named', () => {
        const tree = multiProjectTree();
        const workspace = JSON.parse(
            tree.read('/angular.json')!.toString('utf-8'),
        ) as Record<string, unknown>;
        workspace.defaultProject = 'storefront';
        tree.overwrite('/angular.json', JSON.stringify(workspace));

        addModuleImport({})(tree, ctx);

        expect(
            moduleAt(tree, '/projects/storefront/src/app/app.module.ts'),
        ).toContain('EzClassifyDirective,');
        expect(
            moduleAt(tree, '/projects/admin/src/app/app.module.ts'),
        ).not.toContain('EzClassifyDirective');
    });

    it('refuses a project the workspace does not have', () => {
        const tree = multiProjectTree();
        expect(() =>
            addModuleImport({ project: 'warehouse' })(tree, ctx),
        ).toThrow(/Project "warehouse" does not exist/);
    });

    it('keeps writing to /src for a workspace with no angular.json', () => {
        const tree = new HostTree();
        tree.create('/src/app/app.module.ts', APP_MODULE);
        addModuleImport({})(tree, ctx);
        expect(moduleAt(tree, '/src/app/app.module.ts')).toContain(
            'EzClassifyDirective,',
        );
    });
});

describe('resolveSourceRoot', () => {
    it('uses the single project in a one-application workspace', () => {
        const tree = new HostTree();
        tree.create(
            '/angular.json',
            JSON.stringify({
                projects: { app: { root: '', sourceRoot: 'src' } },
            }),
        );
        expect(resolveSourceRoot(tree, undefined, ctx)).toBe('/src');
    });

    it('derives the root from `root` when a project declares no sourceRoot', () => {
        const tree = new HostTree();
        tree.create(
            '/angular.json',
            JSON.stringify({ projects: { app: { root: 'projects/app' } } }),
        );
        expect(resolveSourceRoot(tree, 'app', ctx)).toBe('/projects/app/src');
    });
});

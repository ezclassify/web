/**
 * Angular schematic for `ng add @ezclassify/angular`.
 *
 * Actions performed:
 *
 * 1. Add @ezclassify/ui and @ezclassify/angular to package.json dependencies
 * 2. Declare EzClassifyDirective in the root AppModule's imports, for an
 *    application that still has one (unless --skipImport)
 * 3. Print a getting-started message
 *
 * Step 1 is workspace-wide; the dependencies land in the one package.json a CLI
 * workspace has. Step 2 is per project, and `--project` picks which one.
 */

import {
    Rule,
    SchematicContext,
    SchematicsException,
    Tree,
    chain,
} from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';

const _require = require;
// Read this schematic's own package.json version so the injected dependency
// range always matches the installed schematic.
const SCHEMATIC_VERSION: string = (
    _require('../../package.json') as { version: string }
).version;

interface NgAddOptions {
    /**
     * Which workspace project to declare the directive in. Defaults to the
     * workspace default project, or the only one when a workspace has just one.
     * See {@link resolveSourceRoot}.
     */
    project?: string;
    skipImport?: boolean;
}

/**
 * Add @ezclassify/ui and @ezclassify/angular to package.json.
 *
 * The engine is not one of them. Which runtime the application talks to, the
 * REST client or a licensed in-process engine, is its own decision, and
 * installing one here would make that decision for it.
 */
function addDependencies(): Rule {
    return (tree: Tree, context: SchematicContext) => {
        const pkgPath = '/package.json';
        const buffer = tree.read(pkgPath);
        if (!buffer) {
            context.logger.warn(
                'Could not find package.json, skipping dependency addition.',
            );
            return tree;
        }

        const pkg = JSON.parse(buffer.toString('utf-8')) as {
            dependencies?: Record<string, string>;
        };
        pkg.dependencies = pkg.dependencies ?? {};

        const range = `^${SCHEMATIC_VERSION}`;
        // @ezclassify/ui is a hard peer dependency referenced by the FESM bundle,
        // so the schematic must install it too, otherwise the consuming app fails
        // to resolve it at runtime.
        if (!pkg.dependencies['@ezclassify/ui']) {
            pkg.dependencies['@ezclassify/ui'] = range;
            context.logger.info('  Added @ezclassify/ui to dependencies.');
        }
        if (!pkg.dependencies['@ezclassify/angular']) {
            pkg.dependencies['@ezclassify/angular'] = range;
            context.logger.info('  Added @ezclassify/angular to dependencies.');
        }

        tree.overwrite(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        context.addTask(new NodePackageInstallTask());
        return tree;
    };
}

/** The slice of `angular.json` this schematic reads. */
interface WorkspaceFile {
    defaultProject?: string;
    projects?: Record<string, { root?: string; sourceRoot?: string }>;
}

/**
 * The source root of the project this run targets, as an absolute tree path
 * with no trailing slash.
 *
 * `--project` is the reason this exists. A workspace with a library and two
 * applications has three source roots, and writing to whichever one happens to
 * sit at `/src` is wrong for two of them.
 *
 * Resolution order: the named project, then the workspace default, then the
 * only project when there is exactly one. A workspace file that is missing or
 * unreadable falls back to `/src`, which is where the CLI puts a single-project
 * application.
 *
 * @param tree - The workspace being modified.
 * @param project - The `--project` value, if the caller passed one.
 * @param context - Used to report a fallback the caller may not expect.
 * @returns The source root to search for an AppModule.
 * @throws SchematicsException when `--project` names a project that is absent.
 */
export function resolveSourceRoot(
    tree: Tree,
    project: string | undefined,
    context: SchematicContext,
): string {
    const buffer = tree.read('/angular.json');
    if (!buffer) {
        if (project) {
            throw new SchematicsException(
                `Cannot resolve --project ${project}: no angular.json in this workspace.`,
            );
        }
        return '/src';
    }

    let workspace: WorkspaceFile;
    try {
        workspace = JSON.parse(buffer.toString('utf-8')) as WorkspaceFile;
    } catch {
        throw new SchematicsException(
            'Could not parse angular.json; fix the workspace file and run ng add again.',
        );
    }

    const projects = workspace.projects ?? {};
    const names = Object.keys(projects);
    const name =
        project ??
        workspace.defaultProject ??
        (names.length === 1 ? names[0] : undefined);

    if (!name) {
        context.logger.warn(
            '  No project selected and the workspace holds more than one; ' +
                'defaulting to /src. Pass --project to choose.',
        );
        return '/src';
    }

    const entry = projects[name];
    if (!entry) {
        throw new SchematicsException(
            `Project "${name}" does not exist in angular.json. ` +
                `Available projects: ${names.join(', ') || 'none'}.`,
        );
    }

    const root = (entry.sourceRoot ?? `${entry.root ?? ''}/src`).replace(
        /^\/*|\/*$/g,
        '',
    );
    return `/${root}`;
}

/**
 * Locate the bounds of the `imports: [ ... ]` array inside the `@NgModule`
 * decorator using a balanced-bracket scan, so a nested array such as
 * `RouterModule.forRoot([{ path: '' }])` does not terminate the match early.
 * Returns the index of the opening `[` and its matching `]`, or null when no
 * well-formed imports array is present.
 */
export function findImportsArrayBounds(
    source: string,
): { open: number; close: number } | null {
    const ngModuleIdx = source.indexOf('@NgModule(');
    if (ngModuleIdx < 0) return null;

    const importsKey = /imports\s*:\s*\[/g;
    importsKey.lastIndex = ngModuleIdx;
    const keyMatch = importsKey.exec(source);
    if (!keyMatch) return null;

    const open = keyMatch.index + keyMatch[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return { open, close: i };
        }
    }
    return null;
}

/**
 * Declare `EzClassifyDirective` in the root AppModule.
 *
 * The package ships a standalone directive, not a module, and a standalone
 * directive is declared in an NgModule's `imports` array. An application on
 * standalone bootstrap has no AppModule at all; nothing here applies to it and
 * nothing is written.
 */
export function addModuleImport(options: NgAddOptions): Rule {
    return (tree: Tree, context: SchematicContext) => {
        if (options.skipImport) {
            context.logger.info('  Skipping AppModule update (--skipImport).');
            return tree;
        }

        // Look for app.module.ts in the target project's common locations.
        const sourceRoot = resolveSourceRoot(tree, options.project, context);
        const modulePaths = [
            `${sourceRoot}/app/app.module.ts`,
            `${sourceRoot}/app/app-routing.module.ts`,
        ];

        for (const modulePath of modulePaths) {
            if (!tree.exists(modulePath)) continue;

            const content = tree.read(modulePath)!.toString('utf-8');

            // Skip if already imported
            if (content.includes('@ezclassify/angular')) {
                context.logger.info(
                    '  EzClassifyDirective already imported, skipping.',
                );
                return tree;
            }

            // Add import statement after the last existing import
            const importLine = `import { EzClassifyDirective } from '@ezclassify/angular';\n`;
            const moduleDeclaration = `    EzClassifyDirective,`;

            // Locate the imports array first so a file we cannot safely edit
            // (no @NgModule, or a malformed imports array) is declined rather
            // than corrupted.
            const bounds = findImportsArrayBounds(content);
            if (!bounds) {
                context.logger.warn(
                    `  Could not locate an imports array in ${modulePath}; ` +
                        'add EzClassifyDirective manually.',
                );
                return tree;
            }

            let updated = content;

            // Insert into the imports array before its matching closing bracket,
            // preserving any nested arrays (e.g. RouterModule.forRoot([...])).
            const inner = updated.slice(bounds.open + 1, bounds.close);
            updated =
                updated.slice(0, bounds.open + 1) +
                inner.trimEnd() +
                `\n${moduleDeclaration}\n` +
                updated.slice(bounds.close);

            // Insert import statement before the @NgModule decorator. Recompute
            // the index against the mutated string so the array edit above does
            // not shift it.
            const ngModuleIdx = updated.indexOf('@NgModule(');
            if (ngModuleIdx >= 0) {
                updated =
                    updated.slice(0, ngModuleIdx) +
                    importLine +
                    updated.slice(ngModuleIdx);
            }

            tree.overwrite(modulePath, updated);
            context.logger.info(`  Added EzClassifyDirective to ${modulePath}`);
            break;
        }

        return tree;
    };
}

/** Print getting-started instructions */
function printGettingStarted(): Rule {
    return (_tree: Tree, context: SchematicContext) => {
        context.logger.info('');
        context.logger.info('✅ @ezclassify/angular installed successfully!');
        context.logger.info('');
        context.logger.info('Quick start:');
        context.logger.info('');
        context.logger.info('  1. Name your engine once in the app config:');
        context.logger.info('');
        context.logger.info(
            `     import { provideEzClassify } from '@ezclassify/angular'`,
        );
        context.logger.info('');
        context.logger.info(
            '     // engine: the runtime your app connects to, a REST client',
        );
        context.logger.info(
            '     // or a licensed in-process engine. This package builds none.',
        );
        context.logger.info(`     providers: [provideEzClassify({ engine })]`);
        context.logger.info('');
        context.logger.info('  2. Use the component in your templates:');
        context.logger.info('');
        context.logger.info(
            '     <input data-ezclassify-controller="tags" data-ezclassify-format="" [(ngModel)]="marking" />',
        );
        context.logger.info(
            '     <div data-ezclassify-controller="banner"></div>',
        );
        context.logger.info('');
        context.logger.info(
            '  Documentation: https://github.com/ezclassify/web/tree/main/integrations/angular#readme',
        );
        context.logger.info('');
        return _tree;
    };
}

/** Main schematic entry point */
export function ngAdd(options: NgAddOptions): Rule {
    return chain([
        addDependencies(),
        addModuleImport(options),
        printGettingStarted(),
    ]);
}

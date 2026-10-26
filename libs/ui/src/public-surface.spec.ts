/**
 * Public-surface guard for the `@ezclassify/ui` package entry.
 *
 * The components barrel (`./components`) is re-exported through the package
 * index by an EXPLICIT named list, not `export *`. That keeps adapter-internal
 * primitives, the abstract `ComponentBase`, the raw `COMPONENT_CSS` string, the
 * `getComponentStyles` builder, and the color constants, out of the published
 * surface, so they can change without a breaking change. This test pins both
 * halves of the contract: the intended-public component classes are reachable
 * from the entry, and the internal primitives are not.
 *
 * `EzClassifyUI` carries the runtime state the forms modules share as ordinary
 * members tagged `@internal`, and the library build strips them from the
 * published declarations. The `EzClassifyUI published declaration` suite emits
 * that declaration the way the build does and pins the members an integrator
 * can see, so a new member is public only when somebody means it to be.
 */
import * as path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import * as ui from './index';

describe('@ezclassify/ui public surface', () => {
    const intendedPublicComponents = [
        'AssertionCard',
        'TagInput',
        'DualPane',
        'CategoryChecklist',
        'CategorySelector',
        'SingleSelect',
        'StatusBanner',
        'Handbook',
        'Guidebook',
        'ContextReference',
        'GuideChecklist',
        'DecisionFlow',
        'HiddenAssertionField',
        'EzClassifyText',
        'MarkedTextArea',
        'MarkedInput',
        'MarkingField',
        'EquivalencyMap',
    ] as const;

    it.each(intendedPublicComponents)(
        're-exports the public component %s',
        (name) => {
            expect((ui as Record<string, unknown>)[name]).toBeDefined();
        },
    );

    // Adapter-internal primitives must NOT leak through the package entry. They
    // are imported by deep path within the library (./components/component-base,
    // ./components/component-utils) but are not part of the published contract.
    const internalSymbols = [
        'ComponentBase',
        'COMPONENT_CSS',
        'getComponentStyles',
        'CATEGORY_COLORS',
    ];

    it.each(internalSymbols)('does not expose internal symbol %s', (name) => {
        expect((ui as Record<string, unknown>)[name]).toBeUndefined();
    });
});

const LIB_DIR = path.resolve(import.meta.dirname, '..');

/**
 * Emit `ezclassify-ui.d.ts` with the compiler options of the library build
 * (`tsconfig.lib.json`), so the result is what the published package carries.
 */
function emitEzClassifyUIDeclaration(): string {
    const configPath = path.join(LIB_DIR, 'tsconfig.lib.json');
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error)
        throw new Error(
            ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        );
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, LIB_DIR);
    const entry = path.join(LIB_DIR, 'src', 'ezclassify-ui.ts');
    const program = ts.createProgram([entry], {
        ...parsed.options,
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: false,
        noEmit: false,
    });
    let declaration: string | undefined;
    program.emit(
        program.getSourceFile(entry),
        (fileName, text) => {
            if (fileName.endsWith('ezclassify-ui.d.ts')) declaration = text;
        },
        undefined,
        true,
    );
    if (declaration === undefined)
        throw new Error('No declaration was emitted for ezclassify-ui.ts');
    return declaration;
}

/** Every member of `EzClassifyUI` in a declaration file, private or not. */
function membersOf(
    declaration: string,
): Array<{ name: string; isPrivate: boolean }> {
    const file = ts.createSourceFile(
        'ezclassify-ui.d.ts',
        declaration,
        ts.ScriptTarget.Latest,
    );
    const cls = file.statements.find(
        (s): s is ts.ClassDeclaration =>
            ts.isClassDeclaration(s) && s.name?.text === 'EzClassifyUI',
    );
    if (!cls) throw new Error('EzClassifyUI is not declared');
    return cls.members.map((m) => ({
        name: ts.isConstructorDeclaration(m)
            ? 'constructor'
            : m.name && ts.isIdentifier(m.name)
              ? m.name.text
              : m.getText(file),
        isPrivate:
            ((m.name !== undefined && ts.isPrivateIdentifier(m.name)) ||
                ts
                    .getModifiers(m as ts.HasModifiers)
                    ?.some(
                        (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword,
                    )) ??
            false,
    }));
}

describe('EzClassifyUI published declaration', () => {
    // What an integrator reaches through the class. `components` stays because
    // host applications load a value through a mounted field's own `setValue`
    // (see docs/binding-model.md).
    const publicMembers = [
        'engine',
        'root',
        'store',
        'components',
        'isReady',
        'constructor',
        'recalculate',
        'getRollup',
        'getAllAssertions',
        'getAssertionsByTarget',
        'copyMarkingToClipboard',
        'destroy',
    ];

    const declaration = emitEzClassifyUIDeclaration();
    const members = membersOf(declaration);

    it('declares exactly the integrator members', () => {
        const declared = members.filter((m) => !m.isPrivate).map((m) => m.name);
        expect([...new Set(declared)].sort()).toEqual(
            [...publicMembers].sort(),
        );
    });

    // Mounting and teardown own the map; an integrator gets a view it cannot
    // change, so a host cannot unregister a field the runtime still manages.
    it('declares the mounted components as a read-only map', () => {
        expect(declaration).toMatch(
            /get components\(\): ReadonlyMap<HTMLElement, ComponentInstance>;/,
        );
    });

    // A heritage clause survives stripping, and a consumer type-checking the
    // declaration would then see a class that no longer satisfies it.
    it('declares no interface that names the stripped members', () => {
        expect(declaration).not.toMatch(/class EzClassifyUI\s+implements\b/);
    });
});

/**
 * Cedar Valley for tests, read from the one copy that exists.
 *
 * The fictional Cedar Valley school district lives in the community-content
 * repository (`scheme-folder/` and `schemes/demo/cedar-valley*`). Nothing here
 * keeps a second copy. A spec that needs the district's scheme, guide or access
 * policy reads the YAML from a community-content checkout through this module
 * and builds its Context with the engine.
 *
 * The checkout is found, in order:
 *
 * 1. `EZCLASSIFY_COMMUNITY_CONTENT_DIR`, when set.
 * 2. The `community-content` directory next to this repository, which is where the
 *    maintainer workspace puts it.
 *
 * CI checks out `github.com/ezclassify/community-content` at the commit in
 * `community-content.pin` and points the variable at it. A checkout that cannot
 * be found throws. Nothing skips quietly, because a skipped spec reads as a
 * smaller passing run.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { Context } from '@ezclassify/engine';

/** The environment variable that overrides the sibling checkout. */
export const COMMUNITY_CONTENT_DIR_VARIABLE =
    'EZCLASSIFY_COMMUNITY_CONTENT_DIR';

/** The kinds of document the scheme folder keeps, one directory each. */
export type SchemeFolderKind = 'schemes' | 'guides' | 'accesses' | 'contexts';

/**
 * The community-content checkout the tests read.
 *
 * @returns Absolute path of a directory that holds `scheme-folder/`
 * @throws When the override or the sibling is not a community-content checkout
 */
export function communityContentDir(): string {
    const override = process.env[COMMUNITY_CONTENT_DIR_VARIABLE];
    const dir = override
        ? path.resolve(override)
        : path.resolve(import.meta.dirname, '../../community-content');
    if (!existsSync(path.join(dir, 'scheme-folder', 'scheme-folder.yaml'))) {
        throw new Error(
            `No community-content checkout at ${dir}. Clone ` +
                'github.com/ezclassify/community-content next to this ' +
                `repository, or set ${COMMUNITY_CONTENT_DIR_VARIABLE} to one ` +
                '(CI uses the commit in test-support/community-content.pin).',
        );
    }
    return dir;
}

/**
 * The YAML text of one scheme-folder document.
 *
 * @param kind - The document's directory in the scheme folder
 * @param id - The document id, such as `cedar-valley-guide`
 * @param version - The document version
 * @returns The file's text
 */
export function schemeFolderYaml(
    kind: SchemeFolderKind,
    id: string,
    version = '1.0.0',
): string {
    return readFileSync(
        path.join(
            communityContentDir(),
            'scheme-folder',
            kind,
            `${id}@${version}.yaml`,
        ),
        'utf8',
    );
}

/**
 * A scheme document as the JSON text a server reads from its artifact path.
 *
 * @param id - The scheme id, such as `cedar-valley-protection`
 * @param version - The scheme version
 * @returns The scheme document serialized as JSON
 */
export function schemeDocumentJson(id: string, version = '1.0.0'): string {
    return JSON.stringify(yaml.load(schemeFolderYaml('schemes', id, version)));
}

/**
 * The Cedar Valley protection-and-handling scheme document, parsed.
 *
 * @returns The scheme document, ready for `Context.fromComponents`
 */
export function cedarValleyHandlingSchemeDocument(): unknown {
    return yaml.load(schemeFolderYaml('schemes', 'cedar-valley-handling'));
}

/**
 * The Cedar Valley protection-levels scheme document, parsed.
 *
 * @returns The scheme document, ready for `Context.fromComponents`
 */
export function cedarValleyLevelsSchemeDocument(): unknown {
    return yaml.load(schemeFolderYaml('schemes', 'cedar-valley-protection'));
}

/** Cedar Valley District Files: the scheme, its guide and its access policy. */
export const cedarValleySchemeYaml: string = schemeFolderYaml(
    'schemes',
    'cedar-valley',
);
export const cedarValleyGuideYaml: string = schemeFolderYaml(
    'guides',
    'cedar-valley-guide',
);
export const cedarValleyAccessYaml: string = schemeFolderYaml(
    'accesses',
    'cedar-valley-access',
);

/**
 * Build a Context from scheme-folder documents.
 *
 * @param ids - The scheme, guide and access ids to read
 * @returns One Context over the three documents
 */
function contextFrom(ids: {
    scheme: string;
    guide: string;
    access: string;
}): Context {
    return Context.fromComponents({
        scheme: yaml.load(schemeFolderYaml('schemes', ids.scheme)),
        guides: [yaml.load(schemeFolderYaml('guides', ids.guide))],
        access: yaml.load(schemeFolderYaml('accesses', ids.access)),
    });
}

/** The Cedar Valley District Files Context. */
export function loadCedarValleyContext(): Context {
    return contextFrom({
        scheme: 'cedar-valley',
        guide: 'cedar-valley-guide',
        access: 'cedar-valley-access',
    });
}

/** The Cedar Valley protection-levels Context. */
export function loadCedarValleyLevelsContext(): Context {
    return contextFrom({
        scheme: 'cedar-valley-protection',
        guide: 'cedar-valley-protection-guide',
        access: 'cedar-valley-protection-access',
    });
}

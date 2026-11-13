/**
 * Where a recording run builds the demo runtime, and how a finished build is
 * keyed. Pure path and digest rules, so a spec can hold them without a Rust
 * toolchain.
 *
 * Every pinned source gets a directory of its own, holding both the extracted
 * source and the Cargo target directory it builds into. Cargo never sees two
 * pins through one target directory, so no crate of an earlier pin can be
 * linked into a later one, and moving the pin always compiles from nothing.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

/** The directories one pinned source is extracted and built in. */
export interface PinnedBuildLayout {
    /** Holds everything of the pin. */
    readonly root: string;
    /** The extracted source tree. */
    readonly source: string;
    /** The Cargo target directory for that source, and no other. */
    readonly cargoTarget: string;
}

/**
 * The layout of a pinned source under `builds`.
 *
 * @param builds - The directory recordings build under
 * @param commit - The pinned commit of the runtime source
 */
export function pinnedBuildLayout(
    builds: string,
    commit: string,
): PinnedBuildLayout {
    const root = path.join(builds, `pin-${commit}`);
    return {
        root,
        source: path.join(root, 'source'),
        cargoTarget: path.join(root, 'target'),
    };
}

/**
 * The key a finished build is stored and reused under: the pin, how cargo was
 * called, and the assembled demo set. Any one of them changing is a new build.
 *
 * @param commit - The pinned commit of the runtime source
 * @param cargoArgs - The cargo arguments of the build
 * @param demoSetDigest - A digest of the assembled demo set
 */
export function buildKey(
    commit: string,
    cargoArgs: readonly string[],
    demoSetDigest: string,
): string {
    return createHash('sha256')
        .update(commit)
        .update('\0')
        .update(cargoArgs.join(' '))
        .update('\0')
        .update(demoSetDigest)
        .digest('hex')
        .slice(0, 32);
}

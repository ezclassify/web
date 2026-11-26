/**
 * The composer port every field builds the same way. A field supplies its own
 * engine binding (scheme, format, context, suggest calls) and its store; the
 * port turns that into what the composer asks for, so reading, rendering,
 * adding, removing and naming concepts behave identically in every field.
 */

import type {
    Assertion,
    Fix,
    SchemePublicView,
    Suggestion,
} from '@ezclassify/types';
import type {
    ComposerCommitted,
    ComposerDraftShape,
    ComposerPort,
    ComposerReading,
} from './composer-controller';
import { statedAssertions } from './composer-controller';
import {
    readAdditiveDraft,
    readWholeDraft,
    renderAssertions,
    suggestionForAssertion,
    type ComposerEngineBinding,
} from './composer-reading';
import { addUserAssertion } from '../assertion-addition';
import { takenFromWhole } from '../../assertion-identity';
import { removeAssertionCascade } from '../assertion-removal';
import {
    getPublicFormatSeparators,
    getPublicFormatLayout,
    type FormatLayoutSource,
} from '../../format-layout';
import { defaultSurfaceOf } from '../../format-resolver';
import { renderViewRefusalMessages } from '../../render-refusal';
import { categoriesByScope, scopeLabel, type ScopeSource } from '../../scopes';

/** What a field provides for its composer port. Read on every call. */
export interface ComposerPortField {
    /** 'whole' when the text is the whole marking, 'additive' when it adds. */
    readonly shape: ComposerDraftShape;
    /** The engine calls, in the field's own format and context. */
    readonly binding: ComposerEngineBinding;
    scheme(): Pick<SchemePublicView, 'categories' | 'concepts'>;
    /** The scheme metadata the field's render formats and scopes come from. */
    meta(): FormatLayoutSource & ScopeSource;
    formatId(): string;
    /**
     * The surface the field declares it authors, with `data-ezclassify-scope`.
     * Without one, the field writes the surface of its format.
     */
    scope?(): string | undefined;
    /**
     * The scope ids the field lists with `data-ezclassify-scope`. A field that
     * lists several edits the categories of every one of them.
     */
    scopes?(): readonly string[];
    /** The one category the field is bound to, if any. */
    categoryId?(): string | undefined;
    /** See ComposerPort.suggestions. */
    suggestions(live?: readonly Assertion[]): Promise<Suggestion[]>;
    gated(query: string, live: readonly Assertion[]): Promise<Suggestion[]>;
    committed(): ComposerCommitted;
    /** See ComposerPort.reentered. */
    reentered?(): void;
    /** See ComposerPort.kept. */
    kept?(): void;
    store: ComposerPort['store'];
    /**
     * For a field that holds one category of a larger marking (a facet): what
     * the rest of that marking holds. A reading is judged together with it.
     */
    siblings?(): readonly Assertion[];
    /** For a facet: the only category it stores. */
    ownCategory?(): string | undefined;
}

/**
 * Whether a category belongs to a surface other than the one a field writes. A
 * category that names its surfaces belongs to those. One that names none is on
 * the marking as a whole, which the default surface writes, the way validation
 * demands it only there. A field whose surface is not known edits every
 * category.
 *
 * @param category - The category, with the scopes it declares
 * @param surface - The scope id of the surface the field writes
 * @param defaultSurface - The scope id of the scheme's default surface
 */
export function ownedElsewhere(
    category: { scopes?: readonly string[] },
    surface: string | undefined,
    defaultSurface: string | undefined,
): boolean {
    if (surface === undefined) return false;
    if (!category.scopes?.length) {
        return defaultSurface !== undefined && surface !== defaultSurface;
    }
    return !category.scopes.includes(surface);
}

/**
 * The surfaces deciding which categories a field edits, for
 * {@link ownedElsewhere}: the one it declares, else the one its format writes,
 * and the scheme's default.
 *
 * @param meta - The scheme metadata the field's render formats come from
 * @param formatId - The field's format
 * @param scope - The surface the field declares, if any
 */
export function fieldSurfaces(
    meta: FormatLayoutSource,
    formatId: string,
    scope: string | undefined,
): { surface: string | undefined; defaultSurface: string | undefined } {
    const outputs = meta.formats ?? [];
    return {
        surface: scope ?? outputs.find((f) => f.id === formatId)?.surface,
        defaultSurface: defaultSurfaceOf(outputs, meta.defaultRenderFormat),
    };
}

/**
 * Build the composer port for a field.
 *
 * @param field - The field's engine binding, scheme and store
 */
export function createComposerPort(field: ComposerPortField): ComposerPort {
    if (field.shape === 'additive' && !field.binding.validate) {
        throw new Error(
            '[ezclassify] An additive composer port needs a binding that can validate its text.',
        );
    }
    const add = (
        assertions: readonly Assertion[],
        ref: { conceptId: string; categoryId: string },
    ) => addUserAssertion(assertions, ref, field.scheme());
    /**
     * A facet's reading judged as part of its whole marking: the facet's own
     * assertions and rendering stay (they are what it stores and shows), and
     * validity, errors, warnings and fixes come from the marking they would
     * store into, with the other categories as they stand.
     *
     * That is a second process call, because one call writes one rendering: the
     * whole's, where the facet shows its own.
     */
    const judged = async (
        reading: ComposerReading,
    ): Promise<ComposerReading> => {
        const siblings = field.siblings?.() ?? [];
        if (siblings.length === 0) return reading;
        const own = statedAssertions(reading.assertions);
        const whole = await field.binding.process('', {
            chosen: [...statedAssertions(siblings), ...own],
        });
        return {
            ...reading,
            valid: whole.valid,
            errors: whole.errors ?? [],
            warnings: whole.warnings ?? [],
            proposedFixes: (whole.proposedFixes ?? []) as Fix[],
        };
    };
    /**
     * The facts a write hands the engine: what the author stated and, for a
     * part read in its whole, the values the engine takes from that whole for
     * them. A format that writes one word for a whole's values needs those
     * values in hand to write it. The engine decides which values it takes,
     * none without a valid whole, and the format leaves them out of the text.
     */
    const writable = async (
        assertions: readonly Assertion[],
    ): Promise<Assertion[]> => {
        const stated = statedAssertions(assertions);
        if (!field.binding.readsInWhole?.()) return stated;
        const read = await field.binding.process('', { chosen: stated });
        return [...stated, ...read.assertions.filter(takenFromWhole)];
    };
    /** What a facet stores: its own category only. */
    const owned = (reading: ComposerReading): ComposerReading => {
        const category = field.ownCategory?.();
        if (!category) return reading;
        const mine = (list: readonly Assertion[]) =>
            list.filter((a) => a.categoryId === category);
        return {
            ...reading,
            assertions: mine(reading.assertions),
        };
    };
    return {
        read: async (text, base) =>
            judged(
                field.shape === 'whole'
                    ? await readWholeDraft(
                          field.binding,
                          text,
                          field.committed().assertions,
                          field.formatId(),
                      )
                    : await readAdditiveDraft(
                          field.binding,
                          text,
                          base ?? [],
                          add,
                          field.formatId(),
                      ),
            ),
        write: field.binding.write
            ? async (assertions) => {
                  const written = await field.binding.write!(
                      await writable(assertions),
                  );
                  const refusal = renderViewRefusalMessages(
                      field.formatId(),
                      written,
                  );
                  return refusal.length > 0
                      ? { rendered: '', refusal }
                      : { rendered: written.rendered };
              }
            : undefined,
        render: async (assertions) =>
            judged(
                await renderAssertions(
                    field.binding,
                    assertions,
                    field.formatId(),
                ),
            ),
        suggestions: (live) => field.suggestions(live),
        gated: (query, live) => field.gated(query, live),
        committed: () => field.committed(),
        reentered: () => field.reentered?.(),
        kept: () => field.kept?.(),
        store: (reading, commit) => field.store(owned(reading), commit),
        separators: () => {
            const format = field
                .meta()
                .formats?.find((f) => f.id === field.formatId());
            return format ? getPublicFormatSeparators(format) : [];
        },
        categories: () => {
            const bound = field.categoryId?.();
            const meta = field.meta();
            const listed = field.scopes?.() ?? [];
            if (listed.length > 1) {
                // A field across scopes edits each scope's categories, scope
                // by scope, and names the scope each one belongs to.
                return categoriesByScope(
                    field
                        .scheme()
                        .categories.filter((c) => !bound || c.id === bound),
                    listed,
                    meta,
                ).flatMap((group) =>
                    group.categories.map((c) => ({
                        id: c.id,
                        label: c.label,
                        single: c.single === true,
                        required: c.required === true,
                        scope: scopeLabel(group.scope, meta),
                    })),
                );
            }
            const { surface, defaultSurface } = fieldSurfaces(
                meta,
                field.formatId(),
                field.scope?.(),
            );
            const order = new Map(
                getPublicFormatLayout(meta, field.formatId()).categoryOrder.map(
                    (id, index) => [id, index],
                ),
            );
            return field
                .scheme()
                .categories.filter((c) => !bound || c.id === bound)
                .filter((c) => !ownedElsewhere(c, surface, defaultSurface))
                .sort(
                    (a, b) =>
                        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
                )
                .map((c) => ({
                    id: c.id,
                    label: c.label,
                    single: c.single === true,
                    required: c.required === true,
                }));
        },
        aliases: (conceptId) =>
            field.scheme().concepts.find((c) => c.id === conceptId)?.aliases ??
            [],
        add,
        remove: (assertions, ref) =>
            removeAssertionCascade(
                [...assertions],
                ref.conceptId,
                ref.categoryId,
                field.scheme(),
                field.meta(),
            ),
        conceptName: (conceptId) => {
            const concept = field
                .scheme()
                .concepts.find((c) => c.id === conceptId);
            return concept?.name || concept?.views?.['default'] || conceptId;
        },
        suggestionFor: (a) =>
            suggestionForAssertion(a, field.scheme(), field.formatId()),
    };
}

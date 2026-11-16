import type {
    ContextSchemeEngineAdapter,
    RenderFormatLayout,
    SchemeMetaView,
} from '@ezclassify/types';
import { inDeclarationOrder, scopesOfCategory } from './scopes';
import { isStandalonePart, partWholeOf } from './binding-model';
import type { FormsContext } from './forms/types';

/** Per-field render-format attribute. */
const FORMAT_ATTR = 'data-ezclassify-format';

/**
 * Read the author-declared render-format attribute for a field.
 *
 * Returns the raw `data-ezclassify-format` string (possibly empty) or null when
 * the attribute is absent; callers apply their own default fallback.
 */
export function resolveFormatAttr(field: Element): string | null {
    return field.getAttribute(FORMAT_ATTR);
}

/**
 * The output a field's format spelling names, as the scheme's metadata lists
 * its outputs.
 *
 * A field may name its format the ways a request may. An output's own id names
 * that output. For a scheme that declares its outputs by surface, a bare view
 * id names the view by that id on the field's surface. Either comes back as the
 * output's id, the one a process names it by in `outputs` and keys it by in
 * `renders`.
 *
 * Undefined when the metadata lists no such output: a spelling the scheme does
 * not have, a view the field's surface does not have, or a format id that is
 * only one of a view's forms, which the metadata does not map to its view.
 *
 * @param outputs - The outputs the scheme lists, as `formats` in its metadata
 *   or `formats` on its public view
 * @param spelling - The format the field names
 * @param surface - The scope id of the surface the field writes
 * @returns The output's id, or undefined
 */
export function resolveOutput(
    outputs: readonly { id: string; surface?: string; outputView?: string }[],
    spelling: string,
    surface: string | undefined,
): string | undefined {
    if (outputs.some((output) => output.id === spelling)) return spelling;
    return outputs.find(
        (output) =>
            output.outputView === spelling && output.surface === surface,
    )?.id;
}

/**
 * The scope id of the surface a scheme writes when a request names no output:
 * the surface of its default output, as its metadata lists its outputs.
 *
 * A bare view id on a field that declares no surface of its own names the view
 * on this surface. It is read off the default output rather than the scheme's
 * default scope, because a scheme without declared scopes may omit
 * `default_scope`, while its output still names a surface.
 *
 * @param outputs - The outputs the scheme lists, as `formats` in its metadata
 *   or `formats` on its public view
 * @param defaultOutput - The scheme's `defaultRenderFormat`
 * @returns The scope id, or undefined when the scheme lists no default output
 */
export function defaultSurfaceOf(
    outputs: readonly { id: string; surface?: string }[],
    defaultOutput: string | undefined,
): string | undefined {
    return outputs.find((output) => output.id === defaultOutput)?.surface;
}

/**
 * The output a scope's surface writes a marking of a role in when a request
 * names none, as the scheme's metadata lists its outputs.
 *
 * For a scheme that declares its outputs by surface, that is the view on the
 * scope's surface whose `defaultFor` includes the role. A scheme whose formats
 * are its outputs has one default, `defaultOutput`, which answers for its own
 * surface; another surface takes the first format that writes it. Undefined
 * when the scheme lists no output for the scope.
 *
 * @param outputs - The outputs the scheme lists, as `formats` in its metadata
 * @param scope - The scope id of the surface
 * @param role - The role of the marking written
 * @param defaultOutput - The scheme's `defaultRenderFormat`
 * @returns The output's id, or undefined
 */
export function defaultOutputOf(
    outputs: readonly {
        id: string;
        surface?: string;
        defaultFor?: readonly string[];
    }[],
    scope: string,
    role: 'whole' | 'part',
    defaultOutput: string | undefined,
): string | undefined {
    const onSurface = outputs.filter((output) => output.surface === scope);
    return (
        onSurface.find((output) => output.defaultFor?.includes(role))?.id ??
        onSurface.find((output) => output.id === defaultOutput)?.id ??
        onSurface[0]?.id
    );
}

/**
 * The output a view of some of a scheme's scopes is written in: the default
 * output, for the view's role, of the first of those scopes in the scheme's
 * declaration order (see {@link defaultOutputOf}). With no scope named, or none
 * the scheme lists an output for, the scheme's own default for the role.
 *
 * @param meta - The scheme's metadata
 * @param scopes - The scope ids the view names
 * @param part - Whether the view shows a part
 * @returns The output's id
 */
export function viewOutputOf(
    meta: Pick<
        SchemeMetaView,
        | 'formats'
        | 'scopes'
        | 'defaultScope'
        | 'defaultRenderFormat'
        | 'defaultPartRenderFormat'
        | 'defaultWholeRenderFormat'
    >,
    scopes: readonly string[],
    part: boolean,
): string {
    const first = inDeclarationOrder(scopes, meta)[0];
    const role = part ? 'part' : 'whole';
    const scoped =
        first === undefined
            ? undefined
            : defaultOutputOf(
                  meta.formats ?? [],
                  first,
                  role,
                  meta.defaultRenderFormat,
              );
    return (
        scoped ??
        (part ? meta.defaultPartRenderFormat : meta.defaultWholeRenderFormat) ??
        meta.defaultRenderFormat ??
        ''
    );
}

/** One surface a field asks the engine what it offers on. */
export interface SuggestionSurface {
    /** The output the answer is written for. */
    outputFormat: string;
    /** The scope id of the surface; absent for the whole marking. */
    surface?: string;
}

/**
 * Where a field asks what it offers: on its own surface in its own format, or,
 * for a field across several scopes, on each listed scope in that scope's own
 * output (see {@link viewOutputOf}). The scheme offers a scope's categories on
 * that scope's surface, so a field across scopes asks each of them.
 *
 * @param meta - The scheme's metadata
 * @param formatId - The field's format
 * @param scope - The field's one scope, if it lists exactly one
 * @param scopes - The scope ids the field lists
 * @param part - Whether the field shows a part
 */
export function suggestionSurfaces(
    meta: Parameters<typeof viewOutputOf>[0],
    formatId: string,
    scope: string | undefined,
    scopes: readonly string[] | undefined,
    part: boolean,
): SuggestionSurface[] {
    if (!scopes || scopes.length < 2)
        return [{ outputFormat: formatId, surface: scope }];
    return inDeclarationOrder(scopes, meta).map((listed) => ({
        outputFormat: viewOutputOf(meta, [listed], part),
        surface: listed,
    }));
}

/**
 * Whether the output a field's format spelling names can write a marking on
 * more than one line, as the scheme's metadata lays that output out: a block of
 * more than one category puts each on its own line, and any text the layout
 * writes between or around values may hold a break. False when the metadata
 * lists no layout for the spelling, which proves nothing either way.
 *
 * @param outputs - The outputs the scheme lists, with their layouts
 * @param spelling - The format the field names
 * @param surface - The scope id of the surface the field writes
 */
export function writesSeveralLines(
    outputs: readonly RenderFormatLayout[],
    spelling: string,
    surface: string | undefined,
): boolean {
    const id = resolveOutput(outputs, spelling, surface);
    const layout = outputs.find((output) => output.id === id);
    if (!layout) return false;
    if (layout.mode === 'block' && layout.categoryOrder.length > 1) return true;
    const written = [
        layout.prefix,
        layout.suffix,
        layout.separator,
        ...Object.values(layout.categorySeparators ?? {}),
        ...Object.values(layout.separatorBefore ?? {}),
        ...Object.values(layout.categoryEach ?? {}).flatMap((each) =>
            Object.values(each),
        ),
    ];
    return written.some(
        (text) => typeof text === 'string' && /[\r\n]/.test(text),
    );
}

/**
 * Refuse a text field whose scopes its format cannot write as one string.
 *
 * A text field shows one string, so a field that lists several scopes shows
 * them together only when its format writes the categories of every one of
 * them. Whether it does is the scheme's to say, through the coverage its view
 * reports for that format: a scheme whose one format carries every scope a host
 * lists renders them as one string, and a scheme that writes them in separate
 * places keeps them in separate fields. A coverage the view cannot report
 * proves nothing, so it refuses too.
 *
 * A field writes only the scopes it lists, one or several, so a format on the
 * surface of a scope it does not list, or one that writes a category of no
 * listed scope, is refused as well. A field that lists no scope writes the
 * default scope's own output and has nothing to check.
 *
 * @param engine - The field's scheme view
 * @param categories - The scheme's categories, with the scopes they declare
 * @param spelling - The format the field writes, as it names it
 * @param scopes - The scope ids the field lists
 * @param component - Names the field in the error
 * @throws Error naming the scopes and the format, and the scopes it leaves out
 */
export function assertWritesScopes(
    engine: Pick<
        ContextSchemeEngineAdapter,
        'getSchemeMeta' | 'getFormatCoverage'
    >,
    categories: ReadonlyArray<{ id: string; scopes?: readonly string[] }>,
    spelling: string,
    scopes: readonly string[],
    component: string,
): void {
    if (scopes.length === 0) return;
    const meta = engine.getSchemeMeta();
    const listed = inDeclarationOrder(scopes, meta);
    const declared = new Set((meta.scopes ?? []).map((scope) => scope.id));
    if (meta.defaultScope) declared.add(meta.defaultScope);
    const quoted = (ids: readonly string[]) =>
        ids.map((id) => `"${id}"`).join(', ');
    const named = `[ezclassify] ${component}: data-ezclassify-scope lists ${quoted(listed)}`;
    const unknown = listed.filter((scope) => !declared.has(scope));
    if (unknown.length > 0) {
        throw new Error(
            `${named}, and the scheme declares no scope ${quoted(unknown)}.`,
        );
    }
    const output = (meta.formats ?? []).find(
        (format) =>
            format.id ===
            resolveOutput(meta.formats ?? [], spelling, listed[0]),
    );
    if (output?.surface && !listed.includes(output.surface)) {
        throw new Error(
            `${named}, but its format "${spelling}" writes the surface of ` +
                `"${output.surface}". A field writes only the scopes it lists. ` +
                'Name a format of those scopes in data-ezclassify-format, or ' +
                'list the scope the format writes.',
        );
    }
    const covered = formatCoverage(engine, spelling, listed[0]);
    // One scope needs no other written beside it, so a coverage the view
    // cannot report leaves nothing to refuse.
    if (covered === undefined && listed.length === 1) return;
    const beyond =
        covered === undefined
            ? []
            : categories
                  .filter(
                      (category) =>
                          covered.has(category.id) &&
                          !scopesOfCategory(category, meta).some((scope) =>
                              listed.includes(scope),
                          ),
                  )
                  .map((category) => category.id);
    if (beyond.length > 0) {
        throw new Error(
            `${named}, but its format "${spelling}" also writes ` +
                `${quoted(beyond)}, of no scope it lists. A field writes only ` +
                'the scopes it lists. Name a format of those scopes in ' +
                'data-ezclassify-format, or list the scopes it writes.',
        );
    }
    // A field of one scope writes that scope's output, whichever of the
    // scope's categories it leaves to other outputs.
    if (listed.length === 1) return;
    const unwritten =
        covered === undefined
            ? listed
            : listed.filter((scope) =>
                  categories.some(
                      (category) =>
                          scopesOfCategory(category, meta).includes(scope) &&
                          !covered.has(category.id),
                  ),
              );
    if (unwritten.length === 0) return;
    const gap =
        covered === undefined
            ? `the scheme reports no coverage for its format "${spelling}"`
            : `its format "${spelling}" does not write the categories of ${quoted(unwritten)}`;
    throw new Error(
        `${named}, but ${gap}. A text field shows its scopes as one string, ` +
            'so one format has to write them all. Name such a format in ' +
            'data-ezclassify-format, or give each scope a field of its own.',
    );
}

/**
 * The categories one format writes, by the coverage the view reports for the
 * output its spelling names, else for the spelling itself. Undefined when the
 * view reports none for it.
 */
function formatCoverage(
    engine: Pick<
        ContextSchemeEngineAdapter,
        'getSchemeMeta' | 'getFormatCoverage'
    >,
    spelling: string,
    surface: string | undefined,
): Set<string> | undefined {
    if (!engine.getFormatCoverage) return undefined;
    const meta = engine.getSchemeMeta();
    const output = resolveOutput(meta.formats ?? [], spelling, surface);
    try {
        return new Set(
            engine.getFormatCoverage(output ?? spelling).coveredCategories,
        );
    } catch {
        return undefined;
    }
}

/**
 * The categories a field's format writes, as the scheme view reports coverage
 * for the output the field's format spelling names (see {@link resolveOutput}).
 *
 * Coverage is reported per output, so the spelling is resolved first: a bare
 * view id names that view on the field's surface. A spelling the scheme lists
 * no output for, such as a format id that is only one of a view's forms, has no
 * coverage the view can report. The answer is then undefined, as it is for a
 * view that reports no coverage at all, and undefined turns carry-forward off.
 *
 * @param engine - The field's scheme view
 * @param spelling - The format the field names
 * @param surface - The scope id of the surface the field writes; defaults to
 *   the surface of the scheme's default output
 * @returns The covered category ids, or undefined
 */
export function coveredCategoriesOf(
    engine: Pick<
        ContextSchemeEngineAdapter,
        'getSchemeMeta' | 'getFormatCoverage'
    >,
    spelling: string,
    surface: string | undefined,
): Set<string> | undefined {
    if (!engine.getFormatCoverage) return undefined;
    const meta = engine.getSchemeMeta();
    const outputs = meta.formats ?? [];
    const output = resolveOutput(
        outputs,
        spelling,
        surface ?? defaultSurfaceOf(outputs, meta.defaultRenderFormat),
    );
    return output === undefined
        ? undefined
        : new Set(engine.getFormatCoverage(output).coveredCategories);
}

/**
 * The whole the marking a field shows is a part of.
 *
 * A field shows the marking it is bound to or is a facet of, else its own. That
 * marking is a part when its host sits in a `data-ezclassify-whole` container
 * other than as the named whole, or names a whole in `data-ezclassify-part-of`
 * (see `binding-model.ts`).
 *
 * @param field - The field's host element
 * @returns The whole's id, or null when the marking the field shows is no part
 */
export function wholeOfShownMarking(field: Element): string | null {
    const host = hostOfShownMarking(field);
    return host ? partWholeOf(host) : null;
}

/**
 * Whether the marking a field shows is a part with no whole on the page (see
 * `isStandalonePart`).
 *
 * @param field - The field's host element
 * @returns True when the marking the field shows has no whole to read against
 */
export function showsStandalonePart(field: Element): boolean {
    const host = hostOfShownMarking(field);
    return !!host && isStandalonePart(host);
}

/**
 * Whether the marking a field shows is a part: of another marking (see
 * {@link wholeOfShownMarking}), or with no whole on the page.
 *
 * @param field - The field's host element
 * @returns True when the marking the field shows is a part
 */
export function holdsPart(field: Element): boolean {
    return wholeOfShownMarking(field) !== null || showsStandalonePart(field);
}

/** The host of the marking a field is bound to or a facet of, else the field. */
function hostOfShownMarking(field: Element): Element | null {
    const shown =
        field.getAttribute('data-ezclassify-bound-to') ??
        field.getAttribute('data-ezclassify-facet-of');
    return shown ? field.ownerDocument.getElementById(shown) : field;
}

/**
 * Resolve the render-format ID for a field from its attributes, falling back to
 * the context default: the part default for a field that shows a part (see
 * {@link holdsPart}), the default format for any other.
 */
export function getFormat(ctx: FormsContext, field: HTMLInputElement): string {
    const dataFormat = resolveFormatAttr(field);
    if (dataFormat && dataFormat.length > 0) return dataFormat;
    return holdsPart(field) ? ctx.defaultPartFormat : ctx.defaultFormat;
}

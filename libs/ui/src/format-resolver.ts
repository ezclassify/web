import type { ContextSchemeEngineAdapter } from '@ezclassify/types';
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

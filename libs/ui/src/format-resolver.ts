import type { FormsContext } from './forms/types';

/** Per-field render-format attribute. */
const FORMAT_ATTR = 'data-ezclassify-format';

/** Names the whole marking a marking host is part of. */
const PART_OF_ATTR = 'data-ezclassify-part-of';

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
 * The whole the marking a field shows is a part of.
 *
 * A field shows the marking it is bound to or is a facet of, else its own. That
 * marking is a part when its host names a whole in `data-ezclassify-part-of`,
 * which is also what registers it with the store as a part of that whole.
 *
 * @param field - The field's host element
 * @returns The whole's id, or null when the marking the field shows is no part
 */
export function wholeOfShownMarking(field: Element): string | null {
    const shown =
        field.getAttribute('data-ezclassify-bound-to') ??
        field.getAttribute('data-ezclassify-facet-of');
    const host = shown ? field.ownerDocument.getElementById(shown) : field;
    return host?.getAttribute(PART_OF_ATTR) ?? null;
}

/**
 * Whether the marking a field shows is a part of another marking (see
 * {@link wholeOfShownMarking}).
 *
 * @param field - The field's host element
 * @returns True when the marking the field shows is a part
 */
export function holdsPart(field: Element): boolean {
    return wholeOfShownMarking(field) !== null;
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

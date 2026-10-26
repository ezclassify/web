/**
 * A marking token's source ownership. Body bytes follow it until the next
 * token.
 */
export interface MarkingEntrySpan {
    entryId?: string;
    start: number;
    end: number;
}

/**
 * Retain identity only where a single text edit proves the token's ownership. A
 * replaced block containing several marks gets new identities; assigning old
 * IDs by ordinal could apply a late edit to an unrelated paragraph.
 */
export function reconcileEntryIds(
    before: string,
    previous: readonly MarkingEntrySpan[],
    after: string,
    next: readonly MarkingEntrySpan[],
    allocate: () => string,
): string[] {
    const mapped = new Map(
        rebaseEntrySpans(before, previous, after).map((span) => [
            JSON.stringify([span.start, span.end]),
            span.entryId!,
        ]),
    );
    return next.map(
        (span) =>
            mapped.get(JSON.stringify([span.start, span.end])) ?? allocate(),
    );
}

/**
 * The one contiguous edit that turns `before` into `after`: it replaced
 * `before.slice(prefix, oldEnd)`, and every offset at or after `oldEnd` moved
 * by `delta`.
 */
export interface TextEdit {
    prefix: number;
    oldEnd: number;
    delta: number;
}

/** Find the single edit between two texts by their common prefix and suffix. */
export function textEdit(before: string, after: string): TextEdit {
    let prefix = 0;
    while (
        prefix < before.length &&
        prefix < after.length &&
        before[prefix] === after[prefix]
    )
        prefix++;
    let suffix = 0;
    while (
        suffix < before.length - prefix &&
        suffix < after.length - prefix &&
        before[before.length - suffix - 1] === after[after.length - suffix - 1]
    )
        suffix++;
    return {
        prefix,
        oldEnd: before.length - suffix,
        delta: after.length - before.length,
    };
}

/**
 * Where an offset in the text before `edit` lands after it. An offset inside
 * the replaced range lands at the start of what replaced it.
 */
export function rebaseOffset(edit: TextEdit, offset: number): number {
    if (offset <= edit.prefix) return offset;
    if (offset >= edit.oldEnd) return offset + edit.delta;
    return edit.prefix;
}

/** Retain only source spans a single edit can map without guessing ownership. */
export function rebaseEntrySpans(
    before: string,
    previous: readonly MarkingEntrySpan[],
    after: string,
): MarkingEntrySpan[] {
    const { prefix, oldEnd, delta } = textEdit(before, after);
    const mapped: MarkingEntrySpan[] = [];
    for (const span of previous) {
        if (!span.entryId) continue;
        let start: number;
        let end: number;
        if (span.end <= prefix) {
            start = span.start;
            end = span.end;
        } else if (span.start >= oldEnd) {
            start = span.start + delta;
            end = span.end + delta;
        } else if (span.start <= prefix && span.end >= oldEnd) {
            start = span.start;
            end = span.end + delta;
        } else continue;
        mapped.push({ entryId: span.entryId, start, end });
    }
    return mapped;
}

/**
 * Replace/reorder token-owned spans without discarding unmarked body bytes. A
 * removed token leaves its body at its original boundary. A reordered token
 * moves with its body; newly added tokens have no body and append on a new
 * line.
 */
export function projectEntrySpans(
    text: string,
    spans: readonly (MarkingEntrySpan & { entryId: string })[],
    requested: readonly { entryId: string; marking: string }[],
): {
    text: string;
    spans: Array<MarkingEntrySpan & { entryId: string }>;
    bodyMappings: Array<{ start: number; end: number; projectedStart: number }>;
} {
    const bodies = new Map(
        spans.map((span, i) => [
            span.entryId,
            text.slice(span.end, spans[i + 1]?.start ?? text.length),
        ]),
    );
    const bodySources = new Map(
        spans.map((span, i) => [
            span.entryId,
            { start: span.end, end: spans[i + 1]?.start ?? text.length },
        ]),
    );
    const bodyMappings = [
        { start: 0, end: spans[0]?.start ?? text.length, projectedStart: 0 },
    ];
    const tokens = new Map(
        requested.map((entry) => [entry.entryId, entry.marking]),
    );
    const existing = requested.filter((entry) => bodies.has(entry.entryId));
    let cursor = 0;
    let output = text.slice(0, spans[0]?.start ?? text.length);
    const projected: Array<MarkingEntrySpan & { entryId: string }> = [];
    const append = (
        entryId: string,
        marking: string,
        body: string,
        moved = false,
    ) => {
        if (moved && projected.length && output && !output.endsWith('\n'))
            output += '\n';
        const start = output.length;
        output += marking;
        // Empty entries retain an anchor, not an invented marking token.
        projected.push({ entryId, start, end: output.length });
        const source = bodySources.get(entryId);
        if (source)
            bodyMappings.push({ ...source, projectedStart: output.length });
        output += body;
    };
    for (const span of spans) {
        if (!tokens.has(span.entryId)) {
            bodyMappings.push({
                ...bodySources.get(span.entryId)!,
                projectedStart: output.length,
            });
            output += bodies.get(span.entryId)!;
            continue;
        }
        const entry = existing[cursor++];
        append(
            entry.entryId,
            entry.marking,
            bodies.get(entry.entryId)!,
            entry.entryId !== span.entryId,
        );
    }
    for (const entry of requested) {
        if (bodies.has(entry.entryId)) continue;
        if (output && !output.endsWith('\n')) output += '\n';
        append(entry.entryId, entry.marking, '');
    }
    return { text: output, spans: projected, bodyMappings };
}

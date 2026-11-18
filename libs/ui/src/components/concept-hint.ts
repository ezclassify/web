/** The native title and accessible explanation used by editable choices. */
export function conceptHint(
    name: string,
    label: string,
    definition: string,
    why?: string | null,
): { title: string; description: string } {
    const lines = [why ?? '', name !== label ? name : '', definition].filter(
        Boolean,
    );
    return {
        title: lines.join('\n'),
        description: lines
            .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
            .join(' '),
    };
}

/** Name a hint in its configured view; value-taking views remain templates. */
export function conceptHintName(
    concept: {
        id: string;
        name?: string;
        views?: Record<string, string>;
        textInput?: unknown;
    },
    view?: string,
): string {
    const named = concept.name || concept.id;
    return view && !concept.textInput ? concept.views?.[view] || named : named;
}

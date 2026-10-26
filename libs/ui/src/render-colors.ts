/** Background, text, and border colors for a marking at a given level. */
export interface RenderColor {
    background: string;
    text: string;
    border?: string;
}

/** Mapping of render color keys to values. */
export type RenderColorMap = Record<string, RenderColor>;

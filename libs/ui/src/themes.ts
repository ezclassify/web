/**
 * A named set of CSS custom-property overrides for input, dropdown, badge, and
 * notice styling.
 */
export interface EzTheme {
    name: string;
    input: Record<string, string>;
    dropdown: Record<string, string>;
    badge: Record<string, string>;
    notice: Record<string, string>;
}

export const THEMES: Record<string, EzTheme> = {
    government: {
        name: 'Government',
        input: {
            '--ez-color-text': '#e8e6e3',
            '--ez-color-background': '#1b2a4a',
            '--ez-color-border': '#3d5a80',
            '--ez-color-border-focus': '#fdb827',
            '--ez-color-placeholder': '#8899aa',
            '--ez-color-muted': '#8899aa',
            '--ez-color-primary-contrast': '#1b2a4a',
            '--ez-color-surface': '#162040',
            '--ez-color-surface-hover': '#243b5e',
            '--ez-color-surface-active': '#2e4a72',
            '--ez-font-family': '"Segoe UI", system-ui, sans-serif',
            '--ez-focus-ring-shadow': '0 0 0 3px rgba(253, 184, 39, 0.2)',
            '--ez-tag-bg-alpha': '50',
        },
        dropdown: {
            '--ez-dropdown-background': '#1b2a4a',
            '--ez-dropdown-color': '#e8e6e3',
            '--ez-dropdown-item-hover': '#243b5e',
            '--ez-dropdown-highlight': 'rgba(253, 184, 39, 0.2)',
            '--ez-dropdown-selected': 'rgba(76, 175, 80, 0.15)',
            '--ez-dropdown-group-bg': 'rgba(255, 255, 255, 0.05)',
            '--ez-dropdown-shadow': '0 4px 12px rgba(0, 0, 0, 0.4)',
        },
        badge: {
            '--ez-color-primary': '#fdb827',
            '--ez-color-success': '#4caf50',
            '--ez-color-error': '#f87171',
            '--ez-color-warning': '#ff9800',
            '--ez-marking-label-default': '#3d5a80',
            '--ez-marking-label-text': '#e8e6e3',
            '--ez-kbd-background': 'rgba(255, 255, 255, 0.08)',
            '--ez-select-active-border': '#fdb827',
            '--ez-select-active-bg': 'rgba(253, 184, 39, 0.1)',
            '--ez-select-hover-shadow': '0 1px 4px rgba(0, 0, 0, 0.3)',
        },
        notice: {
            '--ez-color-text': '#e8e6e3',
            '--ez-color-background': '#162040',
            '--ez-color-border': '#3d5a80',
        },
    },

    corporate: {
        name: 'Corporate',
        input: {
            '--ez-color-text': '#1a1a2e',
            '--ez-color-background': '#ffffff',
            '--ez-color-border': '#d1d5db',
            '--ez-color-border-focus': '#2563eb',
            '--ez-color-placeholder': '#9ca3af',
            '--ez-color-muted': '#6b7280',
            '--ez-color-primary-contrast': '#ffffff',
            '--ez-color-surface': '#f8fafc',
            '--ez-color-surface-hover': '#f0f4ff',
            '--ez-color-surface-active': '#e0e7ff',
            '--ez-font-family': '"Inter", "Helvetica Neue", sans-serif',
            '--ez-focus-ring-shadow': '0 0 0 3px rgba(37, 99, 235, 0.1)',
        },
        dropdown: {
            '--ez-dropdown-background': '#ffffff',
            '--ez-dropdown-color': '#1a1a2e',
            '--ez-dropdown-item-hover': '#f0f4ff',
            '--ez-dropdown-highlight': 'rgba(37, 99, 235, 0.15)',
            '--ez-dropdown-selected': 'rgba(22, 163, 74, 0.1)',
            '--ez-dropdown-group-bg': 'rgba(0, 0, 0, 0.03)',
            '--ez-dropdown-shadow': '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
        },
        badge: {
            '--ez-color-primary': '#2563eb',
            '--ez-color-success': '#16a34a',
            '--ez-color-error': '#b91c1c',
            '--ez-color-warning': '#d97706',
            '--ez-kbd-background': 'rgba(0, 0, 0, 0.05)',
            '--ez-select-active-border': '#2563eb',
            '--ez-select-active-bg': 'rgba(37, 99, 235, 0.06)',
            '--ez-select-hover-shadow': '0 1px 4px rgba(0, 0, 0, 0.08)',
        },
        notice: {
            '--ez-color-text': '#1a1a2e',
            '--ez-color-background': '#f8fafc',
            '--ez-color-border': '#e2e8f0',
        },
    },

    minimal: {
        name: 'Minimal',
        input: {
            '--ez-color-text': '#374151',
            '--ez-color-background': '#fafafa',
            '--ez-color-border': '#e5e7eb',
            '--ez-color-border-focus': '#6b7280',
            '--ez-color-placeholder': '#9ca3af',
            '--ez-color-muted': '#9ca3af',
            '--ez-color-primary-contrast': '#ffffff',
            '--ez-color-surface': '#f3f4f6',
            '--ez-color-surface-hover': '#e5e7eb',
            '--ez-color-surface-active': '#d1d5db',
            '--ez-border-radius': '2px',
            '--ez-border-width': '0 0 1px 0',
            '--ez-font-family': '"system-ui", sans-serif',
            '--ez-focus-ring-shadow': '0 0 0 3px rgba(107, 114, 128, 0.1)',
        },
        dropdown: {
            '--ez-dropdown-background': '#fafafa',
            '--ez-dropdown-color': '#374151',
            '--ez-dropdown-item-hover': '#f3f4f6',
            '--ez-dropdown-highlight': 'rgba(107, 114, 128, 0.15)',
            '--ez-dropdown-selected': 'rgba(5, 150, 105, 0.1)',
            '--ez-dropdown-group-bg': 'rgba(0, 0, 0, 0.03)',
            '--ez-dropdown-shadow': '0 1px 3px rgba(0, 0, 0, 0.06)',
        },
        badge: {
            '--ez-color-primary': '#6b7280',
            '--ez-color-success': '#059669',
            '--ez-color-error': '#b91c1c',
            '--ez-color-warning': '#d97706',
            '--ez-kbd-background': 'rgba(0, 0, 0, 0.04)',
            '--ez-select-active-border': '#6b7280',
            '--ez-select-active-bg': 'rgba(107, 114, 128, 0.06)',
            '--ez-select-hover-shadow': '0 1px 3px rgba(0, 0, 0, 0.06)',
        },
        notice: {
            '--ez-color-text': '#374151',
            '--ez-color-background': '#f9fafb',
            '--ez-color-border': '#e5e7eb',
        },
    },

    dark: {
        name: 'Dark',
        input: {
            '--ez-color-text': '#e5e7eb',
            '--ez-color-background': '#1f2937',
            '--ez-color-border': '#4b5563',
            '--ez-color-border-focus': '#60a5fa',
            '--ez-color-placeholder': '#6b7280',
            '--ez-color-muted': '#9ca3af',
            '--ez-color-primary-contrast': '#1f2937',
            '--ez-color-surface': '#111827',
            '--ez-color-surface-hover': '#374151',
            '--ez-color-surface-active': '#3b5998',
            '--ez-font-family': 'system-ui, sans-serif',
            '--ez-focus-ring-shadow': '0 0 0 3px rgba(96, 165, 250, 0.2)',
            '--ez-tag-bg-alpha': '50',
        },
        dropdown: {
            '--ez-dropdown-background': '#1f2937',
            '--ez-dropdown-color': '#e5e7eb',
            '--ez-dropdown-item-hover': '#374151',
            '--ez-dropdown-highlight': 'rgba(96, 165, 250, 0.25)',
            '--ez-dropdown-selected': 'rgba(52, 211, 153, 0.15)',
            '--ez-dropdown-group-bg': 'rgba(255, 255, 255, 0.05)',
            '--ez-dropdown-shadow': '0 4px 12px rgba(0, 0, 0, 0.5)',
        },
        badge: {
            '--ez-color-primary': '#60a5fa',
            '--ez-color-success': '#34d399',
            '--ez-color-error': '#f87171',
            '--ez-color-warning': '#fbbf24',
            '--ez-marking-label-default': '#4b5563',
            '--ez-marking-label-text': '#e5e7eb',
            '--ez-kbd-background': 'rgba(255, 255, 255, 0.08)',
            '--ez-select-active-border': '#60a5fa',
            '--ez-select-active-bg': 'rgba(96, 165, 250, 0.1)',
            '--ez-select-hover-shadow': '0 1px 4px rgba(0, 0, 0, 0.3)',
        },
        notice: {
            '--ez-color-text': '#e5e7eb',
            '--ez-color-background': '#111827',
            '--ez-color-border': '#374151',
        },
    },
};

/**
 * Generate a CSS string that sets the custom properties for the given theme.
 *
 * The selector targets `[data-theme="<name>"]` so consumers can scope a theme
 * to any DOM subtree by adding the attribute.
 */
export function applyTheme(theme: EzTheme): string {
    const allVars: Record<string, string> = {
        ...theme.input,
        ...theme.dropdown,
        ...theme.badge,
        ...theme.notice,
    };

    const slug = theme.name.toLowerCase().replace(/\s+/g, '-');
    const declarations = Object.entries(allVars)
        .map(([prop, value]) => `  ${prop}: ${value};`)
        .join('\n');

    return `[data-theme="${slug}"] {\n${declarations}\n}`;
}

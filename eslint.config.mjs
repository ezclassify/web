import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            '**/*.d.ts',
            '**/*.js',
            '**/*.mjs',
            '**/*.cjs',
        ],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_' },
            ],
        },
    },
    {
        // Tests routinely construct deliberately partial or malformed adapters
        // to verify runtime boundaries. `any` is appropriate at that seam, but
        // unused values still indicate dead test setup and remain errors.
        files: ['**/*.spec.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    {
        files: ['integrations/react/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooksPlugin,
        },
        rules: {
            'react-hooks/exhaustive-deps': 'warn',
            'react-hooks/rules-of-hooks': 'error',
        },
    },
    {
        // The shared, scheme-agnostic component library must never name the
        // whole/part roles directly: the display noun is owned by the scheme
        // (vocabulary) and resolved through roleNoun() from @ezclassify/types.
        // Reading `.vocabulary.whole` / `.part` raw bypasses the singular/plural
        // resolution and the generic fallback, so it is banned here.
        files: ['libs/ui/src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "MemberExpression[property.name=/^(whole|part)$/][object.property.name='vocabulary']",
                    message:
                        "Don't read vocabulary.whole/.part directly; resolve the display noun via roleNoun(vocabulary, role, count) from @ezclassify/types so scheme vocabulary and singular/plural are honored.",
                },
            ],
        },
    },
];

/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

const path = require('path');

/** @type {import('eslint').Linter.Config} */
module.exports = {
    root: true,
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
            jsx: true,
        },
    },
    env: {
        browser: true,
        commonjs: true,
        es6: true,
    },
    ignorePatterns: ['!**/.server', '!**/.client', 'dist/**'],

    plugins: [
        '@typescript-eslint',
        'import',
        'unused-imports',
    ],

    // Base config
    extends: ['eslint:recommended'],

    overrides: [
        // React
        {
            files: ['**/*.{js,jsx,ts,tsx}'],
            plugins: ['react', 'jsx-a11y'],
            extends: [
                'plugin:react/recommended',
                'plugin:react/jsx-runtime',
                'plugin:react-hooks/recommended',
            ],
            settings: {
                react: {
                    version: 'detect',
                },
                formComponents: ['Form'],
                linkComponents: [
                    { name: 'Link', linkAttribute: 'to' },
                    { name: 'NavLink', linkAttribute: 'to' },
                ],
                'import/resolver': {
                    typescript: {},
                },
            },
            rules: {
                'react/jsx-no-target-blank': 'off',
            },
        },

        // TypeScript
        {
            files: ['**/*.{ts,tsx}'],
            plugins: ['@typescript-eslint', 'import'],
            parser: '@typescript-eslint/parser',
            settings: {
                'import/internal-regex': '^~/',
                'import/resolver': {
                    node: {
                        extensions: ['.ts', '.tsx'],
                    },
                    typescript: {
                        // eslint-disable-next-line no-undef
                        project: path.resolve(__dirname, './tsconfig.json'),
                        alwaysTryTypes: true,
                    },
                },
            },
            extends: [
                'plugin:@typescript-eslint/recommended',
                'plugin:import/recommended',
                'plugin:import/typescript',
            ],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
            },
        },

        // Node
        {
            files: ['.eslintrc.cjs'],
            env: {
                node: true,
            },
        },
    ],

    rules: {
        '@typescript-eslint/comma-dangle': ['error', {
            'objects': 'always-multiline',
            'arrays': 'always-multiline',
            'imports': 'always-multiline',
            'exports': 'always-multiline',
            'functions': 'only-multiline',
        }],
        '@typescript-eslint/indent': ['error', 4, { SwitchCase: 1 }],
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/quotes': ['error', 'single'],
        '@typescript-eslint/semi': ['error', 'always'],
        '@typescript-eslint/triple-slash-reference': 'off',
        'import/order': [
            'warn',
            {
                'alphabetize': {'order': 'asc', 'caseInsensitive': true},
                'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
                'newlines-between': 'always',
                'pathGroupsExcludedImportTypes': ['builtin'],
            },
        ],
        'unused-imports/no-unused-imports': 'warn',
        'jsx-quotes': ['error', 'prefer-double'],
        'no-constant-condition': ['error', {'checkLoops': false}],
        'no-irregular-whitespace': 'off',
        'no-trailing-spaces': 'error',
        'no-unused-vars': 'off',
    },
};

import { heroui } from '@heroui/react';

import type { Config } from 'tailwindcss';


export default {
    content: [
        './app/**/*.{js,jsx,ts,tsx}',
        './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                ink: '#080A0D',
                panel: '#11151B',
                line: '#29313B',
                muted: '#98A2B0',
                lime: '#CBF56C',
            },
            fontFamily: {
                sans: ['Open Sans', 'Noto Sans JP', 'sans-serif'],
            },
            boxShadow: {
                glow: '0 0 80px rgba(203, 245, 108, 0.08)',
            },
        },
    },
    darkMode: 'class',
    plugins: [
        heroui({
            defaultTheme: 'dark',
            defaultExtendTheme: 'dark',
            layout: {
                radius: {
                    small: '8px',
                    medium: '12px',
                    large: '18px',
                },
            },
            themes: {
                dark: {
                    colors: {
                        primary: {
                            DEFAULT: '#CBF56C',
                            foreground: '#11150A',
                        },
                        background: '#080A0D',
                        content1: '#11151B',
                    },
                },
            },
        }),
    ],
} satisfies Config;

import { HeroUIProvider } from '@heroui/react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, type MetaFunction } from '@remix-run/react';

import styles from '~/styles/global.scss?url';


export const meta: MetaFunction = () => [
    { title: 'Movie Cut Tile Generator' },
    { name: 'description', content: '動画のカットと動きを読み取り、一枚のタイル画像へ整理します。' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
    { name: 'color-scheme', content: 'dark' },
];

export const links = () => [
    { rel: 'stylesheet', href: styles },
    { rel: 'canonical', href: 'https://tools.tsukumijima.net/movie-cut-tile-generator/' },
];

export function HydrateFallback() {
    return (
        <html lang="ja" className="dark">
            <head>
                <meta charSet="utf-8" />
                <Meta />
                <Links />
            </head>
            <body>
                <div className="flex min-h-screen items-center justify-center bg-ink text-muted">起動しています…</div>
                <Scripts />
            </body>
        </html>
    );
}

export default function App() {
    return (
        <html lang="ja" className="dark">
            <head>
                <meta charSet="utf-8" />
                <Meta />
                <Links />
            </head>
            <body>
                <HeroUIProvider>
                    <Outlet />
                    <ScrollRestoration />
                    <Scripts />
                </HeroUIProvider>
            </body>
        </html>
    );
}

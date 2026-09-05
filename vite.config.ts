import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';
import babel from 'vite-plugin-babel';
import tsconfigPaths from 'vite-tsconfig-paths';


export default defineConfig({
    // 開発時と公開時で、アセットの取得先を同じサブパスに揃える
    base: '/movie-cut-tile-generator/',
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    build: {
        // HeroUI を含む単一ページのため、依存関係をまとめたチャンクの警告閾値を緩和する
        chunkSizeWarningLimit: 3 * 1024,
    },
    server: {
        host: '0.0.0.0',
        port: 8080,
        strictPort: true,
    },
    preview: {
        host: '0.0.0.0',
        port: 8080,
        strictPort: true,
    },
    plugins: [
        remix({
            ssr: false,
            // 画面のルーティングにもアセットと同じ基準パスを使う
            basename: '/movie-cut-tile-generator/',
            buildDirectory: 'dist',
            ignoredRouteFiles: ['**/.*', '**/*.scss', '**/*.css'],
        }),
        tsconfigPaths(),
        // コンポーネント内の signal を React の描画更新へ自動接続する
        babel({
            include: /\.[jt]sx?$/,
            babelConfig: {
                presets: [
                    ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
                    ['@babel/preset-react', { runtime: 'automatic' }],
                ],
                plugins: [['module:@preact/signals-react-transform', { mode: 'manual' }]],
            },
            exclude: [/entry\.server\.tsx$/, /node_modules/],
        }),
    ],
    css: {
        modules: {
            localsConvention: 'camelCase',
        },
    },
});

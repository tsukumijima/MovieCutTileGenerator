# Movie Cut Tile Generator

動画の流れを、タイムスタンプ付きの1枚の画像で見渡せる Web アプリです。  
動画を読み込むとカットの変化と動き量を解析し、内容を追いやすい代表フレームを自動で選んで並べます。

処理はすべてブラウザ内で完結するため、動画ファイルがサーバーへ送信されることはありません。

### できること

- MP4, MOV, WebM 動画からカットタイルを自動生成
- 複数の動画をまとめて追加し、順番に処理
- 代表フレームの枚数と横方向のタイル数を調整
- PNG または JPEG で個別保存、一括保存

### 使い方

1. 動画を画面へドラッグして追加するか、クリックして選択します
2. 自動生成された画像を確認し、必要に応じてフレーム数や列数、出力形式を調整して再生成します
3. 「単独保存」または「すべて保存」から画像を保存します

対応するコーデックはブラウザや端末によって異なります。

### ローカルで動かす

Node.js 22 以降が必要です。

```bash
npm install
npm run dev
```

起動後、[http://localhost:8080/movie-cut-tile-generator/](http://localhost:8080/movie-cut-tile-generator/) を開きます。

### ビルドとプレビュー

```bash
npm run build
npm run preview
```

Cloudflare Workers の静的配信をローカルで起動します。  
開発時と同じ URL で、ビルドしたアプリを確認できます。

ビルド成果物は `dist/movie-cut-tile-generator/` に出力され、`dist/` を Workers Static Assets へ配置します。  
公開先は [Movie Cut Tile Generator](https://tools.tsukumijima.net/movie-cut-tile-generator/) です。

### デプロイ

Cloudflare Workers の Git 連携で、[tsukumijima/MovieCutTileGenerator](https://github.com/tsukumijima/MovieCutTileGenerator) の `master` ブランチへの push 時に自動デプロイします。  
Worker 名は `movie-cut-tile-generator` です。

ビルドコマンドは `npm run build`、デプロイコマンドは `npx wrangler deploy`、ビルド環境の変数は `NODE_VERSION=22` に設定しています。

本番の Route `tools.tsukumijima.net/movie-cut-tile-generator/*` は Cloudflare ダッシュボードで管理しています。  
[workers.dev の確認用 URL](https://movie-cut-tile-generator.tsukumijima.workers.dev/movie-cut-tile-generator/) でも公開したアプリを確認できます。

### ライセンス

[License.txt](./License.txt) をご覧ください。

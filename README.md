# svg-web

`svg-app` の WASM 変換エンジンをブラウザで使う React + TypeScript (Vite) アプリです。変換はすべてブラウザ内(Web Worker 上の WASM)で実行され、サーバーは不要です。

## 起動

```powershell
npm install
npm run dev      # WASM を ..\svg-app\dist\wasm から src\wasm にコピーしてから起動
npm run build    # 型チェック + 本番ビルド
```

WASM の場所は環境変数 `SVG_WASM_DIR` で変更できます。`src/wasm/svg-converter.{js,wasm}` はコピー生成物で、git 管理外です。

## 構成

- `src/converter/worker.ts` — WASM を初期化し `convertImage` を呼ぶ Worker(`.wasm` は `?url` と `locateFile` で解決)
- `src/converter/decode.ts` — ブラウザで PNG/JPEG をデコードして非乗算 RGBA を取得
- `src/converter/limits.ts` — 色数(2,3,4,5,6,8,12,16,24,32)と画像サイズ上限(20MB / 1辺4096px / 400万画素)
- SVG は Blob URL を `<img>` に設定して表示するため、DOM に挿入されずスクリプトも実行されません。

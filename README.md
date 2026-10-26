# SVG Web

C++とOpenCVで実装したSVG変換エンジンをWebAssembly（WASM）経由で利用する、React・TypeScript製のWebアプリです。

**公開デモ：** https://svg.art-full-stack.com/

## 概要

PNGやJPEGなどのラスター画像を読み込み、SVG形式のベクター画像に変換します。

画像のデコード、変換処理、SVGのプレビューはブラウザ内で実行されます。画像を変換するためのバックエンドサーバーは不要です。

## 使用技術

- React
- TypeScript
- Vite
- C++20
- OpenCV
- WebAssembly（WASM）
- Web Worker

## 主な機能

- ラスター画像の読み込みとSVGへの変換
- 色数の指定（2、3、4、5、6、8、12、16、24、32）
- 変換結果のSVGプレビュー
- Web Workerによる変換処理の実行
- 画像サイズなどの入力制限
- Blob URLを利用したSVGプレビュー

## アーキテクチャ

本アプリは、React・TypeScript製のフロントエンドと、WebAssembly化したC++の変換エンジンで構成されています。

### 変換処理

- `src/converter/worker.ts`：WASMを初期化し、変換関数 `convertImage` を呼び出すWeb Workerです。
- `src/converter/decode.ts`：ブラウザでPNG・JPEG画像をデコードし、非乗算RGBAデータを取得します。
- `src/converter/limits.ts`：対応する色数と画像サイズの上限を管理します。
- `src/wasm/`：C++の変換エンジンから生成したWASM関連ファイルを配置します。

変換処理をWeb Worker上で実行することで、UIの処理と画像変換処理を分離しています。

### 画像処理とデータの取り扱い

画像の変換はブラウザ内で実行し、変換のために画像をバックエンドサーバーへ送信しない構成です。

生成したSVGはBlob URLを使って画像要素としてプレビューします。SVGをHTMLのDOMとして直接挿入する方式は使用していません。

## 入力制限

現時点の設定は次のとおりです。

- 対応形式：PNG、JPEG
- 最大ファイルサイズ：20 MB
- 画像の最大幅・高さ：各4096 px
- 最大画素数：400万画素
- 色数：2、3、4、5、6、8、12、16、24、32

## 開発環境

- Node.js
- npm
- C++変換エンジンをビルドできる環境
- Emscriptenなど、WASMビルドに必要な環境

## 起動方法

依存パッケージをインストールします。

```powershell
npm install
```

開発サーバーを起動します。

```powershell
npm run dev
```

開発用の起動スクリプトは、`svg-app` の `dist/wasm` にあるWASM関連ファイルを `src/wasm` にコピーしてから実行します。

## 本番ビルド

```powershell
npm run build
```

このコマンドでは型チェックと本番用ビルドを実行します。

## WASMファイルの管理

WASMファイルの配置元は環境変数 `SVG_WASM_DIR` で変更できます。

`src/wasm/svg-converter.js` および `src/wasm/svg-converter.wasm` はビルド生成物のため、Git管理対象外としています。

開発環境では、対応するC++変換エンジンをビルドし、WASMファイルを生成しておく必要があります。

## 今後の開発予定

- 変換結果の品質改善
- さまざまなサンプル画像による検証
- 自動テストの導入
- エラー表示や操作性の改善
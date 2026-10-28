# SVG Web

C++とOpenCVで実装したSVG変換エンジンをWebAssembly（WASM）経由で利用する、React・TypeScript製のWebアプリです。

**公開デモ：** https://svg.art-full-stack.com/

## 概要

PNGやJPEGなどのラスター画像を読み込み、SVG形式のベクター画像に変換するWebアプリです。

変換処理には、C++とOpenCVで実装した画像変換エンジンを使用しています。変換方式は次の2つに対応しています。

- **ブラウザ内変換**：WebAssembly（WASM）を利用して、ブラウザ内で変換を実行
- **サーバー変換**：Go REST API経由でC++ gRPCサーバーに変換を依頼

ブラウザ内変換は、画像を変換サーバーへ送信せずに利用できます。サーバー変換では、画像データがサーバーへ送信されます。

公開デモとAWS上の検証環境は別の環境です。

## 使用技術

### フロントエンド

- React
- TypeScript
- Vite
- WebAssembly（WASM）
- Web Worker

### 画像変換エンジン・バックエンド

- C++20
- OpenCV
- Go
- Protocol Buffers
- gRPC
- REST API

### インフラ・開発環境

- AWS EC2
- Ubuntu Server
- Docker / Docker Compose
- Nginx
- GitHub Actions

## 主な機能

- ラスター画像の読み込みとSVGへの変換
- 色数の指定（2、3、4、5、6、8、12、16、24、32）
- 変換結果のSVGプレビュー
- Web Workerによる変換処理の実行
- 画像サイズなどの入力制限
- Blob URLを利用したSVGプレビュー

## アーキテクチャ

本アプリは、React・TypeScript製のフロントエンドと、WebAssembly化したC++の変換エンジンで構成されています。

## AWSデプロイ

AWS EC2上にDocker環境を構築し、フロントエンドとバックエンドを連携させています。

### 構成

```text
Browser
   |
   | HTTP :80
   v
Nginx (Docker)
   |                 |
   | Static Files    | /api/*
   v                 v
React / Vite      Go REST API
                       |
                       | gRPC
                       v
                 C++ gRPC Server
                       |
                       v
                 OpenCV Converter
```

### 実装内容

- Dockerコンテナによるフロントエンドの配信
- Nginxによる静的ファイル配信とAPIリバースプロキシ
- Docker Composeのネットワークを利用したフロントエンドとバックエンドの接続
- Go REST APIからC++ gRPCサーバーへのリクエスト転送

### 動作確認

AWS上の検証環境で、ブラウザからの画像アップロード、SVG変換、変換結果のダウンロードまで動作することを確認しています。

検証環境はHTTPで公開しています。機密性の高い画像の送信には使用しないでください。

### AWS検証環境

- EC2上でDocker Composeを使用してサービスを起動
- フロントエンドの公開ポートは80
- Go APIとC++ gRPCサーバーはホストのループバックアドレスにバインドし、直接の外部公開を避ける構成

※AWS上の検証環境のIPアドレスは変更される可能性があるため、ここでは固定URLとして記載していません。

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

## サーバー変換（任意）

既定ではWebAssemblyを利用してブラウザ内で変換します。

環境変数 `VITE_API_BASE_URL` を設定してビルドすると、画像をGo REST APIへ送信し、サーバー側のC++画像変換エンジンで変換します。

- 未設定の場合：ブラウザ内のWASMで変換
- 設定した場合：API経由でサーバー側のエンジンを使用

`VITE_API_BASE_URL` はフロントエンドのビルド時に反映されます。AWSのNginx構成では、フロントエンドとAPIを同じオリジンから利用できるようにしています。

サーバー変換を利用すると、アップロードした画像が外部サーバーへ送信されます。画像の取り扱いには注意してください。

## WASMファイルの管理

`src/wasm/svg-converter.js` および `src/wasm/svg-converter.wasm` は、C++の画像変換エンジンから生成したファイルです。

これらのファイルはGit管理対象としています。Cloudflare Pagesへのデプロイ時に、別途WASMをビルドすることなく、リポジトリに含まれるファイルを使用してフロントエンドをビルド・公開できるようにしています。

WASMファイルを更新する場合は、対応するC++変換エンジンからファイルを生成し、`src/wasm/` に反映してコミットします。

## デプロイ

### Cloudflare Pages

公開デモはCloudflare Pagesでホスティングしています。GitHubリポジトリへの変更を契機に自動デプロイされる構成です。

WASMファイルをGit管理することで、Cloudflare Pages側でフロントエンドのビルドに必要なファイルを利用できます。

### AWS EC2

AWS EC2上にも検証環境を構築しています。Docker Composeでフロントエンドをビルドし、Nginxで配信しています。NginxはAPIリクエストをGo REST APIに転送します。

AWS環境では、ブラウザからの画像アップロード、SVG変換、ダウンロードまで動作確認済みです。

AWSへのデプロイは現時点では手動で行っています。

## 今後の開発予定

- 変換結果の品質改善
- さまざまなサンプル画像による検証
- 自動テストの導入
- エラー表示や操作性の改善

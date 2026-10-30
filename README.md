# SVG Web

C++20とOpenCVで実装した画像変換エンジンを、WebAssembly（WASM）およびサーバーAPI経由で利用できるReact・TypeScript製のWebアプリです。

**公開デモ（ブラウザ内変換）：** https://svg.art-full-stack.com/

**AWS版（サーバー側変換）：** https://aws-svg.art-full-stack.com/

## 概要

PNGやJPEGなどのラスター画像をSVG形式のベクター画像に変換するWebアプリです。

画像変換には、C++20とOpenCVで実装した画像変換エンジンを使用しています。次の2つの変換方式に対応しています。

- **ブラウザ内変換：** WebAssembly（WASM）を利用し、ブラウザ内で画像を変換
- **サーバー変換：** Go REST APIからgRPC経由でC++の画像変換エンジンを呼び出して変換

ブラウザ内変換では、画像を変換サーバーへ送信せずに処理できます。サーバー変換では、画像データがサーバーへ送信されます。

Cloudflare Pagesの公開デモとAWS版は、別々の環境として運用しています。

## 使用技術

### フロントエンド

- React
- TypeScript
- Vite
- WebAssembly（WASM）
- Web Worker
- Nginx

### 画像変換エンジン・バックエンド

- C++20
- OpenCV
- Go
- REST API
- gRPC
- Protocol Buffers

### インフラ・開発環境

- AWS EC2
- Ubuntu Server
- AWS Systems Manager（SSM）
- Docker
- Docker Compose
- Nginx
- GitHub Actions
- Cloudflare Pages
- Git / GitHub

## 主な機能

- PNG・JPEG画像の読み込みとSVGへの変換
- 色数の指定（2、3、4、5、6、8、12、16、24、32色）
- 塗りつぶしモードと、境界線のみを描画するモードの切り替え
- 変換結果のSVGプレビュー
- Web Workerによる画像変換処理
- 入力ファイルサイズ・画像サイズの制限
- Blob URLを利用したSVGプレビューとダウンロード
- ビルド時の設定による変換方式の切り替え（Cloudflare Pages版はブラウザ内変換、AWS版はサーバー側変換）
- サーバー側変換での、画像送信の画面上での明示と、APIエラーのステータスごとの日本語表示

## アーキテクチャ

ブラウザ内変換では、WASM化したC++画像変換エンジンを利用します。サーバー変換では、フロントエンドからGo REST APIへリクエストを送り、gRPC経由でC++画像変換エンジンを呼び出します。

### ブラウザ内変換

```text
Browser
   |
   v
React / TypeScript
   |
   v
Web Worker
   |
   v
WebAssembly
   |
   v
C++ / OpenCV
   |
   v
SVG
```

### AWSサーバー変換

```text
Browser
   |
   | HTTPS :443
   v
Host Nginx (EC2)
   |
   | Reverse Proxy
   v
Frontend Nginx (Docker)
   |                       |
   | Static Files          | /api/*
   v                       v
React / TypeScript     Go REST API
                           |
                           | gRPC
                           v
                     C++ gRPC Server
                           |
                           v
                     OpenCV Converter
```

EC2上のホストNginxがHTTPS通信を受け付け、フロントエンドのDockerコンテナへリバースプロキシします。フロントエンド側のNginxは静的ファイルを配信し、`/api/` へのリクエストをGo REST APIへ転送します。

フロントエンドとバックエンドはDockerネットワークを利用して接続しています。

## AWSデプロイ

AWS EC2上にDocker環境を構築し、フロントエンドとバックエンドを連携させています。

### 実装内容

- EC2上でのDocker Composeによるサービス管理
- NginxによるHTTPS終端、静的ファイル配信、APIリバースプロキシ
- Go REST APIからC++ gRPCサーバーへのリクエスト転送
- Dockerネットワークを利用したサービス間通信
- GitHub ActionsとAWS Systems Managerを利用した自動デプロイ
- デプロイ後のHTTP・HTTPSヘルスチェック

### CI/CDパイプライン

GitHubの`main`ブランチへのプッシュを契機に、GitHub ActionsからAWS Systems Manager（SSM）経由でEC2上のデプロイ処理を実行します。ワークフローの手動実行にも対応しています。

```text
GitHub Push (main)
        |
        v
GitHub Actions
        |
        | AWS認証
        v
AWS Systems Manager (SSM)
        |
        v
EC2
        |
        | Git Pull
        v
Docker Compose Build
        |
        v
Frontend Container Update
        |
        v
HTTP / HTTPS Health Checks
```

デプロイ処理では、主に次の手順を実行します。

1. EC2上でGitHubリポジトリの`main`ブランチを更新
2. フロントエンドのDockerイメージをビルド
3. フロントエンドコンテナを再作成
4. ローカルHTTPエンドポイントと公開HTTPSエンドポイントを確認
5. ヘルスチェックが成功した場合にデプロイ成功と判定

フロントエンドのみを更新する構成とし、Go REST APIやC++ gRPCサーバーをデプロイ処理で再起動しないようにしています。

また、GitHub ActionsからEC2への操作にはSSMを利用し、デプロイ専用のAWS認証情報をGitHub Secretsで管理しています。EC2への接続にGitHub Actions用のSSH秘密鍵を使用しない構成です。

### AWS環境のセキュリティとネットワーク

- HTTPSでWebアプリを公開
- フロントエンドコンテナのポートをホストのループバックアドレスにバインド
- APIおよびgRPCサービスは、Dockerネットワークを通じて接続
- デプロイ用AWS認証情報をGitHub Secretsで管理

### 監視およびアラート

- **Amazon CloudWatch**: EC2ステータスチェック失敗の監視
- **Amazon SNS**: アラームが「ALARM」状態になった際のメール通知
- **アラームしきい値**: `StatusCheckFailed >= 1`
- **評価期間**: 5分

運用手順およびトラブルシューティングについては、[`docs/operations.md`](docs/operations.md) を参照してください。

### 動作確認

AWS版で、ブラウザからの画像アップロード、SVG変換、変換結果のダウンロードまで正常に動作することを確認しています。

また、GitHub ActionsからSSM経由でフロントエンドを更新し、デプロイ後のHTTP・HTTPS確認が成功することを検証しています。

AWS環境は検証・ポートフォリオ用途です。サーバー変換を使用する場合は画像データがサーバーへ送信されるため、機密性の高い画像のアップロードは避けてください。

## 変換処理の実装

- `src/converter/worker.ts`：WASMを初期化し、変換関数`convertImage`を呼び出すWeb Worker
- `src/converter/decode.ts`：ブラウザでPNG・JPEG画像をデコードし、非乗算RGBAデータを取得
- `src/converter/limits.ts`：対応する色数と画像サイズの上限を管理
- `src/wasm/`：C++画像変換エンジンから生成したWASM関連ファイルを配置

Web Worker上で変換処理を実行することで、UIの処理と画像変換処理を分離しています。

## 画像処理とデータの取り扱い

ブラウザ内変換では、画像をバックエンドサーバーへ送信せずに変換できます。

生成したSVGはBlob URLを利用してプレビューします。SVGをHTMLのDOMとして直接挿入する方式は使用していません。

サーバー変換を選択した場合は、画像データがGo REST APIへ送信され、サーバー側のC++画像変換エンジンで処理されます。

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
- C++画像変換エンジンをビルドできる環境
- Emscriptenなど、WASMビルドに必要な環境

### 起動方法

依存パッケージをインストールします。

```powershell
npm install
```

開発サーバーを起動します。

```powershell
npm run dev
```

開発用の起動スクリプトは、`svg-app`の`dist/wasm`にあるWASM関連ファイルを`src/wasm`へコピーしてから実行します。

### 本番ビルド

```powershell
npm run build
```

このコマンドでは型チェックと本番用ビルドを実行します。

### テスト

```powershell
npm test
```

Vitestで、変換方式の設定、APIエラー時の表示、各変換方式の画面表示（画像送信の有無の表示を含む）、WASMモジュールによる変換をテストします。

## 変換モードの設定

変換方式は、ビルド時の環境変数`VITE_CONVERTER_MODE`で指定します。

| 値 | 変換方式 | 利用環境 |
| --- | --- | --- |
| 未設定 / `wasm` | ブラウザ内のWebAssemblyで変換（画像は送信しない） | Cloudflare Pages |
| `server` | Go REST API → gRPC → C++ / OpenCVで変換（画像をサーバーへ送信） | AWS（`docker-compose.yml`で指定） |

- `VITE_API_BASE_URL`は`server`モードでのみ使用します。空の場合は同一オリジンの`/api/v1/convert`を呼び出します（AWSでは`docker/nginx.conf`が`/api/`をGo REST APIへ転送します）。値には`/api`を含めません。
- `wasm`モードで`VITE_API_BASE_URL`を設定した場合や、`wasm`・`server`以外の値を指定した場合は、ビルドと開発サーバーの起動がエラーになります。設定の誤りによって、意図しない変換方式で公開されることを防ぐためです。
- `server`モードでAPIの呼び出しに失敗した場合は、エラーを表示します。WebAssemblyへの自動切り替えは行いません。
- ビルドした`index.html`には`<meta name="converter-mode" content="...">`が含まれ、デプロイ後の確認に使用します。

ローカルでサーバー変換を試す場合は、`svg-app`で`docker compose up`を実行したうえで、`.env`に次のように設定します。

```text
VITE_CONVERTER_MODE=server
VITE_API_BASE_URL=http://localhost:8080
```

### ヘルスチェック

フロントエンドのNginxは、`/api/healthz`をGo REST APIの`GET /healthz`へ転送します。GitHub Actionsのデプロイでは、フロントエンドに加えて`/api/healthz`の応答と、公開中のビルドが`server`モードであることを確認します。

## WASMファイルの管理

`src/wasm/svg-converter.js`および`src/wasm/svg-converter.wasm`は、C++画像変換エンジンから生成したファイルです。

これらのファイルはGit管理対象としています。Cloudflare Pagesへのデプロイ時に、別途WASMをビルドすることなく、リポジトリに含まれるファイルを使用してフロントエンドをビルド・公開できるようにしています。

WASMファイルを更新する場合は、対応するC++画像変換エンジンからファイルを生成し、`src/wasm/`に反映してコミットします。

## デプロイ環境

### Cloudflare Pages

公開デモはCloudflare Pagesでホスティングしています。GitHubリポジトリへの変更を契機に自動デプロイされる構成です。

### AWS EC2

AWS版は、AWS EC2上にDocker Composeを利用して構築しています。

フロントエンドはDockerコンテナで配信し、ホストNginxでHTTPSを終端します。APIリクエストはGo REST APIへ転送し、gRPC経由でC++画像変換エンジンを呼び出します。

GitHub ActionsとAWS Systems Managerを利用した自動デプロイを実装し、デプロイ後のヘルスチェックまで自動化しています。

## 今後の開発予定

- 変換結果の品質改善
- さまざまなサンプル画像による検証
- 自動テストの拡充
- エラー表示や操作性の改善
- AWS環境の監視・運用改善

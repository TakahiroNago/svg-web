# SVG App 運用手順書

## 1. 目的

本書では、SVG画像変換アプリのAWS環境について、デプロイ、稼働確認、ログ確認、障害対応、費用管理の手順を記録する。

## 2. システム構成

### 公開URL

- Cloudflare Pages版: https://svg.art-full-stack.com/
- AWS版: https://aws-svg.art-full-stack.com/

### AWS環境

- リージョン: `ap-southeast-2`（Sydney）
- EC2インスタンス: `i-0f21053ec32e7d409`
- インスタンスタイプ: `t3.small`
- OS: Ubuntu 24.04
- EBS: gp3、16 GiB
- アプリケーションディレクトリ: `/home/ubuntu/apps/svg-web`

### サービス構成

- ホスト側Nginx: HTTPS終端、フロントエンドへのリバースプロキシ
- フロントエンド: React / TypeScript / Vite、Dockerコンテナ内のNginx
- Go REST API: 画像変換リクエストを受け付ける
- C++ gRPCサーバー: OpenCVを使った画像変換処理
- Docker Compose: コンテナの構築・起動
- GitHub Actions: CIとデプロイ処理
- AWS Systems Manager（SSM）: GitHub ActionsからEC2上でコマンドを実行

### 通信経路

ブラウザーからのサーバー変換リクエストは、HTTPS → ホスト側Nginx → フロントエンドNginx → Go REST API → C++ gRPCサーバーの順に処理される。

ブラウザー内で完結するWASM変換では、画像をサーバーへ送信せずに変換できる。

## 3. 通常のデプロイ

### 自動デプロイ

1. ローカルで変更・テストする。
2. Gitにコミットする。
3. GitHubのPRでレビュー・CIチェックを行う。
4. `main` ブランチへマージする。
5. GitHub Actionsの実行結果を確認する。
6. AWS版で必要な動作確認を行う。

### デプロイの仕組み

GitHub ActionsがAWSの認証情報を使用してSSMコマンドを送信する。EC2側で `main` ブランチを更新し、Docker Composeでフロントエンドをビルド・再作成する。

デプロイ後、ローカルHTTPと公開HTTPSのヘルスチェックを実行する。

通常のフロントエンドデプロイでは、Go REST APIとC++ gRPCサーバーは再起動しない。

### デプロイ成功の確認

- GitHub Actionsの対象ワークフローが成功している。
- https://aws-svg.art-full-stack.com/ にアクセスできる。
- 必要に応じて、画像変換が正常に動作することを確認する。

## 4. デプロイ失敗時の確認

1. GitHubリポジトリのActionsを開く。
2. 失敗した実行を選択する。
3. 赤く表示されたステップとログを確認する。
4. エラー内容に応じて、Git、AWS認証、SSM、Docker、ヘルスチェックを切り分ける。

確認先: https://github.com/TakahiroNago/svg-web/actions

### 主な確認ポイント

- AWS認証情報がGitHub Secretsに設定されているか。
- EC2がSSMの管理対象としてオンラインか。
- EC2からGitHubのリポジトリを取得できるか。
- Dockerイメージのビルドに失敗していないか。
- フロントエンドコンテナが起動しているか。
- ホスト側NginxとHTTPSが正常か。

認証情報や秘密鍵をログ、README、Gitに記録しない。

## 5. EC2への接続

手動調査が必要な場合は、許可されたSSH接続またはAWS Systems Manager Session Managerを使用する。

SSH接続の例:

```bash
ssh ubuntu@54.252.250.180
```

SSHを使用する場合は、適切な秘密鍵とアクセス権限が必要。秘密鍵をGitリポジトリに保存しない。

接続後、アプリケーションのディレクトリへ移動する。

```bash
cd /home/ubuntu/apps/svg-web
```

## 6. Dockerコンテナの状態確認

```bash
cd /home/ubuntu/apps/svg-web
docker compose ps
```

フロントエンドの状態確認:

```bash
docker compose ps web
```

ホスト側のフロントエンド応答確認:

```bash
curl -I --max-time 5 http://127.0.0.1:8081/
```

公開HTTPSの確認:

```bash
curl -I --max-time 15 https://aws-svg.art-full-stack.com/
```

HTTPステータスが200であることを確認する。必要に応じて、ブラウザーで実際の画像変換もテストする。

## 7. ログの確認

フロントエンドのコンテナログ:

```bash
cd /home/ubuntu/apps/svg-web
docker compose logs --tail=100 web
```

直近のログを継続して確認する場合:

```bash
docker compose logs -f web
```

ホスト側Nginxのエラーログ:

```bash
sudo tail -n 100 /var/log/nginx/error.log
```

ホスト側Nginxのアクセスログ:

```bash
sudo tail -n 100 /var/log/nginx/access.log
```

Go APIやC++ gRPCサーバーのログは、それぞれのComposeプロジェクトとコンテナ構成を確認してから調査する。

## 8. 障害時の切り分け

### 公開URLにアクセスできない

1. GitHub Actionsで直近のデプロイ結果を確認する。
2. EC2の稼働状態とSSMの接続状態を確認する。
3. ホスト側Nginxの状態とエラーログを確認する。
4. `curl` でローカルHTTPと公開HTTPSを確認する。
5. Dockerコンテナの状態とログを確認する。

### フロントエンドは表示されるが画像変換に失敗する

1. ブラウザーの開発者ツールでネットワークエラーを確認する。
2. Go REST APIの稼働状態を確認する。
3. Go APIからC++ gRPCサーバーへの通信を確認する。
4. 入力画像の形式・サイズ・変換エラーを確認する。

### フロントエンドのデプロイだけが失敗する

まずGitHub Actionsのログを確認する。必要な場合に限り、EC2でDockerとNginxの状態を調べる。

原因が判明するまでは、Go APIやC++ gRPCサーバーを不用意に再起動しない。

## 9. 復旧時の注意

- まずログと状態を確認し、原因を特定する。
- 不要なコンテナ全体の停止・削除を避ける。
- フロントエンドだけの問題なら、バックエンドを停止しない。
- 本番環境で手動変更した場合は、その内容と理由を記録する。
- 修正は可能な限りGitHub上で管理し、通常のデプロイ経路を使用する。

## 10. AWS費用の管理

### 現在の設定

- 無料プランの表示上の期限: 2027年4月28日
- 確認時点の残りクレジット: $120
- 設定した予算アラート: 月 $10

これらの値は変化するため、定期的にAWSコンソールで最新の値を確認する。

### 確認項目

- AWS Billingで今月のコストを確認する。
- Cost Explorerでサービス別のコストを確認する。
- AWS Budgetsで予算と通知条件を確認する。
- クレジット残高と有効期限を確認する。
- EC2、EBS、パブリックIPv4、データ転送などの料金を確認する。

予算アラートは自動停止機能ではない。通知を受け取ったら利用状況を調査する。

無料プランやクレジットの終了後に備え、常時稼働に必要な月額費用を事前に見積もる。

## 11. 定期確認チェックリスト

- [ ] AWS版の公開URLにアクセスできる
- [ ] 画像変換が正常に動作する
- [ ] GitHub Actionsの最新実行が成功している
- [ ] EC2とDockerコンテナが正常に稼働している
- [ ] AWSの月額コストと予算アラートを確認した
- [ ] クレジット残高と有効期限を確認した

## 12. 関連リンク

- AWS版: https://aws-svg.art-full-stack.com/
- Cloudflare Pages版: https://svg.art-full-stack.com/
- GitHubリポジトリ: https://github.com/TakahiroNago/svg-web
- GitHub Actions: https://github.com/TakahiroNago/svg-web/actions
- AWS EC2（Sydney）: https://ap-southeast-2.console.aws.amazon.com/ec2/home?region=ap-southeast-2#Instances:
- AWS Billing: https://console.aws.amazon.com/billing/home
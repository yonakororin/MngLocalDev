# mnglocaldev (ローカル作業環境管理ツール)

このツールは、WSL2上のPHPバージョンの管理、Docker上のNginx設定、およびPHP-FPMプロセスをGUIで管理するためのアプリケーションです。

## 主な機能

- **ダッシュボード**: 有効なプロジェクト、PHPバージョン、FPMの稼働状況を一覧表示。
- **アサインメント (Assignments)**: どのプロジェクトフォルダにどのPHPバージョンを割り当てるかを管理。
- **バージョン管理 (Versions)**: インストール済みPHPバージョンの一覧表示と削除、新規バージョンのインストール。
- **Nginx管理**: プロジェクト追加・変更時にDocker内のNginx設定を自動更新・リロード。
- **FPM操作**: UIから直接PHP-FPMプロセスの起動・停止が可能。
- **MySQL管理**: Dockerで動作するMySQLのデータベース、テーブル、データのブラウズおよびクエリ実行。

## 事前準備

- Windows 10/11
- WSL2 (OracleLinux / Ubuntu 等のディストリビューション)
- Docker Desktop
- Node.js (Windows側にインストール)
- `phpenv` (WSL2側にインストール)

## 設定

アプリケーションは `../container/config.json` から基本設定を読み込みます。
このファイルの `wsl_distro` および `phpenv_root` が正しく設定されていることを確認してください。

## アプリケーション設定の保存場所

設定ファイル自体のパス（どこにある config.json を見るかなど）は、Electronのユーザーデータディレクトリに保存されています。パスを変更したい場合は、以下のファイルを編集または削除してください。

- **場所**: `%APPDATA%\mnglocaldev\app-settings.json`
- **内容**: 
  - `configPath`: `container/config.json` へのパス
  - `assignmentsPath`: `phpmanager/assignments.json` へのパス

このファイルを削除してアプリを再起動すると、初期設定（セットアップウィザード）からやり直すことができます。

## PHPの設定変更 (php.ini)

`phpenv` で管理されている各PHPバージョンの設定を変更する手順です。

### 1. php.ini の場所
設定ファイルは各バージョンの `etc` ディレクトリ内にあります。

- **Windows側のパス例**: `C:\Projects\localmng\phpenv\versions\{VERSION}\etc\php.ini`
- **WSL側のパス例**: `/mnt/c/Projects/localmng/phpenv/versions/{VERSION}/etc/php.ini`

### 2. 設定の反映
`php.ini` を編集・保存した後は、**PHP-FPM プロセスを再起動**する必要があります。

1. アプリの **Assignments** タブを開く
2. 対象プロジェクトのアクションから **Stop** をクリック
3. 再度 **Start** をクリック

これで新しい設定が読み込まれます。

## 開発用コマンド

```bash
# 依存関係のインストール
npm install

# 開発モードで起動
npm run dev
```

## ビルド

```bash
# プロダクション用ビルド（インストーラー作成）
npm run build
```

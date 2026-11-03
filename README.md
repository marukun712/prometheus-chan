# prometheus-chan

サーバー・ネットワーク機器などを擬人化して監視するソフトウェア

## Setup

Requirements
- Deno
- Nix

```
nix develop
deno task build
deno task runner <pack>/<profile> <metrics>
```

起動後、metrics側で指定したポート(既定では3000)にブラウザからアクセスします。

## 開発

| タスク | 内容 |
| --- | --- |
| `deno task build` | フロントエンドを`dist/`にバンドル |
| `deno task runner` | サーバーを起動 |
| `deno task check` | 型チェックとBiomeによる整形 |
| `deno task fmt` | `conf/`と`packs/`以下のKDLを整形 |
| `deno task loadtest` | 負荷テスト用のダミーexporterを9100番で起動 |

## サンプル

パック
- packs/default ... デフォルトのパック
  - profiles/node.kdl ... node_exporter向けのプロファイル
  - profiles/home-router.kdl ... WANとLANの通信量を見るホームルーター監視プロファイル

メトリクス
- conf/metrics/ix2215.kdl ... UNIVERGE IX2215の監視。IF-MIBとルーターのプライベートMIBが必要
- conf/metrics/node_exporter.kdl ... node_exporterを使った監視

# License
本ソフトウェアは、MIT Licenseの元で公開されます。ただし、packs配下のアセットには適用されません。

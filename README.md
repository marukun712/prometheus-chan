# prometheus-chan

サーバー・ネットワーク機器などを擬人化して監視するソフトウェアです。
デフォルトでは、東北きりたんのパックが入っています。

## Setup

必要なのはDenoのみです。nixを使う場合は`nix develop`(direnv利用時は`direnv allow`)で開発環境に入れます。

フロントエンドをビルドしてから、使うパックとプロファイル、メトリクスの設定を指定してサーバーを起動します。

```
deno task build
deno task runner <pack>/<profile> <metrics>
```

`<pack>`は`packs/`以下のパック名、`<profile>`はそのパックの`profiles/`以下のファイル名(拡張子なし)、`<metrics>`は`conf/metrics/`以下のパスです。

```
deno task runner kiritan/node node_exporter.kdl
```

起動後、metrics側で指定したポート(既定では3000)にブラウザからアクセスします。

## 開発

| タスク | 内容 |
| --- | --- |
| `deno task build` | フロントエンドを`dist/`にバンドル |
| `deno task runner` | サーバーを起動 |
| `deno task check` | 型チェックとBiomeによる整形 |
| `deno task fmt` | `conf/`と`packs/`以下のKDLを整形 |

## Pack

キャラクターは、パックという単位で配布します。パックは`packs/`以下のフォルダで、そのままzipに固めて配れます。

```
packs/kiritan/
    pack.kdl              キャラクターとレベルの定義
    profiles/
        node.kdl          node_exporter向けのプロファイル
        home-router.kdl   ホームルーター向けのプロファイル
    images/
        default.png
        default_depth.png
    voices/
        *.wav
```

| 要素 | 内容 |
| --- | --- |
| `pack.kdl` | キャラクターの名前とレベル。パックに1つだけ置く |
| `profiles/` | 監視対象ごとの部位とセリフ。メトリクスの設定と組み合わせて使う |
| `images/`, `voices/` | 立ち絵とボイス |

設定ファイルからは、パックのルートを基準にしたパス(`images/default.png`、`voices/はい.wav`など)で参照します。
立ち絵には、同じ名前に`_depth`を付けたデプスマップ(`images/default_depth.png`)が必要です。

1つのパックに複数のプロファイルを置けます。同じキャラクターでnode_exporter用とルーター用を使い分けるときは、`pack.kdl`を共有してプロファイルだけ分けます。

## Config

設定はKDL(v1)で書きます。メトリクスの設定はパックの外(`conf/metrics/`)に置き、キャラクターの設定はパックのなかに置きます。

### metrics

接続先のPrometheusと、部位に割り当てるPromQLを定義します。

```kdl
prometheus url="http://10.0.0.1:9020" interval="10000"
server port=3000
signal "head" {
    query "1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m]))"
}
```

| ノード | 説明 |
| --- | --- |
| `prometheus` | `url`はPrometheusのベースURL、`interval`は取得間隔(ミリ秒) |
| `server` | `port`はサーバーのポート |
| `signal "<part>"` | 部位またはイベントに割り当てるクエリ。`query`にPromQLを書く |

クエリは`instant query`として実行され、最初の結果の値だけを使います。レベル判定に使うので、0.0から1.0の割合になるように書くのがおすすめです。
イベントとして扱うシグナルは、`> bool`などで0/1になるように書きます。

### pack.kdl

キャラクターの名前とレベルを定義します。

```kdl
character "tohoku-kiritan" {
    name "東北きりたん"
}
levels {
    ok enter=0.0 {
        label "ふつう"
        color "#4a8f6f"
        voice "voices/はい.wav"
        image "images/default.png"
    }
    hard enter=0.6 exit=0.5 {
        label "すこし疲れています"
        color "#c88a2e"
        voice "voices/はあ…….wav"
        image "images/default.png"
    }
}
```

| ノード | 説明 |
| --- | --- |
| `character "<id>"` | キャラクターのID。子に`name`で表示名 |
| `levels` | 子ノードの名前がレベル名になる。`enter`はそのレベルに入る値、`exit`は抜ける値(省略可)。子に`label`(表示名)、`color`(表示色)、`voice`(既定のボイス、複数可)、`image`(既定の立ち絵) |

`enter`と`exit`の両方を書くと、値が`exit`以上`enter`未満のあいだは現在のレベルに留まります。
しきい値の前後で値が揺れたときにレベルが行き来するのを防げます。

### profiles

部位とイベント、それぞれのセリフを定義します。セリフは対象の部位またはイベントの子として書きます。

```kdl
part "head" "頭" {
    on from="*" to="hard" {
        say line="考えることが増えてきました" voice="voices/はあ…….wav"
    }
    ask level="ok" {
        say line="いまは余裕があります" voice="voices/はい.wav"
    }
    care level="critical" line="考えることが多すぎます。何か止めてください"
}
event "visitor" {
    react when="rise" {
        say line="こんにちは" voice="voices/こんにちは.wav"
    }
}
```

| ノード | 説明 |
| --- | --- |
| `part "<id>" "<label>"` | 部位のIDと表示名。子に`on`、`ask`、`care`を書く |
| `on` | レベル遷移時のセリフ。`from`は遷移元(カンマ区切り、`*`ですべて)、`to`は遷移先 |
| `ask` | 部位をクリックしたときの返事。`level`は対象のレベル(カンマ区切り、`*`ですべて) |
| `care` | おせわの要望。`level`は対象のレベル(カンマ区切り)、`line`はテキスト |
| `event "<id>"` | イベントとして扱うシグナルのID。子に`react`を書く |
| `react` | イベントへの反応。`when`は`rise`(値の上昇)または`fall`(値の下降) |

`on`、`ask`、`react`の子に書く`say`は、候補のなかからランダムに1つ選ばれます。
`line`がセリフ、`voice`と`image`はそのセリフだけのボイスと立ち絵で、省略するとレベルの既定値が使われます。

`part`の`<id>`と`event`の`<id>`は、メトリクス側の`signal "<part>"`と対応させます。

## サンプル

パック
- packs/kiritan ... 東北きりたんのパック
  - profiles/node.kdl ... node_exporter向けのプロファイル
  - profiles/home-router.kdl ... 家庭用VLANとサーバー用VLANがある家庭環境向けホームルーター監視プロファイル

メトリクス
- conf/metrics/ix2215.kdl ... UNIVERGE IX2215の監視。IF-MIBとルーターのプライベートMIBが必要
- conf/metrics/node_exporter.kdl ... node_exporterを使った監視

# License
本ソフトウェアは、MIT Licenseの元で公開されます。ただし、packs配下のアセットには適用されません。

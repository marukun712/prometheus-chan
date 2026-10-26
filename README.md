# prometheus-chan

サーバー・ネットワーク機器などを擬人化して監視するソフトウェアです。
デフォルトでは、東北きりたんのプロファイルが入っています。

## Setup

必要なのはDenoのみです。nixを使う場合は`nix develop`(direnv利用時は`direnv allow`)で開発環境に入れます。

フロントエンドをビルドしてから、設定ファイルを指定してサーバーを起動します。

```
deno task build
deno task runner <character> <metrics>
```

`<character>`は`conf/character/`以下のパス、`<metrics>`は`conf/metrics/`以下のパスです。

```
deno task runner kiritan/node_exporter.kdl node_exporter.kdl
```

起動後、metrics側で指定したポート(既定では3000)にブラウザからアクセスします。

## 開発

| タスク | 内容 |
| --- | --- |
| `deno task build` | フロントエンドを`dist/`にバンドル |
| `deno task runner` | サーバーを起動 |
| `deno task check` | 型チェックとBiomeによる整形 |
| `deno task fmt` | `conf/`以下のKDLを整形 |

立ち絵とボイスは`static/`以下に置きます。設定ファイルからは`static/`を基準にしたパス(`images/default.png`など)で参照します。
立ち絵には、同じ名前に`_depth`を付けたデプスマップ(`images/default_depth.png`)が必要です。

## Config

設定はKDL(v1)で書きます。メトリクスの設定とキャラクターの設定を別のファイルに分けます。

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

### character

名前、レベル、部位、セリフを定義します。

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
part "head" "頭"
on "head" from="*" to="hard" {
    say line="考えることが増えてきました" voice="voices/はあ…….wav"
}
event "visitor"
react "visitor" when="rise" {
    say line="こんにちは" voice="voices/こんにちは.wav"
}
ask "head" level="ok" {
    say line="いまは余裕があります" voice="voices/はい.wav"
}
care "head" level="critical" {
    line "考えることが多すぎます。何か止めてください"
}
```

| ノード | 説明 |
| --- | --- |
| `character "<id>"` | キャラクターのID。子に`name`で表示名 |
| `levels` | 子ノードの名前がレベル名になる。`enter`はそのレベルに入る値、`exit`は抜ける値(省略可)。子に`label`(表示名)、`color`(表示色)、`voice`(既定のボイス、複数可)、`image`(既定の立ち絵) |
| `part "<id>" "<label>"` | 部位のIDと表示名 |
| `on "<part>"` | レベル遷移時のセリフ。`from`は遷移元(カンマ区切り、`*`ですべて)、`to`は遷移先 |
| `event "<id>"` | イベントとして扱うシグナルのID |
| `react "<event>"` | イベントへの反応。`when`は`rise`(値の上昇)または`fall`(値の下降) |
| `ask "<part>"` | 部位をクリックしたときの返事。`level`は対象のレベル(カンマ区切り、`*`ですべて) |
| `care "<part>"` | おせわの要望。`level`は対象のレベル(カンマ区切り)。子に`line`でテキスト |

`on`、`react`、`ask`の子に書く`say`は、候補のなかからランダムに1つ選ばれます。
`line`がセリフ、`voice`と`image`はそのセリフだけのボイスと立ち絵で、省略するとレベルの既定値が使われます。

`enter`と`exit`の両方を書くと、値が`exit`以上`enter`未満のあいだは現在のレベルに留まります。
しきい値の前後で値が揺れたときにレベルが行き来するのを防げます。

## サンプル

東北きりたん
- conf/character/kiritan/node.kdl ... node_exporter向けのサンプルキャラクター
- conf/character/kiritan/home-router.kdl ... 家庭用VLANとサーバー用VLANがある家庭環境向けホームルーター監視キャラクター

メトリクス
- conf/metrics/node/ix2215.kdl ... UNIVERGE IX2215の監視。IF-MIBとルーターのプライベートMIBが必要
- conf/metrics/node_exporter.kdl ... node_exporterを使った監視

# License
本ソフトウェアは、MIT Licenseの元で公開されます。ただし、static配下のアセットには適用されません。

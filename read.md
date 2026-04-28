# 飲食店リスト取得 Chrome拡張機能

## インストール方法

1. Chrome で `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このフォルダ（`chrome-extension/`）を選択する

## 使い方

1. 対応サイトの**検索結果ページ**を開く
2. Chrome右上の拡張機能アイコン（🍽）をクリック
3. 「店舗情報を取得」ボタンを押す
4. 取得件数が表示されたら「CSVダウンロード」ボタンを押す

## 対応サイト

| サイト | URL パターン |
|--------|-------------|
| ホットペッパーグルメ | `hotpepper.jp/*` |
| 食べログ | `tabelog.com/*` |
| Googleマップ | `google.com/maps/*` |

## CSV 出力形式

```
name,address,phone,url,source
焼肉〇〇,東京都渋谷区...,03-1234-5678,https://...,hotpepper
```

## 注意事項

- 一覧画面から取得可能な情報のみ取得します（詳細ページへの遷移なし）
- サイトのDOM構造変更により取得できなくなる場合があります
- 電話番号は一覧ページに表示されない場合は空欄になります
- Googleマップは事前にスクロールして結果を多く表示してから実行してください

## 新サイト追加方法

`src/content.js` の `strategies` 配列に新しいStrategyオブジェクトを追加するだけです:

```javascript
const myNewSiteStrategy = {
  name: 'newsite',
  matches(url) { return /newsite\.com/.test(url); },
  scrape() {
    // DOM取得ロジック
    return [{ name, address, phone, url, source: 'newsite' }];
  }
};

const strategies = [
  hotpepperStrategy,
  tabelogStrategy,
  googleMapsStrategy,
  myNewSiteStrategy, // ← 追加するだけ
];
```

また `manifest.json` の `host_permissions` と `content_scripts.matches` にURLを追加してください。


# 飲食店リスト 重複排除ツール

## インストール

```bash
pip install pandas rapidfuzz
```

## 使い方

```bash
# 基本
python dedup_restaurants.py input.csv -o cleaned_list.csv

# 複数ファイル
python dedup_restaurants.py hotpepper.csv tabelog.csv google.csv -o cleaned_list.csv

# ワイルドカード
python dedup_restaurants.py *.csv

# merge_reason 列を出力に含めない
python dedup_restaurants.py *.csv --no-flag

# 類似度閾値を調整（0-100）
python dedup_restaurants.py *.csv --name-addr-threshold 85 --name-area-threshold 95
```

## 入力CSV 形式

```
name,address,phone,url,source
焼肉まる,東京都渋谷区道玄坂1-2-3,03-1234-5678,https://...,hotpepper
```

## 重複判定ロジック

| 優先順位 | 判定方法 | 閾値 |
|---------|---------|------|
| 1 | 電話番号の完全一致 | 完全一致 |
| 2 | 店舗名 + 住所のfuzzy一致 | デフォルト80% |
| 3 | 店舗名のみfuzzy一致 + 同一エリア | デフォルト90% |

## 正規化内容

- **電話番号**: ハイフン・括弧・スペースを除去。`+81` → `0` 変換
- **住所**: 全角→半角、空白除去、ハイフン統一、小文字化
- **店舗名**: NFKC正規化、小文字化、空白除去

## 出力CSV 形式

```
name,address,phone,url,source,merge_reason
焼肉まる,東京都渋谷区道玄坂1-2-3,03-1234-5678,https://...,hotpepper,
```

- `merge_reason`: 重複として除外された理由（残ったレコードは空欄）
  - `phone`: 電話番号一致で除外
  - `name_addr`: 名前+住所の類似で除外
  - `name_area`: 名前+エリアの類似で除外

## ログ出力例

```
10:03:36 [INFO] 読み込み: hotpepper.csv — 150 件
10:03:36 [INFO] 読み込み: tabelog.csv — 120 件
10:03:36 [INFO] [重複] 統合: idx=154 → idx=5  理由=phone  名前='焼肉まる' / '焼肉まる'
10:03:36 [INFO] 重複検出: 電話番号=45 件, 名前+住所=12 件, 名前+エリア=3 件
10:03:36 [INFO]   入力件数:       270 件
10:03:36 [INFO]   重複件数:        60 件
10:03:36 [INFO]   出力件数:       210 件
```
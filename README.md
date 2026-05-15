# PayPal Edit FI デモ

## セットアップ

### 1. 認証情報を設定

`server.js` の冒頭の `config` を編集：

```js
const config = {
  CLIENT_ID:            'YOUR_SANDBOX_CLIENT_ID',
  CLIENT_SECRET:        'YOUR_SANDBOX_CLIENT_SECRET',
  BILLING_AGREEMENT_ID: 'B-XXXXXXXXXXXXXXX',
  ...
};
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. サーバーを起動

```bash
node server.js
```

### 4. ブラウザで開く

http://localhost:3000

---

## フロー

1. ページロード時に `POST /v2/checkout/orders` が自動実行されてOrderが作成される
2. 「変更」ボタンをクリック → PayPalポップアップが開く（Edit FI）
3. バイヤーが支払い手段を変更（Pay Laterも選択可能）
4. 「注文を確定する」ボタンで Capture 実行

---

## APIログ

画面下部の「APIログを表示」でリクエスト/レスポンスの内容を確認できます。

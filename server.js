/**
 * PayPal Edit FI + Vault with Purchase (BNPL) + Vault Component デモサーバー
 *
 * 使い方:
 *   1. config の CLIENT_ID / CLIENT_SECRET / BILLING_AGREEMENT_ID を設定
 *   2. npm install express node-fetch
 *   3. node server.js
 *   4. ブラウザで http://localhost:3000 を開く
 *
 *   Tab 1: Edit FI フロー（Billing Agreement + 支払い手段変更）
 *   Tab 2: Vault with Purchase フロー（JS SDK + BNPLセカンドボタン）
 *   Tab 3: paypal.Vault() コンポーネント（Alpha / SDD実装パターン）
 */

try { require('dotenv').config(); } catch(e) {} // ローカル開発時に .env を読み込む

const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// 認証情報は環境変数で設定してください（.env.example 参照）
// ローカル: .env ファイル または export で設定
// Render:  Dashboard > Environment Variables で設定
// ============================================================
const config = {
  CLIENT_ID:            process.env.PAYPAL_CLIENT_ID            || 'YOUR_SANDBOX_CLIENT_ID',
  CLIENT_SECRET:        process.env.PAYPAL_CLIENT_SECRET        || 'YOUR_SANDBOX_CLIENT_SECRET',
  BILLING_AGREEMENT_ID: process.env.PAYPAL_BILLING_AGREEMENT_ID || 'B-XXXXXXXXXXXXXXX',
  VAULT_ID:             process.env.PAYPAL_VAULT_ID             || '',  // Tab3: Vault保存済みPayment Method Token ID
  CUSTOMER_ID:          process.env.PAYPAL_CUSTOMER_ID          || '',  // Tab3: vault.customer.id（Tab2の決済完了ログから取得）
  BASE_URL:             process.env.PAYPAL_BASE_URL              || 'https://api-m.sandbox.paypal.com',
  PORT:                 process.env.PORT                         || 3000,
};
// ============================================================


// ---- PayPal API Helpers ----

async function getAccessToken() {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`${config.BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Access token取得失敗: ' + JSON.stringify(data));
  return data.access_token;
}

// Tab1: BA詳細取得（メールアドレス等）
async function getBillingAgreement(accessToken, baId) {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`${config.BASE_URL}/v1/billing-agreements/agreements/${baId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  return res.json();
}

// Tab1: Billing Agreement ベースのOrder作成（Edit FI用）
async function createOrderWithBA(accessToken) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    intent: 'CAPTURE',
    payer: {
      address: {
        address_line_1: '123 Main St',
        admin_area_2: 'San Jose',
        admin_area_1: 'CA',
        postal_code: '95131',
        country_code: 'US',
      },
    },
    application_context: {
      return_url: `http://localhost:${config.PORT}/return`,
      cancel_url:  `http://localhost:${config.PORT}/cancel`,
      preferred_payment_source: {
        token: {
          type: 'BILLING_AGREEMENT',
          id: config.BILLING_AGREEMENT_ID,
        },
      },
    },
    purchase_units: [{
      description: 'デモ商品（Edit FI）',
      amount: {
        currency_code: 'USD',
        value: '50.00',
        breakdown: { item_total: { currency_code: 'USD', value: '50.00' } },
      },
      items: [{
        name: 'デモ商品',
        unit_amount: { currency_code: 'USD', value: '50.00' },
        quantity: '1',
        category: 'PHYSICAL_GOODS',
      }],
    }],
  };
  const res = await fetch(`${config.BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Tab2: User ID Token生成（Vault with Purchase用）
async function getUserIdToken(accessToken, customerIdOrNull) {
  const fetch = (await import('node-fetch')).default;
  let body = 'grant_type=client_credentials&response_type=id_token';
  if (customerIdOrNull) {
    body += `&target_customer_id=${customerIdOrNull}`;
  }
  const res = await fetch(`${config.BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  return data.id_token;
}

// Tab2: Vault属性付きOrder作成
async function createOrderWithVault(accessToken, paymentSource) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    intent: 'CAPTURE',
    payment_source: {
      [paymentSource]: {  // 'paypal' or 'pay_upon_invoice' etc.
        attributes: {
          vault: {
            store_in_vault: 'ON_SUCCESS',
            usage_type: 'MERCHANT',
            customer_type: 'CONSUMER',
          },
        },
        experience_context: {
          return_url: `http://localhost:${config.PORT}/return`,
          cancel_url:  `http://localhost:${config.PORT}/cancel`,
          payment_method_preference: 'UNRESTRICTED',
          user_action: 'PAY_NOW',
        },
      },
    },
    purchase_units: [{
      description: 'デモ商品（Vault with Purchase）',
      amount: {
        currency_code: 'USD',
        value: '50.00',
        breakdown: { item_total: { currency_code: 'USD', value: '50.00' } },
      },
      items: [{
        name: 'デモ商品',
        unit_amount: { currency_code: 'USD', value: '50.00' },
        quantity: '1',
        category: 'PHYSICAL_GOODS',
      }],
    }],
  };
  const res = await fetch(`${config.BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Tab3: Setup Token生成（v3/vault/setup-tokens）
// Vault ComponentのSDKに渡す client token を生成する
// customerId は vault.customer.id（Tab2 の決済完了ログに表示）
async function createSetupToken(accessToken, vaultId, customerId) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    payment_source: {
      token: {
        id: vaultId,
        type: 'PAYMENT_METHOD_TOKEN',
      },
    },
  };
  // customer.id があれば付与（setup-tokens API に必要な場合がある）
  if (customerId) {
    body.customer = { id: customerId };
  }
  console.log('[vault3/setup-token] request body:', JSON.stringify(body, null, 2));
  const res = await fetch(`${config.BASE_URL}/v3/vault/setup-tokens`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `setup-token-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('[vault3/setup-token] HTTP status:', res.status);
  console.log('[vault3/setup-token] raw response:', text);
  try { return JSON.parse(text); } catch(e) { return { error: text }; }
}

// Tab3: Payment Method Token でOrder作成（Path A の createOrder コールバック / Path B の直接課金）
async function createOrderWithToken(accessToken, vaultId) {
  const fetch = (await import('node-fetch')).default;
  const body = {
    intent: 'CAPTURE',
    payment_source: {
      token: {
        id: vaultId,
        type: 'PAYMENT_METHOD_TOKEN',
      },
    },
    purchase_units: [{
      description: 'デモ商品（Vault Component）',
      amount: {
        currency_code: 'USD',
        value: '50.00',
        breakdown: { item_total: { currency_code: 'USD', value: '50.00' } },
      },
      items: [{
        name: 'デモ商品',
        unit_amount: { currency_code: 'USD', value: '50.00' },
        quantity: '1',
        category: 'PHYSICAL_GOODS',
      }],
    }],
  };
  const res = await fetch(`${config.BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 共通: Order Capture
async function captureOrder(accessToken, orderId) {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`${config.BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return res.json();
}


// ---- Routes ----

// トップページ（3タブUI）
app.get('/', (req, res) => {
  const vaultIdConfigured = config.VAULT_ID && config.VAULT_ID.length > 5;
  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>PayPal Edit FI / Vault+BNPL デモ</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #333; }
    header { background: #003087; color: white; padding: 16px 24px; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
    header span { font-size: 20px; }
    .tabs { display: flex; background: white; border-bottom: 2px solid #e0e0e0; padding: 0 24px; }
    .tab { padding: 14px 20px; cursor: pointer; font-size: 14px; font-weight: 500; color: #666; border-bottom: 3px solid transparent; margin-bottom: -2px; transition: all 0.2s; }
    .tab.active { color: #003087; border-bottom-color: #003087; }
    .tab:hover:not(.active) { color: #333; background: #f5f5f5; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .container { max-width: 520px; margin: 32px auto; padding: 0 16px; }
    .card { background: white; border-radius: 12px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 16px; }
    h2 { font-size: 17px; margin-bottom: 20px; color: #111; }
    .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; margin-left: 8px; vertical-align: middle; }
    .badge-old { background: #fff3cd; color: #856404; }
    .badge-new { background: #d4edda; color: #155724; }
    .badge-alpha { background: #e8d5f5; color: #6f42c1; }
    .product { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid #eee; }
    .total { display: flex; justify-content: space-between; padding: 14px 0; font-weight: 700; font-size: 16px; }
    .section-title { font-size: 11px; color: #888; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .payment-info { background: #f7f7f7; border-radius: 8px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    .edit-fi-btn { font-size: 13px; color: #0070ba; text-decoration: none; font-weight: 600; cursor: pointer; border: none; background: none; padding: 0; }
    .edit-fi-btn:hover { text-decoration: underline; }
    .btn { width: 100%; margin-top: 20px; border: none; border-radius: 8px; padding: 15px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn-primary { background: #0070ba; color: white; }
    .btn-primary:hover { background: #005ea6; }
    .btn-primary:disabled { background: #aaa; cursor: not-allowed; }
    .alert { padding: 11px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; line-height: 1.5; }
    .alert-info  { background: #e8f4fd; color: #0c5a8a; border: 1px solid #b3d9f5; }
    .alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .alert-warn  { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
    .alert-error { background: #fde8e8; color: #8a0c0c; border: 1px solid #f5b3b3; }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.5); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #paypal-button-container { margin-top: 16px; min-height: 60px; }
    .note { font-size: 12px; color: #888; margin-top: 8px; }
    #log1, #log2, #log3 { margin-top: 12px; background: #1e1e1e; color: #d4d4d4; border-radius: 8px; padding: 14px; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 220px; overflow-y: auto; display: none; }
    .log-toggle { font-size: 12px; color: #888; cursor: pointer; text-align: center; display: block; margin-top: 8px; }
    .vault-result { background: #f0f9ff; border: 1px solid #b3d9f5; border-radius: 8px; padding: 14px; font-size: 12px; font-family: monospace; margin-top: 12px; display: none; }
    .vault-result strong { font-size: 13px; font-family: sans-serif; display: block; margin-bottom: 8px; color: #0c5a8a; }
    .customer-id-row { display: flex; gap: 8px; margin-top: 8px; }
    .customer-id-row input { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; font-size: 13px; }
    .customer-id-row button { background: #0070ba; color: white; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; white-space: nowrap; }
    /* Tab 3 Vault Component UI */
    #vault-container { margin-top: 8px; min-height: 64px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; }
    #vault-container.loading { display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
    #smart-messaging-container { margin-top: 12px; }
    .path-indicator { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: 600; margin-left: 8px; }
    .path-a { background: #d4edda; color: #155724; }
    .path-b { background: #e8f4fd; color: #0c5a8a; }
    .vault-id-display { font-size: 11px; color: #999; font-family: monospace; margin-top: 4px; word-break: break-all; }
  </style>
</head>
<body>

<header>
  <span>🅿️</span> PayPal デモ — Edit FI / Vault with Purchase + BNPL
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab(1)">Tab 1: Edit FI<span class="badge badge-old">Billing Agreement</span></div>
  <div class="tab" onclick="switchTab(2)">Tab 2: Vault with Purchase<span class="badge badge-new">+ BNPL</span></div>
  <div class="tab" onclick="switchTab(3)">Tab 3: paypal.Vault()<span class="badge badge-alpha">Alpha</span></div>
</div>

<!-- ==============================
     Tab 1: Edit FI フロー
     ============================== -->
<div class="tab-content active" id="tab1">
  <div class="container">
    <div class="card">
      <h2>チェックアウト</h2>

      <div id="alert1"></div>

      <div class="product">
        <div>デモ商品</div>
        <div style="font-weight:600">$50.00</div>
      </div>
      <div class="total"><span>合計</span><span>$50.00</span></div>

      <div class="section-title">支払い方法</div>
      <div class="payment-info">
        <div>
          <div id="ba-email" style="font-weight:600;font-size:14px">読み込み中...</div>
          <div style="font-size:11px;color:#aaa;margin-top:2px">${config.BILLING_AGREEMENT_ID}</div>
        </div>
        <button class="edit-fi-btn" onclick="openEditFI()">変更 →</button>
      </div>
      <p class="note">「変更」をクリックすると PayPal ポップアップが開き、<br>保存済み支払い手段を変更できます。</p>

      <button class="btn btn-primary" id="btn1" onclick="capture1()">注文を確定する</button>
    </div>

    <a class="log-toggle" onclick="toggleLog(1)">▼ APIログ</a>
    <div id="log1"></div>
  </div>
</div>

<!-- ==============================
     Tab 2: Vault with Purchase + BNPL
     ============================== -->
<div class="tab-content" id="tab2">
  <div class="container">
    <div class="card">
      <h2>チェックアウト</h2>

      <div id="alert2"></div>

      <div class="product">
        <div>デモ商品</div>
        <div style="font-weight:600">$50.00</div>
      </div>
      <div class="total"><span>合計</span><span>$50.00</span></div>

      <div class="section-title">リピーターの場合（任意）</div>
      <div class="customer-id-row">
        <input type="text" id="customer-id-input" placeholder="PayPal Customer ID（例: 208743798）">
        <button onclick="reloadSDK()">適用</button>
      </div>
      <p class="note">Customer IDを入れると保存済み手段でのリピーターフローになります。</p>

      <div class="section-title">支払い方法を選択</div>
      <div id="paypal-button-container">
        <p style="color:#aaa;font-size:13px;text-align:center;padding:20px 0">ボタン読み込み中...</p>
      </div>
      <p class="note">↑ PayPal ボタンと <strong>Pay Later セカンドボタン</strong>が表示されます<br>
         （Sandbox: <code>enable-funding=paylater&buyer-country=US</code>）</p>
    </div>

    <div class="vault-result" id="vault-result">
      <strong>✅ Vault 保存完了</strong>
      <div id="vault-detail"></div>
    </div>

    <a class="log-toggle" onclick="toggleLog(2)">▼ APIログ</a>
    <div id="log2"></div>
  </div>
</div>

<!-- ==============================
     Tab 3: paypal.Vault() Component（Alpha）
     ============================== -->
<div class="tab-content" id="tab3">
  <div class="container">
    <div class="card">
      <h2>チェックアウト</h2>

      <div id="alert3"></div>

      <div class="product">
        <div>デモ商品</div>
        <div style="font-weight:600">$50.00</div>
      </div>
      <div class="total"><span>合計</span><span>$50.00</span></div>

      <div class="section-title">保存済み支払い方法</div>
      <!-- paypal.Vault() コンポーネントがここにレンダリングされる -->
      <!-- 表示例: PayPal | [カードアイコン] ••1234 ✏️  -->
      <!--        PayPal | [カードアイコン] ••1234 (Pay in 4) ✏️  -->
      <div id="vault-container" class="loading">
        <span>${vaultIdConfigured ? 'コンポーネント読み込み中...' : '⚠️ PAYPAL_VAULT_ID が未設定です'}</span>
      </div>
      <div class="vault-id-display" id="vault-id-display">
        Vault ID: ${config.VAULT_ID || '（未設定）'}
      </div>

      <!-- Smart Messaging: BNPL未選択時に表示 -->
      <div id="smart-messaging-container"></div>

      <!-- 決済フロー説明 -->
      <div style="margin-top:16px;font-size:12px;color:#777;background:#f9f9f9;border-radius:6px;padding:10px 12px;line-height:1.6">
        <strong style="color:#555">2パスロジック:</strong><br>
        <span class="path-indicator path-a">Path A</span> 鉛筆アイコンで支払い手段変更 → onApprove → キャプチャ<br>
        <span class="path-indicator path-b">Path B</span> 変更なし → Vault ID で直接注文作成＆キャプチャ
      </div>

      <button class="btn btn-primary" id="btn3" onclick="submit3()" ${vaultIdConfigured ? '' : 'disabled'}>
        注文を確定する
      </button>
    </div>

    <div class="vault-result" id="vault-result3">
      <strong>✅ 決済完了</strong>
      <div id="vault-detail3"></div>
    </div>

    <a class="log-toggle" onclick="toggleLog(3)">▼ APIログ</a>
    <div id="log3"></div>
  </div>
</div>

<script>
  // ---- Tab 切り替え ----
  let tab3Initialized = false;

  function switchTab(n) {
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === n-1));
    document.querySelectorAll('.tab-content').forEach((c, i) => c.classList.toggle('active', i === n-1));

    // Tab 3 を初めて開いたときに遅延初期化
    if (n === 3 && !tab3Initialized) {
      tab3Initialized = true;
      initTab3();
    }

    // Tab 3 の SDK ロード後に Tab 2 へ戻った場合は再初期化
    if (n === 2 && tab3Initialized) {
      const cid = document.getElementById('customer-id-input').value.trim() || null;
      initTab2(cid);
    }
  }

  // ---- ログ ----
  function log(n, msg, data) {
    const el = document.getElementById('log' + n);
    el.style.display = 'block';
    const ts = new Date().toLocaleTimeString('ja-JP');
    el.textContent += '[' + ts + '] ' + msg + '\\n';
    if (data) el.textContent += JSON.stringify(data, null, 2) + '\\n\\n';
    el.scrollTop = el.scrollHeight;
  }
  function toggleLog(n) {
    const el = document.getElementById('log' + n);
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // ---- アラート ----
  function showAlert(n, msg, type = 'info') {
    document.getElementById('alert' + n).innerHTML =
      '<div class="alert alert-' + type + '">' + msg + '</div>';
  }

  // =====================================
  // Tab 1: Edit FI
  // =====================================
  let tab1OrderId   = null;
  let tab1EditFIUrl = null;

  async function initTab1() {
    // BA のメールアドレスを取得して表示
    const baRes  = await fetch('/api/ba/details');
    const baData = await baRes.json();
    log(1, 'BA詳細', baData);
    document.getElementById('ba-email').textContent = baData.email || '（メール取得失敗）';

    // Order作成
    log(1, 'Order作成中（Billing Agreement）...');
    const res  = await fetch('/api/ba/create-order', { method: 'POST' });
    const data = await res.json();
    log(1, 'Create Order レスポンス', data);
    if (data.error) { showAlert(1, 'Order作成失敗: ' + data.error, 'error'); return; }
    tab1OrderId   = data.id;
    const approve = data.links?.find(l => l.rel === 'approve');
    if (approve) {
      tab1EditFIUrl = approve.href;
      showAlert(1, 'Order作成完了。「変更」で支払い手段を変更できます。', 'info');
    }
  }

  function openEditFI() {
    if (!tab1EditFIUrl) { showAlert(1, 'Order IDがありません', 'error'); return; }
    log(1, 'PayPalポップアップを開く: ' + tab1EditFIUrl);
    const popup = window.open(tab1EditFIUrl, 'pp_edit_fi', 'width=500,height=600,scrollbars=yes');
    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          log(1, 'ポップアップが閉じられました');
          showAlert(1, '支払い手段の変更が完了（またはキャンセル）しました。「注文を確定する」で決済できます。', 'info');
        }
      } catch(e) { /* cross-origin */ }
    }, 500);
  }

  async function capture1() {
    if (!tab1OrderId) { showAlert(1, 'Order IDがありません', 'error'); return; }
    const btn = document.getElementById('btn1');
    btn.innerHTML = '<span class="spinner"></span>処理中...';
    btn.disabled = true;
    log(1, 'Capture実行: ' + tab1OrderId);
    const res  = await fetch('/api/capture/' + tab1OrderId, { method: 'POST' });
    const data = await res.json();
    log(1, 'Capture レスポンス', data);
    if (data.status === 'COMPLETED') {
      showAlert(1, '✅ 決済完了！ Capture ID: ' + data.purchase_units?.[0]?.payments?.captures?.[0]?.id, 'success');
      btn.textContent = '完了';
    } else {
      showAlert(1, '❌ エラー: ' + (data.message || JSON.stringify(data)), 'error');
      btn.textContent = '注文を確定する';
      btn.disabled = false;
    }
  }

  // =====================================
  // Tab 2: Vault with Purchase + BNPL
  // =====================================
  let sdkLoaded = false;

  async function loadPayPalSDK(idToken) {
    // 既存のスクリプトを削除
    ['paypal-sdk', 'paypal-sdk-vault'].forEach(id => {
      const old = document.getElementById(id);
      if (old) old.remove();
    });
    if (window.paypal) delete window.paypal;

    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.id  = 'paypal-sdk';
      // PPTXの指示通り: enable-funding=paylater + buyer-country=US (Sandboxのみ)
      s.src = 'https://www.paypal.com/sdk/js'
            + '?client-id=${config.CLIENT_ID}'
            + '&enable-funding=paylater'
            + '&currency=USD'
            + '&buyer-country=US'
            + '&components=buttons,messages';
      s.setAttribute('data-user-id-token', idToken);
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function renderButtons() {
    const container = document.getElementById('paypal-button-container');
    container.innerHTML = '';

    paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },

      createOrder: async function(data) {
        log(2, 'Order作成中（Vault with Purchase）... 支払い元: ' + data.paymentSource);
        const res  = await fetch('/api/vault/create-order', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ paymentSource: data.paymentSource }),
        });
        const order = await res.json();
        log(2, 'Create Order レスポンス', order);
        if (order.error) { showAlert(2, 'Order作成失敗: ' + order.error, 'error'); throw new Error(order.error); }
        showAlert(2, 'Order作成完了。PayPalで承認してください。', 'info');
        return order.id;
      },

      onApprove: async function(data) {
        showAlert(2, '<span class="spinner" style="border-color:#0c5a8a;border-top-color:transparent"></span> Capture中...', 'info');
        log(2, 'Capture実行: ' + data.orderID);
        const res    = await fetch('/api/capture/' + data.orderID, { method: 'POST' });
        const result = await res.json();
        log(2, 'Capture レスポンス', result);

        if (result.status === 'COMPLETED') {
          const vault    = result.payment_source?.paypal?.attributes?.vault;
          const captureId = result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
          showAlert(2, '✅ 決済完了！ Capture ID: ' + captureId, 'success');

          if (vault) {
            const detail = document.getElementById('vault-detail');
            detail.innerHTML =
              '<b>vault.id:</b> '    + (vault.id || '（APPROVED状態、webhook待ち）') + '<br>' +
              '<b>customer.id:</b> ' + (vault.customer?.id || '—') + '<br>' +
              '<b>status:</b> '      + vault.status;
            document.getElementById('vault-result').style.display = 'block';
            log(2, '★ Vault保存完了', vault);
          }
        } else {
          showAlert(2, '❌ エラー: ' + (result.message || JSON.stringify(result)), 'error');
        }
      },

      onCancel: function(data) {
        showAlert(2, '⚠️ キャンセルされました', 'warn');
        log(2, 'キャンセル', data);
      },

      onError: function(err) {
        showAlert(2, '❌ SDKエラー: ' + err, 'error');
        log(2, 'SDKエラー', err);
      },
    }).render('#paypal-button-container');
  }

  async function initTab2(customerId) {
    log(2, 'User ID Token取得中...' + (customerId ? '（Customer ID: ' + customerId + '）' : '（初回）'));
    const url = '/api/id-token' + (customerId ? '?customerId=' + customerId : '');
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) { showAlert(2, 'ID Token取得失敗: ' + data.error, 'error'); return; }
    log(2, 'ID Token取得成功（先頭30文字）: ' + data.id_token?.slice(0, 30) + '...');

    await loadPayPalSDK(data.id_token);
    renderButtons();
    showAlert(2, customerId
      ? 'リピーターモード：保存済み支払い手段 + BNPLが選択できます。'
      : '初回モード：決済完了後にVaultへ保存されます。Pay Laterボタンも表示されます。', 'info');
  }

  function reloadSDK() {
    const cid = document.getElementById('customer-id-input').value.trim();
    initTab2(cid || null);
  }

  // =====================================
  // Tab 3: paypal.Vault() Component（Alpha）
  // =====================================
  let tab3OrderApproved   = false;
  let tab3ApprovedOrderId = null;

  async function loadPayPalSDKVault(clientToken) {
    // 既存のスクリプトを全て削除
    ['paypal-sdk', 'paypal-sdk-vault'].forEach(id => {
      const old = document.getElementById(id);
      if (old) old.remove();
    });
    if (window.paypal) delete window.paypal;

    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.id  = 'paypal-sdk-vault';
      // Vault コンポーネントは data-sdk-client-token（setup-token）を使用
      s.src = 'https://www.paypal.com/sdk/js'
            + '?client-id=${config.CLIENT_ID}'
            + '&components=vault,buttons,messages'
            + '&currency=USD';
      s.setAttribute('data-sdk-client-token', clientToken);
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function initTab3() {
    const vaultContainer = document.getElementById('vault-container');
    vaultContainer.classList.add('loading');

    // VAULT_ID 未設定チェック
    const vaultId = '${config.VAULT_ID}';
    if (!vaultId || vaultId.length < 5) {
      showAlert(3, '⚠️ <b>PAYPAL_VAULT_ID</b> が設定されていません。<br>Tab 2 で決済を完了してVault IDを取得し、<code>.env</code> の <code>PAYPAL_VAULT_ID</code> に設定してください。', 'warn');
      vaultContainer.innerHTML = '<div style="padding:20px;font-size:13px;color:#856404;text-align:center">VAULT_ID 未設定</div>';
      return;
    }

    log(3, 'Setup Token取得中（v3/vault/setup-tokens）...');
    log(3, 'Vault ID: ' + vaultId);

    try {
      const res  = await fetch('/api/vault3/setup-token');
      const data = await res.json();
      log(3, 'Setup Token レスポンス', data);

      if (data.error) {
        const detail = data._raw ? '<br><small>' + JSON.stringify(data._raw) + '</small>' : '';
        showAlert(3, '❌ Setup Token取得失敗: ' + data.error + detail, 'error');
        // CUSTOMER_ID が未設定の場合のヒントを表示
        if (!data._raw?.name || data._raw?.name === 'INTERNAL_SERVER_ERROR') {
          showAlert(3,
            '❌ Setup Token取得失敗 — <b>PAYPAL_CUSTOMER_ID</b> が必要な可能性があります。<br>' +
            'Tab 2 の決済完了ログに表示された <code>vault.customer.id</code> の値を<br>' +
            '<code>.env</code> の <code>PAYPAL_CUSTOMER_ID</code> に設定してください。<br>' +
            '<small>' + data.error + '</small>', 'error');
        }
        vaultContainer.innerHTML = '<div style="padding:20px;font-size:13px;color:#8a0c0c;text-align:center">Setup Token エラー — APIログを確認してください</div>';
        return;
      }

      log(3, 'Client Token取得成功 [' + (data.method || '?') + ']（先頭40文字）: ' + data.client_token?.slice(0, 40) + '...');
      showAlert(3, 'SDK読み込み中...', 'info');

      await loadPayPalSDKVault(data.client_token);

      // paypal.Vault() の存在チェック（Alpha機能：有効化が必要）
      if (typeof paypal.Vault !== 'function') {
        showAlert(3, '⚠️ <b>paypal.Vault()</b> がこのアカウントで有効ではありません。<br>Alpha機能のため、PayPal による有効化が必要です。<br>Setup Token API は正常に動作しています（下記APIログ参照）。', 'warn');
        vaultContainer.innerHTML = '<div style="padding:16px;font-size:12px;color:#856404">' +
          '<b>[モック表示]</b> paypal.Vault() が有効化された場合のUI:<br><br>' +
          '<div style="background:white;border:1px solid #ddd;border-radius:6px;padding:12px;font-size:13px;display:flex;align-items:center;gap:10px">' +
          '<img src="https://www.paypalobjects.com/webstatic/icon/pp258.png" width="20" alt="PP">' +
          '<span>PayPal</span>' +
          '<span style="color:#666">|</span>' +
          '<span>💳 ••1234</span>' +
          '<button style="background:none;border:none;cursor:pointer;color:#0070ba;font-size:14px" title="支払い方法を変更">✏️</button>' +
          '</div>' +
          '<div style="margin-top:8px;background:white;border:1px solid #ddd;border-radius:6px;padding:12px;font-size:13px;display:flex;align-items:center;gap:10px">' +
          '<img src="https://www.paypalobjects.com/webstatic/icon/pp258.png" width="20" alt="PP">' +
          '<span>PayPal</span>' +
          '<span style="color:#666">|</span>' +
          '<span>💳 ••1234</span>' +
          '<span style="background:#e8f4fd;color:#0c5a8a;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:600">Pay in 4</span>' +
          '<button style="background:none;border:none;cursor:pointer;color:#0070ba;font-size:14px" title="支払い方法を変更">✏️</button>' +
          '</div>' +
          '</div>';
        log(3, '★ paypal.Vault() 未利用可能。Alpha有効化待ち。');

        // Smart Messaging は表示可能な場合がある
        if (typeof paypal.Messages === 'function') {
          paypal.Messages({ amount: 50, placement: 'payment' })
            .render('#smart-messaging-container');
        }
        return;
      }

      // paypal.Vault() コンポーネントレンダリング
      vaultContainer.classList.remove('loading');
      vaultContainer.innerHTML = '';

      paypal.Vault({
        createOrder: async function() {
          log(3, 'onEdit: Order作成中（PAYMENT_METHOD_TOKEN）...');
          const orderRes  = await fetch('/api/vault3/create-order', { method: 'POST' });
          const orderData = await orderRes.json();
          log(3, 'Create Order レスポンス', orderData);
          if (orderData.error) throw new Error(orderData.error);
          return orderData.id;
        },

        onApprove: function(data) {
          // Path A: 買い手が支払い手段を変更・承認した
          log(3, 'onApprove: Path A → Order承認済み: ' + data.orderID);
          tab3OrderApproved   = true;
          tab3ApprovedOrderId = data.orderID;
          showAlert(3,
            '✅ 支払い手段が変更されました <span class="path-indicator path-a">Path A</span><br>' +
            '「注文を確定する」で決済（Capture）します。', 'info');
          // BNPL選択後は Smart Messaging を非表示
          document.getElementById('smart-messaging-container').style.display = 'none';
        },

        onCancel: function() {
          log(3, 'キャンセル（変更なし）');
          showAlert(3, '⚠️ キャンセルされました。変更なしで続行するには「注文を確定する」をクリックしてください。', 'warn');
        },

        onError: function(err) {
          showAlert(3, '❌ SDKエラー: ' + err, 'error');
          log(3, 'SDKエラー', { error: String(err) });
        },
      }).render('#vault-container');

      // Smart Messaging（BNPL未選択時に表示）
      if (typeof paypal.Messages === 'function') {
        paypal.Messages({ amount: 50, placement: 'payment' })
          .render('#smart-messaging-container');
      }

      showAlert(3,
        'Vault コンポーネントが読み込まれました。<br>' +
        '✏️ をクリックすると支払い手段を変更できます（Pay Later も選択可）。<br>' +
        '変更しない場合はそのまま「注文を確定する」をクリックしてください <span class="path-indicator path-b">Path B</span>', 'info');

    } catch(e) {
      showAlert(3, '❌ 初期化エラー: ' + e.message, 'error');
      log(3, 'initTab3 エラー', { error: e.message });
    }
  }

  async function submit3() {
    const btn = document.getElementById('btn3');
    btn.innerHTML = '<span class="spinner"></span>処理中...';
    btn.disabled = true;

    let result;

    try {
      if (tab3OrderApproved && tab3ApprovedOrderId) {
        // ---- Path A: 支払い手段変更済み → onApprove の Order ID をキャプチャ ----
        log(3, '▶ Path A: Capture実行: ' + tab3ApprovedOrderId);
        const res = await fetch('/api/capture/' + tab3ApprovedOrderId, { method: 'POST' });
        result = await res.json();
        log(3, 'Path A Capture レスポンス', result);
      } else {
        // ---- Path B: 変更なし → Vault ID で直接注文作成＆キャプチャ ----
        log(3, '▶ Path B: Vault直接課金（create + capture）...');
        const res = await fetch('/api/vault3/charge', { method: 'POST' });
        result = await res.json();
        log(3, 'Path B Charge レスポンス', result);
      }

      if (result.status === 'COMPLETED') {
        const captureId = result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        const pathLabel = tab3OrderApproved ? '<span class="path-indicator path-a">Path A</span>' : '<span class="path-indicator path-b">Path B</span>';
        showAlert(3, '✅ 決済完了！ ' + pathLabel + '<br>Capture ID: ' + captureId, 'success');
        btn.textContent = '完了';

        document.getElementById('vault-detail3').innerHTML =
          '<b>path:</b> ' + (tab3OrderApproved ? 'A (FI変更あり)' : 'B (Vault直接)') + '<br>' +
          '<b>capture_id:</b> ' + captureId + '<br>' +
          '<b>status:</b> ' + result.status;
        document.getElementById('vault-result3').style.display = 'block';
      } else {
        showAlert(3, '❌ エラー: ' + (result.message || JSON.stringify(result)), 'error');
        btn.textContent = '注文を確定する';
        btn.disabled = false;
      }
    } catch(e) {
      showAlert(3, '❌ 例外: ' + e.message, 'error');
      btn.textContent = '注文を確定する';
      btn.disabled = false;
    }
  }

  // ---- ページロード ----
  window.addEventListener('load', () => {
    initTab1();
    initTab2(null);
    // Tab 3 は初回クリック時に遅延初期化（VAULT_ID が未設定でも問題ない）
  });
</script>
</body>
</html>`);
});


// ---- API Routes ----

// Tab1: BA詳細取得
app.get('/api/ba/details', async (req, res) => {
  try {
    const token = await getAccessToken();
    const details = await getBillingAgreement(token, config.BILLING_AGREEMENT_ID);
    console.log('[ba/details] raw response:', JSON.stringify(details, null, 2));
    res.json({
      id:    details.id,
      state: details.state,
      email: details.payer?.payer_info?.email,
      name:  details.payer?.payer_info?.first_name
             ? `${details.payer.payer_info.first_name} ${details.payer.payer_info.last_name}`
             : null,
      _raw_payer: details.payer,
    });
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// Tab1: Billing Agreement ベースのOrder作成
app.post('/api/ba/create-order', async (req, res) => {
  try {
    const token = await getAccessToken();
    const order = await createOrderWithBA(token);
    console.log('[ba/create-order]', JSON.stringify(order, null, 2));
    res.json(order);
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// Tab2: User ID Token 発行
app.get('/api/id-token', async (req, res) => {
  try {
    const token      = await getAccessToken();
    const customerId = req.query.customerId || null;
    const id_token   = await getUserIdToken(token, customerId);
    if (!id_token) throw new Error('id_token が取得できませんでした');
    res.json({ id_token });
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// Tab2: Vault with Purchase Order作成
app.post('/api/vault/create-order', async (req, res) => {
  try {
    const token = await getAccessToken();
    // 'paylater' は Orders API では 'paypal' として渡す（Pay Later はPayPal内の支払い方法）
    const paymentSource = req.body.paymentSource === 'paylater' ? 'paypal' : (req.body.paymentSource || 'paypal');
    const order         = await createOrderWithVault(token, paymentSource);
    console.log('[vault/create-order]', JSON.stringify(order, null, 2));
    res.json(order);
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// Tab3: Setup Token発行
// 試行順:
//   1. v3/vault/setup-tokens（SDD準拠の本命、Alpha機能で有効化が必要）
//   2. v1/oauth2/token id_token（フォールバック、Tab2と同じ仕組み）
app.get('/api/vault3/setup-token', async (req, res) => {
  try {
    if (!config.VAULT_ID) throw new Error('PAYPAL_VAULT_ID が設定されていません。.env に PAYPAL_VAULT_ID を追加してください。');
    const token      = await getAccessToken();
    const customerId = req.query.customerId || config.CUSTOMER_ID || null;

    // --- 試行 1: v3/vault/setup-tokens ---
    const v3result = await createSetupToken(token, config.VAULT_ID, customerId);
    if (v3result.id) {
      console.log('[vault3/setup-token] ✅ v3/vault/setup-tokens 成功');
      return res.json({ client_token: v3result.id, status: v3result.status, method: 'v3_setup_token' });
    }
    console.warn('[vault3/setup-token] ⚠️  v3/vault/setup-tokens 失敗 → id_token フォールバック:', v3result.message || v3result.error);

    // --- 試行 2: v1/oauth2/token id_token（customerId 必須）---
    if (!customerId) {
      return res.json({
        error: 'v3/vault/setup-tokens が利用不可のため id_token フォールバックを試みましたが CUSTOMER_ID が未設定です。',
        _v3_error: v3result,
      });
    }
    const idToken = await getUserIdToken(token, customerId);
    if (idToken) {
      console.log('[vault3/setup-token] ✅ id_token フォールバック成功');
      return res.json({ client_token: idToken, status: 'APPROVED', method: 'id_token_fallback' });
    }

    // どちらも失敗
    return res.json({ error: 'Setup Token の取得に失敗しました。', _v3_error: v3result });
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// Tab3: Path A 用 Order作成（paypal.Vault() の createOrder コールバック経由）
app.post('/api/vault3/create-order', async (req, res) => {
  try {
    if (!config.VAULT_ID) throw new Error('PAYPAL_VAULT_ID が設定されていません');
    const token = await getAccessToken();
    const order = await createOrderWithToken(token, config.VAULT_ID);
    console.log('[vault3/create-order]', JSON.stringify(order, null, 2));
    res.json(order);
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// Tab3: Path B 直接課金（支払い手段変更なし → Vault ID でそのままOrder作成 & Capture）
app.post('/api/vault3/charge', async (req, res) => {
  try {
    if (!config.VAULT_ID) throw new Error('PAYPAL_VAULT_ID が設定されていません');
    const token = await getAccessToken();
    // Step 1: Order作成
    const order = await createOrderWithToken(token, config.VAULT_ID);
    console.log('[vault3/charge] create-order:', JSON.stringify(order, null, 2));
    if (!order.id) throw new Error(order.message || 'Order作成失敗: ' + JSON.stringify(order));
    // Step 2: 即座にCapture（バイヤー承認不要）
    const result = await captureOrder(token, order.id);
    console.log('[vault3/charge] capture:', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// 共通: Capture
app.post('/api/capture/:orderId', async (req, res) => {
  try {
    const token  = await getAccessToken();
    const result = await captureOrder(token, req.params.orderId);
    console.log('[capture]', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// PayPal承認後のリターンURL
app.get('/return', (req, res) => {
  const { token } = req.query;
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>承認完了</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px;}</style></head>
<body>
<h2 style="color:#0070ba">✅ 承認されました</h2>
<p>Order ID: <strong>${token || ''}</strong></p>
<p style="margin-top:12px;color:#666">このウィンドウを閉じてチェックアウト画面に戻ってください。</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'paypal_approved', orderId: '${token || ''}' }, '*');
    setTimeout(() => window.close(), 1500);
  }
</script>
</body></html>`);
});

// キャンセルURL
app.get('/cancel', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>キャンセル</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px;}</style></head>
<body>
<h2 style="color:#888">⚠️ キャンセルされました</h2>
<p style="margin-top:12px;color:#666">このウィンドウを閉じてチェックアウト画面に戻ってください。</p>
<script>if (window.opener) setTimeout(() => window.close(), 1500);</script>
</body></html>`);
});

app.listen(config.PORT, () => {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PayPal デモサーバー起動
  http://localhost:${config.PORT}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tab 1: Edit FI（Billing Agreement）
  Tab 2: Vault with Purchase + BNPL
  Tab 3: paypal.Vault() Component（Alpha）
         VAULT_ID: ${config.VAULT_ID || '（未設定 — .env に PAYPAL_VAULT_ID を追加）'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
});

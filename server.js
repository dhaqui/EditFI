/**
 * PayPal Edit FI + Vault with Purchase (BNPL) デモサーバー
 *
 * 使い方:
 *   1. config の CLIENT_ID / CLIENT_SECRET / BILLING_AGREEMENT_ID を設定
 *   2. npm install express node-fetch
 *   3. node server.js
 *   4. ブラウザで http://localhost:3000 を開く
 *
 *   Tab 1: Edit FI フロー（Billing Agreement + 支払い手段変更）
 *   Tab 2: Vault with Purchase フロー（JS SDK + BNPLセカンドボタン）
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

// トップページ（2タブUI）
app.get('/', (req, res) => {
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
    #log1, #log2 { margin-top: 12px; background: #1e1e1e; color: #d4d4d4; border-radius: 8px; padding: 14px; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 220px; overflow-y: auto; display: none; }
    .log-toggle { font-size: 12px; color: #888; cursor: pointer; text-align: center; display: block; margin-top: 8px; }
    .vault-result { background: #f0f9ff; border: 1px solid #b3d9f5; border-radius: 8px; padding: 14px; font-size: 12px; font-family: monospace; margin-top: 12px; display: none; }
    .vault-result strong { font-size: 13px; font-family: sans-serif; display: block; margin-bottom: 8px; color: #0c5a8a; }
    .customer-id-row { display: flex; gap: 8px; margin-top: 8px; }
    .customer-id-row input { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; font-size: 13px; }
    .customer-id-row button { background: #0070ba; color: white; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  </style>
</head>
<body>

<header>
  <span>🅿️</span> PayPal デモ — Edit FI / Vault with Purchase + BNPL
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab(1)">Tab 1: Edit FI<span class="badge badge-old">Billing Agreement</span></div>
  <div class="tab" onclick="switchTab(2)">Tab 2: Vault with Purchase<span class="badge badge-new">+ BNPL</span></div>
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

<script>
  // ---- Tab 切り替え ----
  function switchTab(n) {
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === n-1));
    document.querySelectorAll('.tab-content').forEach((c, i) => c.classList.toggle('active', i === n-1));
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
    const old = document.getElementById('paypal-sdk');
    if (old) old.remove();
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
            + '&components=buttons';
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

  // ---- ページロード ----
  window.addEventListener('load', () => {
    initTab1();
    initTab2(null);
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
});

const { chromium } = require('playwright');
const fs = require('fs');

const CONFIG = {
  websiteUrl: 'https://chomthong-gold-shop.vercel.app/',
  priceSelectors: [
    '.card-body.items-center.text-center',
    '[class*="card-body"][class*="items-center"]',
    'main',
  ],
  lastPriceFile: 'last_price.json',
  minPriceChangeTHB: 10,
  zoomFactor: 0.6,
  deviceScaleFactor: 3,
  postStartHour: 9, postStartMin: 30,   // 09:30 น.
  postEndHour: 16,  postEndMin: 30,     // 16:30 น.
};

function formatPrice(price) {
  return price.toLocaleString('th-TH');
}

function loadLastPrice() {
  try {
    if (fs.existsSync(CONFIG.lastPriceFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.lastPriceFile, 'utf8'));
      if (data && data.sell) return data;
    }
  } catch (e) {
    console.log('ไม่พบไฟล์ราคาเก่า จะโพสต์ครั้งแรก');
  }
  return null;
}

function saveLastPrice(priceData) {
  fs.writeFileSync(CONFIG.lastPriceFile, JSON.stringify(priceData, null, 2), 'utf8');
  console.log('บันทึกราคาล่าสุดแล้ว:', priceData);
}

function buildPostMessage(sellPrice, buyPrice, dateStr, timeStr) {
  return `อัพเดตราคาทองตอนนี้นะคะ 😊
.
💛 ขายออก บาทละ ${formatPrice(sellPrice)} บาท
💛 รับซื้อ บาทละ ${formatPrice(buyPrice)} บาท
.
🗓️ อัพเดทวันที่ ${dateStr} เวลา ${timeStr} น.
.
#ราคาทอง #ราคาทองวันนี้
.
สำหรับท่านใดที่ไม่อยากพลาดอัพเดทราคาทองปัจจุบัน สามารถเข้าไปเช็คที่เว็บด้านล่างนี้ได้เลยค่ะ ⬇️😊
.
https://chomthong-gold-shop.vercel.app/
.
---------------------------------
ห้างทองจอมทอง ตรงข้ามตลาดจอมทอง กรุงเทพฯ
.
📍 แผนที่ร้าน :
https://maps.app.goo.gl/1rDfcVCezRv6auE56
.
#ทองคุณภาพได้มาตรฐาน #ค่ากำเหน็จราคาถูก #บริการเป็นกันเอง
.
ทางร้านของเราพร้อมยินดีต้อนรับและให้บริการคุณลูกค้าทุกท่านค่ะ 🥰`;
}

async function scrapeGoldPrice() {
  console.log('กำลังเปิดเว็บไซต์...');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    deviceScaleFactor: CONFIG.deviceScaleFactor,
  });
  const page = await context.newPage();

  await page.goto(CONFIG.websiteUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate((zoom) => { document.body.style.zoom = String(zoom); }, CONFIG.zoomFactor);
  await page.waitForTimeout(2000);

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('ข้อความบนหน้าเว็บ (200 ตัวอักษรแรก):', pageText.substring(0, 200));

  const prices = extractPrices(pageText);
  console.log('ราคาที่พบ:', prices);

  let screenshotBuffer = null;
  for (const selector of CONFIG.priceSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        console.log('พบ element ด้วย selector:', selector);
        screenshotBuffer = await element.screenshot({ type: 'png' });
        const sharp = require('sharp');
        const meta = await sharp(screenshotBuffer).metadata();
        console.log('ขนาดรูปที่แคปได้:', meta.width, 'x', meta.height);

        // ==============================
        // ปรับกรอบภาพได้ที่นี่ (หน่วยเป็น pixel)
        const cropTop    = 0;
        const cropBottom = 1010;
        const cropLeft   = 42;
        const cropRight  = 43;
        // ==============================

        if (cropTop || cropBottom || cropLeft || cropRight) {
          const newW = meta.width  - cropLeft - cropRight;
          const newH = meta.height - cropTop  - cropBottom;
          screenshotBuffer = await sharp(screenshotBuffer)
            .extract({ left: cropLeft, top: cropTop, width: newW, height: newH })
            .png()
            .toBuffer();
          console.log('ขนาดหลัง crop:', newW, 'x', newH);
        }
        break;
      }
    } catch (e) {
      console.log('selector error:', e.message);
    }
  }

  if (!screenshotBuffer) {
    console.log('ไม่พบ selector — จับภาพ viewport แทน');
    screenshotBuffer = await page.screenshot({ type: 'png' });
  }

  fs.writeFileSync('screenshot.png', screenshotBuffer);
  console.log('บันทึกภาพแล้วที่ screenshot.png');

  // Commit รูปขึ้น GitHub ก่อน เพื่อให้ Facebook ดึง URL ได้
  try {
    const { execSync } = require('child_process');
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
    execSync('git add screenshot.png');
    execSync('git diff --staged --quiet || git commit -m "Pre-post screenshot"');
    execSync('git push');
    console.log('Commit รูปสำเร็จ รอ 5 วินาที...');
    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.log('Commit รูป error:', e.message);
  }

  await browser.close();
  return { prices, screenshotBuffer };
}

function extractPrices(text) {
  const matches = text.match(/(\d{1,3}(?:,\d{3})+|\d{5,6})/g) || [];
  const numbers = matches
    .map(m => parseInt(m.replace(/,/g, ''), 10))
    .filter(n => n >= 30000 && n <= 200000);
  if (numbers.length >= 2) return { sell: numbers[0], buy: numbers[1] };
  if (numbers.length === 1) return { sell: numbers[0], buy: numbers[0] - 200 };
  return null;
}

async function refreshToken(currentToken) {
  const appId = (process.env.FB_APP_ID || '').trim();
  const appSecret = (process.env.FB_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    console.log('ไม่พบ FB_APP_ID หรือ FB_APP_SECRET — ข้าม refresh Token');
    return currentToken;
  }
  console.log('กำลัง refresh Token...');
  const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    console.log('refresh Token ไม่สำเร็จ:', data.error.message);
    return currentToken;
  }
  const newToken = data.access_token;
  console.log('refresh Token สำเร็จ');

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (githubToken && repo) {
    try {
      const keyRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
        headers: { Authorization: `Bearer ${githubToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
      });
      const keyData = await keyRes.json();
      const sodium = require('libsodium-wrappers');
      await sodium.ready;
      const binkey = sodium.from_base64(keyData.key, sodium.base64_variants.ORIGINAL);
      const binsec = sodium.from_string(newToken);
      const encBytes = sodium.crypto_box_seal(binsec, binkey);
      const encValue = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
      await fetch(`https://api.github.com/repos/${repo}/actions/secrets/FB_ACCESS_TOKEN`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ encrypted_value: encValue, key_id: keyData.key_id }),
      });
      console.log('อัปเดต GitHub Secret สำเร็จ');
    } catch (e) {
      console.log('อัปเดต Secret error:', e.message);
    }
  }
  return newToken;
}

async function deleteLastPost(postId, accessToken) {
  if (!postId) return;
  console.log('กำลังลบโพสต์เก่า ID:', postId);
  const params = new URLSearchParams();
  params.append('access_token', accessToken);
  const res = await fetch(`https://graph.facebook.com/v21.0/${postId}`, {
    method: 'DELETE',
    body: params,
  });
  const data = await res.json();
  if (data.error) {
    console.log('ลบโพสต์ไม่สำเร็จ (อาจถูกลบไปแล้ว):', data.error.message);
  } else {
    console.log('ลบโพสต์เก่าสำเร็จแล้ว ✅');
  }
}

async function postToFacebook(message, lastPostId) {
  const pageId = (process.env.FB_PAGE_ID || '').trim();
  let accessToken = (process.env.FB_ACCESS_TOKEN || '').trim();
  if (!pageId || !accessToken) throw new Error('ไม่พบ FB_PAGE_ID หรือ FB_ACCESS_TOKEN');

  accessToken = await refreshToken(accessToken);

  // ลบโพสต์เก่าก่อน
  await deleteLastPost(lastPostId, accessToken);

  const repo = process.env.GITHUB_REPOSITORY;
  const imageUrl = `https://raw.githubusercontent.com/${repo}/main/screenshot.png?t=${Date.now()}`;
  console.log('DEBUG image URL:', imageUrl);

  const params = new URLSearchParams();
  params.append('caption', message);
  params.append('url', imageUrl);
  params.append('access_token', accessToken);

  const postRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
    method: 'POST',
    body: params,
  });

  const postData = await postRes.json();
  console.log('ผลการโพสต์:', postData);
  if (postData.error) throw new Error(`Facebook API error: ${JSON.stringify(postData.error)}`);

  // คืนค่า post_id เพื่อเก็บไว้ลบครั้งหน้า
  return postData.post_id || postData.id || null;
}

async function main() {
  console.log('=== เริ่มระบบโพสต์ราคาทองอัตโนมัติ ===');

  // เช็คเวลาไทย — โพสต์ได้เฉพาะ 09:30-16:30 น.
  const nowCheck = new Date();
  const thaiNow = new Date(nowCheck.getTime() + 7 * 60 * 60 * 1000);
  const thaiHour = thaiNow.getUTCHours();
  const thaiMin = thaiNow.getUTCMinutes();
  const thaiMinTotal = thaiHour * 60 + thaiMin;
  const startMin = CONFIG.postStartHour * 60 + CONFIG.postStartMin;
  const endMin = CONFIG.postEndHour * 60 + CONFIG.postEndMin;
  console.log(`เวลาไทยปัจจุบัน: ${thaiHour}:${String(thaiMin).padStart(2,'0')} น.`);
  if (thaiMinTotal < startMin || thaiMinTotal > endMin) {
    console.log('อยู่นอกช่วงเวลาโพสต์ (09:30-16:30 น.) — ไม่โพสต์');
    process.exit(0);
  }

  const lastPrice = loadLastPrice();
  console.log('ราคาก่อนหน้า:', lastPrice);

  const { prices } = await scrapeGoldPrice();

  if (!prices) {
    console.log('ไม่สามารถดึงราคาทองได้ — หยุดการทำงาน');
    process.exit(0);
  }

  console.log('ราคาปัจจุบัน:', prices);

  if (lastPrice) {
    const diff = Math.abs(prices.sell - lastPrice.sell);
    if (diff < CONFIG.minPriceChangeTHB) {
      console.log('ราคาไม่เปลี่ยนแปลง (ต่างกัน', diff, 'บาท) — ไม่โพสต์');
      process.exit(0);
    }
  }

  const now = new Date();
  const thaiTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dateStr = thaiTime.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const timeStr = thaiTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  const message = buildPostMessage(prices.sell, prices.buy, dateStr, timeStr);
  console.log('ข้อความที่จะโพสต์:\n', message);

  if (process.env.TEST_MODE === 'true') {
    console.log('TEST MODE — ไม่โพสต์ลง Facebook');
  } else {
    const lastPostId = lastPrice ? (lastPrice.lastPostId || null) : null;
    const newPostId = await postToFacebook(message, lastPostId);
    console.log('โพสต์สำเร็จแล้ว! Post ID:', newPostId);
    saveLastPrice({ sell: prices.sell, buy: prices.buy, timestamp: now.toISOString(), lastPostId: newPostId });
    return;
  }

  saveLastPrice({ sell: prices.sell, buy: prices.buy, timestamp: now.toISOString() });
}

main().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});

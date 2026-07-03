const { chromium } = require('playwright');
const fs = require('fs');

// ==============================
// ประโยคสุ่มตามสถานการณ์ (แก้ไขได้)
// ==============================
const SENTENCES = {
  upSmall: [
    'เช้านี้ราคาทองขยับขึ้นเล็กน้อยนะคะ 📈',
    'ราคาทองวันนี้มีการปรับขึ้นเบา ๆ แล้วนะคะ ✨',
    'ทองวันนี้ขยับขึ้นนิดหน่อยค่ะ 😊',
    'มีการปรับขึ้นเล็กน้อยอีกแล้วนะคะ 💛',
    'ราคาทองวันนี้บวกเพิ่มเล็กน้อยค่า 📊',
  ],
  upBig: [
    'ราคาทองปรับขึ้นแรงพอสมควรเลยนะคะ 📈✨',
    'วันนี้ทองพุ่งขึ้นค่อนข้างเยอะเลยค่ะ 😮',
    'ราคาทองขยับขึ้นแรงกว่าปกติแล้วค่ะ 💛',
    'ทองวันนี้ปรับขึ้นแบบเห็นตัวเลขชัดเลยค่ะ 📊',
    'มีการปรับขึ้นค่อนข้างแรงเลยค่า 🔥',
  ],
  downSmall: [
    'วันนี้ราคาทองมีการปรับลงเล็กน้อยนะคะ 📉',
    'ราคาทองขยับลงเบา ๆ ค่ะ 😊',
    'เช้านี้ทองย่อตัวลงเล็กน้อยค่ะ 💛',
    'ราคาวันนี้ลดลงนิดหน่อยนะคะ 📊',
    'ทองวันนี้มีการปรับลงเล็กน้อยค่ะ ✨',
  ],
  downBig: [
    'ราคาทองวันนี้ปรับลงค่อนข้างแรงเลยค่ะ 📉',
    'วันนี้ทองลงแรงกว่าปกติเลยค่ะ 😮',
    'ราคาทองย่อตัวลงค่อนข้างเยอะวันนี้ 💛',
    'ทองวันนี้มีการปรับลดค่อนข้างมากค่ะ 📊',
    'มีการปรับลงแรงพอสมควรเลยค่า ✨',
  ],
};

// เกณฑ์แบ่ง "ขึ้น/ลงมาก" (บาท)
const BIG_CHANGE_THRESHOLD = 1000;

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
};

function formatPrice(price) {
  return price.toLocaleString('th-TH');
}

// เลือกประโยคสุ่มโดยไม่ซ้ำกับครั้งก่อน
function pickSentence(sentences, lastSentence) {
  const available = sentences.filter(s => s !== lastSentence);
  const pool = available.length > 0 ? available : sentences;
  return pool[Math.floor(Math.random() * pool.length)];
}

// เลือก sentence pool ตามสถานการณ์
function getSentencePool(change) {
  if (change > 0) {
    return Math.abs(change) >= BIG_CHANGE_THRESHOLD ? SENTENCES.upBig : SENTENCES.upSmall;
  } else if (change < 0) {
    return Math.abs(change) >= BIG_CHANGE_THRESHOLD ? SENTENCES.downBig : SENTENCES.downSmall;
  }
  return null; // ราคาคงที่ ไม่มีประโยคสุ่ม
}

function buildPostMessage(sellPrice, buyPrice, change, changeSymbol, changeText, dateStr, timeStr, sentence) {
  const sentenceLine = sentence ? `${sentence}\n.\n` : '';
  return `${sentenceLine}ราคาทองตอนนี้นะคะ 🏅
.
💛 ขายออก บาทละ ${formatPrice(sellPrice)} บาท
💛 รับซื้อ บาทละ ${formatPrice(buyPrice)} บาท
${changeSymbol} ${changeText} ${Math.abs(change)} บาทค่ะ
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

async function scrapeGoldPrice() {
  console.log('กำลังเปิดเว็บไซต์...');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(CONFIG.websiteUrl, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate((zoom) => {
    document.body.style.zoom = String(zoom);
  }, CONFIG.zoomFactor);

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
        const cropBottom = 310;
        const cropLeft   = 42;
        const cropRight  = 43;
        // ==============================

        const newW = meta.width  - cropLeft - cropRight;
        const newH = meta.height - cropTop  - cropBottom;
        if (cropTop || cropBottom || cropLeft || cropRight) {
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
    screenshotBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 800, height: 800 },
    });
  }

  fs.writeFileSync('screenshot.png', screenshotBuffer);
  console.log('บันทึกภาพแล้วที่ screenshot.png');

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
    console.log('refresh Token ไม่สำเร็จ:', data.error.message, '— ใช้ Token เดิม');
    return currentToken;
  }

  const newToken = data.access_token;
  console.log('refresh Token สำเร็จ — Token ใหม่ขึ้นต้นด้วย:', newToken.substring(0, 10));

  // อัปเดต GitHub Secret อัตโนมัติผ่าน GitHub API
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;

  if (githubToken && repo) {
    try {
      // ดึง public key ของ repo
      const keyRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
        headers: { Authorization: `Bearer ${githubToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
      });
      const keyData = await keyRes.json();

      // encrypt Token ด้วย public key ของ GitHub
      const sodium = require('libsodium-wrappers');
      await sodium.ready;
      const binkey = sodium.from_base64(keyData.key, sodium.base64_variants.ORIGINAL);
      const binsec = sodium.from_string(newToken);
      const encBytes = sodium.crypto_box_seal(binsec, binkey);
      const encValue = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

      // อัปเดต Secret
      const updateRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/FB_ACCESS_TOKEN`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ encrypted_value: encValue, key_id: keyData.key_id }),
      });

      if (updateRes.status === 204 || updateRes.status === 201) {
        console.log('อัปเดต GitHub Secret FB_ACCESS_TOKEN สำเร็จแล้ว');
      } else {
        console.log('อัปเดต Secret ไม่สำเร็จ status:', updateRes.status);
      }
    } catch (e) {
      console.log('อัปเดต Secret error:', e.message);
    }
  }

  return newToken;
}

async function postToFacebook(message, imageBuffer) {
  const pageId = (process.env.FB_PAGE_ID || '').trim();
  let accessToken = (process.env.FB_ACCESS_TOKEN || '').trim();

  if (!pageId || !accessToken) throw new Error('ไม่พบ FB_PAGE_ID หรือ FB_ACCESS_TOKEN');

  // Refresh Token ก่อนโพสต์ทุกครั้ง
  accessToken = await refreshToken(accessToken);

  console.log('กำลังโพสต์รูป+ข้อความลง Facebook...');

  // ใช้ URL ของรูปที่บันทึกไว้ใน GitHub แทนการส่ง binary
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
  return postData;
}

async function main() {
  console.log('=== เริ่มระบบโพสต์ราคาทองอัตโนมัติ ===');

  const lastPrice = loadLastPrice();
  console.log('ราคาก่อนหน้า:', lastPrice);

  const { prices, screenshotBuffer } = await scrapeGoldPrice();

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
  const dateStr = thaiTime.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  const timeStr = thaiTime.toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  let change = 0;
  let changeSymbol = '➡️';
  let changeText = 'ราคาคงที่';

  if (lastPrice) {
    change = prices.sell - lastPrice.sell;
    if (change > 0) { changeSymbol = '📈'; changeText = 'ราคาเพิ่มขึ้น'; }
    else if (change < 0) { changeSymbol = '📉'; changeText = 'ราคาลดลง'; }
  } else {
    changeSymbol = '🆕'; changeText = 'อัพเดทราคา'; change = 0;
  }

  // สุ่มประโยคตามสถานการณ์ โดยไม่ซ้ำกับครั้งก่อน
  const pool = getSentencePool(change);
  const lastSentence = lastPrice ? (lastPrice.lastSentence || '') : '';
  const sentence = pool ? pickSentence(pool, lastSentence) : '';
  console.log('ประโยคที่สุ่มได้:', sentence);

  const message = buildPostMessage(
    prices.sell, prices.buy, change, changeSymbol, changeText, dateStr, timeStr, sentence
  );

  console.log('ข้อความที่จะโพสต์:\n', message);

  await postToFacebook(message, screenshotBuffer);
  console.log('โพสต์สำเร็จแล้ว!');

  saveLastPrice({
    sell: prices.sell,
    buy: prices.buy,
    timestamp: now.toISOString(),
    lastSentence: sentence,
  });
}

main().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});

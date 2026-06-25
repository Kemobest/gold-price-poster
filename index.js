const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ==========================================
// การตั้งค่า — แก้ไขตามต้องการ
// ==========================================
const CONFIG = {
  // URL เว็บไซต์ร้านทอง
  websiteUrl: 'https://chomthong-gold-shop.vercel.app/',

  // CSS Selector ของกล่องราคาทองที่ต้องการจับภาพ
  // ตัวเลือกตามลำดับความน่าจะเป็น — ระบบจะลองทีละตัวจนกว่าจะเจอ
  priceSelectors: [
    '.gold-price',
    '.price-card',
    '.price-container',
    '[class*="price"]',
    '[class*="gold"]',
    'main',
  ],

  // ไฟล์เก็บราคาล่าสุด
  lastPriceFile: 'last_price.json',

  // ขีดจำกัดการเปลี่ยนแปลงราคา (บาท) — ถ้าต่ำกว่านี้ถือว่า "ไม่เปลี่ยน" ไม่โพสต์
  minPriceChangeTHB: 10,

  // ข้อความโพสต์ — แก้ไขได้ตามต้องการ
  postTemplate: (sellPrice, buyPrice, change, changeSymbol, changeText, dateStr, timeStr) => `ราคาทองตอนนี้นะคะ 🏅
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
ทางร้านของเราพร้อมยินดีต้อนรับและให้บริการคุณลูกค้าทุกท่านค่ะ 🥰`,
};

// ==========================================
// ฟังก์ชันหลัก
// ==========================================

function formatPrice(price) {
  return price.toLocaleString('th-TH');
}

function loadLastPrice() {
  try {
    if (fs.existsSync(CONFIG.lastPriceFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.lastPriceFile, 'utf8'));
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

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(CONFIG.websiteUrl, { waitUntil: 'networkidle', timeout: 30000 });

  // รอให้เนื้อหาโหลด
  await page.waitForTimeout(2000);

  // ดึงข้อความทั้งหมดในหน้าเพื่อ parse ราคา
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('ข้อความบนหน้าเว็บ (100 ตัวอักษรแรก):', pageText.substring(0, 200));

  // Parse ราคา — หาตัวเลขที่มีรูปแบบราคาทอง (5 หลักขึ้นไป)
  const prices = extractPrices(pageText);
  console.log('ราคาที่พบ:', prices);

  // จับภาพส่วนราคาทอง
  let screenshotBuffer = null;
  for (const selector of CONFIG.priceSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        console.log(`พบ element ด้วย selector: ${selector}`);
        screenshotBuffer = await element.screenshot({ type: 'png' });
        break;
      }
    } catch (e) {
      // ลอง selector ถัดไป
    }
  }

  // ถ้าไม่เจอ element ที่ตรง ให้ถ่ายภาพครึ่งบนของหน้า
  if (!screenshotBuffer) {
    console.log('ไม่พบ selector ที่กำหนด — จับภาพ viewport แทน');
    screenshotBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 600 },
    });
  }

  await browser.close();
  return { prices, screenshotBuffer };
}

function extractPrices(text) {
  // หาตัวเลขในรูปแบบราคาทอง เช่น 60,000 หรือ 60000
  const matches = text.match(/(\d{1,3}(?:,\d{3})+|\d{5,6})/g) || [];
  const numbers = matches
    .map(m => parseInt(m.replace(/,/g, ''), 10))
    .filter(n => n >= 30000 && n <= 200000); // กรองเฉพาะช่วงราคาทองที่สมเหตุสมผล

  if (numbers.length >= 2) {
    // สมมติว่าตัวแรกคือราคาขาย ตัวที่สองคือราคารับซื้อ
    return { sell: numbers[0], buy: numbers[1] };
  } else if (numbers.length === 1) {
    return { sell: numbers[0], buy: numbers[0] - 200 };
  }
  return null;
}

async function postToFacebook(message, imageBuffer) {
  const pageId = (process.env.FB_PAGE_ID || '').trim();
  const accessToken = (process.env.FB_ACCESS_TOKEN || '').trim();

  console.log('DEBUG pageId:', pageId, 'length:', pageId.length);
  console.log('DEBUG token starts:', accessToken.substring(0, 10));

  if (!pageId || !accessToken) {
    throw new Error('ไม่พบ FB_PAGE_ID หรือ FB_ACCESS_TOKEN ใน environment variables');
  }

  // อัปโหลดรูปภาพก่อน
  console.log('กำลังอัปโหลดรูปภาพไปยัง Facebook...');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('source', imageBuffer, { filename: 'gold-price.png', contentType: 'image/png' });
  form.append('caption', message);
  form.append('access_token', accessToken);

  const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const uploadData = await uploadRes.json();
  console.log('ผลการโพสต์:', uploadData);

  if (uploadData.error) {
    throw new Error(`Facebook API error: ${JSON.stringify(uploadData.error)}`);
  }

  return uploadData;
}

async function main() {
  console.log('=== เริ่มระบบโพสต์ราคาทองอัตโนมัติ ===');

  // 1. โหลดราคาเก่า
  const lastPrice = loadLastPrice();
  console.log('ราคาก่อนหน้า:', lastPrice);

  // 2. ดึงราคาปัจจุบัน
  const { prices, screenshotBuffer } = await scrapeGoldPrice();

  if (!prices) {
    console.log('❌ ไม่สามารถดึงราคาทองได้ — หยุดการทำงาน');
    process.exit(0);
  }

  console.log('ราคาปัจจุบัน:', prices);

  // 3. เปรียบเทียบกับราคาก่อนหน้า
  if (lastPrice) {
    const diff = Math.abs(prices.sell - lastPrice.sell);
    if (diff < CONFIG.minPriceChangeTHB) {
      console.log(`✅ ราคาไม่เปลี่ยนแปลง (ต่างกัน ${diff} บาท < ${CONFIG.minPriceChangeTHB} บาท) — ไม่โพสต์`);
      process.exit(0);
    }
  }

  // 4. เตรียมข้อความ
  const now = new Date();
  // แปลงเป็นเวลาไทย (UTC+7)
  const thaiTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dateStr = thaiTime.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const timeStr = thaiTime.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  let change = 0;
  let changeSymbol = '➡️';
  let changeText = 'ราคาคงที่';

  if (lastPrice) {
    change = prices.sell - lastPrice.sell;
    if (change > 0) {
      changeSymbol = '📈';
      changeText = 'ราคาเพิ่มขึ้น';
    } else if (change < 0) {
      changeSymbol = '📉';
      changeText = 'ราคาลดลง';
    }
  } else {
    changeSymbol = '🆕';
    changeText = 'อัพเดทราคา';
    change = 0;
  }

  const message = CONFIG.postTemplate(
    prices.sell,
    prices.buy,
    change,
    changeSymbol,
    changeText,
    dateStr,
    timeStr
  );

  console.log('ข้อความที่จะโพสต์:\n', message);

  // 5. โพสต์ลง Facebook
  await postToFacebook(message, screenshotBuffer);
  console.log('✅ โพสต์สำเร็จแล้ว!');

  // 6. บันทึกราคาล่าสุด
  saveLastPrice({
    sell: prices.sell,
    buy: prices.buy,
    timestamp: now.toISOString(),
  });
}

main().catch(err => {
  console.error('❌ เกิดข้อผิดพลาด:', err);
  process.exit(1);
});

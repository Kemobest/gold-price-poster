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
  // ปรับค่านี้เพื่อจำลองการซูมหน้าเว็บ: ยิ่งน้อยยิ่งเหมือนซูมออก (เห็น layout กว้างขึ้น กล่องราคาจะเตี้ยลง)
  zoomFactor: 1.5,
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

async function scrapeGoldPrice() {
  console.log('กำลังเปิดเว็บไซต์...');
  const browser = await chromium.launch();

  // จำลองการซูมโดยขยาย viewport จริง แล้วลด deviceScaleFactor
  // วิธีนี้ทำให้ browser คำนวณ layout ใหม่จริง ๆ เหมือนกด Ctrl+- ในเบราว์เซอร์
  const baseWidth = 1440;
  const baseHeight = 1400;
  const viewportWidth = Math.round(baseWidth / CONFIG.zoomFactor);
  const viewportHeight = Math.round(baseHeight / CONFIG.zoomFactor);

  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: viewportHeight },
  });

  await page.goto(CONFIG.websiteUrl, { waitUntil: 'networkidle', timeout: 30000 });

  // ใช้ CDP เพื่อบังคับ zoom จริง (เหมือน Ctrl+- ในเบราว์เซอร์ จริง ๆ)
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: CONFIG.zoomFactor });

  await page.waitForTimeout(2000);
  console.log(`DEBUG zoomFactor=${CONFIG.zoomFactor}, viewport=${viewportWidth}x${viewportHeight}`);

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
        const box = await element.boundingBox();
        console.log('DEBUG element box:', JSON.stringify(box));
        const rawBuffer = await element.screenshot({ type: 'png' });
        const sharp = require('sharp');
        const meta = await sharp(rawBuffer).metadata();
        const w = meta.width;
        const h = meta.height;
        const size = Math.max(w, h);
        screenshotBuffer = await sharp(rawBuffer)
          .extend({
            top: Math.floor((size - h) / 2),
            bottom: Math.ceil((size - h) / 2),
            left: Math.floor((size - w) / 2),
            right: Math.ceil((size - w) / 2),
            background: { r: 254, g: 249, b: 231, alpha: 1 },
          })
          .png()
          .toBuffer();
        console.log('ขนาดรูปเดิม:', w, 'x', h, '→ จัตุรัส:', size, 'x', size);
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

  if (numbers.length >= 2) {
    return { sell: numbers[0], buy: numbers[1] };
  } else if (numbers.length === 1) {
    return { sell: numbers[0], buy: numbers[0] - 200 };
  }
  return null;
}

async function postToFacebook(message) {
  const pageId = (process.env.FB_PAGE_ID || '').trim();
  const accessToken = (process.env.FB_ACCESS_TOKEN || '').trim();

  if (!pageId || !accessToken) {
    throw new Error('ไม่พบ FB_PAGE_ID หรือ FB_ACCESS_TOKEN');
  }

  console.log('กำลังโพสต์ข้อความลง Facebook...');
  const params = new URLSearchParams();
  params.append('message', message);
  params.append('access_token', accessToken);

  const postRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    method: 'POST',
    body: params,
  });

  const postData = await postRes.json();
  console.log('ผลการโพสต์:', postData);

  if (postData.error) {
    throw new Error(`Facebook API error: ${JSON.stringify(postData.error)}`);
  }

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

  const message = CONFIG.postTemplate(
    prices.sell, prices.buy, change, changeSymbol, changeText, dateStr, timeStr
  );

  console.log('ข้อความที่จะโพสต์:\n', message);

  await postToFacebook(message);
  console.log('โพสต์สำเร็จแล้ว!');

  saveLastPrice({ sell: prices.sell, buy: prices.buy, timestamp: now.toISOString() });
}

main().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});

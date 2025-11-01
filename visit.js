const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');
const sharp = require('sharp');

// 环境变量
const urls = process.env.TARGET_URLS.split(',');
const cookieMap = JSON.parse(process.env.COOKIE_MAP || '{}');
const userAgent = process.env.USER_AGENT || 'Mozilla/5.0';
const IMGE_API_KEY = process.env.IMGE_API_KEY;
const ALBUM_ID = process.env.IMGE_ALBUM_ID;
const COOKIE_FILE = path.join(__dirname, 'cookies.json');

// 模糊处理函数
const blurImage = async (inputPath, outputPath) => {
  await sharp(inputPath)
    .blur(15)
    .jpeg({ quality: 80 })
    .toFile(outputPath);
};

// Cookie 解析函数（从字符串转为对象）
const parseCookies = (cookieStr, domain) => {
  return cookieStr.split(';').map(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    return {
      name,
      value: rest.join('='),
      domain,
      path: '/',
      httpOnly: false,
      secure: true
    };
  });
};

// 加载本地 Cookie
const loadCookies = (domain) => {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  const allCookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  return allCookies[domain] || null;
};

// 保存 Cookie 到本地
const saveCookies = async (page, domain) => {
  const cookies = await page.cookies();
  const allCookies = fs.existsSync(COOKIE_FILE)
    ? JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'))
    : {};
  allCookies[domain] = cookies;
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(allCookies, null, 2));
  console.log(`💾 Cookie 已保存: ${domain}`);
};

// 上传图床
const uploadToImge = async (filePath) => {
  const formdata = new FormData();
  formdata.append("key", IMGE_API_KEY);
  formdata.append("source", fs.createReadStream(filePath));
  formdata.append("album_id", ALBUM_ID);
  formdata.append("nsfw", '1');

  const response = await fetch("https://im.ge/api/1/upload", {
    method: 'POST',
    body: formdata,
  });

  if (response.ok) {
    const data = await response.json();
    const imageUrl = data?.image?.url;
    console.log(`📸 上传成功: ${imageUrl}`);
    return imageUrl;
  } else {
    console.error('❌ 上传失败:', await response.text());
    return null;
  }
};

// 主流程
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const tasks = urls.map(async (url, index) => {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    const domain = new URL(url).hostname;

    // 优先使用环境变量 Cookie，否则使用本地缓存
let cookies = loadCookies(domain);
if (cookies) {
  console.log(`🍪 使用本地缓存 Cookie: ${domain}`);
} else if (cookieMap[domain]) {
  cookies = parseCookies(cookieMap[domain], domain);
  console.log(`🍪 使用环境变量 Cookie: ${domain}`);
} else {
  console.warn(`⚠️ 未找到 ${domain} 的 Cookie`);
}


    if (cookies) await page.setCookie(...cookies);

    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      console.log(`✅ 页面已加载: ${url}`);

      if (url.includes('streamlit.app')) {
        await page.waitForSelector('button', { timeout: 30000, visible: true });
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await btn.evaluate(el => el.innerText.trim());
          if (text.includes('Manage app')) {
            await btn.click();
            console.log('🖱️ 已点击 Manage app 按钮');
            break;
          }
        }
      }

      const screenshotPath = path.join(__dirname, `screenshot_${index + 1}.jpg`);
      await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 80 });
      console.log(`📷 截图已保存: ${screenshotPath}`);

      const blurredPath = path.join(__dirname, `blurred_${index + 1}.jpg`);
      await blurImage(screenshotPath, blurredPath);
      console.log(`🌀 模糊处理完成: ${blurredPath}`);

      await uploadToImge(blurredPath);

      // 保存最新 Cookie
      await saveCookies(page, domain);
    } catch (err) {
      console.error(`❌ 页面处理失败: ${url}`, err.message);
    } finally {
      await page.close();
    }
  });

  await Promise.all(tasks);
  await browser.close();
})();

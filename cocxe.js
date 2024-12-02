const { chromium } = require('playwright-core');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');
const sharp = require('sharp');
const axiosRetry = require('axios-retry').default;
const { Mutex } = require('async-mutex');

// Cấu hình axios-retry
axiosRetry(axios, {
  retries: 3,
  retryDelay: retryCount => retryCount * 1000,
  retryCondition: error => {
    return error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || (error.response && error.response.status >= 500);
  }
});

const BASE_URL = 'https://notpx.app/api/v1';
const axiosInstance = axios.create({ baseURL: BASE_URL });

const colors = {
  reset: '\x1b[0m',
  info: '\x1b[34m',
  success: '\x1b[32m',
  warning: '\x1b[33m',
  error: '\x1b[31m',
  magenta: '\x1b[1m',
  magenta: '\x1b[35m',
  paint: '\x1b[35m'
};

const getTimestampGMT7 = () => {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  const date = new Date().toLocaleDateString('en-GB', options); // Sử dụng 'en-GB' để có định dạng DD/MM/YYYY
  return date;
};

const logMessage = (type, message, accountIndex = '', useColor = true) => {
  const date = getTimestampGMT7(); // Lấy timestamp chỉ với ngày tháng năm
  const color = useColor ? (colors[type] || colors.reset) : '';
  
  // Đặt độ dài cố định cho các loại log
  const logType = type.toUpperCase();
  const fixedLogType = logType.padEnd(8, '-'); // Đảm bảo độ dài 8 ký tự

  // Cắt ngắn thông điệp nếu quá dài
  const maxMessageLength = 350; // Độ dài tối đa của thông điệp
  const shortMessage = message.length > maxMessageLength ? `${message.substring(0, maxMessageLength)}...` : message;

  // Thêm màu cho phần [Account ${accountIndex}]
  const accountColor = colors.magenta; // Chọn màu cho account
  const logText = `[${date}] ${'-'.repeat(2)}${color}[${fixedLogType}]${colors.reset} ${'-'.repeat(2)} [${accountColor}Account ${accountIndex}${colors.reset}]  ${shortMessage}`.trim(); // Sử dụng trim để loại bỏ khoảng trắng thừa

  console.log(logText);
};

let proxies = [];
let currentProxyIndex = 0;

const readProxies = async (filePath = 'proxy.txt') => {
  try {
    const data = await fsPromises.readFile(filePath, 'utf8');
    proxies = data.split('\n').map(line => line.trim()).filter(Boolean);
    if (proxies.length === 0) throw new Error('proxy.txt rỗng. Vui lòng thêm các proxy vào file.');
    logMessage('info', `Đã đọc ${proxies.length} proxy từ ${filePath}.`);
  } catch (error) {
    const errorMsg = error.code === 'ENOENT' ? `Không tìm thấy ${filePath}. Vui lòng tạo file và thêm các proxy vào.` : `Đã xảy ra lỗi khi đọc ${filePath}: ${error.message}`;
    throw new Error(errorMsg);
  }
};

const readProfiles = () => {
  try {
    const fileData = fs.readFileSync('profile.json', 'utf8');
    const jsonData = JSON.parse(fileData);
    if (!Array.isArray(jsonData)) throw new Error('Dữ liệu trong profile.json không phải là một mảng.');
    return jsonData.map((profile, index) => {
      const [server, port, username, password] = profile.raw_proxy ? profile.raw_proxy.split(':') : [null, null, null, null];
      logMessage('info', `Đã đọc profile ${index + 1}: ${profile.name}`, index + 1);
      return {
        name: profile.name,
        server: server && port ? `${server}:${port}` : null,
        username: username || null,
        password: password || null,
        profilePath: path.join('D:\\ProfileD', profile.profile_path)
      };
    });
  } catch (error) {
    logMessage('error', `Đã xảy ra lỗi khi đọc profile.json: ${error.message}`, '');
    return [];
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const createHeaders = authorization => ({
  'accept': 'application/json, text/plain, */*',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'origin': 'https://app.notpx.app',
  'priority': 'u=1, i',
  'referer': 'https://app.notpx.app/',
  'sec-ch-ua': '"Chromium";v="119", "Mobile Safari";v="16", "Not?A_Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"iOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Authorization': `initData ${authorization}`
});

const saveUserData = async (authorizationData, name, index) => {
  let profiles = [];
  if (!fs.existsSync('userdata.json')) {
    fs.writeFileSync('userdata.json', JSON.stringify([]), 'utf8');
    logMessage('info', 'Đã tạo file userdata.json mới.', index);
  }

  try {
    const fileData = fs.readFileSync('userdata.json', 'utf8');
    profiles = JSON.parse(fileData);
  } catch (error) {
    logMessage('error', `Đã xảy ra lỗi khi đọc userdata.json: ${error.message}`, index);
    return;
  }

  const existingProfileIndex = profiles.findIndex(profile => profile.name === name);
  if (existingProfileIndex !== -1) {
    profiles[existingProfileIndex].authorization = authorizationData;
    logMessage('success', `Đã cập nhật Authorization cho ${name}.`, index);
  } else {
    profiles.push({ authorization: authorizationData, name: name });
    logMessage('success', `Đã thêm mới Authorization cho ${name}.`, index);
  }

  try {
    fs.writeFileSync('userdata.json', JSON.stringify(profiles, null, 2), 'utf8');
  } catch (error) {
    logMessage('error', `Đã xảy ra lỗi khi ghi userdata.json: ${error.message}`, index);
  }
};

const parseProxy = (proxyUrl) => {
  const proxyPattern = /^(http:\/\/|https:\/\/)?(?:(.*?):(.*?)@)?(.*?):(\d+)$/;
  const match = proxyUrl.match(proxyPattern);

  if (!match) throw new Error(`Proxy URL không hợp lệ: ${proxyUrl}`);

  const [, protocol = 'http://', username, password, server, port] = match;
  return {
    server: `${protocol}${server}:${port}`,
    username: username || null,
    password: password || null,
  };
};

const launchBrowserAndClickStart = async (profile, proxyUrl, accountIndex) => {
  const { profilePath, name } = profile;
  let proxyConfig = null;
  if (proxyUrl) {
    try {
      const { server, username, password } = parseProxy(proxyUrl);
      logMessage('info', `Sử dụng proxy: ${server}`, accountIndex);
      proxyConfig = { server, username, password };
    } catch (error) {
      logMessage('error', `Lỗi khi phân tích proxy: ${error.message}`, accountIndex);
      return false;
    }
  } else {
    logMessage('info', `Không sử dụng proxy cho profile ${name}.`, accountIndex);
  }

  const contextOptions = {
    headless: false,
    ...(proxyConfig && { proxy: proxyConfig }),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--mute-audio',
      '--disk-cache-size=0',
      '--disable-application-cache',
      '--disable-extensions',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--disable-session-crashed-bubble',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
    ],
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    viewport: { width: 320, height: 480 },
    userDataDir: profilePath
  };

  let authorizationObtained = false;
  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts && !authorizationObtained) {
    attempt++;
    logMessage('info', `Attempt ${attempt} for profile ${name}`, accountIndex);

    let browserContext;
    let page;

    try {
      browserContext = await chromium.launchPersistentContext(profilePath, contextOptions);
      page = browserContext.pages().length > 0 ? browserContext.pages()[0] : await browserContext.newPage();

      if (!page || typeof page.goto !== 'function') {
        throw new Error('Page object không hợp lệ sau khi khởi tạo.');
      }

      logMessage('info', 'Đang truy cập vào trang Telegram Web...', accountIndex);

      page.on('requestfinished', async (request) => {
        if (!authorizationObtained) {
          const response = await request.response();
          const headers = response.headers();
          const authorization = headers['authorization'];
          if (authorization) {
            await saveUserData(authorization, name, accountIndex);
            logMessage('success', `Authorization cho ${name} đã được lưu.`, accountIndex);
            authorizationObtained = true;
            await browserContext.close();
          }
        }
      });

      await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9',
        'upgrade-insecure-requests': '1'
      });

      await page.goto('https://web.telegram.org/k/#@notpixel', { waitUntil: 'networkidle' });
      logMessage('success', 'Trang đã tải xong!', accountIndex);

      if (!authorizationObtained) {
        logMessage('info', 'Đang tìm nút Start...', accountIndex);
        try {
          await page.waitForSelector("//div[contains(text(), 'start') or contains(text(), 'Play') or contains(text(), 'Open')]", { timeout: 10000 });
          const startButton = await page.$("//div[contains(text(), 'start') or contains(text(), 'Play') or contains(text(), 'Open')]");
          if (startButton) {
            logMessage('info', 'Đã tìm thấy nút Start, đang nhấp vào...', accountIndex);
            await startButton.click();
          } else {
            logMessage('warning', 'Không tìm thấy nút Start.', accountIndex);
          }
        } catch (error) {
          logMessage('error', `Lỗi khi tìm nút Start: ${error.message}`, accountIndex);
        }

        logMessage('info', 'Đang kiểm tra Authorization từ iframe...', accountIndex);
        try {
          const iframeElement = await page.waitForSelector("//div[contains(@class, 'web-app-body')]//iframe", { timeout: 20000 });
          if (iframeElement) {
            const src = await iframeElement.evaluate(el => el.src);
            if (src && src.includes('#tgWebAppData=')) {
              const tgWebAppData = src.split('#tgWebAppData=')[1].split('&')[0];
              const decodedData = decodeURIComponent(tgWebAppData);
              logMessage('success', `Authorization lấy từ iframe cho ${name} đã được lưu.`, accountIndex);
              await saveUserData(decodedData, name, accountIndex);
              authorizationObtained = true;
              await browserContext.close();
            } else {
              logMessage('warning', 'Iframe không chứa dữ liệu tgWebAppData trong thuộc tính src.', accountIndex);
            }
          } else {
            logMessage('warning', 'Không tìm thấy iframe.', accountIndex);
          }
        } catch (error) {
          logMessage('error', `Lỗi khi lấy giá trị từ iframe: ${error.message}`, accountIndex);
        }

        if (!authorizationObtained) {
          logMessage('info', 'Chưa lấy được Authorization từ iframe, tiếp tục tìm nút Launch...', accountIndex);
          try {
            await page.waitForSelector('button:has-text("Launch"), button:has-text("Confirm")', { timeout: 5000 });
            const button = await page.$('button:has-text("Launch"), button:has-text("Confirm")');
            if (button) {
              const text = await button.evaluate(el => el.textContent);
              logMessage('info', `Đã tìm thấy nút ${text.trim()}, đang nhấp vào...`, accountIndex);
              await button.click();
            } else {
              logMessage('warning', 'Không tìm thấy nút Launch hoặc Confirm.', accountIndex);
            }
          } catch (error) {
            logMessage('error', `Lỗi khi tìm nút Launch hoặc Confirm: ${error.message}`, accountIndex);
          }

          await page.waitForResponse(response => response.url() === 'https://notpx.app/api/v1/users/me' && response.status() === 200);
          logMessage('info', 'Đã lấy dữ liệu từ API.', accountIndex);
          logMessage('info', 'Đang chờ thêm 5 giây để đảm bảo yêu cầu đã gửi đi...', accountIndex);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    } catch (error) {
      logMessage('error', `Lỗi khi xử lý với profile ${name}: ${error.message}`, accountIndex);
    } finally {
      logMessage('info', 'Hoàn thành lấy QueryID!', accountIndex);
      await browserContext.close();
    }
  }

  return authorizationObtained;
};

const checkIpProxy = async (proxy, index) => {
  if (!proxy) throw new Error('Không có proxy được cung cấp.');
  try {
    const agent = new HttpsProxyAgent(proxy);
    const response = await axios.get('http://api.ipify.org?format=json', {
      httpAgent: agent,
      timeout: 10000,
    });
    logMessage('info', `Proxy đang sử dụng IP: ${response.data.ip}`, index);
    return true;
  } catch (error) {
    throw new Error(`Lỗi với proxy ${proxy}: ${error.message}`);
  }
};

const getNextWorkingProxy = async (startIndex = 0) => {
  for (let i = startIndex; i < proxies.length; i++) {
    try {
      await checkIpProxy(proxies[i], i + 1);
      logMessage('success', `Chuyển sang proxy hợp lệ: ${proxies[i]}`, i + 1);
      return { proxy: proxies[i], index: i };
    } catch (error) {
      logMessage('warning', `Proxy ${proxies[i]} không hoạt động, thử proxy tiếp theo...`, i + 1);
    }
  }
  return null;
};

const getAuthorizationForProfile = (name) => {
  if (!fs.existsSync('userdata.json')) {
    logMessage('warning', `userdata.json không tồn tại.`);
    return null;
  }
  try {
    const fileData = fs.readFileSync('userdata.json', 'utf8');
    const profiles = JSON.parse(fileData);
    const profile = profiles.find(p => p.name === name);
    if (profile) {
      return profile.authorization;
    } else {
      logMessage('warning', `Không tìm thấy Authorization cho ${name} trong userdata.json.`);
      return null;
    }
  } catch (error) {
    logMessage('error', `Đã xảy ra lỗi khi đọc userdata.json: ${error.message}`);
    return null;
  }
};

const makeApiRequest = async (endpoint, method, authorization, userName, proxy, profile, data = null) => {
  const headers = createHeaders(authorization);
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  try {
    const config = {
      method,
      url: endpoint,
      headers,
      httpAgent: agent,
    };

    if (method === 'POST' && data) {
      config.data = data;
    }

    const response = await axiosInstance(config);
    await sleep(1000);
    return response.data;
  } catch (error) {
    logMessage('error', `Lỗi API (${method} ${endpoint}): ${error.message}`, userName);
    throw error;
  }
};

const fetchUserData = async (authorization, index, proxy, profile) => {
  const endpoint = '/users/me';
  let currentAuthorization = authorization;

  try {
    const userData = await makeApiRequest(endpoint, 'GET', currentAuthorization, index + 1, proxy, profile);

    if (userData) {
      const userName = `${userData.lastName} ${userData.firstName}`;
      logMessage('info', `: ${userName}`, index + 1);
      return { userData, authorization: currentAuthorization };
    } else {
      logMessage('warning', `Không nhận được dữ liệu người dùng cho tài khoản ${index + 1}`, index + 1);
      return { userData: null, authorization: null };
    }
  } catch (error) {
    if (error.response && error.response.status === 401) {
      logMessage('info', `Authorization không hợp lệ cho account ${index + 1}, đang làm mới...`, index + 1);
      await launchBrowserAndClickStart(profile, proxy);
      currentAuthorization = await getAuthorizationForProfile(profile.name);
      if (currentAuthorization) {
        return await fetchUserData(currentAuthorization, index, proxy, profile);
      } else {
        throw new Error(`Không thể lấy Authorization mới cho profile ${profile.name}.`);
      }
    } else {
      throw error;
    }
  }
};

const readAllowedColors = () => {
  try {
    const data = fs.readFileSync('mau.txt', 'utf8');
    return data.split('\n').map(color => color.trim().toUpperCase()).filter(color => /^#[0-9A-F]{6}$/.test(color));
  } catch (error) {
    logMessage('error', `Lỗi khi đọc file mau.txt: ${error.message}`);
    return [];
  }
};

const fetchMyTemplate = async (authorization, userName, index, proxy, profile) => {
  let currentAuthorization = authorization;
  const url = 'https://notpx.app/api/v1/image/template/my';
  const headers = createHeaders(currentAuthorization);
  try {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const response = await axios.get(url, { headers, httpAgent: agent });
    const templateData = response.data;
    return templateData;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      currentAuthorization = getAuthorizationForProfile(profile.name);
      if (currentAuthorization) {
        return await fetchMyTemplate(currentAuthorization, userName, index, proxy, profile);
      } else {
        throw new Error(`Không thể lấy Authorization mới cho profile ${profile.name}.`);
      }
    } else {
      throw error;
    }
  }
};

const rgbToHex = (r, g, b) => "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();

const analyzeImage = async (imagePath) => {
  try {
    logMessage('info', `Đang phân tích ảnh chờ chút nhé...`);

    const allowedColors = readAllowedColors();
    if (allowedColors.length === 0) {
      throw new Error('Không có màu hợp lệ trong file mau.txt');
    }
    const imageBuffer = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = imageBuffer;
    logMessage('info', `Kích thước ảnh: ${info.width}x${info.height}`);
    const specialPixels = {
      17018: '#FFB470',
      17145: '#FF9600',
      144018: '#7EED56',
      144145: '#FFB470'
    };
    const colors = [];
    const uniqueColors = new Set();
    const colorCount = {};
    for (let i = 0; i < data.length; i += info.channels) {
      const red = data[i];
      const green = data[i + 1];
      const blue = data[i + 2];
      const hexColor = rgbToHex(red, green, blue);
      const pixelIndex = i / info.channels;
      if (specialPixels[pixelIndex] !== undefined) {
        logMessage('info', `Pixel đặc biệt tại tọa độ ${pixelIndex}: RGB(${red},${green},${blue}) - Mã gốc: ${hexColor}`);
        if (hexColor.toUpperCase() !== specialPixels[pixelIndex].toUpperCase()) {
          logMessage('error', `Mã màu tại tọa độ ${pixelIndex} không khớp! Cần: ${specialPixels[pixelIndex]}, Nhận: ${hexColor}`);
        } else {
          logMessage('success', `Mã màu tại tọa độ ${pixelIndex} khớp!`);
        }
      }
      const closestColor = findClosestColor(hexColor, allowedColors);
      colors.push(closestColor);
      uniqueColors.add(closestColor);
      colorCount[closestColor] = (colorCount[closestColor] || 0) + 1;
    }
    logMessage('info', `Tổng số pixel: ${colors.length}`);
    logMessage('info', `Số màu cần sử dụng: ${uniqueColors.size}`);
    return colors;
  } catch (error) {
    logMessage('error', `Lỗi khi đọc và phân tích ảnh: ${error.message}`);
    return null;
  }
};

const findClosestColor = (hexColor, allowedColors) => {
  let closestColor = allowedColors[0];
  let minDifference = colorDifference(hexColor, closestColor);

  for (let i = 1; i < allowedColors.length; i++) {
    const difference = colorDifference(hexColor, allowedColors[i]);
    if (difference < minDifference) {
      minDifference = difference;
      closestColor = allowedColors[i];
    }
  }

  return closestColor;
};

const colorDifference = (color1, color2) => {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);

  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);

  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
};

const resetRepaintedPixels = () => {
  globalRepaintedPixels = {};
  if (fs.existsSync(repaintedPixelsPath)) {
    fs.unlinkSync(repaintedPixelsPath);
  }
  logMessage('info', 'Đã reset danh sách pixel đã repaint.');
};

const repaintedPixelsPath = path.join(__dirname, 'repainted_pixels.json');
const mutex = new Mutex();
let globalRepaintedPixels = {};

const getRepaintedPixels = async () => {
  if (fs.existsSync(repaintedPixelsPath)) {
    const data = await fsPromises.readFile(repaintedPixelsPath, 'utf8');
    return JSON.parse(data);
  }
  return {};
};
async function saveRepaintedPixels(repaintedPixels) {
    await fsPromises.writeFile(repaintedPixelsPath, JSON.stringify(repaintedPixels, null, 2));
  }
const attemptRepaint = async (pixelId, newColor, userName, currentAuthorization, proxy, profile, index) => {
  const release = await mutex.acquire();
  try {
    if (globalRepaintedPixels[pixelId]) {
      return null;
    }

    const data = { pixelId, newColor };
    const response = await makeApiRequest('/repaint/start', 'POST', currentAuthorization, userName, proxy, profile, data);
    const diem = response.balance;

    logMessage('paint', `Tọa độ ${pixelId} repaint thành công với màu ${colors.magenta}${newColor}${colors.reset}, Tổng điểm: ${colors.magenta}${diem}${colors.reset}`, index + 1);

    globalRepaintedPixels[pixelId] = true;
    await saveRepaintedPixels(globalRepaintedPixels);
    return diem;
  } catch (error) {
    const errorData = error.response?.data || error.message;
    logMessage('error', `Lỗi repaint tại pixel ${pixelId}: ${errorData}`, index + 1);

    if (error.response && error.response.status === 401) {
      logMessage('info', `Authorization không hợp lệ, làm mới Authorization cho ${profile.name}...`, index + 1);
      await launchBrowserAndClickStart(profile, proxy, index + 1);
      currentAuthorization = await getAuthorizationForProfile(profile.name);

      if (currentAuthorization) {
        logMessage('info', `Đã làm mới Authorization, thử lại repaint pixel ${pixelId}...`, index + 1);
        return await attemptRepaint(pixelId, newColor, userName, currentAuthorization, proxy, profile, index);
      } else {
        logMessage('error', `Không thể lấy Authorization mới cho profile ${profile.name}.`, index + 1);
      }
    }
    return null;
  } finally {
    release();
  }
};

const startRepaint = async (authorization, userName, index, proxy, charges, profile, globalImageAnalysis) => {
  let currentAuthorization = authorization || await getAuthorizationForProfile(profile.name);

  if (!currentAuthorization) {
    logMessage('error', `Không tìm thấy Authorization cho ${profile.name}, dừng repaint.`, index + 1);
    return;
  }

  let myTemplateData;
  try {
    myTemplateData = await makeApiRequest('/image/template/my', 'GET', currentAuthorization, userName, proxy, profile);
  } catch (error) {
    logMessage('error', 'Không thể lấy dữ liệu template để repaint.', index + 1);
    return;
  }

  const { x, y, imageSize } = myTemplateData;
  const allowedColors = readColorsFromFile();
  if (allowedColors.length === 0) {
    logMessage('error', 'Không có mã màu hợp lệ trong mau.txt.', index + 1);
    return;
  }

  const imagePath = path.join(__dirname, 'image.png');
  if (!fs.existsSync(imagePath)) {
    logMessage('error', `File ảnh không tồn tại: ${imagePath}`, index + 1);
    return;
  }

  const imageColors = globalImageAnalysis;
  if (!imageColors) {
    logMessage('error', 'Không có dữ liệu phân tích ảnh.', index + 1);
    return;
  }

  if (imageColors.length !== imageSize * imageSize) {
    logMessage('error', `Kích thước ảnh không phù hợp. Cần ${imageSize * imageSize} pixels, nhưng nh có ${imageColors.length} pixels.`, index + 1);
    return;
  }

  const allPixelIds = [];
  for (let i = imageSize - 1; i >= 0; i--) {
    for (let j = imageSize - 1; j >= 0; j--) {
      const pixelId = (y + i) * 1000 + (x + j + 1);
      const colorIndex = i * imageSize + j;
      const targetColor = imageColors[colorIndex];
      if (allowedColors.includes(targetColor)) {
        allPixelIds.push({ pixelId, newColor: targetColor });
      }
    }
  }

  globalRepaintedPixels = await getRepaintedPixels();

  const miningStatus = await makeApiRequest('/mining/status', 'GET', currentAuthorization, userName, proxy, profile);
  let bombCount = miningStatus.goods?.['7'] || 0;

  if (bombCount > 0) {
    logMessage('info', `Số lượng bom còn lại: ${bombCount}`, index + 1);
    for (const { pixelId } of allPixelIds) {
      if (bombCount <= 0) break;

      const payload = {
        pixelId,
        type: 7
      };

      try {
        await makeApiRequest('/repaint/special', 'POST', currentAuthorization, userName, proxy, profile, payload);
        logMessage('success', `Nổ bom thành công tại tọa độ ${pixelId}.`, index + 1);
        bombCount--;
        await sleep(1000);
      } catch (error) {
        logMessage('error', `Lỗi khi nổ bom tại tọa độ ${pixelId}: ${error.message}`, index + 1);
      }
    }
  } else {
    logMessage('info', `Không còn bom nào để sử dụng.`, index + 1);
  }

  while (charges > 0) {
    const unrepaintedPixels = allPixelIds.filter(pixel => !globalRepaintedPixels[pixel.pixelId]);
    let pixelsToRepaint = unrepaintedPixels.slice(0, charges);
    pixelsToRepaint = shuffleArray(pixelsToRepaint);

    for (const { pixelId, newColor } of pixelsToRepaint) {
      const success = await attemptRepaint(pixelId, newColor, userName, currentAuthorization, proxy, profile, index);
      if (success) {
        charges--;
        if (charges <= 0) break;
      }
      await sleep(1000);
    }
  }

  logMessage('info', `Hoàn thành repaint cho tài khoản ${index + 1}.`, index + 1);
};

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const readColorsFromFile = () => {
  const fileName = 'mau.txt';
  const filePath = path.join(__dirname, fileName);
  try {
    const data = fs.readFileSync(filePath, 'utf8');

    const colors = data.split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');
    const validColors = colors.filter(color => /^#[0-9A-Fa-f]{6}$/.test(color));
    if (validColors.length === 0) {
      logMessage('warning', 'Không tìm thấy mã màu hợp lệ trong mau.txt');
      return [];
    }
    return validColors;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logMessage('error', 'File mau.txt không tồn tại');
    } else {
      logMessage('error', `Lỗi khi đọc file mau.txt: ${error.message}`);
    }
    return [];
  }
};

const claimRewards = async (authorization, userName, index, proxy, profile) => {
  const endpoint = '/mining/claim';
  const data = await makeApiRequest(endpoint, 'GET', authorization, userName, proxy, profile);
  logMessage('success', `Tài Khoản ${index + 1} đã claim thành công: ${data.claimed}`, index + 1);
};

const getMiningStatus = async (authorization, userName, index, proxy, profile) => {
  const endpoint = '/mining/status';
  const data = await makeApiRequest(endpoint, 'GET', authorization, userName, proxy, index, profile);
  logMessage('info', `User Balance: ${colors.magenta}${data.userBalance}${colors.reset}, Lượt tô màu: ${colors.magenta}${data.charges}${colors.reset}`, index + 1);
  return data;
};

const checkAndClaimTasks = async (authorization, userName, index, proxy, profile) => {
  try {
    const endpoint = '/mining/status';
    const miningStatus = await makeApiRequest(endpoint, 'GET', authorization, userName, proxy, profile);
    const apiDataTasks = miningStatus.tasks || {};
    if (!fs.existsSync('tasks.json') || !fs.existsSync('checktasks.json')) {
      throw new Error('File tasks.json hoặc checktasks.json không tồn tại');
    }
    const tasksData = await fsPromises.readFile('tasks.json', 'utf8');
    const checkTasksData = await fsPromises.readFile('checktasks.json', 'utf8');
    const tasks = JSON.parse(tasksData);
    const checkTasks = JSON.parse(checkTasksData);
    const missingTasks = Object.keys(tasks).filter(task => !apiDataTasks[task]);
    if (missingTasks.length > 0) {
      for (const missingTask of missingTasks) {
        await claimMissingTask(authorization, missingTask, userName, index, checkTasks, proxy, profile);
      }
    } else {
      logMessage('info', ` Tất cả nhiệm vụ đã được hoàn thành.`, index + 1);
    }
  } catch (error) {
    logMessage('error', `Lỗi khi kiểm tra và yêu cầu nhiệm vụ : ${error.message}`, index + 1);
  }
};

const claimMissingTask = async (authorization, taskKey, userName, index, checkTasks, proxy, profile) => {
  const taskToClaim = checkTasks[taskKey];
  if (!taskToClaim) {
    logMessage('error', `Không tìm thấy thông tin trong checktasks.json cho nhiệm vụ: ${taskKey}`, userName);
    return;
  }
  const endpoint = `/mining/task/check/${taskToClaim}`;
  try {
    await makeApiRequest(endpoint, 'GET', authorization, userName, proxy, profile);
    logMessage('success', `Nhiệm vụ ${taskKey} đã được yêu cầu thành công cho tài khoản ${index + 1}.`, index + 1);
  } catch (error) {
    logMessage('error', `Lỗi khi yêu cầu nhiệm vụ ${taskKey} cho tài khoản ${index + 1}: ${error.message}`, index + 1);
  }
};

const thucHienKiemTraNangCap = async (authorization, userName, coNangCap, proxy, profile, index) => {
  let currentAuthorization = authorization;
  const headers = createHeaders(currentAuthorization);
  const DELAY_BETWEEN_CHECKS = 2000;
  const maxPaintReward = 7;
  const maxReChargeSpeed = 11;
  const maxEnergyLimit = 7;
  if (!coNangCap) {
    logMessage('info', 'Nâng cấp đã bị hủy bởi người dùng.', index + 1);
    return;
  }
  try {
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

    while (true) {
      let statusResponse;
      try {
        statusResponse = await axios.get("https://notpx.app/api/v1/mining/status", {
          headers,
          httpAgent: agent,
        });
      } catch (error) {
        logMessage('error', `Lỗi khi gọi API trạng thái: ${error.message}`, index + 1);
        break;
      }

      if (statusResponse.status !== 200) {
        logMessage('warning', 'Không thể lấy được thông tin trạng thái hiện tại.', index + 1);
        break;
      }
      const currentLevels = statusResponse.data.boosts;
      logMessage(
        'info',
        `Tình trạng BOOST: Paint Reward Level: ${currentLevels.paintReward}/${maxPaintReward}, Energy Limit Level: ${currentLevels.energyLimit}/${maxEnergyLimit}, Hồi Kỹ Năng: ${currentLevels.reChargeSpeed}/${maxReChargeSpeed} `,
        index + 1
      );
      let upgradesMade = false;
      const paintRewardUpgraded = await upgradeLevel("paintReward", currentLevels.paintReward, maxPaintReward, currentAuthorization, headers, proxy, index + 1, profile);
      upgradesMade = upgradesMade || paintRewardUpgraded;
      const reChargeSpeedUpgraded = await upgradeLevel("reChargeSpeed", currentLevels.reChargeSpeed, maxReChargeSpeed, currentAuthorization, headers, proxy, index + 1, profile);
      upgradesMade = upgradesMade || reChargeSpeedUpgraded;
      const energyLimitUpgraded = await upgradeLevel("energyLimit", currentLevels.energyLimit, maxEnergyLimit, currentAuthorization, headers, proxy, index + 1, profile);
      upgradesMade = upgradesMade || energyLimitUpgraded;

      if (!upgradesMade ||
        (currentLevels.paintReward >= maxPaintReward && currentLevels.energyLimit >= maxEnergyLimit && currentLevels.reChargeSpeed >= maxReChargeSpeed)) {
        logMessage('info', 'Không thể nâng cấp thêm hoặc đã đạt mức tối đa.', index + 1);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHECKS));
    }
    logMessage('info', 'Hoàn tất nâng cấp. Chuyển sang công việc tiếp theo...', index + 1);
  } catch (error) {
    const errorMessage = error.response && error.response.data
      ? JSON.stringify(error.response.data)
      : error.message;
    logMessage('error', `Đã xảy ra lỗi: ${errorMessage}`, index + 1);
  }
};
const upgradeLevel = async (levelType, currentLevel, maxLevel, authorization, headers, proxy, userName, profile, index) => {
  if (currentLevel >= maxLevel) {
    logMessage('info', `${levelType} đã đạt mức tối đa.`, index + 1);
    return false;
  }
  const endpoint = `/mining/boost/check/${levelType}`;
  try {
    const response = await makeApiRequest(endpoint, 'GET', authorization, userName, proxy, profile);

    if (response.status === 200) {
      logMessage('success', `Đã nâng cấp ${levelType} thành công.`, index + 1);
      return true;
    } else {
      logMessage('warning', `Nâng cấp ${levelType} không thành công với mã trạng thái: ${response.status}`, index + 1);
      return false;
    }
  } catch (error) {
    const errorMessage = error.response && error.response.data && error.response.data.error
      ? error.response.data.error
      : error.message;

    if (errorMessage.includes("insufficient balance")) {
      logMessage('warning', `Số d không đủ nâng cấp ${levelType}.`, index + 1);
    } else {
      logMessage('warning', `Không thể nâng cấp ${levelType}: ${errorMessage}`, index + 1);
    }
    return false;
  }
};

const parseAuthorization = (authorization) => {
  try {
    const userEncoded = authorization.split('user=')[1].split('&')[0];
    const userDecoded = decodeURIComponent(userEncoded);
    const userInfo = JSON.parse(userDecoded);
    return userInfo;
  } catch (error) {
    console.error('Lỗi khi phân tích cú pháp authorization:', error);
    return null;
  }
};

// Hàm tạo số ngẫu nhiên trong khoảng [min, max]
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const watchAds = async (authorization, userName, index, proxy, profile) => {
  const _headers = createHeaders(authorization);
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  try {
    const userInfo = parseAuthorization(authorization);
    if (!userInfo) {
      throw new Error('Không thể phân tích cú pháp thông tin người dùng từ authorization.');
    }

    const chatInstance = parseInt(authorization.split('chat_instance=')[1].split('&')[0]);

    const params = {
      blockId: 4853,
      tg_id: userInfo.id,
      tg_platform: "android",
      platform: "Linux aarch64",
      language: userInfo.language_code,
      chat_type: "sender",
      chat_instance: chatInstance,
      top_domain: "app.notpx.app",
      connectiontype: 1
    };

    while (true) {
      const baseUrl = "https://api.adsgram.ai/adv";
      const fullUrl = `${baseUrl}?${new URLSearchParams(params).toString()}`;
      const advResponse = await axios.get(fullUrl, { headers: _headers, httpAgent: agent });
      const advData = advResponse.data;

      if (advData && advData.banner && advData.banner.bannerAssets) {
        logMessage('info', `${userName} | A new advertisement has been found for viewing! | Title: ${advData.banner.bannerAssets[1].value} | Type: ${advData.bannerType}`, index + 1);
        
        const previousStatus = await getMiningStatus(authorization, userName, index, proxy, profile);
        const previousBalance = previousStatus.userBalance;

        const renderUrl = advData.banner.trackings[0].value;
        await axios.get(renderUrl, { headers: _headers, httpAgent: agent });
        
        let sleepTime = randomInt(1, 5);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before next action.`, index + 1);
        await countdown(sleepTime);

        const showUrl = advData.banner.trackings[1].value;
        await axios.get(showUrl, { headers: _headers, httpAgent: agent });
        
        sleepTime = randomInt(10, 15);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before next action.`, index + 1);
        await countdown(sleepTime);

        const rewardUrl = advData.banner.trackings[4].value;
        await axios.get(rewardUrl, { headers: _headers, httpAgent: agent });
        
        sleepTime = randomInt(1, 5);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before updating status.`, index + 1);
        await countdown(sleepTime);

        await updateStatus(authorization, userName, index, proxy, profile);

        const currentStatus = await getMiningStatus(authorization, userName, index, proxy, profile);
        const currentBalance = currentStatus.userBalance;

        const delta = Math.round((currentBalance - previousBalance) * 10) / 10;
        logMessage('success', `${userName} | Ad view completed successfully. | Reward: ${delta}`, index + 1);
        
        sleepTime = randomInt(30, 35);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before checking for new ads.`, index + 1);
        await countdown(sleepTime);
      } else {
        logMessage('info', `${userName} | No ads are available for viewing at the moment.`, index + 1);
        break;
      }
    }
  } catch (error) {
    logMessage('error', `Error in watchAds: ${error.message}`, index + 1);
  }
};

const updateStatus = async (authorization, userName, index, proxy, profile) => {
  const baseDelay = 2000; // 2 seconds
  const maxRetries = 5;
  const _headers = createHeaders(authorization);
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = 'https://notpx.app/api/v1/mining/status';
      const response = await axios.get(url, { headers: _headers, httpAgent: agent });
      const statusJson = response.data;
      
      // Cập nhật trạng thái vào profile hoặc một biến toàn cục
      profile.status = statusJson;
      return; // Thoát khi cập nhật thành công

    } catch (error) {
      const retryDelay = baseDelay * (attempt + 1);
      if (error.response) {
        logMessage('warning', `${userName} | Status update attempt ${attempt} failed | Sleep ${retryDelay / 1000} sec | ${error.response.status}, ${error.message}`, index + 1);
      } else {
        logMessage('error', `${userName} | Unexpected error when updating status | Sleep ${retryDelay / 1000} sec | ${error.message}`, index + 1);
      }
      await sleep(retryDelay); // Chờ trước khi thử lại
    }
  }

  throw new Error(`${userName} | Failed to update status after ${maxRetries} attempts`);
};
const countdown = (seconds) => {
  return new Promise((resolve) => {
    let remaining = seconds;
    const interval = setInterval(() => {
      if (remaining >= 0) {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = `Chạy lại sau: ${mins} phút ${secs} giây...`;

        process.stdout.write('\r' + timeStr);

        remaining--;
      } else {
        clearInterval(interval);
        process.stdout.write('\n');
        resolve();
      }
    }, 1000);
  });
};

let globalImageAnalysis = null;
const askUserForUpgrade = () => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Bạn có muốn thực hiện tô màu không? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
};

const run = async () => {
  const wantRepaint = await askUserForUpgrade(); // Hỏi người dùng ngay khi bắt đầu

  while (true) {
    resetRepaintedPixels();
    try {
      if (!globalImageAnalysis) {
        globalImageAnalysis = await analyzeImage('image.png');
        logMessage('info', 'Đã hoàn thành phân tích ảnh ');
      }

      await readProxies();
      const profiles = readProfiles();
      const MAX_CONCURRENT_TASKS = 10;

      const processProfile = async (profile, index) => {
        let proxy = null;
        let proxyIndex = index % proxies.length;
        while (!proxy && proxyIndex < proxies.length) {
          try {
            await checkIpProxy(proxies[proxyIndex], index + 1);
            proxy = proxies[proxyIndex];
          } catch (error) {
            logMessage('warning', `Proxy này bị lỗi không sử dụng được đã chuyển proxy khác`, index + 1);
            proxyIndex++;
          }
        }
        if (!proxy) {
          logMessage('error', `Tất cả proxy đều lỗi cho profile ${profile.name}. Bỏ qua profile này.`);
          return;
        }
        try {
          const { userData, authorization } = await fetchUserData(await getAuthorizationForProfile(profile.name), index, proxy, profile);
          if (userData) {
            const userName = `${userData.lastName} ${userData.firstName}`;
            await watchAds(authorization, userName, index, proxy, profile);
            await claimRewards(authorization, userName, index, proxy, profile);
            await checkAndClaimTasks(authorization, userName, index, proxy, profile);
            const miningStatus = await getMiningStatus(authorization, userName, index, proxy, profile);

            if (wantRepaint) {
              await startRepaint(authorization, userName, index, proxy, miningStatus.charges, profile, globalImageAnalysis);
            } else {
              logMessage('info', 'Người dùng đã chọn không thực hiện repaint.', index + 1);
            }
          }
        } catch (error) {
          logMessage('error', `Đã xảy ra lỗi với tài khoản ${index + 1}: ${error.message}`, profile.name);
        }
      };

      for (let i = 0; i < profiles.length; i += MAX_CONCURRENT_TASKS) {
        const batch = profiles.slice(i, i + MAX_CONCURRENT_TASKS);
        await Promise.all(batch.map((profile, batchIndex) => processProfile(profile, i + batchIndex)));
      }
      await countdown(600);
    } catch (error) {
      logMessage('error', `Đã xảy ra lỗi toàn cục: ${error.message}`);
      return;
    }
  }
};

run().catch(error => {
  logMessage('error', `Đã xảy ra lỗi toàn cục: ${error.message}`);
});

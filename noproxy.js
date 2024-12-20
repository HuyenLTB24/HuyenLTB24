import { chromium } from 'playwright-core';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import axios from 'axios';
import readline from 'readline';
import sharp from 'sharp';
import axiosRetry from 'axios-retry';
import { Mutex } from 'async-mutex';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';

//let globalImageAnalysis = null;
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
    paint: '\x1b[35m'
};
function logMessage(type, message, index = '') {
    const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
    const color = colors[type] || colors.reset;
    const highlightColor = '\x1b[33m'; // Màu vàng cho chữ
    const coloredType = `${color}[${type.toUpperCase()}]${colors.reset}`;
    
    // Chỉ highlight số trong phần message
    const highlightedMessage = message
        .replace(/\${[^}]+}/g, match => `${highlightColor}${match}${colors.reset}`)
        // Highlight số chỉ khi nó đứng sau các từ khóa cụ thể
        .replace(/(?<=(Balance:|màu:|Reward:|points|Total:))\s*\d+(\.\d+)?\b/g, match => `${highlightColor}${match}${colors.reset}`);
    
    const logText = index 
        ? `[${timestamp}] - {@Notpixel} - ${coloredType} ${index} | ${highlightedMessage}`
        : `[${timestamp}] - {@Notpixel} - ${coloredType} ${highlightedMessage}`;
    console.log(logText);
}
function readProfiles() {
    try {
        const fileData = fs.readFileSync('profile.json', 'utf8');
        const jsonData = JSON.parse(fileData);
        if (!Array.isArray(jsonData)) {
            throw new Error('Dữ liệu trong profile.json không phải là một mảng.');
        }
        return jsonData.map(profile => {
            const [server, port, username, password] = profile.raw_proxy ? profile.raw_proxy.split(':') : [null, null, null, null];
            return {
                name: profile.name,
                server: server && port ? `${server}:${port}` : null,
                username: username || null,
                password: password || null,
                profilePath: path.join('D:\\ProfileD', profile.profile_path)
            };
        });
    } catch (error) {
        logMessage('error', `Đã xảy ra lỗi khi đọc profile.json: ${error.message}`);
        return [];
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
const createHeaders = authorization => {
  const userAgent = Math.random() < 0.5 
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    : 'Mozilla/5.0 (Linux; Android 10; Android SDK built for x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';
  const platform = userAgent.includes('iPhone') ? 'iOS' : 'Android';
  return ({
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'origin': 'https://app.notpx.app',
    'priority': 'u=1, i',
    'referer': 'https://app.notpx.app/',
    'sec-ch-ua': '"Chromium";v="119", "Mobile Safari";v="16", "Not?A_Brand";v="99"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': `"${platform}"`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': userAgent,
    'Authorization': `initData ${authorization}`
  });
};
export async function saveUserData(authorizationData, name) {
    let profiles = [];
    if (fs.existsSync('userdata.json')) {
        try {
            const fileData = fs.readFileSync('userdata.json', 'utf8');
            profiles = JSON.parse(fileData);
        } catch (error) {
            logMessage('error', `Đã xảy ra lỗi khi đọc userdata.json: ${error.message}`);
            return;
        }
    }

    const existingProfileIndex = profiles.findIndex(profile => profile.name === name);
    if (existingProfileIndex !== -1) {
        profiles[existingProfileIndex].authorization = authorizationData;
        logMessage('success', `Đã cập nhật Authorization cho ${name}.`);
    } else {
        profiles.push({ authorization: authorizationData, name: name });
        logMessage('success', `Đã thêm mới Authorization cho ${name}.`);
    }

    try {
        fs.writeFileSync('userdata.json', JSON.stringify(profiles, null, 2), 'utf8');
    } catch (error) {
        logMessage('error', `Đã xảy ra lỗi khi ghi userdata.json: ${error.message}`);
    }
}

export async function executeWithAuthorization(profile, fn) {
    let authorization = await getAuthorizationForProfile(profile.name);
    if (!authorization) {
        logMessage('info', `Không tìm thấy Authorization cho ${profile.name}, khởi động trình duyệt để lấy mới.`);
        await launchBrowserAndClickStart(profile);
        authorization = await getAuthorizationForProfile(profile.name);
        if (!authorization) {
            logMessage('error', `Không thể lấy Authorization cho ${profile.name}.`);
            return;
        }
    }
    return await fn(authorization, profile);
}
async function launchBrowserAndClickStart(profile, index) {
    const { profilePath, name } = profile;
    const contextOptions = {
        headless: true,
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
        let browserContext;
        let page;
        try {
            browserContext = await chromium.launchPersistentContext(profilePath, contextOptions);
            page = browserContext.pages().length > 0 ? browserContext.pages()[0] : await browserContext.newPage();

            if (!page || typeof page.goto !== 'function') {
                throw new Error('Page object không hợp lệ sau khi khởi tạo.');
            }
            await page.setExtraHTTPHeaders({
                'accept-language': 'en-US,en;q=0.9',
                'upgrade-insecure-requests': '1'
            });
            await page.goto('https://web.telegram.org/k/#@notpixel', { waitUntil: 'networkidle' });
            if (!authorizationObtained) {
                try {
                    await page.waitForSelector("//div[contains(text(), 'start') or contains(text(), 'Play') or contains(text(), 'Open')]", { timeout: 20000 });
                    const startButton = await page.$("//div[contains(text(), 'start') or contains(text(), 'Play') or contains(text(), 'Open')]");
                    if (startButton) {
                        await startButton.click();
                    } else {
                        logMessage('warning', 'Không tìm thấy nút Start.', 'Account ' + index);
                    }
                } catch (error) {
                    logMessage('error', `Lỗi khi tìm nút Start: ${error.message}`, 'Account ' + index);
                }
                logMessage('info', 'Đang kiểm tra Authorization từ iframe...', 'Account ' + index);
                try {
                    const iframeElement = await page.waitForSelector("//div[contains(@class, 'web-app-body')]//iframe", { timeout: 20000 });
                    if (iframeElement) {
                        const src = await iframeElement.evaluate(el => el.src);
                        if (src && src.includes('#tgWebAppData=')) {
                            const tgWebAppData = src.split('#tgWebAppData=')[1].split('&')[0];
                            const decodedData = decodeURIComponent(tgWebAppData);
                            await saveUserData(decodedData, name);
                            authorizationObtained = true;
                            await browserContext.close(); // Đóng trình duyệt
                        } else {
                            logMessage ('warning', 'Iframe không chứa dữ liệu tgWebAppData trong thuộc tính src.', index);
                        }
                    } else {
                        logMessage('warning', 'Không tìm thấy iframe.', 'Account ' + index);
                    }
                } catch (error) {
                    logMessage('error', `Lỗi khi lấy giá trị từ iframe: ${error.message}`, 'Account ' + index);
                }
                // Nếu chưa lấy được Authorization, thử nhấp vào nút Launch
                if (!authorizationObtained) {
                    try {
                        await page.waitForSelector('button:has-text("Launch"), button:has-text("Confirm")', { timeout: 5000 });
                        const button = await page.$('button:has-text("Launch"), button:has-text("Confirm")');
                        if (button) {
                            const text = await button.evaluate(el => el.textContent);
                            logMessage('info', `Đã tìm thấy nút ${text.trim()}, đang nhấp vào...`, 'Account ' + index);
                            await button.click();
                        } else {
                            logMessage('warning', 'Không tìm thấy nút Launch hoặc Confirm.', 'Account ' + index);
                        }
                    } catch (error) {
                        logMessage('error', `Lỗi khi tìm nút Launch hoặc Confirm: ${error.message}`, 'Account ' + index);
                    }

                    await page.waitForResponse(response => response.url() === 'https://notpx.app/api/v1/users/me' && response.status() === 200);
                    logMessage('info', 'Đã lấy dữ liệu từ API.', 'Account ' + index);
                    logMessage('info', 'Đang chờ thêm 5 giây để đảm bảo yêu cầu đã gửi đi...', 'Account ' + index);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error) {
            logMessage('error', `Lỗi khi xử lý với profile ${index}: ${error.message}`, 'Account ' + index);
        } finally {
            await browserContext.close();
        }
    }

    return authorizationObtained;
}
function getAuthorizationForProfile(name) {
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
}
async function makeApiRequest(endpoint, method, authorization,index, profile) {
    const headers = createHeaders(authorization); 
    try {
      const response = await axiosInstance({
        method,
        url: endpoint,
        headers,
      });
      return response.data;
    } catch (error) {
      logMessage('error', `Lỗi API (${method} ${endpoint}): ${error.message}`,'Account', 'Account ' + index);
      throw error;
    }
  }
async function fetchUserData(authorization, index, profile) {
    const endpoint = '/users/me';
    let currentAuthorization = authorization;

    try {
        const userData = await makeApiRequest(endpoint, 'GET', currentAuthorization, `Account ${index}`, profile);

        if (userData) {
            return { userData, authorization: currentAuthorization };
        } else {
            logMessage('warning', `Không nhận được dữ liệu người dùng cho tài khoản ${index}`, `Account ${index}`);
            return { userData: null, authorization: null };
        }
    } catch (error) {
        if (error.response && error.response.status === 401) {
            logMessage('info', `Authorization không hợp lệ cho account ${index}, đang làm mới...`);
            await launchBrowserAndClickStart(profile);
            currentAuthorization = await getAuthorizationForProfile(profile.name);
            if (currentAuthorization) {
                return await fetchUserData(currentAuthorization, index, profile);
            } else {
                throw new Error(`Không thể lấy Authorization mới cho profile ${profile.name}.`);
            }
        } else {
            throw error;
        }
    }
}
function readAllowedColors() {
    try {
        const data = fs.readFileSync('mau.txt', 'utf8');
        return data.split('\n').map(color => color.trim().toUpperCase()).filter(color => /^#[0-9A-F]{6}$/.test(color));
    } catch (error) {
        logMessage('error', `Lỗi khi đọc file mau.txt: ${error.message}`);
        return [];
    }
}
async function fetchTemplate(authorization, index, profile, isMyTemplate = true) {
    const endpoint = isMyTemplate ? '/tournament/template/subscribe/my' : '/tournament/template/638403324'; // Thay đổi endpoint
    try {
        const templateData = await makeApiRequest(endpoint, 'GET', authorization, index, profile); // Sử dụng makeApiRequest có sẵn
        if (templateData && templateData.url) {
            const imageResponse = await axios.get(templateData.url, { responseType: 'arraybuffer' });
            logMessage('success', `Đã tải ảnh template thành công cho ${isMyTemplate ? 'My Template' : 'Image Template'}.`, index);
            return {
                imageData: imageResponse.data,
                id: templateData.id,
                x: templateData.x,
                y: templateData.y,
                size: templateData.size
            };
        } else {
            // Thêm logic để thử lại với endpoint khác nếu không tìm thấy URL
            logMessage('warning', `Không tìm thấy URL ảnh cho template ${isMyTemplate ? 'My Template' : 'Image Template'}. Thử lại với endpoint khác.`, 'Account ' + index);
            const fallbackEndpoint = 'https://notpx.app/api/v1/tournament/template/638403324';
            const fallbackTemplateData = await makeApiRequest(fallbackEndpoint, 'GET', authorization, index, profile);
            if (fallbackTemplateData && fallbackTemplateData.url) {
                const fallbackImageResponse = await axios.put(fallbackTemplateData.url, { responseType: 'arraybuffer' });
                logMessage('success', `Đã tải ảnh template thành công từ endpoint dự phòng.`, index);
                return {
                    imageData: fallbackImageResponse.data,
                    id: fallbackTemplateData.id,
                    x: fallbackTemplateData.x,
                    y: fallbackTemplateData.y,
                    size: fallbackTemplateData.size
                };
            } else {
                throw new Error(`Không tìm thấy URL ảnh cho template từ endpoint dự phòng.`);
            }
        }
    } catch (error) {
        if (error.response && error.response.status === 401) {
            const newAuthorization = await getAuthorizationForProfile(profile.name);
            if (newAuthorization) {
                return await fetchTemplate(newAuthorization, index, profile, isMyTemplate); // Thử lại với Authorization mới
            } else {
                throw new Error(`Không thể lấy Authorization mới cho profile ${profile.name}.`);
            }
        } else {
            logMessage('error', `Lỗi khi lấy template: ${error.message}`, 'Account ' + index);
            throw error;
        }
    }
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}
async function analyzeImage(imagePath) {
  try {
      logMessage('info', `Bắt đầu phân tích ảnh: ${imagePath}`);

      const allowedColors = readAllowedColors();
      if (allowedColors.length === 0) {
          throw new Error('Không có màu hợp lệ trong file mau.txt');
      }

      logMessage('info', `Số màu cho phép từ mau.txt: ${allowedColors.length}`);

      // Đọc ảnh sử dụng Sharp
      const imageBuffer = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
      const { data, info } = imageBuffer;

      logMessage('info', `Kích thước ảnh: ${info.width}x${info.height}`);

      const colors = [];
      const uniqueColors = new Set();
      const colorCount = {};

      for (let i = 0; i < data.length; i += info.channels) {
          const red = data[i];
          const green = data[i + 1];
          const blue = data[i + 2];
          const hexColor = rgbToHex(red, green, blue);

          // Tìm màu gần nhất trong danh sách màu cho phép
          const closestColor = findClosestColor(hexColor, allowedColors);
          
          colors.push(closestColor);
          uniqueColors.add(closestColor);
          colorCount[closestColor] = (colorCount[closestColor] || 0) + 1;
      }

      logMessage('info', `Tổng số pixel: ${colors.length}`);
      logMessage('info', `Số màu duy nhất (trong mau.txt): ${uniqueColors.size}`);
      return colors;
  } catch (error) {
      logMessage('error', `Lỗi khi đọc và phân tích ảnh: ${error.message}`);
      return null;
  }
}
function findClosestColor(hexColor, allowedColors) {
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
}

function colorDifference(color1, color2) {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice (3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}
function resetRepaintedPixels() {
    globalRepaintedPixels = {};
    if (fs.existsSync(repaintedPixelsPath)) {
        fs.unlinkSync(repaintedPixelsPath);
        logMessage('info', 'Đã xóa file lưu trữ pixel đã repaint.');
    }
    logMessage('info', 'Đã reset danh sách pixel đã repaint.');
}
// Đường dẫn đến file JSON lưu trữ pixelId đã repaint
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repaintedPixelsPath = path.join(__dirname, 'repainted_pixels.json');

// Mutex để đồng bộ hóa ghi file
const mutex = new Mutex();

// Biến toàn cục để theo dõi pixelId đã repaint
let globalRepaintedPixels = {};

// Hàm đọc pixelId đã repaint
async function getRepaintedPixels() {
    if (fs.existsSync(repaintedPixelsPath)) {
        const data = await fsPromises.readFile(repaintedPixelsPath, 'utf8');
        return JSON.parse(data);
    }
    return {};
}
const repaintUrl = 'https://notpx.app/api/v1/repaint/start';
async function saveRepaintedPixels(repaintedPixels) {
    await fsPromises.writeFile(repaintedPixelsPath, JSON.stringify(repaintedPixels, null, 2));
}
async function repaintPixel(pixelId, newColor, currentAuthorization) {
    const data = { pixelId, newColor };
    const response = await axios.post(repaintUrl, data, {
        headers: createHeaders(currentAuthorization),
    });
    return response.data.balance;
}
async function attemptRepaint(pixelId, newColor,index, currentAuthorization) {
    if (globalRepaintedPixels[pixelId]) {
        return null;
    }

    logMessage('paint', `Đang repaint pixel: ${pixelId} với màu: ${newColor}`,'Account ' + index);

    try {
        const diem = await repaintPixel(pixelId, newColor, currentAuthorization);
        logMessage('paint', `Pixel ${pixelId} repaint thành công, Tổng điểm: ${diem}`,'Account ' + index);
        
        globalRepaintedPixels[pixelId] = true;

        const release = await mutex.acquire();
        try {
            await saveRepaintedPixels(globalRepaintedPixels);
        } finally {
            release();
        }

        return diem;
    } catch (error) {
        const errorData = error.response?.data || error.message;
        logMessage('error', `Lỗi repaint tại pixel ${pixelId}: ${errorData}`,'Account ' + index);

        if (error.response && error.response.status === 401) {
            logMessage('info', `Authorization không hợp lệ, làm mới Authorization cho ${profile.name}...`);
            await launchBrowserAndClickStart(profile);
            currentAuthorization = await getAuthorizationForProfile(profile.name);

            if (currentAuthorization) {
                logMessage('info', `Đã làm mới Authorization, thử lại repaint pixel ${pixelId}...`);
                return await attemptRepaint(pixelId, newColor,index, currentAuthorization);
            } else {
                logMessage('error', `Không thể lấy Authorization mới cho profile ${profile.name}.`);
            }
        }
        return null;
    }
}
async function startRepaint(authorization, index, charges, profile, imageColors, templateData) {
  let currentAuthorization = authorization || await getAuthorizationForProfile(profile.name);
  if (!currentAuthorization) {
      logMessage('error', `Không tìm thấy Authorization cho ${profile.name}, dừng repaint.`, 'Account ' + index);
      return;
  }
  const { id, x, y, size } = templateData;
  logMessage('info', `Template info: ID=${id}, x=${x}, y=${y}, size=${size}`, 'Account ' + index);
  const allowedColors = readColorsFromFile();
  if (allowedColors.length === 0) {
      logMessage('error', 'Không có mã màu hợp lệ trong mau.txt.', 'Account ' + index);
      return;
  }
  if (imageColors.length !== size * size) {
      logMessage('error', `Kích thước ảnh không phù hợp. Cần ${size * size} pixels, nhưng ảnh có ${imageColors.length} pixels.`, index);
      return;
  }
  const allPixelIds = [];
  for (let i = size - 1; i >= 0; i--) {
      for (let j = size - 1; j >= 0; j--) {
          const pixelId = (y + i) * 1024 + (x + j + 1);  // Sử dụng tọa độ ngược
          const colorIndex = i * size + j;
          const targetColor = imageColors[colorIndex];
          if (allowedColors.includes(targetColor)) {
              allPixelIds.push({ pixelId, newColor: targetColor });
          }
      }
  }

  globalRepaintedPixels = await getRepaintedPixels();
  while (charges > 0) {
      const unrepaintedPixels = allPixelIds.filter(pixel => !globalRepaintedPixels[pixel.pixelId]);
      let pixelsToRepaint = unrepaintedPixels.slice(0, charges);
      pixelsToRepaint = shuffleArray(pixelsToRepaint);

      logMessage('info', `Đang repaint ${pixelsToRepaint.length} pixels cho tài khoản ${index}.`, 'Account ' + index);

      for (const { pixelId, newColor } of pixelsToRepaint) {
          const success = await attemptRepaint(pixelId, newColor, index, authorization);
          if (success) {
              charges--;
              if (charges <= 0) break;
          }
          await sleep(3000);  
      }
      if (charges > 0) {
          const updatedStatus = await getMiningStatus(authorization, index, profile);
          charges = updatedStatus.charges;
          logMessage('info', `Cập nhật số lượt tô màu còn lại: ${charges}`, 'Account ' + index);
      }
  }

  logMessage('info', `Hoàn thành repaint cho tài khoản ${index}.`, 'Account ' + index);  
}
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
function readColorsFromFile() {
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
}
async function claimRewards(authorization, index, profile) {
    const endpoint = '/mining/claim';
    const data = await makeApiRequest(endpoint, 'GET', authorization,index, profile);
    logMessage('success', `Tài Khoản đã claim thành công: ${data.claimed}`, 'Account ' + index);
  }
async function getMiningStatus(authorization, index, profile) {
    const endpoint = '/mining/status';
    const data = await makeApiRequest(endpoint, 'GET', authorization,index, profile);
    logMessage('info', `User Balance: ${data.userBalance}, Lượt tô màu: ${data.charges}`, 'Account ' + index);
    return data;
  }
async function checkAndClaimTasks(authorization, index, profile) {
    try {
        // Lấy trạng thái nhiệm vụ hiện tại
        const endpoint = '/mining/status';
        const miningStatus = await makeApiRequest(endpoint, 'GET', authorization,index, profile);
        const apiDataTasks = miningStatus.tasks || {};

        // Kiểm tra sự tồn tại của file trước khi đọc
        if (!fs.existsSync('tasks.json') || !fs.existsSync('checktasks.json')) {
            throw new Error('File tasks.json hoặc checktasks.json không tồn tại');
        }

        // Đọc danh sách nhiệm vụ từ file
        const tasksData = await fsPromises.readFile('tasks.json', 'utf8');
        const checkTasksData = await fsPromises.readFile('checktasks.json', 'utf8');
        
        const tasks = JSON.parse(tasksData);
        const checkTasks = JSON.parse(checkTasksData);

        // Tìm các nhiệm vụ chưa hoàn thành
        const missingTasks = Object.keys(tasks).filter(task => !apiDataTasks[task]);

        if (missingTasks.length > 0) {
            for (const missingTask of missingTasks) {
                await claimMissingTask(authorization, missingTask, index, checkTasks, profile);
            }
        } else {
            logMessage('info', `Tất cả nhiệm vụ đã được hoàn thành.`, 'Account ' + index);
        }
    } catch (error) {
        logMessage('error', `Lỗi khi kiểm tra và yêu cầu nhiệm vụ cho tài khoản ${index}: ${error.message}`, 'Account ' + index);
    }
}

async function claimMissingTask(authorization, taskKey, index, checkTasks, profile) {
    const taskToClaim = checkTasks[taskKey];
    if (!taskToClaim) {
        logMessage('error', `Không tìm thấy thông tin trong checktasks.json cho nhiệm vụ: ${taskKey}`,'Account ' + index);
        return;
    }

    const endpoint = `/mining/task/check/${taskToClaim}`;
    try {
        await makeApiRequest(endpoint, 'GET', authorization,index, profile);
        logMessage('success', `Nhiệm vụ ${taskKey} đã được yêu cầu thành công cho tài khoản ${index}.`,'Account ' + index);
    } catch (error) {
        logMessage('error', `Lỗi khi yêu cầu nhiệm vụ ${taskKey} cho tài khoản ${index}: ${error.message}`,'Account ' + index);
    }
}
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const watchAds = async (authorization, index, profile) => {
  const _headers = createHeaders(authorization);
  try {
    const userInfo = parseAuthorization(authorization);
    if (!userInfo) {
      throw new Error('Không thể phân tích cú pháp thông tin người dùng từ authorization.');
    }
    const chatInstance = parseInt(authorization.split('chat_instance=')[1].split('&')[0]);
    const params = {
      blockId: 4853,
      tg_id: userInfo.id,
      tg_platform: "ios",
      platform: "Win32",
      language: userInfo.language_code,
      chat_type: "sender",
      chat_instance: chatInstance,
      top_domain: "app.notpx.app",
      connectiontype: 1
    };
    while (true) {
      const baseUrl = "https://api.adsgram.ai/adv";
      const fullUrl = `${baseUrl}?${new URLSearchParams(params).toString()}`;
      const advResponse = await axios.get(fullUrl, { headers: _headers });
      const advData = advResponse.data;

      if (advData && advData.banner && advData.banner.bannerAssets) {
        logMessage('info', ` A new advertisement has been found for viewing! | Title: ${advData.banner.bannerAssets[1].value} | Type: ${advData.bannerType}`, 'Account ' + index);
        
        const previousStatus = await getMiningStatus(authorization, index, profile);
        const previousBalance = previousStatus.userBalance;
        const renderUrl = advData.banner.trackings[0].value;
        await axios.get(renderUrl, { headers: _headers });
        let sleepTime = randomInt(1, 5);
        logMessage('info', ` Sleeping for ${sleepTime} seconds before next action.`, 'Account ' + index);
        await countdown(sleepTime);
        const showUrl = advData.banner.trackings[1].value;
        await axios.get(showUrl, { headers: _headers });
        sleepTime = randomInt(10, 15);
        logMessage('info', ` Sleeping for ${sleepTime} seconds before next action.`, 'Account ' + index);
        await countdown(sleepTime);
        const rewardUrl = advData.banner.trackings[4].value;
        await axios.get(rewardUrl, { headers: _headers });
        sleepTime = randomInt(1, 5);
        logMessage('info', ` Sleeping for ${sleepTime} seconds before updating status.`, 'Account ' + index);
        await countdown(sleepTime);
        await updateStatus(authorization, index, profile);
        const currentStatus = await getMiningStatus(authorization, index, profile);
        const currentBalance = currentStatus.userBalance;
        const delta = Math.round((currentBalance - previousBalance) * 10) / 10;
        logMessage('success', ` Ad view completed successfully. | Reward: ${delta}`, 'Account ' + index);
        sleepTime = randomInt(30, 35);
        logMessage('info', ` Sleeping for ${sleepTime} seconds before checking for new ads.`, 'Account ' + index);
        await countdown(sleepTime);
      } else {
        logMessage('info', ` No ads are available for viewing at the moment.`, 'Account ' + index);
        break;
      }
    }
  } catch (error) {
    logMessage('error', `Error in watchAds: ${error.message}`, 'Account ' + index);
  }
};

const updateStatus = async (authorization, index, profile) => {
  const baseDelay = 2000; // 2 seconds
  const maxRetries = 5;
  const _headers = createHeaders(authorization);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = 'https://notpx.app/api/v1/mining/status';
      const response = await axios.get(url, { headers: _headers });
      const statusJson = response.data;
      profile.status = statusJson;
      return; 

    } catch (error) {
      const retryDelay = baseDelay * (attempt + 1);
      if (error.response) {
        logMessage('warning', ` Status update attempt ${attempt} failed | Sleep ${retryDelay / 1000} sec | ${error.response.status}, ${error.message}`, 'Account ' + index);
      } else {
        logMessage('error', ` Unexpected error when updating status | Sleep ${retryDelay / 1000} sec | ${error.message}`, 'Account ' + index);
      }
      await sleep(retryDelay); 
    }
  }

  throw new Error(` Failed to update status after ${maxRetries} attempts`);
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
  
  export async function run() {
    const wantRepaint = await askUserForUpgrade();
    const limit = pLimit(10);
    while (true) {
        resetRepaintedPixels();
        try {
            const profiles = readProfiles();

            const processProfile = async (profile, index) => {
                try {
                    const { userData, authorization } = await fetchUserData(await getAuthorizationForProfile(profile.name), index, profile);
                    if (userData) {
                        //const userName = `${userData.lastName} ${userData.firstName}`;
                        await claimRewards(authorization, index, profile);
                        await watchAds(authorization, index, profile);
                        await checkAndClaimTasks(authorization, index, profile);
                        const miningStatus = await getMiningStatus(authorization, index, profile);

                        if (wantRepaint) {
                            // Fetch template and save with a unique name for each profile
                            const myTemplateData = await fetchTemplate(authorization, index, profile);
                            if (myTemplateData && myTemplateData.imageData) {
                                const imagePath = `image_${profile.name}.png`; // Unique image path for each profile
                                fs.writeFileSync(imagePath, myTemplateData.imageData);

                                // Analyze the image for the current profile
                                const imageAnalysis = await analyzeImage(imagePath);
                                logMessage('info', `Đã hoàn thành phân tích ảnh cho tài khoản ${index}`);

                                await startRepaint(authorization, index, miningStatus.charges, profile, imageAnalysis, myTemplateData);
                            } else {
                                logMessage('error', `Không thể tải dữ liệu hình ảnh cho tài khoản ${index}.`, 'Account ' + index);
                            }
                        } else {
                            logMessage('info', 'Người dùng đã chọn không thực hiện repaint.', 'Account ' + index);
                        }
                    }
                } catch (error) {
                    logMessage('error', `Đã xảy ra lỗi với tài khoản ${index}: ${error.message}`);
                }
            };
    
            const tasks = profiles.map((profile, index) => limit(() => processProfile(profile, index)));
            await Promise.all(tasks);

            await countdown(600);
        } catch (error) {
            logMessage('error', `Đã xảy ra lỗi toàn cục: ${error.message}`);
            return;
        }
    }
}
run().catch(error => {
    logMessage('error', `Đã xảy ra lỗi toàn cục: ${error.message}`);
});

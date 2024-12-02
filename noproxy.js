const { chromium } = require('playwright-core');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const axios = require('axios');
const readline = require('readline');
const sharp = require('sharp');
const axiosRetry = require('axios-retry').default;

let globalImageAnalysis = null;
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

function getTimestampGMT7() {
    return new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
}

function logMessage(type, message, userName = '') {
    const timestamp = getTimestampGMT7();
    const color = colors[type] || colors.reset;
    const coloredType = `${color}[${type.toUpperCase()}]${colors.reset}`;
    const logText = userName 
        ? `[${timestamp}] ${coloredType} [${userName}] ${message}`
        : `[${timestamp}] ${coloredType} ${message}`;
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
        logMessage('error', `Đã xảy ra l ôi khi đọc profile.json: ${error.message}`);
        return [];
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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
async function saveUserData(authorizationData, name) {
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

async function executeWithAuthorization(profile, fn) {
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

async function retryWithNewAuthorization(fn, profile) {
    let authorization = await getAuthorizationForProfile(profile.name);
    try {
        return await fn(authorization, profile);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            logMessage('info', `Authorization cho ${profile.name} đã hết hạn. Đang làm mới...`);
            await launchBrowserAndClickStart(profile);
            authorization = await getAuthorizationForProfile(profile.name);
            logMessage('info', `Đã làm mới Authorization cho ${profile.name}, thử lại...`);
            return await fn(authorization, profile);
        } else {
            throw error;
        }
    }
}

async function launchBrowserAndClickStart(profile) {
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
        logMessage('info', `Attempt ${attempt} for profile ${name}`, name);
        
        let browserContext;
        let page;

        try {
            browserContext = await chromium.launchPersistentContext(profilePath, contextOptions);
            page = browserContext.pages().length > 0 ? browserContext.pages()[0] : await browserContext.newPage();

            if (!page || typeof page.goto !== 'function') {
                throw new Error('Page object không hợp lệ sau khi khởi tạo.');
            }

            logMessage('info', 'Đang truy cập vào trang Telegram Web...', name);
            
            page.on('requestfinished', async (request) => {
                if (!authorizationObtained) {
                    const response = await request.response();
                    const headers = response.headers();
                    const authorization = headers['authorization'];
                    if (authorization) {
                        await saveUserData(authorization, name);
                        logMessage('success', `Authorization cho ${name} đã được lưu.`);
                        authorizationObtained = true;
                        await browserContext.close(); // Đóng trình duyệt
                    }
                }
            });
            await page.setExtraHTTPHeaders({
                'accept-language': 'en-US,en;q=0.9',
                'upgrade-insecure-requests': '1'
            });
            await page.goto('https://web.telegram.org/k/#@notpixel', { waitUntil: 'networkidle' });
            logMessage('success', 'Trang đã tải xong!', name);

            if (!authorizationObtained) {
                // Click vào nút Start
                logMessage('info', 'Đang tìm nút Start...', name);
                try {
                    await page.waitForSelector("//div[contains(text(), 'start') or contains(text(), 'Play') or contains(text(), 'Open')]", { timeout: 20000 });
                    const startButton = await page.$("//div[contains(text(), 'start') or contains(text(), 'Play') or contains(text(), 'Open')]");
                    if (startButton) {
                        logMessage('info', 'Đã tìm thấy nút Start, đang nhấp vào...', name);
                        await startButton.click();
                    } else {
                        logMessage('warning', 'Không tìm thấy nút Start.', name);
                    }
                } catch (error) {
                    logMessage('error', `Lỗi khi tìm nút Start: ${error.message}`, name);
                }

                // Thử lấy Authorization từ iframe
                logMessage('info', 'Đang kiểm tra Authorization từ iframe...', name);
                try {
                    const iframeElement = await page.waitForSelector("//div[contains(@class, 'web-app-body')]//iframe", { timeout: 20000 });
                    if (iframeElement) {
                        const src = await iframeElement.evaluate(el => el.src);
                        if (src && src.includes('#tgWebAppData=')) {
                            const tgWebAppData = src.split('#tgWebAppData=')[1].split('&')[0];
                            const decodedData = decodeURIComponent(tgWebAppData);
                            logMessage('success', `Authorization lấy từ iframe cho ${name} đã được lưu.`);
                            await saveUserData(decodedData, name);
                            authorizationObtained = true;
                            await browserContext.close(); // Đóng trình duyệt
                        } else {
                            logMessage ('warning', 'Iframe không chứa dữ liệu tgWebAppData trong thuộc tính src.', name);
                        }
                    } else {
                        logMessage('warning', 'Không tìm thấy iframe.', name);
                    }
                } catch (error) {
                    logMessage('error', `Lỗi khi lấy giá trị từ iframe: ${error.message}`, name);
                }
                // Nếu chưa lấy được Authorization, thử nhấp vào nút Launch
                if (!authorizationObtained) {
                    logMessage('info', 'Chưa lấy được Authorization từ iframe, tiếp tục tìm nút Launch...', name);
                    try {
                        await page.waitForSelector('button:has-text("Launch"), button:has-text("Confirm")', { timeout: 5000 });
                        const button = await page.$('button:has-text("Launch"), button:has-text("Confirm")');
                        if (button) {
                            const text = await button.evaluate(el => el.textContent);
                            logMessage('info', `Đã tìm thấy nút ${text.trim()}, đang nhấp vào...`, name);
                            await button.click();
                        } else {
                            logMessage('warning', 'Không tìm thấy nút Launch hoặc Confirm.', name);
                        }
                    } catch (error) {
                        logMessage('error', `Lỗi khi tìm nút Launch hoặc Confirm: ${error.message}`, name);
                    }

                    await page.waitForResponse(response => response.url() === 'https://notpx.app/api/v1/users/me' && response.status() === 200);
                    logMessage('info', 'Đã lấy dữ liệu từ API.', name);
                    logMessage('info', 'Đang chờ thêm 5 giây để đảm bảo yêu cầu đã gửi đi...', name);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error) {
            logMessage('error', `Lỗi khi xử lý với profile ${name}: ${error.message}`, name);
        } finally {
            logMessage('info', 'Đóng trình duyệt...', name);
            await browserContext.close();
            logMessage('info', 'Hoàn thành quá trình!', name);
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
            logMessage('info', `Authorization cho ${name} đã được tìm thấy.`);
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
async function makeApiRequest(endpoint, method, authorization, userName, profile) {
    const headers = createHeaders(authorization); 
    try {
      const response = await axiosInstance({
        method,
        url: endpoint,
        headers,
      });
      return response.data;
    } catch (error) {
      logMessage('error', `Lỗi API (${method} ${endpoint}): ${error.message}`, userName);
      throw error;
    }
  }
  
  // Các hàm khác như repaintPixel, upgradeLevel, v.v. cũng sử dụng axiosInstance tương tự
  async function fetchUserData(authorization, index, profile) {
    const endpoint = '/users/me';
    let currentAuthorization = authorization;

    try {
        const userData = await makeApiRequest(endpoint, 'GET', currentAuthorization, `Account ${index + 1}`, profile);

        if (userData) {
            const userName = `${userData.lastName} ${userData.firstName}`;
            logMessage('info', `Tài Khoản ${index + 1}: ${userName}`, userName);
            return { userData, authorization: currentAuthorization };
        } else {
            logMessage('warning', `Không nhận được dữ liệu người dùng cho tài khoản ${index + 1}`, `Account ${index + 1}`);
            return { userData: null, authorization: null };
        }
    } catch (error) {
        if (error.response && error.response.status === 401) {
            logMessage('info', `Authorization không hợp lệ cho account ${index + 1}, đang làm mới...`, profile.name);
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
async function fetchTemplate(authorization, userName, profile, isMyTemplate = true) {
    const endpoint = isMyTemplate ? '/tournament/template/subscribe/my' : '/tournament/template/638403324'; // Thay đổi endpoint
    try {
        const templateData = await makeApiRequest(endpoint, 'GET', authorization, userName, profile); // Sử dụng makeApiRequest có sẵn
        logMessage('success', `Đã lấy template thành công cho ${isMyTemplate ? 'My Template' : 'Image Template'}.`, userName);
        return templateData;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            const newAuthorization = await getAuthorizationForProfile(profile.name);
            if (newAuthorization) {
                return await fetchTemplate(newAuthorization, userName, profile, isMyTemplate); // Thử lại với Authorization mới
            } else {
                throw new Error(`Không thể lấy Authorization mới cho profile ${profile.name}.`);
            }
        } else {
            logMessage('error', `Lỗi khi lấy template: ${error.message}`, userName);
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

        // Tạo danh sách kiểm tra các vị trí đặc biệt (góc)
        const specialPixels = {
            198839: '#000000',  // Góc xy = 838198 mã màu #000000
            261839: '#FFB470',  // Góc xy = 838261 mã màu #FFB470
            198902: '#898D90',  // Góc xy = 901198 mã màu #898D90
            261902: '#FFB470'   // Góc xy = 901261 mã màu #FFB470
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

            // Nếu pixel này nằm trong các vị trí đặc biệt
            if (specialPixels[pixelIndex] !== undefined) {
                logMessage('info', `Pixel đặc biệt tại tọa độ ${pixelIndex}: RGB(${red},${green},${blue}) - Mã gốc: ${hexColor}`);
                if (hexColor.toUpperCase() !== specialPixels[pixelIndex].toUpperCase()) {
                    logMessage('error', `Mã màu tại tọa độ ${pixelIndex} không khớp! Cần: ${specialPixels[pixelIndex]}, Nhận: ${hexColor}`);
                } else {
                    logMessage('success', `Mã màu tại tọa độ ${pixelIndex} khớp!`);
                }
            }

            // Tìm màu gần nhất trong danh sách màu cho phép
            const closestColor = findClosestColor(hexColor, allowedColors);
            
            colors.push(closestColor);
            uniqueColors.add(closestColor);
            colorCount[closestColor] = (colorCount[closestColor] || 0) + 1;

            if (colors.length <= 5 || colors.length > data.length / info.channels - 5) {
            } else if (colors.length === 6) {
            }
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
const { Mutex } = require('async-mutex');
function resetRepaintedPixels() {
    globalRepaintedPixels = {};
    if (fs.existsSync(repaintedPixelsPath)) {
        fs.unlinkSync(repaintedPixelsPath);
        logMessage('info', 'Đã xóa file lưu trữ pixel đã repaint.');
    }
    logMessage('info', 'Đã reset danh sách pixel đã repaint.');
}
// Đường dẫn đến file JSON lưu trữ pixelId đã repaint
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
async function attemptRepaint(pixelId, newColor, userName, currentAuthorization) {
    // Kiểm tra xem pixelId đã được repaint chưa
    if (globalRepaintedPixels[pixelId]) {

        return null; // Không cần thực hiện repaint
    }

    logMessage('paint', `Đang repaint pixel: ${pixelId} với màu: ${newColor}`, userName);

    try {
        const diem = await repaintPixel(pixelId, newColor, currentAuthorization);
        logMessage('paint', `Pixel ${pixelId} repaint thành công, Tổng điểm: ${diem}`, userName);
        
        // Cập nhật pixel đã repaint
        globalRepaintedPixels[pixelId] = true;

        // Ghi lại pixelId đã repaint vào file ngay lập tức
        const release = await mutex.acquire();
        try {
            await saveRepaintedPixels(globalRepaintedPixels);
        } finally {
            release();
        }

        return diem; // Trả lại điểm tổng
    } catch (error) {
        const errorData = error.response?.data || error.message;
        logMessage('error', `Lỗi repaint tại pixel ${pixelId}: ${errorData}`, userName);

        // Kiểm tra lỗi 401 Unauthorized và cập nhật Authorization
        if (error.response && error.response.status === 401) {
            logMessage('info', `Authorization không hợp lệ, làm mới Authorization cho ${profile.name}...`);
            await launchBrowserAndClickStart(profile);
            currentAuthorization = await getAuthorizationForProfile(profile.name);

            if (currentAuthorization) {
                logMessage('info', `Đã làm mới Authorization, thử lại repaint pixel ${pixelId}...`);
                return await attemptRepaint(pixelId, newColor, userName, currentAuthorization); // Thử lại với Authorization mới
            } else {
                logMessage('error', `Không thể lấy Authorization mới cho profile ${profile.name}.`);
            }
        }
        return null; // Không thành công
    }
}
async function startRepaint(authorization, userName, index, charges, profile) {
    let currentAuthorization = authorization || await getAuthorizationForProfile(profile.name);

    if (!currentAuthorization) {
        logMessage('error', `Không tìm thấy Authorization cho ${profile.name}, dừng repaint.`, userName);
        return;
    }

    // Lấy template
    const myTemplateData = await fetchTemplate(currentAuthorization, userName, index, profile);
    if (!myTemplateData) {
        logMessage('error', 'Không thể lấy dữ liệu template để repaint.', userName);
        return;
    }

    const { id, x, y, size } = myTemplateData;
    logMessage('info', `Template info: ID=${id}, x=${x}, y=${y}, size=${size}`, userName);

    const allowedColors = readColorsFromFile();
    if (allowedColors.length === 0) {
        logMessage('error', 'Không có mã màu hợp lệ trong mau.txt.', userName);
        return;
    }

    const imagePath = path.join(__dirname, 'image.png');
    if (!fs.existsSync(imagePath)) {
        logMessage('error', `File ảnh không tồn tại: ${imagePath}`, userName);
        return;
    }

    logMessage('info', `Bắt đầu phân tích ảnh cho tài khoản ${index + 1}`, userName);
    const imageColors = await analyzeImage(imagePath);
    
    if (!imageColors) {
        logMessage('error', 'Không thể phân tích ảnh.', userName);
        return;
    }

    logMessage('info', `Phân tích ảnh hoàn tất cho tài khoản ${index + 1}`, userName);

    if (imageColors.length !== size * size) {
        logMessage('error', `Kích thước ảnh không phù hợp. Cần ${size * size} pixels, nhưng ảnh có ${imageColors.length} pixels.`, userName);
        return;
    }

    const allPixelIds = [];
    for (let i = size - 1; i >= 0; i--) {
        for (let j = size - 1; j >= 0; j--) {
            const pixelId = (y + i) * 1000 + (x + j + 1);  // Sử dụng tọa độ ngược
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

        logMessage('info', `Đang repaint ${pixelsToRepaint.length} pixels cho tài khoản ${index + 1}.`, userName);

        for (const { pixelId, newColor } of pixelsToRepaint) {
            const success = await attemptRepaint(pixelId, newColor, userName, authorization);
            if (success) {
                charges--;
                if (charges <= 0) break;
            }
            await sleep(3000);  
        }
        if (charges > 0) {
            const updatedStatus = await getMiningStatus(authorization, userName, index, profile);
            charges = updatedStatus.charges;
            logMessage('info', `Cập nhật số lượt tô màu còn lại: ${charges}`, userName);
        }
    }

    logMessage('info', `Hoàn thành repaint cho tài khoản ${index + 1}.`, userName);
    
    try {
        const updatedTemplate = await fetchTemplate(currentAuthorization);
        if (updatedTemplate) {
            logMessage('info', `Template mới: subscribers=${updatedTemplate.subscribers}, hits=${updatedTemplate.hits}`, userName);
        }
    } catch (error) {
        logMessage('error', `Không thể cập nhật thông tin template sau repaint: ${error.message}`, userName);
    }
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

async function claimRewards(authorization, userName, index, profile) {
    const endpoint = '/mining/claim';
    const data = await makeApiRequest(endpoint, 'GET', authorization, userName, profile);
    logMessage('success', `Tài Khoản ${index + 1} đã claim thành công: ${data.claimed}`, userName);
  }
async function getMiningStatus(authorization, userName, index, profile) {
    const endpoint = '/mining/status';
    const data = await makeApiRequest(endpoint, 'GET', authorization, userName, profile);
    logMessage('info', `User Balance: ${data.userBalance}, Lượt tô màu: ${data.charges}`, userName);
    return data;
  }
  async function checkAndClaimTasks(authorization, userName, index, profile) {
    try {
        // Lấy trạng thái nhiệm vụ hiện tại
        const endpoint = '/mining/status';
        const miningStatus = await makeApiRequest(endpoint, 'GET', authorization, userName, profile);
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
                await claimMissingTask(authorization, missingTask, userName, index, checkTasks, profile);
            }
        } else {
            logMessage('info', `Tài Khoản ${index + 1}: Tất cả nhiệm vụ đã được hoàn thành.`, userName);
        }
    } catch (error) {
        logMessage('error', `Lỗi khi kiểm tra và yêu cầu nhiệm vụ cho tài khoản ${index + 1}: ${error.message}`, userName);
    }
}

async function claimMissingTask(authorization, taskKey, userName, index, checkTasks, profile) {
    const taskToClaim = checkTasks[taskKey];
    if (!taskToClaim) {
        logMessage('error', `Không tìm thấy thông tin trong checktasks.json cho nhiệm vụ: ${taskKey}`, userName);
        return;
    }

    const endpoint = `/mining/task/check/${taskToClaim}`;
    try {
        await makeApiRequest(endpoint, 'GET', authorization, userName, profile);
        logMessage('success', `Nhiệm vụ ${taskKey} đã được yêu cầu thành công cho tài khoản ${index + 1}.`, userName);
    } catch (error) {
        logMessage('error', `Lỗi khi yêu cầu nhiệm vụ ${taskKey} cho tài khoản ${index + 1}: ${error.message}`, userName);
    }
}

async function thucHienKiemTraNangCap(authorization, userName, coNangCap, profile) {
    let currentAuthorization = authorization;
    const headers = createHeaders(currentAuthorization);
    const DELAY_BETWEEN_CHECKS = 2000;
    const maxPaintReward = 7;
    const maxReChargeSpeed = 11;
    const maxEnergyLimit = 7;

    if (!coNangCap) {
        logMessage('info', 'Nâng cấp đã bị hủy bởi người dùng.', userName);
        return;
    }

    try {

        while (true) {
            let statusResponse;

            try {
                statusResponse = await axios.get("https://notpx.app/api/v1/mining/status", {
                    headers,
                });
            } catch (error) {
                logMessage('error', `Lỗi khi gọi API trạng thái: ${error.message}`, userName);
                break;
            }

            if (statusResponse.status !== 200) {
                logMessage('warning', 'Không thể lấy được thông tin trạng thái hiện tại.', userName);
                break;
            }

            const currentLevels = statusResponse.data.boosts;
            logMessage(
                'info',
                `Tình trạng BOOST: Paint Reward Level: ${currentLevels.paintReward}/${maxPaintReward}, Energy Limit Level: ${currentLevels.energyLimit}/${maxEnergyLimit}, Hồi Kỹ Năng: ${currentLevels.reChargeSpeed}/${maxReChargeSpeed} ` + 
                userName
            );
            let upgradesMade = false;

            const paintRewardUpgraded = await upgradeLevel(
                "paintReward",
                currentLevels.paintReward,
                maxPaintReward,
                currentAuthorization,
                headers,
                userName,
                profile
            );
            upgradesMade = upgradesMade || paintRewardUpgraded;
            const reChargeSpeedUpgraded = await upgradeLevel(
                "reChargeSpeed",
                currentLevels.reChargeSpeed,
                maxReChargeSpeed,
                currentAuthorization,
                headers,
                userName,
                profile
            );
            upgradesMade = upgradesMade || reChargeSpeedUpgraded;
            const energyLimitUpgraded = await upgradeLevel(
                "energyLimit",
                currentLevels.energyLimit,
                maxEnergyLimit,
                currentAuthorization,
                headers,
                userName,
                profile
            );
            upgradesMade = upgradesMade || energyLimitUpgraded;

            if (!upgradesMade || 
                (currentLevels.paintReward >= maxPaintReward && currentLevels.energyLimit >= maxEnergyLimit && currentLevels.reChargeSpeed >= maxReChargeSpeed)) {
                logMessage('info', 'Không thể nâng cấp thêm hoặc đã đạt mức tối đa.', userName);
                break;
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHECKS));
        }

        logMessage('info', 'Hoàn tất nâng cấp. Chuyển sang công việc tiếp theo...', userName);
    } catch (error) {
        const errorMessage = error.response && error.response.data
            ? JSON.stringify(error.response.data)
            : error.message;

        logMessage('error', `Đã xảy ra lỗi: ${errorMessage}`, userName);
    }
}


async function upgradeLevel(levelType, currentLevel, maxLevel, authorization, headers, userName, profile) {
    if (currentLevel >= maxLevel) {
        logMessage('info', `${levelType} đã đạt mức tối đa.`, userName);
        return false;
    }

    const endpoint = `/mining/boost/check/${levelType}`;

    try {
        const response = await axiosInstance.get(endpoint, {
            headers,
        });

        if (response.status === 200) {
            logMessage('success', `Đã nâng cấp ${levelType} thành công.`, userName);
            return true;
        } else {
            logMessage('warning', `Nâng cấp ${levelType} không thành công với mã trạng thái: ${response.status}`, userName);
            return false;
        }
    } catch (error) {
        const errorMessage = error.response && error.response.data && error.response.data.error
            ? error.response.data.error
            : error.message;

        if (errorMessage.includes("insufficient balance")) {
            logMessage('warning', `Số dư không đủ nâng cấp ${levelType}.`, userName);
        } else {
            logMessage('warning', `Không thể nâng cấp ${levelType}: ${errorMessage}`, userName);
        }
        return false;
    }
}
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const watchAds = async (authorization, userName, index, profile) => {
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
        logMessage('info', `${userName} | A new advertisement has been found for viewing! | Title: ${advData.banner.bannerAssets[1].value} | Type: ${advData.bannerType}`, index + 1);
        
        const previousStatus = await getMiningStatus(authorization, userName, index, profile);
        const previousBalance = previousStatus.userBalance;

        const renderUrl = advData.banner.trackings[0].value;
        await axios.get(renderUrl, { headers: _headers });
        
        let sleepTime = randomInt(1, 5);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before next action.`, index + 1);
        await countdown(sleepTime);

        const showUrl = advData.banner.trackings[1].value;
        await axios.get(showUrl, { headers: _headers });
        
        sleepTime = randomInt(10, 15);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before next action.`, index + 1);
        await countdown(sleepTime);

        const rewardUrl = advData.banner.trackings[4].value;
        await axios.get(rewardUrl, { headers: _headers });
        
        sleepTime = randomInt(1, 5);
        logMessage('info', `${userName} | Sleeping for ${sleepTime} seconds before updating status.`, index + 1);
        await countdown(sleepTime);

        await updateStatus(authorization, userName, index, profile);

        const currentStatus = await getMiningStatus(authorization, userName, index, profile);
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

const updateStatus = async (authorization, userName, index, profile) => {
  const baseDelay = 2000; // 2 seconds
  const maxRetries = 5;
  const _headers = createHeaders(authorization);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = 'https://notpx.app/api/v1/mining/status';
      const response = await axios.get(url, { headers: _headers });
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
        const profiles = readProfiles();
        const MAX_CONCURRENT_TASKS = 10;
  
        const processProfile = async (profile, index) => {
          try {
            const { userData, authorization } = await fetchUserData(await getAuthorizationForProfile(profile.name), index, profile);
            if (userData) {
              const userName = `${userData.lastName} ${userData.firstName}`;
              await watchAds(authorization, userName, index, profile);
              await claimRewards(authorization, userName, index, profile);
              await checkAndClaimTasks(authorization, userName, index, profile);
              const miningStatus = await getMiningStatus(authorization, userName, index, profile);
  
              if (wantRepaint) {
                await startRepaint(authorization, userName, index, miningStatus.charges, profile, globalImageAnalysis);
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

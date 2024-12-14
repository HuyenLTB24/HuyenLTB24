import asyncio
import json
import os
import random
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlencode, unquote
from PIL import Image
import numpy as np
import aiohttp
from playwright.async_api import async_playwright
from asyncio import Lock as Mutex
import urllib.parse
import re


# Constants
BASE_URL = 'https://notpx.app/api/v1'
COLORS = {
    'reset': '\x1b[0m',
    'info': '\x1b[34m', 
    'success': '\x1b[32m',
    'warning': '\x1b[33m',
    'error': '\x1b[31m',
    'paint': '\x1b[35m'
}

async def sleep(ms: int):
    await asyncio.sleep(ms / 1000)

def log_message(msg_type: str, message: str, index: str = ''):
    timestamp = datetime.now().strftime('%d/%m/%Y, %H:%M:%S')
    color = COLORS.get(msg_type, COLORS['reset'])
    highlight_color = '\x1b[33m'  # Màu vàng cho highlight
    reset_color = COLORS['reset']
    
    # Highlight số trong message
    highlighted_message = message
    keywords = {
        'Balance:': r'Balance:\s*([-+]?\d*\.?\d+)',
        'màu:': r'màu:\s*(\d+)',
        'Reward:': r'Reward:\s*([-+]?\d*\.?\d+)',
        'points': r'(\d+)\s*points',
        'Total:': r'Total:\s*([-+]?\d*\.?\d+)',
        'Lượt tô màu:': r'Lượt tô màu:\s*(\d+)',
        'User Balance:': r'User Balance:\s*([-+]?\d*\.?\d+)',
        'pixel:': r'pixel:\s*(\d+)',
        'charges:': r'charges:\s*(\d+)',
        'Title:': r'Title:\s*([^|]+)',
        'Type:': r'Type:\s*([^\s]+)',
        'thành công:': r'thành công:\s*([-+]?\d*\.?\d+)'
    }
    
    for keyword, pattern in keywords.items():
        match = re.search(pattern, message)
        if match:
            value = match.group(1)
            # Thay thế trực tiếp với giá trị đã tìm thấy
            original = message[match.start():match.end()]
            replacement = original.replace(value, f"{highlight_color}{value}{color}")
            highlighted_message = highlighted_message.replace(original, replacement)
    
    # Tạo log text với màu và reset color
    log_text = (
        f"[{timestamp}] - {{@Notpixel}} - {color}[{msg_type.upper()}]{reset_color} "
        f"{index} | {highlighted_message}"
    ) if index else (
        f"[{timestamp}] - {{@Notpixel}} - {color}[{msg_type.upper()}]{reset_color} {highlighted_message}"
    )
    
    # Đảm bảo reset màu ở cuối message
    print(f"{log_text}{reset_color}")

def parse_authorization(authorization: str) -> Optional[dict]:
    try:
        user_encoded = authorization.split('user=')[1].split('&')[0]
        user_decoded = urllib.parse.unquote(user_encoded)
        user_info = json.loads(user_decoded)
        return user_info
    except Exception as error:
        log_message('error', f'Lỗi khi phân tích cú pháp authorization: {error}')
        return None

def read_profiles() -> List[dict]:
    try:
        with open('profile.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        if not isinstance(data, list):
            raise ValueError('Dữ liệu trong profile.json không phải là một mảng.')
            
        profiles = []
        for profile in data:
            if profile.get('raw_proxy'):
                server, port, username, password = profile['raw_proxy'].split(':')
                proxy = f"{server}:{port}"
            else:
                proxy = username = password = None
                
            profile_path = os.path.join('D:\\', 'ProfileD', profile['profile_path'])
            if not os.path.exists(profile_path):
                log_message('warning', f'Thư mục profile không tồn tại: {profile_path}')
                try:
                    os.makedirs(profile_path, exist_ok=True)
                    log_message('info', f'Đã tạo thư mục profile: {profile_path}')
                except Exception as e:
                    log_message('error', f'Không thể tạo thư mục profile: {e}')
                    continue
                
            profiles.append({
                'name': profile['name'],
                'server': proxy,
                'username': username,
                'password': password,
                'profilePath': profile_path
            })
            
        if not profiles:
            raise ValueError('Không có profile hợp lệ nào được tìm thấy')
            
        return profiles
        
    except Exception as error:
        log_message('error', f'Đã xảy ra lỗi khi đọc profile.json: {error}')
        return []

def create_headers(authorization: str) -> dict:
    user_agent = random.choice([
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Mozilla/5.0 (Linux; Android 10; Android SDK built for x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36'
    ])
    platform = 'iOS' if 'iPhone' in user_agent else 'Android'
    
    return {
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'origin': 'https://app.notpx.app',
        'priority': 'u=1, i',
        'referer': 'https://app.notpx.app/',
        'sec-ch-ua': '"Chromium";v="119", "Mobile Safari";v="16", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': f'"{platform}"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': user_agent,
        'Authorization': f'initData {authorization}'
    }

class AuthorizationManager:
    def __init__(self):
        self.mutex = Mutex()
        
    async def save_user_data(self, authorization_data: str, name: str):
        profiles = []
        if os.path.exists('userdata.json'):
            try:
                with open('userdata.json', 'r', encoding='utf-8') as f:
                    profiles = json.load(f)
            except Exception as error:
                log_message('error', f'Đã xảy ra lỗi khi đọc userdata.json: {error}')
                return

        # Cập nhật hoặc thêm mới profile
        existing_profile = next((p for p in profiles if p['name'] == name), None)
        if existing_profile:
            existing_profile['authorization'] = authorization_data
            log_message('success', f'Đã cập nhật Authorization cho {name}.')
        else:
            profiles.append({'authorization': authorization_data, 'name': name})
            log_message('success', f'Đã thêm mới Authorization cho {name}.')

        try:
            async with self.mutex:
                with open('userdata.json', 'w', encoding='utf-8') as f:
                    json.dump(profiles, f, indent=2)
        except Exception as error:
            log_message('error', f'Đã xảy ra lỗi khi ghi userdata.json: {error}')

    async def get_authorization_for_profile(self, name: str) -> Optional[str]:
        if not os.path.exists('userdata.json'):
            log_message('warning', 'userdata.json không tồn tại.')
            return None
            
        try:
            with open('userdata.json', 'r', encoding='utf-8') as f:
                profiles = json.load(f)
                profile = next((p for p in profiles if p['name'] == name), None)
                
            if profile:
                return profile['authorization']
            else:
                log_message('warning', f'Không tìm thấy Authorization cho {name} trong userdata.json.')
                return None
        except Exception as error:
            log_message('error', f'Đã xảy ra lỗi khi đọc userdata.json: {error}')
            return None

    async def launch_browser_and_click_start(self, profile: dict, index: str = '') -> bool:
        context_options = {
            'headless': True,
            'args': [
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
            'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
            'viewport': {'width': 320, 'height': 480}
        }

        authorization_obtained = False
        max_attempts = 2
        attempt = 0

        async with async_playwright() as p:
            while attempt < max_attempts and not authorization_obtained:
                attempt += 1
                browser_context = None
                try:
                    browser_context = await p.chromium.launch_persistent_context(
                        profile['profilePath'],
                        **context_options
                    )
                    
                    page = browser_context.pages[0] if browser_context.pages else await browser_context.new_page()
                    await page.set_extra_http_headers({
                        'accept-language': 'en-US,en;q=0.9',
                        'upgrade-insecure-requests': '1'
                    })

                    # Đợi trang load xong
                    await page.goto('https://web.telegram.org/k/#@notpixel')
                    await page.wait_for_load_state('networkidle')
                    await asyncio.sleep(5)  # Đợi thêm 5 giây

                    # Tìm và click nút Start với nhiều cách khác nhau
                    try:
                        # Thử nhiều selector khác nhau
                        selectors = [
                            "//div[contains(@class, 'new-message-bot-commands-view') and contains(text(), 'start')]",
                            "//button[contains(@class, 'Button') and contains(text(), 'Start')]",
                            "//div[contains(@class, 'Button') and contains(text(), 'Start')]", 
                            "//div[contains(text(), 'Start')]",
                            "//div[contains(text(), 'PLAY')]",
                            "//div[contains(text(), 'Play')]",
                            "//div[contains(text(), 'Open')]",
                            "//button[contains(text(), 'Start')]"
                        ]
                        
                        start_button = None
                        for selector in selectors:
                            try:
                                start_button = await page.wait_for_selector(
                                    f"xpath={selector}",
                                    timeout=5000
                                )
                                if start_button:
                                    break
                            except:
                                continue
                                
                        if start_button:
                            await start_button.click()
                            log_message('success', 'Đã click nút Start thành công', f'Account {index}')
                            await asyncio.sleep(5)  # Tăng thời gian chờ sau khi click
                        else:
                            log_message('warning', 'Không tìm thấy nút Start với tất cả các selector.', f'Account {index}')
                            
                    except Exception as e:
                        log_message('warning', f'Lỗi khi tìm và click nút Start: {e}', f'Account {index}')

                    try:
                        iframe_element = await page.wait_for_selector("//div[contains(@class, 'web-app-body')]//iframe", timeout=20000)
                        if iframe_element:
                            src = await iframe_element.get_attribute('src')
                            if src and '#tgWebAppData=' in src:
                                tg_web_app_data = src.split('#tgWebAppData=')[1].split('&')[0]
                                decoded_data = urllib.parse.unquote(tg_web_app_data)  # Sử dụng urllib để giải mã
                                await self.save_user_data(decoded_data, profile['name'])
                                authorization_obtained = True
                                await browser_context.close()  # Đóng trình duyệt
                            else:
                                log_message('warning', 'Iframe không chứa dữ liệu tgWebAppData trong thuộc tính src.', f'Account {index}')
                        else:
                            log_message('warning', 'Không tìm thấy iframe.', f'Account {index}')
                    except Exception as error:
                        log_message('error', f'Lỗi khi lấy giá trị từ iframe: {error}', f'Account {index}')

                except Exception as error:
                    log_message('error', f'Lỗi khi xử lý với profile {index}: {error}', f'Account {index}')
                finally:
                    if browser_context:
                        await browser_context.close()

                if not authorization_obtained:
                    log_message('warning', f'Không lấy được authorization ở lần thử {attempt}', f'Account {index}')
                    await asyncio.sleep(5)  # Đợi trước khi thử lại

            return authorization_obtained

    async def execute_with_authorization(self, profile: dict, fn, index: str = ''):
        authorization = await self.get_authorization_for_profile(profile['name'])
        if not authorization:
            log_message('info', f'Không tìm thấy Authorization cho {profile["name"]}, khởi động trình duyệt để lấy mới.')
            await self.launch_browser_and_click_start(profile, index)
            authorization = await self.get_authorization_for_profile(profile['name'])
            if not authorization:
                log_message('error', f'Không thể lấy Authorization cho {profile["name"]}.')
                return
        return await fn(authorization, profile)

class ApiClient:
    def __init__(self):
        self.session = aiohttp.ClientSession()
        
    async def make_api_request(self, endpoint: str, method: str, authorization: str, index: str, profile: dict):
        headers = create_headers(authorization)
        try:
            url = f"{BASE_URL}{endpoint}"
            async with self.session.request(method, url, headers=headers) as response:
                response.raise_for_status()
                return await response.json()
        except Exception as error:
            log_message('error', f'Lỗi API ({method} {endpoint}): {error}', f'Account {index}')
            raise

    async def fetch_user_data(self, authorization: str, index: str, profile: dict) -> Tuple[Optional[dict], Optional[str]]:
        endpoint = '/users/me'
        current_authorization = authorization

        try:
            user_data = await self.make_api_request(endpoint, 'GET', current_authorization, f'Account {index}', profile)
            if user_data:
                return user_data, current_authorization
            else:
                log_message('warning', f'Không nhận được dữ liệu người dùng cho tài khoản {index}', f'Account {index}')
                return None, None
        except Exception as error:
            if isinstance(error, aiohttp.ClientResponseError) and error.status == 401:
                log_message('info', f'Authorization không hợp lệ cho account {index}, đang làm mới...')
                auth_manager = AuthorizationManager()
                await auth_manager.launch_browser_and_click_start(profile)
                current_authorization = await auth_manager.get_authorization_for_profile(profile['name'])
                if current_authorization:
                    return await self.fetch_user_data(current_authorization, index, profile)
                else:
                    raise Exception(f'Không thể lấy Authorization mới cho profile {profile["name"]}.')
            else:
                raise

    async def close(self):
        await self.session.close()

class ImageProcessor:
    def __init__(self):
        self.repainted_pixels: Dict[int, bool] = {}
        self.repainted_pixels_path = Path(__file__).parent / 'repainted_pixels.json'
        self.mutex = Mutex()

    def rgb_to_hex(self, r: int, g: int, b: int) -> str:
        """Chuyển đổi màu từ RGB sang HEX"""
        return f"#{r:02x}{g:02x}{b:02x}".upper()

    def color_difference(self, color1: str, color2: str) -> int:
        """Tính toán sự khác biệt giữa hai màu"""
        r1 = int(color1[1:3], 16)
        g1 = int(color1[3:5], 16)
        b1 = int(color1[5:7], 16)
        
        r2 = int(color2[1:3], 16)
        g2 = int(color2[3:5], 16)
        b2 = int(color2[5:7], 16)
        
        return abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)

    def find_closest_color(self, hex_color: str, allowed_colors: List[str]) -> str:
        """Tìm màu gần nhất trong danh sách màu cho phép"""
        closest_color = allowed_colors[0]
        min_difference = self.color_difference(hex_color, closest_color)
        
        for color in allowed_colors[1:]:
            difference = self.color_difference(hex_color, color)
            if difference < min_difference:
                min_difference = difference
                closest_color = color
                
        return closest_color

    def read_allowed_colors(self) -> List[str]:
        """Đọc danh sách màu cho phép từ file"""
        try:
            with open('mau.txt', 'r', encoding='utf-8') as f:
                colors = [color.strip().upper() for color in f.readlines()]
                return [c for c in colors if c and c.startswith('#') and len(c) == 7]
        except Exception as error:
            log_message('error', f'Lỗi khi đọc file mau.txt: {error}')
            return []

    async def analyze_image(self, image_path: str) -> List[str]:
        """Phân tích ảnh và trả về danh sách màu"""
        try:
            # Kiểm tra xem file có tồn tại không
            if not os.path.exists(image_path):
                log_message('error', f'File ảnh không tồn tại: {image_path}')
                return []
            
            # Kiểm tra kích thước file
            file_size = os.path.getsize(image_path)
            if file_size == 0:
                log_message('error', f'File ảnh rỗng: {image_path}')
                return []
            
            log_message('info', f'Bắt đầu phân tích ảnh: {image_path} (kích thước: {file_size} bytes)')
            
            allowed_colors = self.read_allowed_colors()
            if not allowed_colors:
                raise ValueError('Không có màu hợp lệ trong file mau.txt')
            
            log_message('info', f'Số màu cho phép từ mau.txt: {len(allowed_colors)}')
            
            try:
                # Đọc và xử lý ảnh bằng PIL với thêm thông tin chi tiết
                image = Image.open(image_path)
                log_message('info', f'Định dạng ảnh: {image.format}')
                log_message('info', f'Chế độ màu: {image.mode}')
                
                # Chuyển đổi ảnh sang RGB nếu cần
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                    log_message('info', 'Đã chuyển đổi ảnh sang chế độ RGB')
                    
                image_array = np.array(image)
                
            except Exception as img_error:
                log_message('error', f'Lỗi khi đọc file ảnh: {img_error}')
                # Thử đọc lại file với các tùy chọn khác
                try:
                    image = Image.open(image_path, formats=['PNG', 'JPEG', 'GIF'])
                    image_array = np.array(image)
                    log_message('info', 'Đã đọc thành công file ảnh sau khi thử lại')
                except Exception as retry_error:
                    log_message('error', f'Không thể đọc file ảnh sau khi thử lại: {retry_error}')
                    return []
            
            height, width = image_array.shape[:2]
            log_message('info', f'Kích thước ảnh: {width}x{height}')
            
            colors = []
            unique_colors: Set[str] = set()
            color_count: Dict[str, int] = {}
            
            # Xử lý từng pixel
            for y in range(height):
                for x in range(width):
                    pixel = image_array[y, x]
                    if len(pixel) >= 3:
                        r, g, b = pixel[:3]
                        hex_color = self.rgb_to_hex(r, g, b)
                        closest_color = self.find_closest_color(hex_color, allowed_colors)
                        
                        colors.append(closest_color)
                        unique_colors.add(closest_color)
                        color_count[closest_color] = color_count.get(closest_color, 0) + 1
            
            log_message('info', f'Tổng số pixel: {len(colors)}')
            log_message('info', f'Số màu duy nhất (trong mau.txt): {len(unique_colors)}')
            
            # In thông tin về các màu được sử dụng
            for color, count in color_count.items():
                percentage = (count / len(colors)) * 100
                log_message('info', f'Màu {color}: {count} pixels ({percentage:.2f}%)')
            
            return colors
            
        except Exception as error:
            log_message('error', f'Lỗi khi đọc và phân tích ảnh: {str(error)}')
            log_message('error', f'Chi tiết lỗi: {type(error).__name__}')
            return []

    async def reset_repainted_pixels(self):
        """Reset danh sách pixel đã tô"""
        self.repainted_pixels.clear()
        if self.repainted_pixels_path.exists():
            self.repainted_pixels_path.unlink()
            log_message('info', 'Đã xóa file lưu trữ pixel đã repaint.')
        log_message('info', 'Đã reset danh sách pixel đã repaint.')

    async def get_repainted_pixels(self) -> Dict[int, bool]:
        """Đọc danh sách pixel đã tô từ file"""
        if self.repainted_pixels_path.exists():
            async with self.mutex:
                try:
                    with open(self.repainted_pixels_path, 'r') as f:
                        return json.load(f)
                except Exception as error:
                    log_message('error', f'Lỗi khi đọc file repainted pixels: {error}')
        return {}

    async def save_repainted_pixels(self, pixels: Dict[int, bool]):
        """Lưu danh sách pixel đã tô vào file"""
        async with self.mutex:
            try:
                with open(self.repainted_pixels_path, 'w') as f:
                    json.dump(pixels, f, indent=2)
            except Exception as error:
                log_message('error', f'Lỗi khi lưu file repainted pixels: {error}')

class TemplateManager:
    def __init__(self, api_client: ApiClient):
        self.api_client = api_client

    async def fetch_template(self, authorization: str, index: str, profile: dict, is_my_template: bool = True) -> Optional[dict]:
        """Lấy template từ server"""
        endpoint = '/tournament/template/subscribe/my'
        
        try:
            template_data = await self.api_client.make_api_request(
                endpoint, 'GET', authorization, index, profile
            )
            
            if template_data and template_data.get('url'):
                # Tạo đường dẫn tuyệt đối cho file ảnh
                image_path = os.path.abspath(f'image_{profile["name"]}.png')
                
                async with aiohttp.ClientSession() as session:
                    async with session.get(template_data['url']) as response:
                        if response.status == 200:
                            image_data = await response.read()
                            
                            # Kiểm tra xem dữ liệu ảnh có hợp lệ không
                            if not image_data:
                                raise ValueError('Dữ liệu ảnh trống')
                                
                            # Lưu file với mode binary
                            try:
                                with open(image_path, 'wb') as f:
                                    f.write(image_data)
                                    
                                # Kiểm tra file sau khi lưu
                                if not os.path.exists(image_path) or os.path.getsize(image_path) == 0:
                                    raise ValueError('File ảnh không được lưu đúng cách')
                                    
                                log_message('success', 
                                    f'Đã tải và lưu ảnh template thành công: {image_path} '
                                    f'(kích thước: {os.path.getsize(image_path)} bytes)',
                                    index
                                )
                            except Exception as save_error:
                                log_message('error', f'Lỗi khi lưu file ảnh: {save_error}', index)
                                raise
                        else:
                            raise ValueError(f'Không thể tải ảnh, status code: {response.status}')
                
                return {
                    'image_data': image_data,
                    'image_path': image_path,
                    'id': template_data['id'],
                    'x': template_data['x'],
                    'y': template_data['y'],
                    'size': template_data['size']
                }
            
            # Nếu không tìm thấy URL trong template data
            log_message('warning', 
                f'Không tìm thấy URL ảnh cho template {("My Template" if is_my_template else "Image Template")}.',
                f'Account {index}'
            )
            return None
            
        except Exception as error:
            if isinstance(error, aiohttp.ClientResponseError) and error.status == 401:
                auth_manager = AuthorizationManager()
                new_authorization = await auth_manager.get_authorization_for_profile(profile['name'])
                if new_authorization:
                    return await self.fetch_template(new_authorization, index, profile, is_my_template)
                else:
                    raise ValueError(f'Không thể lấy Authorization mới cho profile {profile["name"]}.')
            else:
                log_message('error', f'Lỗi khi lấy template: {error}', f'Account {index}')
                return None

class RepaintManager:
    def __init__(self, api_client: ApiClient, image_processor: ImageProcessor):
        self.api_client = api_client
        self.image_processor = image_processor
        self.repaint_url = 'https://notpx.app/api/v1/repaint/start'

    async def repaint_pixel(self, pixel_id: int, new_color: str, authorization: str, headers: dict) -> Optional[float]:
        """Thực hiện repaint một pixel"""
        data = {'pixelId': pixel_id, 'newColor': new_color}
        async with aiohttp.ClientSession() as session:
            async with session.post(self.repaint_url, json=data, headers=headers) as response:
                if response.status == 200:
                    result = await response.json()
                    return result.get('balance')
                return None

    async def attempt_repaint(self, pixel_id: int, new_color: str, index: str, 
                            authorization: str, profile: dict) -> Optional[float]:
        """Thử repaint một pixel với xử lý lỗi"""
        if self.image_processor.repainted_pixels.get(pixel_id):
            return None

        log_message('paint', f'Đang repaint pixel: {pixel_id} với màu: {new_color}', f'Account {index}')

        try:
            headers = create_headers(authorization)
            diem = await self.repaint_pixel(pixel_id, new_color, authorization, headers)
            
            if diem is not None:
                log_message('paint', f'Pixel {pixel_id} repaint thành công, Tổng điểm: {diem}', f'Account {index}')
                
                self.image_processor.repainted_pixels[pixel_id] = True
                await self.image_processor.save_repainted_pixels(self.image_processor.repainted_pixels)
                
                return diem

        except Exception as error:
            error_msg = str(error.response.json() if hasattr(error, 'response') else error)
            log_message('error', f'Lỗi repaint tại pixel {pixel_id}: {error_msg}', f'Account {index}')

            if isinstance(error, aiohttp.ClientResponseError) and error.status == 401:
                log_message('info', f'Authorization không hợp lệ, làm mới Authorization cho {profile["name"]}...')
                auth_manager = AuthorizationManager()
                await auth_manager.launch_browser_and_click_start(profile)
                new_authorization = await auth_manager.get_authorization_for_profile(profile['name'])

                if new_authorization:
                    log_message('info', f'Đã làm mới Authorization, thử lại repaint pixel {pixel_id}...')
                    return await self.attempt_repaint(pixel_id, new_color, index, new_authorization, profile)
                else:
                    log_message('error', f'Không thể lấy Authorization mới cho profile {profile["name"]}.')

        return None

    async def start_repaint(self, authorization: str, index: str, charges: int, 
                          profile: dict, image_colors: List[str], template_data: dict):
        """Bắt đầu quá trình repaint"""
        current_authorization = authorization or await AuthorizationManager().get_authorization_for_profile(profile['name'])
        if not current_authorization:
            log_message('error', f'Không tìm thấy Authorization cho {profile["name"]}, dừng repaint.', f'Account {index}')
            return

        x, y, size = template_data['x'], template_data['y'], template_data['size']
        log_message('info', f'Template info: ID={template_data["id"]}, x={x}, y={y}, size={size}', f'Account {index}')

        allowed_colors = self.image_processor.read_allowed_colors()
        if not allowed_colors:
            log_message('error', 'Không có mã màu hợp lệ trong mau.txt.', f'Account {index}')
            return

        if len(image_colors) != size * size:
            log_message('error', 
                f'Kích thước ảnh không phù hợp. Cần {size * size} pixels, nhưng ảnh có {len(image_colors)} pixels.', 
                index
            )
            return

        # Tạo danh sách pixel cần repaint
        all_pixel_ids = []
        for i in range(size - 1, -1, -1):
            for j in range(size - 1, -1, -1):
                pixel_id = (y + i) * 1024 + (x + j + 1)
                color_index = i * size + j
                target_color = image_colors[color_index]
                
                if target_color in allowed_colors:
                    all_pixel_ids.append({'pixel_id': pixel_id, 'new_color': target_color})

        self.image_processor.repainted_pixels = await self.image_processor.get_repainted_pixels()

        while charges > 0:
            # Lọc các pixel chưa repaint
            unrepainted_pixels = [p for p in all_pixel_ids 
                                if not self.image_processor.repainted_pixels.get(p['pixel_id'])]
            pixels_to_repaint = unrepainted_pixels[:charges]
            random.shuffle(pixels_to_repaint)

            log_message('info', f'Đang repaint {len(pixels_to_repaint)} pixels cho tài khoản {index}.', f'Account {index}')

            for pixel in pixels_to_repaint:
                success = await self.attempt_repaint(
                    pixel['pixel_id'], pixel['new_color'], index, authorization, profile
                )
                if success is not None:
                    charges -= 1
                    if charges <= 0:
                        break
                await asyncio.sleep(3)

            if charges > 0:
                updated_status = await self.api_client.make_api_request(
                    '/mining/status', 'GET', authorization, index, profile
                )
                charges = updated_status.get('charges', 0)
                log_message('info', f'Cập nhật số lượt tô màu còn lại: {charges}', f'Account {index}')

        log_message('info', f'Hoàn thành repaint cho tài khoản {index}.', f'Account {index}')

class TaskManager:
    def __init__(self, api_client: ApiClient):
        self.api_client = api_client

    async def claim_rewards(self, authorization: str, index: str, profile: dict):
        """Nhận phần thưởng"""
        data = await self.api_client.make_api_request('/mining/claim', 'GET', authorization, index, profile)
        log_message('success', f'Tài Khoản đã claim thành công: {data.get("claimed")}', f'Account {index}')

    async def get_mining_status(self, authorization: str, index: str, profile: dict) -> dict:
        """Lấy trạng thái đào"""
        data = await self.api_client.make_api_request('/mining/status', 'GET', authorization, index, profile)
        log_message('info', f'User Balance: {data.get("userBalance")}, Lượt tô màu: {data.get("charges")}', f'Account {index}')
        return data

    async def check_and_claim_tasks(self, authorization: str, index: str, profile: dict):
        """Kiểm tra và nhận nhiệm vụ"""
        try:
            # Lấy trạng thái nhiệm vụ hiện tại
            mining_status = await self.api_client.make_api_request('/mining/status', 'GET', authorization, index, profile)
            api_data_tasks = mining_status.get('tasks', {})

            # Kiểm tra file tasks
            if not all(os.path.exists(f) for f in ['tasks.json', 'checktasks.json']):
                raise FileNotFoundError('File tasks.json hoặc checktasks.json không tồn tại')

            # Đọc danh sách nhiệm vụ
            with open('tasks.json', 'r', encoding='utf-8') as f:
                tasks = json.load(f)
            with open('checktasks.json', 'r', encoding='utf-8') as f:
                check_tasks = json.load(f)

            # Tìm nhiệm vụ chưa hoàn thành
            missing_tasks = [task for task in tasks if task not in api_data_tasks]

            if missing_tasks:
                for missing_task in missing_tasks:
                    await self.claim_missing_task(authorization, missing_task, index, check_tasks, profile)
            else:
                log_message('info', 'Tất cả nhiệm vụ đã được hoàn thành.', f'Account {index}')

        except Exception as error:
            log_message('error', 
                f'Lỗi khi kiểm tra và yêu cầu nhiệm vụ cho tài khoản {index}: {error}', 
                f'Account {index}'
            )

    async def claim_missing_task(self, authorization: str, task_key: str, 
                               index: str, check_tasks: dict, profile: dict):
        """Nhận nhiệm vụ còn thiếu"""
        task_to_claim = check_tasks.get(task_key)
        if not task_to_claim:
            log_message('error', 
                f'Không tìm thấy thông tin trong checktasks.json cho nhiệm vụ: {task_key}',
                f'Account {index}'
            )
            return

        try:
            await self.api_client.make_api_request(
                f'/mining/task/check/{task_to_claim}', 'GET', authorization, index, profile
            )
            log_message('success', 
                f'Nhiệm vụ {task_key} đã được yêu cầu thành công cho tài khoản {index}.',
                f'Account {index}'
            )
        except Exception as error:
            log_message('error', 
                f'Lỗi khi yêu cầu nhiệm vụ {task_key} cho tài khoản {index}: {error}',
                f'Account {index}'
            )

class AdManager:
    def __init__(self, api_client: ApiClient):
        self.api_client = api_client

    async def watch_ads(self, authorization: str, index: str, profile: dict):
        """Xem quảng cáo để nhận thưởng (giới hạn 3 lần)"""
        headers = create_headers(authorization)
        try:
            user_info = parse_authorization(authorization)
            if not user_info:
                raise ValueError('Không thể phân tích cú pháp thông tin người dùng từ authorization.')

            chat_instance = int(authorization.split('chat_instance=')[1].split('&')[0])
            params = {
                'blockId': 4853,
                'tg_id': user_info['id'],
                'tg_platform': 'ios',
                'platform': 'Win32',
                'language': user_info['language_code'],
                'chat_type': 'sender',
                'chat_instance': chat_instance,
                'top_domain': 'app.notpx.app',
                'connectiontype': 1
            }

            # Giới hạn số lần xem quảng cáo
            max_ads = 3
            ads_watched = 0

            while ads_watched < max_ads:
                base_url = "https://api.adsgram.ai/adv"
                full_url = f"{base_url}?{urlencode(params)}"
                
                async with aiohttp.ClientSession() as session:
                    async with session.get(full_url, headers=headers) as response:
                        adv_data = await response.json()

                if adv_data and adv_data.get('banner') and adv_data['banner'].get('bannerAssets'):
                    log_message('info', 
                        f'Quảng cáo mới được tìm thấy! ({ads_watched + 1}/{max_ads}) | '
                        f'Title: {adv_data["banner"]["bannerAssets"][1]["value"]} | '
                        f'Type: {adv_data["bannerType"]}', 
                        f'Account {index}'
                    )

                    # Lấy trạng thái trước khi xem quảng cáo
                    previous_status = await self.api_client.make_api_request(
                        '/mining/status', 'GET', authorization, index, profile
                    )
                    previous_balance = previous_status.get('userBalance', 0)

                    # Xử lý các tracking URL
                    render_url = adv_data['banner']['trackings'][0]['value']
                    await self.process_tracking_url(render_url, headers, 1, 5, index)

                    show_url = adv_data['banner']['trackings'][1]['value']
                    await self.process_tracking_url(show_url, headers, 10, 15, index)

                    reward_url = adv_data['banner']['trackings'][4]['value']
                    await self.process_tracking_url(reward_url, headers, 1, 5, index)

                    # Cập nhật trạng thái sau khi xem quảng cáo
                    current_status = await self.api_client.make_api_request(
                        '/mining/status', 'GET', authorization, index, profile
                    )
                    current_balance = current_status.get('userBalance', 0)
                    delta = round(current_balance - previous_balance, 1)

                    ads_watched += 1
                    log_message('success', 
                        f'Hoàn thành xem quảng cáo lần {ads_watched}/{max_ads}. | Reward: {delta}', 
                        f'Account {index}'
                    )
                    
                    if ads_watched < max_ads:
                        # Chờ trước khi kiểm tra quảng cáo tiếp theo
                        sleep_time = random.randint(30, 35)
                        log_message('info', 
                            f'Đợi {sleep_time} giây trước khi xem quảng cáo tiếp theo...', 
                            f'Account {index}'
                        )
                        await self.countdown(sleep_time)
                else:
                    log_message('info', 'Không có quảng cáo khả dụng tại thời điểm này.', f'Account {index}')
                    break

            log_message('info', 
                f'Đã hoàn thành {ads_watched}/{max_ads} lần xem quảng cáo.', 
                f'Account {index}'
            )

        except Exception as error:
            log_message('error', f'Lỗi trong watchAds: {error}', f'Account {index}')

    async def process_tracking_url(self, url: str, headers: dict, min_sleep: int, max_sleep: int, index: str):
        """Xử lý tracking URL của quảng cáo"""
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers):
                sleep_time = random.randint(min_sleep, max_sleep)
                log_message('info', f'Sleeping for {sleep_time} seconds before next action.', f'Account {index}')
                await self.countdown(sleep_time)

    async def countdown(self, seconds: int):
        """Đếm ngược thời gian"""
        for remaining in range(seconds, 0, -1):
            mins, secs = divmod(remaining, 60)
            time_str = f'Chạy lại sau: {mins} phút {secs} giây...'
            print(f'\r{time_str}', end='', flush=True)
            await asyncio.sleep(1)
        print()

class NotPixelBot:
    def __init__(self):
        self.api_client = ApiClient()
        self.auth_manager = AuthorizationManager()
        self.image_processor = ImageProcessor()
        self.template_manager = TemplateManager(self.api_client)
        self.repaint_manager = RepaintManager(self.api_client, self.image_processor)
        self.task_manager = TaskManager(self.api_client)
        self.ad_manager = AdManager(self.api_client)

    async def process_profile(self, profile: dict, index: str):
        """Xử lý một profile"""
        try:
            # Lấy thông tin người dùng
            user_data_result = await self.api_client.fetch_user_data(
                await self.auth_manager.get_authorization_for_profile(profile['name']),
                index,
                profile
            )
            
            if not user_data_result:
                return
                
            user_data, authorization = user_data_result

            if user_data:
                # Thực hiện các nhiệm vụ
                await self.task_manager.claim_rewards(authorization, index, profile)
                await self.task_manager.check_and_claim_tasks(authorization, index, profile)
                await self.ad_manager.watch_ads(authorization, index, profile)  # Thêm dòng này

                mining_status = await self.task_manager.get_mining_status(authorization, index, profile)

                if self.want_repaint:
                    # Xử lý template và repaint
                    template_data = await self.template_manager.fetch_template(authorization, index, profile)
                    if template_data and template_data.get('image_path'):
                        image_path = template_data['image_path']
                        
                        # Kiểm tra file ảnh trước khi phân tích
                        if os.path.exists(image_path) and os.path.getsize(image_path) > 0:
                            image_colors = await self.image_processor.analyze_image(image_path)
                            if image_colors:
                                log_message('info', f'Đã hoàn thành phân tích ảnh cho tài khoản {index}')
                                
                                await self.repaint_manager.start_repaint(
                                    authorization,
                                    index,
                                    mining_status['charges'],
                                    profile,
                                    image_colors,
                                    template_data
                                )
                            else:
                                log_message('error', f'Không thể phân tích màu từ ảnh cho tài khoản {index}', f'Account {index}')
                        else:
                            log_message('error', f'File ảnh không tồn tại hoặc rỗng: {image_path}', f'Account {index}')
                    else:
                        log_message('error', f'Không thể tải dữ liệu hình ảnh cho tài khoản {index}', f'Account {index}')
                else:
                    log_message('info', 'Người dùng đã chọn không thực hiện repaint.', f'Account {index}')

        except Exception as error:
            log_message('error', f'Đã xảy ra lỗi với tài khoản {index}: {error}')

    async def ask_user_for_upgrade(self) -> bool:
        """Hỏi người dùng có muốn thực hiện tô màu không"""
        print('Bạn có muốn thực hiện tô màu không? (y/n): ')
        response = await asyncio.get_event_loop().run_in_executor(None, input)
        return response.lower() == 'y'

    async def run(self):
        """Hàm chính để chạy bot"""
        self.want_repaint = await self.ask_user_for_upgrade()
        
        while True:
            await self.image_processor.reset_repainted_pixels()
            try:
                max_concurrent_tasks = 10  # Giới hạn số luồng xử lý đồng thời
                await run_with_limit(self, max_concurrent_tasks)

                # Đợi 10 phút trước khi chạy lại
                for remaining in range(600, 0, -1):
                    mins, secs = divmod(remaining, 60)
                    time_str = f'Chạy lại sau: {mins} phút {secs} giây...'
                    print(f'\r{time_str}', end='', flush=True)
                    await asyncio.sleep(1)
                print()
                
            except Exception as error:
                log_message('error', f'Đã xảy ra lỗi toàn cục: {error}')
                return

    async def cleanup(self):
        """Dọn dẹp tài nguyên"""
        await self.api_client.close()

async def process_profile_with_semaphore(semaphore, bot, profile, index):
    """Xử lý profile với semaphore để giới hạn số lượng xử lý đồng thời"""
    async with semaphore:
        await bot.process_profile(profile, index)

async def run_with_limit(bot, max_concurrent_tasks):
    """Chạy các profile với giới hạn số lượng xử lý đồng thời"""
    semaphore = asyncio.Semaphore(max_concurrent_tasks)
    profiles = read_profiles()
    tasks = [process_profile_with_semaphore(semaphore, bot, profile, str(i)) 
             for i, profile in enumerate(profiles)]
    await asyncio.gather(*tasks)

async def main():
    """Hàm main"""
    bot = NotPixelBot()
    try:
        await bot.run()
    except Exception as error:
        log_message('error', f'Đã xảy ra lỗi toàn cục: {error}')
    finally:
        await bot.cleanup()

if __name__ == "__main__":
    asyncio.run(main())
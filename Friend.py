import requests
import random
import json
import os
import asyncio
from datetime import datetime
import aiohttp
import aiofiles
from aiofiles import os as aio_os
from tenacity import retry, wait_fixed, stop_after_attempt

# Khởi tạo lock cho đồng bộ hóa
lock = asyncio.Lock()

# Các màu cho log
colors = {
    'reset': '\x1b[0m',
    'info': '\x1b[34m', 
    'success': '\x1b[32m',
    'warning': '\x1b[33m',
    'error': '\x1b[31m',
    'magenta': '\x1b[35m',
    'paint': '\x1b[35m'
}

# Cấu hình cơ bản
BASE_URL = 'https://api.ffabrika.com/api/v1'
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Linux; Android 7.1.2; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.193 Mobile Safari/537.36 Telegram-Android/11.4.3 (Samsung SM-G965N; Android 7.1.2; SDK 25; LOW)",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://ffabrika.com",
    "X-Requested-With": "org.telegram.messenger"
}

# Decorator retry cho các request API
@retry(wait=wait_fixed(1), stop=stop_after_attempt(3))
async def fetch_with_retry(session, url, **kwargs):
    async with session.get(url, **kwargs) as response:
        if response.status >= 500:
            raise Exception(f"Server error: {response.status}")
        return await response.text()

# Hàm tạo headers với token
def create_headers(token):
    headers = HEADERS.copy()
    headers["Cookie"] = f"acc_uid={token}"
    return headers

# Hàm gọi API chung
async def make_api_request(endpoint, method, token, user_name, data=None, proxy=None):
    headers = create_headers(token)
    url = f"{BASE_URL}{endpoint}"
    
    try:
        proxy_auth = None
        if proxy and '@' in proxy:
            # Tách thông tin xác thực từ proxy
            auth_proxy = proxy.split('@')
            if len(auth_proxy) == 2:
                auth = auth_proxy[0].replace('http://', '')
                proxy_host = auth_proxy[1]
                proxy = f"http://{proxy_host}"
                proxy_auth = aiohttp.BasicAuth(*auth.split(':'))

        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            if method == 'POST':
                async with session.post(url, json=data, headers=headers, proxy=proxy, proxy_auth=proxy_auth) as response:
                    return await response.json()
            else:
                async with session.get(url, headers=headers, proxy=proxy, proxy_auth=proxy_auth) as response:
                    return await response.json()
    except Exception as error:
        print(f"{colors['error']}Lỗi API ({method} {endpoint}): {str(error)}{colors['reset']}")
        return None

# Các hàm chức năng chính
async def get_user(token, proxy=None):
    return await make_api_request("/profile", "GET", token, "System", proxy=proxy)

async def get_tasks(token, proxy=None):
    return await make_api_request("/tasks", "GET", token, "System", proxy=proxy)

async def claim_task(token, task_id, proxy=None):
    return await make_api_request(f"/tasks/completion/{task_id}", "POST", token, "System", proxy=proxy)

async def tap(token, proxy=None):
    while True:
        tap_points = random.randint(30, 70)
        data = {"count": tap_points}
        response = await make_api_request("/scores", "POST", token, "System", data, proxy)
        
        if response and 'data' in response:
            score = response['data'].get('score', {})
            energy = response['data'].get('energy', {})
            
            total_score = score.get('total', 0)
            remaining_energy = energy.get('balance', 0)
            
            await log_message('success', f'Tap thành công: Tổng điểm {colors["magenta"]}{total_score}{colors["reset"]}, '
                                       f'Điểm tap được {colors["success"]}{tap_points}{colors["reset"]}, '
                                       f'Năng lượng còn lại {colors["warning"]}{remaining_energy}{colors["reset"]}')
            
            if remaining_energy <= 0:
                await log_message('info', 'Năng lượng đã hết, dừng tap')
                break
        else:
            await log_message('error', 'Lỗi khi thực hiện tap')
            break

async def log_message(type, message, user_name=None):
    time = datetime.now().strftime("%H:%M:%S")
    color = colors.get(type, colors['reset'])
    user_info = f"[{user_name}]" if user_name else ""
    print(f"{color}[{time}]{user_info} {message}{colors['reset']}")

async def get_random_proxy():
    try:
        async with aiofiles.open('proxy.txt', 'r', encoding='utf-8') as file:
            proxies = await file.readlines()
        
        # Loại bỏ khoảng trắng và dòng trống
        proxies = [proxy.strip() for proxy in proxies if proxy.strip()]
        
        if not proxies:
            await log_message('info', 'Không có proxy nào được sử dụng')
            return None
        
        # Chọn ngẫu nhiên một proxy
        return random.choice(proxies)
    except FileNotFoundError:
        await log_message('info', 'Không tìm thấy file proxy.txt, không sử dụng proxy')
        return None
    except Exception as e:
        await log_message('error', f'Lỗi khi đọc file proxy.txt: {str(e)}')
        return None

async def check_ip(proxy=None):
    try:
        if proxy:
            proxy_auth = None
            if '@' in proxy:
                # Tách thông tin xác thực từ proxy
                auth_proxy = proxy.split('@')
                if len(auth_proxy) == 2:
                    auth = auth_proxy[0].replace('http://', '')
                    proxy_host = auth_proxy[1]
                    proxy = f"http://{proxy_host}"
                    proxy_auth = aiohttp.BasicAuth(*auth.split(':'))

            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get('https://api.ipify.org?format=json', proxy=proxy, proxy_auth=proxy_auth) as response:
                    data = await response.json()
                    return data.get('ip')
        else:
            async with aiohttp.ClientSession() as session:
                async with session.get('https://api.ipify.org?format=json') as response:
                    data = await response.json()
                    return data.get('ip')
    except Exception as e:
        await log_message('error', f'Lỗi khi kiểm tra IP: {str(e)}')
        return None

async def main():
    try:
        # Đọc tất cả payload từ file
        async with aiofiles.open('data.txt', 'r', encoding='utf-8') as file:
            payloads = await file.readlines()
        
        # Loại bỏ khoảng trắng và dòng trống
        payloads = [payload.strip() for payload in payloads if payload.strip()]

        # Đọc tất cả proxy từ file
        async with aiofiles.open('proxy.txt', 'r', encoding='utf-8') as file:
            proxies = await file.readlines()
        
        # Loại bỏ khoảng trắng và dòng trống
        proxies = [proxy.strip() for proxy in proxies if proxy.strip()]
        
        for index, payload in enumerate(payloads, 1):
            await log_message('info', f'Đang xử lý tài khoản {index}/{len(payloads)}')
            
            # Lấy proxy theo chỉ số, sử dụng modulo để quay vòng
            proxy = proxies[index % len(proxies)] if proxies else None
            
            # Kiểm tra và hiển thị IP
            if proxy:
                ip = await check_ip(proxy)
                if ip:
                    await log_message('info', f'Sử dụng proxy: {colors["magenta"]}{proxy}{colors["reset"]} - IP: {colors["warning"]}{ip}{colors["reset"]}')
                else:
                    await log_message('warning', f'Không thể kiểm tra IP của proxy: {proxy}')
            else:
                ip = await check_ip()
                await log_message('info', f'Không sử dụng proxy - IP hiện tại: {colors["warning"]}{ip}{colors["reset"]}')
            
            # Lấy token cho mỗi payload
            data = {
                "webAppData": {
                    "payload": payload
                }
            }
            
            response = await make_api_request("/auth/login-telegram", "POST", None, "System", data, proxy)
            if not response or 'data' not in response or 'accessToken' not in response['data']:
                await log_message('error', f'Không thể lấy token cho tài khoản {index}')
                continue
                
            token = response['data']['accessToken']['value']
            
            # Lấy thông tin user
            user_data = await get_user(token, proxy)
            if not user_data or 'data' not in user_data:
                await log_message('error', f'Không thể lấy thông tin user cho tài khoản {index}')
                continue
                
            # Lấy thông tin từ data
            user_info = user_data.get('data', {})
            if not isinstance(user_info, dict):
                await log_message('error', f'Dữ liệu user không hợp lệ cho tài khoản {index}')
                continue

            # Lấy thông tin user an toàn
            last_name = user_info.get('lastName', '') or ''
            first_name = user_info.get('firstName', '') or ''
            username = user_info.get('username', '') or ''
            user_id = user_info.get('id', '')

            # Xử lý chuỗi an toàn
            last_name = str(last_name).strip()
            first_name = str(first_name).strip()
            username = str(username).strip()
            user_id = str(user_id)

            # Tạo tên hiển thị
            display_name_parts = []
            if last_name:
                display_name_parts.append(last_name)
            if first_name:
                display_name_parts.append(first_name)
            if username:
                display_name_parts.append(f"(@{username})")
            if user_id:
                display_name_parts.append(f"ID: {user_id}")

            user_name = " ".join(display_name_parts) if display_name_parts else "Unknown User"
            await log_message('success', f'Đăng nhập thành công tài khoản {index}: {colors["magenta"]}{user_name}{colors["reset"]}')

            # Xử lý tasks
            tasks = await get_tasks(token, proxy)
            if tasks and 'data' in tasks:
                task_list = tasks['data']
                await log_message('info', f'Danh sách nhiệm vụ tài khoản {index}:')
                
                for task in task_list:
                    description = task.get('description', '')
                    is_completed = task.get('isCompleted', False)
                    status = "✅" if is_completed else "❌"
                    await log_message('info', f'{status} {description}')
                    
                    if not is_completed:
                        task_id = task.get('id')
                        if task_id:
                            result = await claim_task(token, task_id, proxy)
                            if result:
                                await log_message('success', f'Đã claim nhiệm vụ: {description}', user_name)

            # Thực hiện tap
            await tap(token, proxy)
            
            # Tạm dừng giữa các tài khoản
            if index < len(payloads):
                await log_message('info', f'Đợi 3 giây trước khi xử lý tài khoản tiếp theo...')
                await asyncio.sleep(3)

    except Exception as e:
        await log_message('error', f'Lỗi: {str(e)}')
        import traceback
        print(traceback.format_exc())

async def run_with_interval():
    while True:
        try:
            current_time = datetime.now().strftime("%H:%M:%S")
            await log_message('info', f'Bắt đầu chạy lúc: {current_time}')
            
            # Chạy chương trình chính
            await main()
            
            # Thông báo hoàn thành và bắt đầu đếm ngược
            await log_message('info', f'Hoàn thành! Đợi 1 giờ trước khi chạy lại...')
            for remaining in range(3600, 0, -1):
                print(f"\r{colors['info']}Chờ {remaining} giây...{colors['reset']}", end='', flush=True)
                await asyncio.sleep(1)
            print() # Xuống dòng sau khi đếm ngược xong
            
        except Exception as e:
            await log_message('error', f'Lỗi trong vòng lặp chính: {str(e)}')
            await asyncio.sleep(3600)  # Nếu có lỗi vẫn đợi 1 giờ trước khi thử lại

if __name__ == "__main__":
    asyncio.run(run_with_interval())



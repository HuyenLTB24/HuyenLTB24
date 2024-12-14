import requests
from typing import Dict, Any
import logging
from time import sleep
import sys
import re
import json
from colorlog import ColoredFormatter
import random
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from queue import Queue
from colorama import Fore, Back, Style
import colorama
import signal
import os

# Thêm biến global để kiểm soát việc dừng
should_exit = False

# Khai báo global queue ở mức module
token_queue = Queue()

def signal_handler(signum, frame):
    """Xử lý khi người dùng nhấn Ctrl+C"""
    global should_exit
    print(f"\n{Fore.YELLOW}Đang dừng chương trình...{Style.RESET_ALL}")
    should_exit = True
    # Thoát ngay lập tức
    os._exit(0)

class NotBitcoinAPI:
    def __init__(self, token: str, proxy: str = None):
        # Khởi tạo colorama
        colorama.init()
        self.base_url = "https://api.notbitco.in/api/v1"
        self.session = requests.Session()
        self.session.headers.update({
            "accept": "application/json, text/plain, */*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
            "authorization": f"Bearer {token}",
            "sec-ch-ua": "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not?A_Brand\";v=\"99\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
        })
        
        # Headers chung cho task
        self.task_headers = {
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
            "sec-ch-ua": "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not?A_Brand\";v=\"99\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
        }

        # Cấu hình proxy nếu có
        if proxy:
            self.session.proxies.update({
                "http": proxy,
                "https": proxy,
            })

    def _make_request(self, method: str, endpoint: str, headers: Dict[str, str] = None, data: str = None) -> Dict[str, Any]:
        """Thực hiện yêu cầu API và xử lý lỗi"""
        try:
            url = f"{self.base_url}/{endpoint}"
            response = self.session.request(
                method=method, 
                url=url,
                headers=headers or self.session.headers,
                data=data,
                allow_redirects=True,
                verify=True
            )
            response.raise_for_status()
            
            # Nếu là HTML response, trả về text
            if 'text/html' in response.headers.get('content-type', ''):
                return response.text
                
            # Kiểm tra nếu response rỗng
            if not response.text.strip():
                return {"error": "Response rỗng từ server"}
            
            try:
                return response.json()
            except ValueError:
                return {"success": True, "message": "Task completed"}
                
        except requests.exceptions.RequestException as e:
            logging.error(f"Lỗi khi gọi API {endpoint}: {str(e)}")
            return {"error": str(e)}

    def get_user_info(self) -> Dict[str, Any]:
        return self._make_request("GET", "user/me")

    def draw_prizes(self) -> Dict[str, Any]:
        return self._make_request("POST", "prizes/draw?turn=all")

    def get_tasks(self) -> Dict[str, Any]:
        return self._make_request("GET", "tasks?sizes=-1")

    def execute_task(self, task_code: str, step_code: str, task_token: str) -> Dict[str, Any]:
        """Thực hiện một bước của task"""
        endpoint = f"tasks/execute/{task_code}/{step_code}?token={task_token}"
        headers = {
            **self.task_headers,
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "cache-control": "max-age=0",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1"
        }
        response = self._make_request("GET", endpoint, headers)
        
        if isinstance(response, str) and '<script>' in response:
            script_pattern = r"const task = '(.+?)';.*?const step = '(.+?)';.*?const token = '(.+?)';.*?const verifyCode = '(.+?)';"
            match = re.search(script_pattern, response, re.DOTALL)
            
            if match:
                task, step, token, verify_code = match.groups()
                return self.claim_task(task, step, token, verify_code)
            
        return response

    def claim_task(self, task: str, step: str, token: str, verify_code: str) -> Dict[str, Any]:
        """Claim task sau khi đã verify"""
        endpoint = "tasks/execute"
        headers = {
            **self.task_headers,
            "accept": "*/*",
            "content-type": "application/json",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-requested-with": "XMLHttpRequest"
        }
        data = {
            "verifyCode": verify_code,
            "task": task,
            "step": step,
            "token": token
        }
        return self._make_request("POST", endpoint, headers, json.dumps(data))

def check_proxy(proxy: str) -> str:
    """Kiểm tra tính hợp lệ của proxy và trả về địa chỉ IP"""
    if not proxy:
        return "Không có proxy được cung cấp."
    try:
        response = requests.get("http://api.ipify.org?format=json", proxies={"http": proxy, "https": proxy}, timeout=10)
        if response.status_code == 200:
            return response.json().get("ip", "Không lấy được địa chỉ IP")
    except requests.RequestException as error:
        return f"Lỗi với proxy {proxy}: {error}"
    return "Proxy không hợp lệ"

def process_token(token: str, index: int, proxy: str = None):
    """Xử lý một token cụ thể"""
    global should_exit
    if should_exit:
        return
    logging.info(f"{Fore.BLUE}Đang xử lý token thứ {index}{Style.RESET_ALL}")
    if proxy and not check_proxy(proxy):
        logging.warning(f"{Fore.RED}Proxy không hợp lệ: {proxy}{Style.RESET_ALL}")
        proxy = None
    api = NotBitcoinAPI(token.strip(), proxy)
    
    try:
        # Lấy thông tin user
        user_info = api.get_user_info()
        if "error" not in user_info:
            logging.info(
                f"[Tài Khoản {index}] - "
                f"Tn người dùng: {Fore.CYAN}{user_info.get('user', {}).get('username', 'Không có thông tin')}{Style.RESET_ALL}, "
                f"Telegram ID: {Fore.YELLOW}{user_info.get('user', {}).get('telegramId', 'Không có thông tin')}{Style.RESET_ALL}, "
                f"Tổng điểm: {Fore.GREEN}{user_info.get('user', {}).get('totalPoint', 'Không có thông tin')}{Style.RESET_ALL}, "
                f"Proxy: {Fore.MAGENTA}{check_proxy(proxy)}{Style.RESET_ALL}"
            )
            
            # Rút thưởng
            if user_info.get('user', {}).get('turnDraw', 0) > 0:
                prizes = api.draw_prizes()
                if "error" not in prizes:
                    logging.info(f"[Tài Khoản {index}] - {Fore.GREEN}Rút thưởng thành công{Style.RESET_ALL}")
            
            # Lấy tasks và thực hiện
            tasks = api.get_tasks()
            if "error" not in tasks:
                # Lấy token từ meta
                task_meta_token = tasks.get('meta', {}).get('token', '')
                
                for task in tasks.get('data', []):
                    task_code = task.get('code', '')
                    steps = task.get('steps', [])
                    
                    
                    # Sử dụng code từ mỗi step và kiểm tra done
                    for step in steps:
                        if not step.get('done', False):  # Chỉ thực hiện các step chưa done
                            step_code = step.get('code', '')
                            result = api.execute_task(task_code, step_code, task_meta_token)
                            if "error" not in result:
                                logging.info(
                                    f"[Tài Khoản {index}] - "
                                    f"Hoàn thành bước {Fore.CYAN}{step_code}{Style.RESET_ALL} của task: "
                                    f"{Fore.YELLOW}{task.get('title', 'Không có thông tin')}{Style.RESET_ALL}"
                                )
                            else:
                                logging.error(
                                    f"[Tài Khoản {index}] - "
                                    f"{Fore.RED}Lỗi khi thực hiện bước {step_code} của task {task_code}: "
                                    f"{result['error']}{Style.RESET_ALL}"
                                )
                            sleep(1)
        else:
            logging.error(f"[Tài Khoản {index}] không hợp lệ")
            
    except Exception as e:
        logging.error(f"{Fore.RED}Lỗi khi xử lý [Tài Khoản {index}]: {str(e)}{Style.RESET_ALL}")

def worker():
    """Worker function cho thread pool"""
    try:
        while not token_queue.empty() and not should_exit:
            try:
                token, index, proxy = token_queue.get(timeout=1)
                process_token(token, index, proxy)
                token_queue.task_done()
            except Exception:
                break
    except KeyboardInterrupt:
        return

def main():
    # Đăng ký signal handler
    signal.signal(signal.SIGINT, signal_handler)
    
    # Cấu hình logging với encoding='utf-8' và thêm màu
    formatter = ColoredFormatter(
        "%(log_color)s%(asctime)s - [BITNOTCOIN] - %(levelname)s - %(message)s",
        datefmt=None,
        reset=True,
        log_colors={
            'DEBUG': 'cyan',
            'INFO': 'green',
            'WARNING': 'yellow',
            'ERROR': 'red',
            'CRITICAL': 'red,bg_white',
        }
    )
    
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - [BITNOTCOIN] - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('notbitcoin.log', encoding='utf-8'),
            handler
        ]
    )
    
    try:
        # Đọc file data.txt với encoding='utf-8'
        with open('data.txt', 'r', encoding='utf-8') as file:
            tokens = file.readlines()
        
        # Đọc file proxy.txt với encoding='utf-8'
        try:
            with open('proxy.txt', 'r', encoding='utf-8') as proxy_file:
                proxies = proxy_file.readlines()
                proxies = [proxy.strip() for proxy in proxies if proxy.strip()]
        except FileNotFoundError:
            proxies = []
            logging.warning(f"{Fore.YELLOW}Không tìm thấy file proxy.txt{Style.RESET_ALL}")
        
        # Tạo hàng đợi cho các token
        for index, token in enumerate(tokens, 1):
            if token.strip():
                proxy = random.choice(proxies) if proxies else None
                token_queue.put((token, index, proxy))
        
        # Tạo ThreadPoolExecutor với 5 luồng
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = []
            try:
                for _ in range(5):
                    if should_exit:
                        break
                    futures.append(executor.submit(worker))
                
                # Đợi với timeout ngắn
                wait(futures, timeout=0.1, return_when=FIRST_COMPLETED)
                
            except KeyboardInterrupt:
                # Thoát ngay khi nhận Ctrl+C
                print(f"\n{Fore.YELLOW}Dừng ngay lập tức!{Style.RESET_ALL}")
                os._exit(0)
                
    except Exception as e:
        logging.error(f"{Fore.RED}Lỗi: {str(e)}{Style.RESET_ALL}")
        os._exit(1)

if __name__ == "__main__":
    main()
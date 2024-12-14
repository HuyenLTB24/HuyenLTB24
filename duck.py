import os
import json
import time
import urllib.parse
import requests
from datetime import datetime
from colorama import Fore, init

# Khởi tạo colorama
init()

class MemesWar:
    def __init__(self):
        self.headers = {
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br",
            "accept-language": "en-US,en;q=0.9",
            "referer": "https://memes-war.memecore.com/",
            "sec-ch-ua": '"Chromium";v="130", "Not?A_Brand";v="99"',
            "sec-ch-ua-mobile": "?1",
            "sec-ch-ua-platform": '"Android"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors", 
            "sec-fetch-site": "same-origin",
            "user-agent": "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
        }

    def log(self, msg, type='info'):
        timestamp = datetime.now().strftime('%H:%M:%S')
        if type == 'success':
            print(f"[{timestamp}] [✓] {msg}", Fore.GREEN)
        elif type == 'custom':
            print(f"[{timestamp}] [*] {msg}", Fore.MAGENTA)
        elif type == 'error':
            print(f"[{timestamp}] [✗] {msg}", Fore.RED)
        elif type == 'warning':
            print(f"[{timestamp}] [!] {msg}", Fore.YELLOW)
        else:
            print(f"[{timestamp}] [ℹ] {msg}", Fore.BLUE)

    async def countdown(self, seconds):
        for i in range(seconds, 0, -1):
            timestamp = datetime.now().strftime('%H:%M:%S')
            print(f"\r[{timestamp}] [*] Wait {i} sec to continue...", end='')
            time.sleep(1)
        print('\r' + ' ' * 50 + '\r', end='')

    async def get_user_info(self, telegram_init_data):
        url = "https://memes-war.memecore.com/api/user"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.get(url, headers=headers)
            self.log(f"Response status: {response.status_code}", 'info')
            self.log(f"Response body: {response.text[:200]}", 'info')
            
            if response.status_code == 200:
                data = response.json()
                if 'data' in data and 'user' in data['data']:
                    user_data = data['data']['user']
                    return {
                        'success': True,
                        'data': {
                            'honorPoints': user_data.get('honorPoints', 0),
                            'warbondTokens': user_data.get('warbondTokens', 0),
                            'honorPointRank': user_data.get('honorPointRank', 0)
                        }
                    }
            return {
                'success': False, 
                'error': f'Invalid response format (Status: {response.status_code})'
            }
        except Exception as e:
            return {'success': False, 'error': f'Request failed: {str(e)}'}

    async def check_treasury_rewards(self, telegram_init_data):
        url = "https://memes-war.memecore.com/api/quest/treasury/rewards"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200 and response.json().get('data'):
                return {'success': True, 'data': response.json()['data']}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def claim_treasury_rewards(self, telegram_init_data):
        url = "https://memes-war.memecore.com/api/quest/treasury"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.post(url, headers=headers, json={})
            if response.status_code == 200 and response.json().get('data'):
                return {'success': True, 'data': response.json()['data']}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def process_treasury(self, telegram_init_data):
        check_result = await self.check_treasury_rewards(telegram_init_data)
        if not check_result['success']:
            self.log(f"Cannot check $War.Bond: {check_result['error']}", 'error')
            return

        left_seconds = check_result['data']['leftSecondsUntilTreasury']
        
        if left_seconds == 0:
            self.log('Claiming $War.Bond...', 'info')
            claim_result = await self.claim_treasury_rewards(telegram_init_data)
            
            if claim_result['success']:
                reward_amount = claim_result['data']['rewards'][0]['rewardAmount']
                self.log(f"Claim successful {reward_amount} $War.Bond", 'success')
                self.log(f"Time to wait for the next claim: {claim_result['data']['leftSecondsUntilTreasury']} seconds", 'info')
            else:
                self.log(f"Unable to claim $War.Bond: {claim_result['error']}", 'error')
        else:
            self.log(f"It's not time to claim yet $War.Bond (còn {left_seconds} seconds)", 'warning')

    async def check_check_in_status(self, telegram_init_data):
        url = "https://memes-war.memecore.com/api/quest/check-in"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200 and response.json().get('data'):
                return {'success': True, 'data': response.json()['data']}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def perform_check_in(self, telegram_init_data):
        url = "https://memes-war.memecore.com/api/quest/check-in"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.post(url, headers=headers, json={})
            if response.status_code == 200 and response.json().get('data'):
                return {'success': True, 'data': response.json()['data']}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def process_check_in(self, telegram_init_data):
        check_result = await self.check_check_in_status(telegram_init_data)
        if not check_result['success']:
            self.log(f"Unable to check attendance status: {check_result['error']}", 'error')
            return

        check_in_rewards = check_result['data']['checkInRewards']
        claimable_reward = next((reward for reward in check_in_rewards if reward['status'] == 'CLAIMABLE'), None)

        if claimable_reward:
            self.log('Checking attendance..', 'info')
            check_in_result = await self.perform_check_in(telegram_init_data)
            
            if check_in_result['success']:
                current_consecutive = check_in_result['data']['currentConsecutiveCheckIn']
                rewards = check_in_result['data']['rewards']
                reward_text = ' + '.join([
                    f"{r['rewardAmount']} $War.Bond" if r['rewardType'] == 'WARBOND'
                    else f"{r['rewardAmount']} Honor Points" if r['rewardType'] == 'HONOR_POINT'
                    else f"{r['rewardAmount']} {r['rewardType']}"
                    for r in rewards
                ])
                
                self.log(f"Attendance successfully marked for today. {current_consecutive} | Reward {reward_text}", 'success')
            else:
                self.log(f"Attendance failed: {check_in_result['error']}", 'error')
        else:
            self.log('You have checked in today.', 'warning')

    async def check_guild_status(self, telegram_init_data, guild_id):
        url = f"https://memes-war.memecore.com/api/guild/{guild_id}"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200 and response.json().get('data'):
                return {'success': True, 'data': response.json()['data']}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def check_favorite_guilds(self, telegram_init_data):
        url = "https://memes-war.memecore.com/api/guild/list/favorite?start=0&count=10"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.get(url, headers=headers)
            if response.status_code == 200 and response.json().get('data'):
                return {'success': True, 'data': response.json()['data']}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def favorite_guild(self, telegram_init_data, guild_id):
        url = "https://memes-war.memecore.com/api/guild/favorite"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            response = requests.post(url, headers=headers, json={'guildId': guild_id})
            if response.status_code == 200:
                return {'success': True}
            return {'success': False, 'error': 'Invalid response format'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def transfer_warbond_to_guild(self, telegram_init_data, guild_id, warbond_count):
        url = "https://memes-war.memecore.com/api/guild/warbond"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            self.log(f"Sending transfer request: {guild_id}, amount: {warbond_count}", 'info')
            
            response = requests.post(url, headers=headers, json={
                'guildId': guild_id,
                'warbondCount': str(warbond_count)
            })
            
            self.log(f"Transfer response status: {response.status_code}", 'info')
            self.log(f"Transfer response body: {response.text[:200]}", 'info')
            
            if response.status_code == 200:
                return {'success': True}
            return {
                'success': False, 
                'error': f'Invalid response (Status: {response.status_code}): {response.text}'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def process_guild_operations(self, telegram_init_data):
        TARGET_GUILD_ID = "ec0e0804-a2cd-4800-9f5f-631cea84f749"
        MIN_WARBOND_THRESHOLD = 1000

        user_info = await self.get_user_info(telegram_init_data)
        if not user_info['success']:
            self.log(f"Cannot retrieve user information: {user_info['error']}", 'error')
            return

        warbond_tokens = int(user_info['data']['warbondTokens'])
        if warbond_tokens <= MIN_WARBOND_THRESHOLD:
            self.log(f"Balance $War.Bond ({warbond_tokens}) Not enough to transfer", 'warning')
            return

        guild_status = await self.check_guild_status(telegram_init_data, TARGET_GUILD_ID)
        if guild_status['success']:
            self.log(f"Guild {guild_status['data']['name']}: {guild_status['data']['warbondTokens']} $War.Bond", 'custom')

            if user_info['data'].get('guildId') == TARGET_GUILD_ID:
                self.log("Already in target guild", 'warning')
                return

        favorite_guilds = await self.check_favorite_guilds(telegram_init_data)
        if favorite_guilds['success']:
            is_guild_favorited = any(guild['guildId'] == TARGET_GUILD_ID for guild in favorite_guilds['data']['guilds'])
            if not is_guild_favorited:
                self.log('Adding guild to favorites...', 'info')
                await self.favorite_guild(telegram_init_data, TARGET_GUILD_ID)

        self.log(f"Transfer {warbond_tokens} $War.Bond Join the guild...", 'info')
        transfer_result = await self.transfer_warbond_to_guild(telegram_init_data, TARGET_GUILD_ID, str(warbond_tokens))
        if transfer_result['success']:
            self.log(f"Transfer {warbond_tokens} $War.Bond Successful", 'success')
        else:
            self.log(f"Cannot transfer $War.Bond: {transfer_result['error']}", 'error')

    async def get_quests(self, telegram_init_data):
        try:
            headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
            
            daily_response = requests.get("https://memes-war.memecore.com/api/quest/daily/list", headers=headers)
            self.log(f"Daily quest response status: {daily_response.status_code}", 'info')
            
            if daily_response.status_code == 200:
                daily_data = daily_response.json()
                if 'data' in daily_data and 'quests' in daily_data['data']:
                    daily_quests = [{**quest, 'questType': 'daily'} for quest in daily_data['data']['quests']]
                    self.log(f"Found {len(daily_quests)} daily quests", 'info')
                    return {'success': True, 'data': daily_quests}
                else:
                    return {'success': False, 'error': 'Missing data or quests in response'}
            else:
                return {'success': False, 'error': f'Invalid response status: {daily_response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': f'Request failed: {str(e)}'}

    async def submit_quest_progress(self, telegram_init_data, quest_type, quest_id):
        url = f"https://memes-war.memecore.com/api/quest/{quest_type}/{quest_id}/progress"
        headers = {**self.headers, "cookie": f"telegramInitData={telegram_init_data}"}
        
        try:
            # Thêm logging cho request
            self.log(f"Submitting progress for quest {quest_id} (type: {quest_type})", 'info')
            
            response = requests.post(url, headers=headers, json={})
            
            # Thêm logging cho response
            self.log(f"Progress response status: {response.status_code}", 'info')
            self.log(f"Progress response body: {response.text[:200]}", 'info')
            
            if response.status_code == 200:
                data = response.json()
                if 'data' in data:
                    return {'success': True, 'data': data['data']}
                return {'success': False, 'error': 'Missing data in response'}
            return {
                'success': False, 
                'error': f'Invalid response (Status: {response.status_code}): {response.text}'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    async def process_quests(self, telegram_init_data):
        quests_result = await self.get_quests(telegram_init_data)
        if not quests_result['success']:
            self.log(f"Cannot retrieve the task list: {quests_result['error']}", 'error')
            return

        pending_quests = [quest for quest in quests_result['data'] if quest['status'] == 'GO']
        if not pending_quests:
            self.log('No tasks to complete', 'warning')
            return

        self.log(f"Found {len(pending_quests)} pending quests", 'info')
        
        for quest in pending_quests:
            self.log(f"Processing quest: {quest['title']} (ID: {quest['id']}, Type: {quest['questType']})", 'info')
            
            try:
                # First submission - should return VERIFY
                result = await self.submit_quest_progress(telegram_init_data, quest['questType'], quest['id'])
                if not result['success']:
                    self.log(f"First submission failed for {quest['title']}: {result['error']}", 'error')
                    continue
                    
                status = result['data'].get('status')
                self.log(f"First submission status: {status}", 'info')
                
                if status != 'VERIFY':
                    self.log(f"Unexpected status after first submission: {status}", 'error')
                    continue

                await self.countdown(3)

                # Second submission - should return CLAIM
                result = await self.submit_quest_progress(telegram_init_data, quest['questType'], quest['id'])
                if not result['success']:
                    self.log(f"Second submission failed for {quest['title']}: {result['error']}", 'error')
                    continue
                    
                status = result['data'].get('status')
                self.log(f"Second submission status: {status}", 'info')
                
                if status != 'CLAIM':
                    self.log(f"Unexpected status after second submission: {status}", 'error')
                    continue

                await self.countdown(3)

                # Final submission - should return DONE
                result = await self.submit_quest_progress(telegram_init_data, quest['questType'], quest['id'])
                if not result['success']:
                    self.log(f"Final submission failed for {quest['title']}: {result['error']}", 'error')
                    continue
                    
                status = result['data'].get('status')
                self.log(f"Final submission status: {status}", 'info')
                
                if status != 'DONE':
                    self.log(f"Unexpected status after final submission: {status}", 'error')
                    continue

                rewards = ' + '.join([
                    f"{r['rewardAmount']} $War.Bond" if r['rewardType'] == 'WARBOND'
                    else f"{r['rewardAmount']} {r['rewardType']}"
                    for r in result['data']['rewards']
                ])

                self.log(f"Quest {quest['title']} completed successfully | Reward: {rewards}", 'success')
                
            except Exception as e:
                self.log(f"Error processing quest {quest['title']}: {str(e)}", 'error')
                continue

    async def main(self):
        data_file = os.path.join(os.path.dirname(__file__), 'data.txt')
        with open(data_file, 'r', encoding='utf-8') as f:
            data = [line.strip() for line in f if line.strip()]

        while True:
            for i, telegram_init_data in enumerate(data):
                try:
                    # Encode telegram_init_data đúng cách
                    encoded_data = urllib.parse.quote(telegram_init_data, safe='')
                    
                    user_data = json.loads(urllib.parse.unquote(
                        telegram_init_data.split('user=')[1].split('&')[0]
                    ))
                    first_name = user_data['first_name']

                    print(f"_______________ Account {i + 1} | {first_name} _______________")

                    # Sử dụng encoded_data thay vì telegram_init_data gốc
                    user_info = await self.get_user_info(encoded_data)
                    if user_info['success']:
                        self.log(f"Honor Points: {user_info['data']['honorPoints']}", 'success')
                        self.log(f"Warbond Tokens: {user_info['data']['warbondTokens']}", 'success')
                        self.log(f"Honor Point Rank: {user_info['data']['honorPointRank']}", 'success')
                    else:
                        self.log(f"Unable to fetch user information: {user_info['error']}", 'error')

                    await self.process_check_in(encoded_data)
                    await self.process_treasury(encoded_data)
                    await self.process_quests(encoded_data)
                    await self.process_guild_operations(encoded_data)

                except Exception as e:
                    self.log(f"Error processing account {i + 1}: {str(e)}", 'error')

                time.sleep(1)

            await self.countdown(65 * 60)

if __name__ == "__main__":
    client = MemesWar()
    try:
        import asyncio
        asyncio.run(client.main())
    except Exception as e:
        client.log(str(e), 'error')
        exit(1)
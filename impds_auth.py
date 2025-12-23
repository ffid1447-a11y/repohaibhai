#!/usr/bin/env python3

import os
import sys
import requests
import hashlib
from bs4 import BeautifulSoup
import re

class IMPDSAuth:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://impds.nic.in/impdsdeduplication"
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
    
    def sha512(self, text):
        return hashlib.sha512(text.encode()).hexdigest()
    
    def login(self):
        # Get credentials from environment
        username = os.getenv('IMPDS_USERNAME', 'dsojpnagar@gmail.com')
        password = os.getenv('IMPDS_PASSWORD', 'CHCAEsoK')
        
        print(f"Logging in as: {username}")
        
        try:
            # Get login page
            response = self.session.get(f"{self.base_url}/LoginPage")
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Get CSRF token
            csrf_input = soup.find('input', {'name': 'REQ_CSRF_TOKEN'})
            csrf_token = csrf_input['value'] if csrf_input else ''
            
            # Get USER_SALT
            user_salt = None
            for script in soup.find_all('script'):
                if script.string and 'USER_SALT' in script.string:
                    match = re.search(r"USER_SALT\s*=\s*'([^']+)'", script.string)
                    if match:
                        user_salt = match.group(1)
                        break
            
            if not csrf_token or not user_salt:
                print("Failed to get tokens")
                return None
            
            # Get CAPTCHA
            captcha_response = self.session.post(f"{self.base_url}/ReloadCaptcha")
            if captcha_response.status_code == 200:
                captcha_data = captcha_response.json()
                captcha_base64 = captcha_data.get('captchaBase64')
            
            # For Railway, we need to handle CAPTCHA
            # Since we can't use Tesseract, use a placeholder
            # In production, you should use a CAPTCHA solving service
            captcha_text = "ABCD123"  # Placeholder - you need to implement real solving
            
            # Prepare password
            salted_password = self.sha512(self.sha512(user_salt) + self.sha512(password))
            
            # Login data
            data = {
                'userName': username,
                'password': salted_password,
                'captcha': captcha_text,
                'REQ_CSRF_TOKEN': csrf_token
            }
            
            # Login
            response = self.session.post(f"{self.base_url}/UserLogin", data=data)
            
            # Get session ID
            jsessionid = self.session.cookies.get('JSESSIONID')
            
            if jsessionid:
                print("✅ Login successful")
                return jsessionid
            else:
                print("❌ Login failed - no session ID")
                return None
                
        except Exception as e:
            print(f"Login error: {e}")
            return None

def main():
    print("Starting IMPDS authentication...")
    
    auth = IMPDSAuth()
    session_id = auth.login()
    
    if session_id:
        print(f"JSESSIONID: {session_id}")
        return 0
    else:
        print("Authentication failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())

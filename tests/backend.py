# Execute (from ~/blackouts directory): env/bin/python -m unittest tests.backend
import unittest
import sys
import socket
from time import time, sleep
from json import loads, dumps
from datetime import datetime, timezone
from random import SystemRandom
from http.client import HTTPConnection

sys.path.append('.')

from CONFIG import *

random = SystemRandom()
r1 = random.randrange(0, 256)
r2 = random.randrange(0, 256)


class HTTPUnixSocketConnection(HTTPConnection):
    def __init__(self, unix_socket: str, timeout=None, blocksize=8192):
        super().__init__("localhost", timeout, blocksize)
        self.unix_socket = unix_socket

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.unix_socket)

def get_cl():
    hp = SANIC_SOCKET.split(':')
    if hp[0] == 'unix':
        return HTTPUnixSocketConnection(hp[1])
    else:
        return HTTPConnection(hp[0], int(hp[1]))

class TestBackend(unittest.TestCase):
    ip = '127.0.0.2'
    tokens = []
    devices = []

    def set_ip(self, l):
        self.ip = f'127.{r1}.{r2}.{l}'

    def get(self, uri, body=None):
        try:
            print()
            method = 'GET' if body is None else 'POST'
            cl = get_cl()
            h = {}
            if self.ip:
                h['forwarded'] =  f'for={self.ip};by="_tests";proto=https;host="{DOMAIN}";path="/a/v";secret={FORWARDED_SECRET}'
            cl.request(method, uri, body=dumps(body) if body is not None else None, headers=h)
            print(method, uri, self.ip)
            if body is not None: print(body)

            print()
            res = cl.getresponse()
            print(res.status, res.reason)
            self.assertEqual(res.status, 200)
            content = res.read().decode("utf-8")
            print(content)
            return content
        finally:
            cl.close()
    
    def get_js(self, uri, body=None):
        return loads(self.get(uri, body))

    def test_a_listing(self):
        self.get_js("/u/listing")

    def test_b_create(self):
        for m in (1, 2):
            self.set_ip(m)
            for n in range(REG_PER_IP + 1):
                js = self.get_js("/u/create_device", {})
                self.assertTrue(js.get('ok'))
                self.assertIn('new_token', js)
                token = js['new_token']
                self.assertNotIn(token, self.tokens)
                self.assertTrue(token.islower())
                self.assertEqual(len(token), 20)
                self.tokens.append(token)
            
            for n in range(3):
                js = self.get_js("/u/create_device", {})
                self.assertTrue(js.get('blocked'))
    
    def test_c_eview(self):
        for token in self.tokens:
            js = self.get_js("/u/e/" + token)
            self.assertGreater(js['id'], 0)
            self.assertEqual(js['title'], f"Device {js['id']}")
            self.assertFalse(js['public'])
            self.assertEqual(js['interval'], DEFAULT_INTERVAL)
            self.assertEqual(js['notify_interval'], int(DEFAULT_INTERVAL * BLACKOUT_COEFFICIENT))
            self.assertFalse(js['email_confirmed'])
            self.assertListEqual(js['events'], [])
            self.assertIsNone(js['updated'])
            delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(js['created'])
            self.assertEqual(delta.days, 0)
            self.assertLess(delta.seconds, 5)
            self.devices.append(js)

    def test_d_update(self):
        for n in (2, 9, 10):
            self.set_ip(n)
            device = self.devices[n]
            txt = self.get("/u/"+device['update_token'])
            self.assertEqual(txt, '')
            txt = self.get("/u/"+device['update_token'])
            self.assertEqual(txt, 'too often')
    
    def test_e_save(self):
        device = self.devices[9]

        js = self.get_js("/u/e/"+device['edit_token'], {'public': True, 'email': '', 'title': 'Public9', 'notes': 'Testing', 
            'location': 'TestLoc9', 'isp': 'TestIsp9', 'battery': True, 'reserve': True, 'battery_comment': 'CommentB', 
            'reserve_comment': 'CommentR', 'interval': MIN_INTERVAL, 'notify_interval': MIN_INTERVAL + 2, 'notifyoff': True, 'notifyon': True})
        self.assertTrue(js.get('ok'))

        device = self.devices[2]

        js = self.get_js("/u/v/"+str(device['id']))
        self.assertIn('error', js)
        self.assertNotIn('id', js)

        js = self.get_js("/u/e/"+device['edit_token'], {'public': True, 'email': '', 'title': 'Public2', 'notes': 'Testing', 
            'location': 'TestLoc2', 'isp': 'TestIsp2', 'battery': True, 'reserve': True, 'battery_comment': 'CommentB', 
            'reserve_comment': 'CommentR', 'interval': MIN_INTERVAL, 'notify_interval': MIN_INTERVAL + 2, 'notifyoff': True, 'notifyon': True})
        self.assertTrue(js.get('ok'))

        js = self.get_js("/u/e/"+device['edit_token'])
        self.assertEqual(js['title'], 'Public2')
        self.assertEqual(js['notes'], 'Testing')
        self.assertEqual(js['location'], 'TestLoc2')
        self.assertEqual(js['isp'], 'TestIsp2')
        self.assertTrue(js['battery'])
        self.assertTrue(js['reserve'])
        self.assertEqual(js['battery_comment'], 'CommentB')
        self.assertEqual(js['reserve_comment'], 'CommentR')
        self.assertEqual(js['interval'], MIN_INTERVAL)
        self.assertEqual(js['notify_interval'], MIN_INTERVAL + 2)
        self.assertTrue(js['battery'])
        self.assertTrue(js['battery'])
        self.assertTrue(js['public'])

        delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(js['updated'])
        self.assertEqual(delta.days, 0)
        self.assertLess(delta.seconds, 5)

        self.assertEqual(len(js['events']), 1)
        ev = js['events'][0]
        self.assertIsNone(ev['started'])
        self.assertIsNone(ev['old_ip'])
        self.assertIsNone(ev['downtime'])
        delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(ev['ended'])
        self.assertEqual(delta.days, 0)
        self.assertLess(delta.seconds, 5)
        self.assertTrue(ev['new_ip'].startswith(f'127.{r1}.{r2}'))

        js = self.get_js("/u/change_token/"+device['edit_token'], {'tok': 'edit'})
        self.assertTrue(js.get('ok'))
        new_edit_token = js['new_token']
        self.assertNotIn(new_edit_token, self.tokens)

        js = self.get_js("/u/e/"+device['edit_token'])
        self.assertTrue(js.get('error'))
        self.assertNotIn('id', js)

        device['edit_token'] = new_edit_token

        js = self.get_js("/u/change_token/"+device['edit_token'], {'tok': 'view'})
        self.assertTrue(js.get('ok'))
        new_view_token = js['new_token']


        js = self.get_js("/u/e/"+device['view_token'])
        self.assertIn('error', js)
        self.assertNotIn('id', js)

        js = self.get_js("/u/v/"+device['view_token'])
        self.assertIn('error', js)
        self.assertNotIn('id', js)

        device['view_token'] = new_view_token

        for token in device['view_token'], str(device['id']):
            js = self.get_js("/u/v/"+token)
            self.assertNotIn('error', js)
            self.assertIn('id', js)
            self.assertEqual(js['title'], 'Public2')
            self.assertEqual(js['notes'], 'Testing')
            self.assertEqual(js['location'], 'TestLoc2')
            self.assertEqual(js['isp'], 'TestIsp2')
            self.assertTrue(js['battery'])
            self.assertTrue(js['reserve'])
            self.assertEqual(js['battery_comment'], 'CommentB')
            self.assertEqual(js['reserve_comment'], 'CommentR')
            self.assertEqual(js['interval'], MIN_INTERVAL)

            delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(js['updated'])
            self.assertEqual(delta.days, 0)
            self.assertLess(delta.seconds, 5)

            self.assertEqual(len(js['events']), 1)
            ev = js['events'][0]
            self.assertIsNone(ev['started'])
            self.assertIsNone(ev['old_ip'])
            self.assertIsNone(ev['downtime'])
            delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(ev['ended'])
            self.assertEqual(delta.days, 0)
            self.assertLess(delta.seconds, 5)
            self.assertTrue(ev['new_ip'].startswith(f'127.{r1}.{r2}'))
        
        js = self.get_js("/u/listing")

        ids = []
        
        for device in js['devices']:
            ids.append(device['id'])

        for n in (2, 9):
            self.assertIn(self.devices[n]['id'], ids)
    
    def test_f_set_confirm_email(self):
        for n in (2, 9, 10):
            device = self.devices[n]
            email = device['email'] = f'testmail{n}@example.com'

            ts = time()
            js = self.get_js("/u/email_send_code/"+device['edit_token'], {'email': email})
            self.assertTrue(js.get('ok'))

            js = {}
            with open('example_email.log') as emlog:
                for jl in emlog:
                    js = loads(jl)
                    if js['timestamp'] < ts: continue
                    print(js)
                    if js['to'] != email: continue
            

            self.assertEqual(js['from'], MAILER_EMAIL)
            self.assertEqual(js['to'], email)
            content = js['content']
            self.assertIn('Verification code', content)
            vcode = content.split('<b>')[1].split('</b>')[0]
            self.assertEqual(len(vcode), 6)

            if n in (9, 10):
                for t in range(1 if n == 9 else EMAIL_VCODE_ATTEMPT):
                    js = self.get_js("/u/verify_email/"+device['edit_token'], {'vcode': '111222'})
                    self.assertTrue(js.get('error'))

            js = self.get_js("/u/verify_email/"+device['edit_token'], {'vcode': vcode})
            if n == 10:
                self.assertTrue(js.get('blocked'))
            else:
                self.assertTrue(js.get('ok'))

    def test_g_down(self):       
        ts = time()
        vsleep(MIN_INTERVAL * 3)
        for n in (2, 9):
            device = self.devices[n]
            self.assertTrue(search_email(ts, device))
    
    def test_h_unsubcribe(self):
        device = self.devices[9]
        txt = self.get("/u/unsubscribe/"+device['edit_token'])
        self.assertIn('You have successfully unsubscribed from notifications about', txt)
    
    def test_j_update(self):
        ts = time()
        for n in (2, 9, 10):
            self.set_ip(n + (10 if n > 2 else 0))
            device = self.devices[n]
            txt = self.get("/u/"+device['update_token'])
            self.assertTrue(txt.isdigit)
        
        device = self.devices[2]
        self.assertTrue(search_email(ts, device))

        device = self.devices[9]
        self.assertFalse(search_email(ts, device))

        for n in (2, 9, 10):
            device = self.devices[n]
            js = self.get_js("/u/v/"+device['view_token'])
            self.assertEqual(len(js['events']), 2)
            for ev in js['events']:
                if not ev['started']: continue

                self.assertLess(ev['downtime'], MIN_INTERVAL * 5)
                delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(ev['ended'])
                self.assertEqual(delta.days, 0)
                self.assertLess(delta.seconds, 5)
                delta = datetime.utcnow().replace(tzinfo=timezone.utc) - datetime.fromisoformat(ev['started'])
                self.assertEqual(delta.days, 0)
                self.assertLess(delta.seconds, MIN_INTERVAL * 5)
                if n == 2:
                    self.assertIsNone(ev['old_ip'])
                    self.assertIsNone(ev['new_ip'])
                else:
                    self.assertIsNotNone(ev['old_ip'])
                    self.assertIsNotNone(ev['new_ip'])
                
                if n == 2:
                    js = self.get_js("/u/add_comment/"+device['edit_token'], {'id': ev['id'], 'comment': f"Comment{ev['id']}"})
                    self.assertTrue(js.get('ok'))

                else:
                    for m in range(n - 8):
                        js = self.get_js("/u/toogle_event/"+device['edit_token'], {'id': ev['id']})
                        self.assertTrue(js.get('ok'))
            
            js = self.get_js("/u/v/"+device['view_token'])
            for ev in js['events']:
                if not ev['started']: continue

                if n == 2:
                    self.assertEqual(ev['comment'], f"Comment{ev['id']}")

                if n == 9:
                    self.assertTrue(ev['crossed'])

                if n == 10:
                    self.assertFalse(ev['crossed'])
    
    def test_k_delete(self):
        for device in self.devices:
            js = self.get_js("/u/delete_device/"+device['edit_token'], {})
            self.assertTrue(js.get('ok'))
            


def search_email(ts, device, up=False):
    js = {}
    with open('example_email.log') as emlog:
        for jl in emlog:
            js = loads(jl)
            if js['timestamp'] < ts: continue
            if js['to'] != device['email']: continue
            print(js)
            content = js['content']
            print(device['edit_token'])
            if MAILER_UNSUBSCRIBE + device['edit_token'] not in content: continue
            return True
    
    return False

def vsleep(n):
    print('sleep', n)
    sleep(n)
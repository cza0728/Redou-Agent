# -*- coding: utf-8 -*-
"""Hidden tests for SessionPlugin."""
import sys, os, unittest, json, hmac, hashlib, base64

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import bottle
from bottle import tob

# Import the student's plugin
from bottle_plugins import SessionPlugin

from tools import ServerTestBase


def _make_signed_cookie(data, secret, cookie_name='bottle.session'):
    """Helper: build a valid signed session cookie value."""
    payload = base64.b64encode(json.dumps(data).encode('utf-8')).decode('ascii')
    sig = hmac.new(secret.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{payload}.{base64.b64encode(bytes.fromhex(sig)).decode('ascii')}"


class TestSessionBasic(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(SessionPlugin(secret='test-secret'))

        @self.app.route('/set')
        def _set():
            bottle.request.session['user'] = 'alice'
            return 'ok'

        @self.app.route('/get')
        def _get():
            return bottle.request.session.get('user', 'anonymous')

        @self.app.route('/multi')
        def _multi():
            bottle.request.session['a'] = '1'
            bottle.request.session['b'] = '2'
            return 'ok'

        @self.app.route('/len')
        def _len():
            return str(len(bottle.request.session))

        @self.app.route('/contains')
        def _contains():
            return str('user' in bottle.request.session)

        @self.app.route('/del')
        def _del():
            if 'user' in bottle.request.session:
                del bottle.request.session['user']
            return 'ok'

        @self.app.route('/clear')
        def _clear():
            bottle.request.session.clear()
            return 'ok'

    def test_set_session_returns_cookie(self):
        result = self.urlopen('/set')
        self.assertEqual(200, result['code'])
        self.assertIn('Set-Cookie', result['header'])
        self.assertIn('bottle.session', result['header']['Set-Cookie'])

    def test_get_empty_session(self):
        result = self.urlopen('/get')
        self.assertEqual(b'anonymous', result['body'])

    def test_set_then_get(self):
        r1 = self.urlopen('/set')
        cookie_header = r1['header'].get('Set-Cookie', '')
        # Extract cookie value
        cookie_val = ''
        for part in cookie_header.split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val = part.split('=', 1)[1]
                break

        r2 = self.urlopen('/get', env={'HTTP_COOKIE': f'bottle.session={cookie_val}'})
        self.assertEqual(b'alice', r2['body'])

    def test_multiple_keys(self):
        r1 = self.urlopen('/multi')
        cookie_val = ''
        for part in r1['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val = part.split('=', 1)[1]
                break

        r2 = self.urlopen('/len', env={'HTTP_COOKIE': f'bottle.session={cookie_val}'})
        self.assertEqual(b'2', r2['body'])

    def test_delete_key(self):
        r1 = self.urlopen('/set')
        cookie_val = ''
        for part in r1['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val = part.split('=', 1)[1]
                break

        r2 = self.urlopen('/del', env={'HTTP_COOKIE': f'bottle.session={cookie_val}'})
        cookie_val2 = ''
        for part in r2['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val2 = part.split('=', 1)[1]
                break

        r3 = self.urlopen('/get', env={'HTTP_COOKIE': f'bottle.session={cookie_val2}'})
        self.assertEqual(b'anonymous', r3['body'])

    def test_clear_session(self):
        r1 = self.urlopen('/set')
        cookie_val = ''
        for part in r1['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val = part.split('=', 1)[1]
                break

        r2 = self.urlopen('/clear', env={'HTTP_COOKIE': f'bottle.session={cookie_val}'})
        cookie_val2 = ''
        for part in r2['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val2 = part.split('=', 1)[1]
                break

        r3 = self.urlopen('/len', env={'HTTP_COOKIE': f'bottle.session={cookie_val2}'})
        self.assertEqual(b'0', r3['body'])

    def test_contains(self):
        r1 = self.urlopen('/set')
        cookie_val = ''
        for part in r1['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('bottle.session='):
                cookie_val = part.split('=', 1)[1]
                break

        r2 = self.urlopen('/contains', env={'HTTP_COOKIE': f'bottle.session={cookie_val}'})
        self.assertEqual(b'True', r2['body'])


class TestSessionSecurity(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(SessionPlugin(secret='secure-key-123'))

        @self.app.route('/set')
        def _set():
            bottle.request.session['secret'] = 'data'
            return 'ok'

        @self.app.route('/get')
        def _get():
            return bottle.request.session.get('secret', 'empty')

    def test_tampered_cookie_returns_empty(self):
        result = self.urlopen('/get', env={'HTTP_COOKIE': 'bottle.session=tampered_value'})
        self.assertEqual(b'empty', result['body'])

    def test_invalid_base64_returns_empty(self):
        result = self.urlopen('/get', env={'HTTP_COOKIE': 'bottle.session=!!!invalid!!!'})
        self.assertEqual(b'empty', result['body'])

    def test_wrong_signature_returns_empty(self):
        payload = base64.b64encode(json.dumps({'secret': 'hacked'}).encode()).decode()
        fake_sig = base64.b64encode(b'0' * 32).decode()
        cookie_val = f"{payload}.{fake_sig}"
        result = self.urlopen('/get', env={'HTTP_COOKIE': f'bottle.session={cookie_val}'})
        self.assertEqual(b'empty', result['body'])

    def test_no_cookie_returns_empty(self):
        result = self.urlopen('/get')
        self.assertEqual(b'empty', result['body'])

    def test_empty_cookie_returns_empty(self):
        result = self.urlopen('/get', env={'HTTP_COOKIE': 'bottle.session='})
        self.assertEqual(b'empty', result['body'])


class TestSessionConfig(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(SessionPlugin(
            secret='key', cookie_name='my.sess', max_age=7200
        ))

        @self.app.route('/set')
        def _set():
            bottle.request.session['x'] = '1'
            return 'ok'

        @self.app.route('/get')
        def _get():
            return bottle.request.session.get('x', 'none')

    def test_custom_cookie_name(self):
        r1 = self.urlopen('/set')
        self.assertIn('my.sess', r1['header'].get('Set-Cookie', ''))

    def test_custom_cookie_name_read(self):
        r1 = self.urlopen('/set')
        cookie_val = ''
        for part in r1['header'].get('Set-Cookie', '').split(';'):
            part = part.strip()
            if part.startswith('my.sess='):
                cookie_val = part.split('=', 1)[1]
                break
        r2 = self.urlopen('/get', env={'HTTP_COOKIE': f'my.sess={cookie_val}'})
        self.assertEqual(b'1', r2['body'])

    def test_max_age_in_cookie(self):
        r1 = self.urlopen('/set')
        cookie = r1['header'].get('Set-Cookie', '')
        self.assertIn('Max-Age', cookie)

    def test_no_cookie_set_when_unchanged(self):
        result = self.urlopen('/get')
        cookie = result['header'].get('Set-Cookie', '')
        self.assertNotIn('bottle.session', cookie)
        self.assertNotIn('my.sess', cookie)


class TestSessionPluginMeta(unittest.TestCase):
    def test_plugin_name(self):
        p = SessionPlugin(secret='k')
        self.assertEqual('session', p.name)

    def test_plugin_api(self):
        p = SessionPlugin(secret='k')
        self.assertEqual(2, p.api)


if __name__ == '__main__':
    unittest.main()

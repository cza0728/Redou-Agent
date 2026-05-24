# -*- coding: utf-8 -*-
"""Hidden tests for CORSPlugin."""
import sys, os, unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import bottle
from bottle_plugins import CORSPlugin
from tools import ServerTestBase


class TestCORSWildcard(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(CORSPlugin(allow_origins=['*']))

        @self.app.route('/api/data')
        def data():
            return 'ok'

    def test_wildcard_origin(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://any.com'})
        self.assertEqual('*', result['header'].get('Access-Control-Allow-Origin'))

    def test_no_origin_header(self):
        result = self.urlopen('/api/data')
        # Without Origin header, CORS headers may or may not be present
        self.assertEqual(200, result['code'])

    def test_wildcard_no_credentials(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://any.com'})
        self.assertNotIn('Access-Control-Allow-Credentials', result['header'])


class TestCORSSpecificOrigins(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(CORSPlugin(
            allow_origins=['http://example.com', 'http://localhost:3000'],
            allow_credentials=True
        ))

        @self.app.route('/api/data')
        def data():
            return 'ok'

    def test_allowed_origin(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://example.com'})
        self.assertEqual('http://example.com', result['header'].get('Access-Control-Allow-Origin'))

    def test_allowed_origin_second(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://localhost:3000'})
        self.assertEqual('http://localhost:3000', result['header'].get('Access-Control-Allow-Origin'))

    def test_disallowed_origin(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://evil.com'})
        self.assertNotIn('Access-Control-Allow-Origin', result['header'])

    def test_credentials_header(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://example.com'})
        self.assertEqual('true', result['header'].get('Access-Control-Allow-Credentials'))

    def test_credentials_not_with_wildcard_origin(self):
        """When credentials enabled, should echo origin, not '*'."""
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://example.com'})
        self.assertNotEqual('*', result['header'].get('Access-Control-Allow-Origin'))


class TestCORSPreflight(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(CORSPlugin(
            allow_origins=['http://example.com'],
            allow_methods=['GET', 'POST', 'PUT'],
            allow_headers=['Content-Type', 'X-Custom'],
            max_age=3600
        ))

        @self.app.route('/api/data', method=['GET', 'POST'])
        def data():
            return 'ok'

    def test_preflight_returns_204(self):
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://example.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'POST'
        })
        self.assertEqual(204, result['code'])

    def test_preflight_allow_methods(self):
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://example.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'POST'
        })
        methods = result['header'].get('Access-Control-Allow-Methods', '')
        for m in ['GET', 'POST', 'PUT']:
            self.assertIn(m, methods)

    def test_preflight_allow_headers(self):
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://example.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'POST'
        })
        headers = result['header'].get('Access-Control-Allow-Headers', '')
        self.assertIn('Content-Type', headers)
        self.assertIn('X-Custom', headers)

    def test_preflight_max_age(self):
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://example.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'POST'
        })
        self.assertEqual('3600', result['header'].get('Access-Control-Max-Age'))

    def test_preflight_disallowed_origin(self):
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://evil.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'POST'
        })
        self.assertNotIn('Access-Control-Allow-Origin', result['header'])

    def test_options_without_acr_method_not_preflight(self):
        """OPTIONS request without Access-Control-Request-Method is not a preflight."""
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://example.com',
        })
        # Should still get CORS headers but not necessarily 204
        self.assertIn(result['code'], [200, 204])


class TestCORSExposeHeaders(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(CORSPlugin(
            allow_origins=['*'],
            expose_headers=['X-Request-Id', 'X-Total-Count']
        ))

        @self.app.route('/api/data')
        def data():
            return 'ok'

    def test_expose_headers(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://any.com'})
        exposed = result['header'].get('Access-Control-Expose-Headers', '')
        self.assertIn('X-Request-Id', exposed)
        self.assertIn('X-Total-Count', exposed)


class TestCORSDefaults(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(CORSPlugin(allow_origins=['http://example.com']))

        @self.app.route('/api/data')
        def data():
            return 'ok'

    def test_no_max_age_by_default(self):
        result = self.urlopen('/api/data', method='OPTIONS', env={
            'HTTP_ORIGIN': 'http://example.com',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'GET'
        })
        self.assertNotIn('Access-Control-Max-Age', result['header'])

    def test_no_credentials_by_default(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://example.com'})
        self.assertNotIn('Access-Control-Allow-Credentials', result['header'])

    def test_no_expose_by_default(self):
        result = self.urlopen('/api/data', env={'HTTP_ORIGIN': 'http://any.com'})
        self.assertNotIn('Access-Control-Expose-Headers', result['header'])


class TestCORSPluginMeta(unittest.TestCase):
    def test_plugin_name(self):
        p = CORSPlugin(allow_origins=['*'])
        self.assertEqual('cors', p.name)

    def test_plugin_api(self):
        p = CORSPlugin(allow_origins=['*'])
        self.assertEqual(2, p.api)


if __name__ == '__main__':
    unittest.main()

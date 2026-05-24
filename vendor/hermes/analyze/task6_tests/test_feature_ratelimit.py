# -*- coding: utf-8 -*-
"""Hidden tests for RateLimitPlugin."""
import sys, os, unittest, time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import bottle
from bottle_plugins import RateLimitPlugin
from tools import ServerTestBase


class TestRateLimitBasic(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(RateLimitPlugin(limit=5, window=60))

        @self.app.route('/api/data')
        def data():
            return 'ok'

    def test_first_request_passes(self):
        result = self.urlopen('/api/data')
        self.assertEqual(200, result['code'])
        self.assertEqual(b'ok', result['body'])

    def test_rate_limit_headers_present(self):
        result = self.urlopen('/api/data')
        self.assertIn('X-Ratelimit-Limit', result['header'])
        self.assertIn('X-Ratelimit-Remaining', result['header'])
        self.assertIn('X-Ratelimit-Reset', result['header'])

    def test_rate_limit_limit_value(self):
        result = self.urlopen('/api/data')
        self.assertEqual('5', result['header']['X-Ratelimit-Limit'])

    def test_rate_limit_remaining_decrements(self):
        r1 = self.urlopen('/api/data')
        self.assertEqual('4', r1['header']['X-Ratelimit-Remaining'])
        r2 = self.urlopen('/api/data')
        self.assertEqual('3', r2['header']['X-Ratelimit-Remaining'])

    def test_rate_limit_exceeded(self):
        for _ in range(5):
            self.urlopen('/api/data')
        result = self.urlopen('/api/data')
        self.assertEqual(429, result['code'])

    def test_rate_limit_exceeded_body(self):
        for _ in range(5):
            self.urlopen('/api/data')
        result = self.urlopen('/api/data')
        self.assertIn(b'Rate limit exceeded', result['body'])

    def test_rate_limit_exceeded_retry_after(self):
        for _ in range(5):
            self.urlopen('/api/data')
        result = self.urlopen('/api/data')
        self.assertIn('Retry-After', result['header'])
        retry = int(result['header']['Retry-After'])
        self.assertGreater(retry, 0)
        self.assertLessEqual(retry, 60)

    def test_rate_limit_remaining_zero_at_limit(self):
        for _ in range(5):
            self.urlopen('/api/data')
        result = self.urlopen('/api/data')
        self.assertEqual('0', result['header']['X-Ratelimit-Remaining'])

    def test_rate_limit_reset_is_timestamp(self):
        result = self.urlopen('/api/data')
        reset = int(result['header']['X-Ratelimit-Reset'])
        now = int(time.time())
        # Reset should be in the future but within the window
        self.assertGreater(reset, now - 1)
        self.assertLessEqual(reset, now + 61)


class TestRateLimitWindow(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(RateLimitPlugin(limit=2, window=1))

        @self.app.route('/api/data')
        def data():
            return 'ok'

    def test_window_reset(self):
        self.urlopen('/api/data')
        self.urlopen('/api/data')
        r = self.urlopen('/api/data')
        self.assertEqual(429, r['code'])
        # Wait for window to expire
        time.sleep(1.1)
        r = self.urlopen('/api/data')
        self.assertEqual(200, r['code'])


class TestRateLimitKeyFunc(ServerTestBase):
    def setUp(self):
        super().setUp()
        # Rate limit per path instead of per IP
        self.app.install(RateLimitPlugin(
            limit=2, window=60,
            key_func=lambda: bottle.request.path
        ))

        @self.app.route('/a')
        def route_a():
            return 'a'

        @self.app.route('/b')
        def route_b():
            return 'b'

    def test_different_paths_separate_limits(self):
        self.urlopen('/a')
        self.urlopen('/a')
        # /a should be limited
        r = self.urlopen('/a')
        self.assertEqual(429, r['code'])
        # /b should still work
        r = self.urlopen('/b')
        self.assertEqual(200, r['code'])


class TestRateLimitMultipleRoutes(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(RateLimitPlugin(limit=3, window=60))

        @self.app.route('/a')
        def route_a():
            return 'a'

        @self.app.route('/b')
        def route_b():
            return 'b'

    def test_shared_limit_across_routes(self):
        """Default key is IP, so all routes share the same limit."""
        self.urlopen('/a')
        self.urlopen('/b')
        self.urlopen('/a')
        # 4th request should be limited
        r = self.urlopen('/b')
        self.assertEqual(429, r['code'])


class TestRateLimitPluginMeta(unittest.TestCase):
    def test_plugin_name(self):
        p = RateLimitPlugin(limit=10, window=60)
        self.assertEqual('ratelimit', p.name)

    def test_plugin_api(self):
        p = RateLimitPlugin(limit=10, window=60)
        self.assertEqual(2, p.api)


if __name__ == '__main__':
    unittest.main()

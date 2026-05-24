# -*- coding: utf-8 -*-
"""Hidden tests for ETagPlugin."""
import sys, os, unittest, hashlib

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import bottle
from bottle_plugins import ETagPlugin
from tools import ServerTestBase


class TestETagBasic(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(ETagPlugin())

        @self.app.route('/hello')
        def hello():
            return 'Hello World'

        @self.app.route('/empty')
        def empty():
            return ''

        @self.app.route('/dict')
        def dict_resp():
            return {'key': 'value'}

    def test_etag_header_present(self):
        result = self.urlopen('/hello')
        self.assertIn('Etag', result['header'])

    def test_etag_format(self):
        result = self.urlopen('/hello')
        etag = result['header']['Etag']
        self.assertTrue(etag.startswith('"') and etag.endswith('"'),
                        "ETag should be quoted")

    def test_etag_value_md5(self):
        result = self.urlopen('/hello')
        etag = result['header']['Etag']
        expected = '"' + hashlib.md5(b'Hello World').hexdigest() + '"'
        self.assertEqual(expected, etag)

    def test_etag_empty_body_no_etag(self):
        result = self.urlopen('/empty')
        self.assertNotIn('Etag', result['header'])

    def test_normal_response_200(self):
        result = self.urlopen('/hello')
        self.assertEqual(200, result['code'])
        self.assertEqual(b'Hello World', result['body'])


class TestETagConditional(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(ETagPlugin())

        @self.app.route('/page')
        def page():
            return 'static content'

    def test_304_when_etag_matches(self):
        etag = '"' + hashlib.md5(b'static content').hexdigest() + '"'
        result = self.urlopen('/page', env={'HTTP_IF_NONE_MATCH': etag})
        self.assertEqual(304, result['code'])

    def test_304_empty_body(self):
        etag = '"' + hashlib.md5(b'static content').hexdigest() + '"'
        result = self.urlopen('/page', env={'HTTP_IF_NONE_MATCH': etag})
        self.assertEqual(b'', result['body'])

    def test_200_when_etag_no_match(self):
        result = self.urlopen('/page', env={'HTTP_IF_NONE_MATCH': '"wrong_etag"'})
        self.assertEqual(200, result['code'])
        self.assertEqual(b'static content', result['body'])

    def test_multiple_etags_in_if_none_match(self):
        etag = '"' + hashlib.md5(b'static content').hexdigest() + '"'
        header_val = '"aaa", ' + etag + ', "bbb"'
        result = self.urlopen('/page', env={'HTTP_IF_NONE_MATCH': header_val})
        self.assertEqual(304, result['code'])

    def test_star_matches_any(self):
        result = self.urlopen('/page', env={'HTTP_IF_NONE_MATCH': '*'})
        self.assertEqual(304, result['code'])


class TestETagHashFunc(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(ETagPlugin(hash_func='sha256'))

        @self.app.route('/hello')
        def hello():
            return 'Hello World'

    def test_sha256_etag(self):
        result = self.urlopen('/hello')
        etag = result['header']['Etag']
        expected = '"' + hashlib.sha256(b'Hello World').hexdigest() + '"'
        self.assertEqual(expected, etag)


class TestETagMethodFilter(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(ETagPlugin())

        @self.app.route('/data', method=['GET', 'POST'])
        def data():
            return 'response'

    def test_get_has_etag(self):
        result = self.urlopen('/data', method='GET')
        self.assertIn('Etag', result['header'])

    def test_post_no_etag(self):
        result = self.urlopen('/data', method='POST', post='body')
        self.assertNotIn('Etag', result['header'])


class TestETagStatusFilter(ServerTestBase):
    def setUp(self):
        super().setUp()
        self.app.install(ETagPlugin())

        @self.app.route('/notfound')
        def notfound():
            bottle.response.status = 404
            return 'not found'

        @self.app.route('/redirect')
        def redirect():
            bottle.response.status = 301
            bottle.response.set_header('Location', '/other')
            return ''

    def test_404_no_etag(self):
        result = self.urlopen('/notfound')
        self.assertNotIn('Etag', result['header'])

    def test_301_no_etag(self):
        result = self.urlopen('/redirect')
        self.assertNotIn('Etag', result['header'])


class TestETagPluginMeta(unittest.TestCase):
    def test_plugin_name(self):
        p = ETagPlugin()
        self.assertEqual('etag', p.name)

    def test_plugin_api(self):
        p = ETagPlugin()
        self.assertEqual(2, p.api)


if __name__ == '__main__':
    unittest.main()

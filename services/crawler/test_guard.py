"""Run: python -m unittest test_guard   (no network needed: public names are resolved through a stub)."""

import unittest
from unittest import mock

import guard


def fake_resolve(table):
    def resolve(host):
        if host not in table:
            raise guard.BlockedAddress(f"{host} could not be found")
        return tuple(table[host])
    return resolve


class GuardTest(unittest.TestCase):
    def setUp(self):
        guard._resolve.cache_clear()
        self.p = mock.patch.object(guard, "_resolve", fake_resolve({
            "example.com": ["93.184.215.14"],
            "rebind.example": ["93.184.215.14", "10.0.0.7"],
            "internal.example": ["192.168.1.20"],
            "v6.example": ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"],
            "mapped.example": ["::ffff:127.0.0.1"],
        }))
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_public_sites_pass(self):
        self.assertEqual(guard.check_url("https://example.com/about"), "example.com")
        self.assertEqual(guard.check_url("http://example.com:80/"), "example.com")
        self.assertEqual(guard.check_url("https://v6.example/"), "v6.example")

    def test_private_and_special_addresses_are_refused(self):
        for url in [
            "http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/",
            "http://0.0.0.0/", "http://localhost:4000/", "http://api.internal/", "https://internal.example/",
            "https://mapped.example/", "http://100.64.0.1/", "http://192.168.0.1/",
        ]:
            with self.subTest(url=url), self.assertRaises(guard.BlockedAddress):
                guard.check_url(url)

    def test_one_private_record_is_enough_to_refuse(self):
        with self.assertRaises(guard.BlockedAddress):
            guard.check_url("https://rebind.example/")

    def test_only_web_schemes_ports_and_no_credentials(self):
        for url in ["ftp://example.com/", "file:///etc/passwd", "https://example.com:8443/", "https://user:pw@example.com/", "javascript:alert(1)"]:
            with self.subTest(url=url), self.assertRaises(guard.BlockedAddress):
                guard.check_url(url)

    def test_browser_filter(self):
        self.assertTrue(guard.is_allowed("data:image/png;base64,AAAA"))
        self.assertTrue(guard.is_allowed("https://example.com/app.js"))
        self.assertFalse(guard.is_allowed("http://169.254.169.254/"))
        self.assertFalse(guard.is_allowed("https://unknown.example/"))

    def test_private_networks_only_when_explicitly_allowed_for_tests(self):
        self.assertEqual(guard.check_url("http://127.0.0.1:8765/", allow_private=True), "127.0.0.1")


if __name__ == "__main__":
    unittest.main()

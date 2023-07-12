# Execute (from ~/blackouts directory): env/bin/python -m unittest tests.utils
import unittest
import sys

sys.path.append('.')

import blackouts as tgt

class TestFunctions(unittest.TestCase):
    def test_validate_email(self):
        self.assertTrue(tgt.validate_email('admin@homserv.net'))
        self.assertTrue(tgt.validate_email('Man.a%ge-+r_1@L-ocalhost.example.com'))
        self.assertRaises(ValueError, tgt.validate_email, 'ne')
        self.assertRaises(ValueError, tgt.validate_email, '@')
        self.assertRaises(ValueError, tgt.validate_email, 'ne@')
        self.assertRaises(ValueError, tgt.validate_email, '@ne')
        self.assertRaises(ValueError, tgt.validate_email, '/@bad')
        self.assertRaises(ValueError, tgt.validate_email, ' admin@homserv.net')
    
    def test_random_str(self):
        rss = []
        for n in range(15000):
            rs = tgt.random_str()
            self.assertTrue(rs.islower())
            self.assertEqual(len(rs), 20)
            self.assertNotIn(rs, rss)
            rss.append(rs)

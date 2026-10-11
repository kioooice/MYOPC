import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('briefs', Path(__file__).with_name('server.py'))
briefs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(briefs)


class ResearchContracts(unittest.TestCase):
    def evidence(self):
        return [{'tool': 'web_read', 'result': {'url': u, 'resolved_url': u, 'text': '实际来源内容' * 80}}
                for u in ('https://example.org/a', 'https://example.org/b')]

    def report(self):
        return {'markdown': '[原始来源甲](https://example.org/a)\n[原始来源乙](https://example.org/b)',
                'items': [{'title': '新发布', 'section': 'yesterday', 'publication_date': '2026-10-10', 'event_date': '2026-10-10'}]}

    def test_search_snippets_cannot_satisfy_source_gate(self):
        with self.assertRaises(ValueError):
            briefs.validate_report(self.report(), [{'tool': 'web_search', 'result': {}}], 'frontier', '2026-10-11')

    def test_actual_reads_and_yesterday_pass(self):
        self.assertEqual(briefs.validate_report(self.report(), self.evidence(), 'frontier', '2026-10-11'), [])

    def test_old_news_cannot_get_clean_daily_status(self):
        r = self.report()
        r['items'][0]['publication_date'] = r['items'][0]['event_date'] = '2026-10-08'
        warnings = briefs.validate_report(r, self.evidence(), 'frontier', '2026-10-11')
        self.assertTrue(any('日期核验不足' in s for s in warnings))
        self.assertTrue(any('不能按完整日报' in s for s in warnings))

    def test_unread_links_are_marked(self):
        r = self.report()
        r['markdown'] += '\n[未读取](https://example.org/c)'
        self.assertTrue(briefs.validate_report(r, self.evidence(), 'creative', '2026-10-11'))

    def test_one_real_source_is_kept_with_quantity_limit(self):
        r = self.report()
        r['markdown'] = '[实际来源](https://example.org/a)'
        self.assertTrue(briefs.validate_report(r, self.evidence()[:1], 'creative', '2026-10-11'))

    def test_readme_can_be_cited_at_equivalent_repository(self):
        r = self.report()
        r['markdown'] = '[项目](https://github.com/example/project)\n[原文](https://example.org/b)'
        e = self.evidence()
        e[0]['result']['url'] = e[0]['result']['resolved_url'] = 'https://raw.githubusercontent.com/example/project/main/README.md'
        self.assertEqual(briefs.validate_report(r, e, 'creative', '2026-10-11'), [])

    def test_missing_item_evidence_is_rejected(self):
        r = self.report()
        r['items'] = []
        with self.assertRaises(ValueError):
            briefs.validate_report(r, self.evidence(), 'experience', '2026-10-11')

    def test_private_and_credentialed_targets_are_denied(self):
        with patch.object(briefs.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 80))]):
            with self.assertRaises(ValueError):
                briefs.public_url('http://example.org/')
        for url in ['file:///etc/passwd', 'http://user:secret@example.org', 'https://example.org:18789']:
            with self.assertRaises(ValueError):
                briefs.public_url(url)

    def test_redirect_to_private_target_is_denied(self):
        with patch.object(briefs.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('169.254.169.254', 80))]):
            with self.assertRaises(ValueError):
                briefs.PublicRedirect().redirect_request(None, None, 302, '', {}, 'http://169.254.169.254/')

    def test_page_read_does_not_claim_video_watching(self):
        with patch.object(briefs, 'fetch', return_value=('<title>创作者原文</title><meta property="article:published_time" content="2026-10-10"><p>实际故事段落</p><script>secret()</script>', 'https://example.org/a', 'text/html')):
            r = briefs.read_page('https://example.org/a')
        self.assertFalse(r['video_watched'])
        self.assertNotIn('secret()', r['text'])
        self.assertEqual(r['metadata']['article:published_time'], '2026-10-10')

    def test_old_release_is_structurally_removed_from_yesterday(self):
        r={'items':[{'title':'旧发布','section':'yesterday','publication_date':'2026-10-09','event_date':'2026-10-08','body':'原始内容','verification':'事实'}], 'highlights':[], 'warnings':[]}
        r=briefs.organize_report(r,'frontier','2026-10-11')
        self.assertNotIn('## 昨日新进展',r['markdown'])
        self.assertEqual(r['items'][0]['section'],'supplement')

    def test_creative_has_no_yesterday_constraint_and_title_leads_do_not_count(self):
        r={'items':[{'title':'旧故事原文','section':'creative','publication_date':'2020-01-01','event_date':'unknown','source_urls':['https://example.org/story'],'body':'真实故事','verification':'事实'}, {'title':'榜单标题','section':'creative','source_urls':['https://tophub.today/list'],'body':'只有标题','verification':'事实'}], 'highlights':[]}
        r=briefs.organize_report(r,'creative','2026-10-11')
        self.assertIn('素材 1 条',r['headline'])
        self.assertEqual(r['items'][1]['section'],'supplement')


if __name__ == '__main__':
    unittest.main()

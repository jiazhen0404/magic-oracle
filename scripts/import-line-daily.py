"""
LINE 今日訊息籤：把校稿 docx 轉成 src/line-daily-fortunes.json 與 src/line-daily-seed.sql
用法：python3 scripts/import-line-daily.py 路徑/LINE_Bot_今日訊息籤_100支完整版.docx
只做「搬運」，不改寫任何一個字。
"""
import json, re, sys
from docx import Document

src = sys.argv[1]
paras = [p.text.strip() for p in Document(src).paragraphs]
paras = [p for p in paras if p]

HEAD = re.compile(r'^(\d{3})｜(.+)$')
META = re.compile(r'^內部分類：([a-z_]+)\s*｜\s*權重：([0-9.]+)\s*｜\s*啟用：(true|false)$')
REM = re.compile(r'^今日提醒｜(.+)$')

out, cur = [], None
for p in paras:
    m = HEAD.match(p)
    if m:
        cur = {'fortune_id': m.group(1), 'title': m.group(2).strip(), 'content': [], 'reminder': None}
        continue
    if cur is None:
        continue
    m = REM.match(p)
    if m:
        cur['reminder'] = m.group(1).strip(); continue
    m = META.match(p)
    if m:
        cur.update(category=m.group(1), weight=float(m.group(2)), is_active=m.group(3) == 'true')
        cur['content'] = '\n'.join(cur['content'])
        out.append(cur); cur = None; continue
    cur['content'].append(p)

ids = [f['fortune_id'] for f in out]
assert ids == [f'{i:03d}' for i in range(1, 101)], ('編號不完整', ids)
for f in out:
    assert f['title'] and f['content'] and f['reminder'], f['fortune_id']
    assert 0 < f['weight'] <= 1, f['fortune_id']

json.dump(out, open('src/line-daily-fortunes.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

q = lambda s: "'" + s.replace("'", "''") + "'"
lines = ['-- LINE 今日訊息籤 100 支（由 scripts/import-line-daily.py 產生，不要手改）',
         '-- 重複執行安全：已存在的 fortune_id 不會被覆蓋（後台改過的內容與權重會保留）', '']
for f in out:
    lines.append('INSERT OR IGNORE INTO line_daily_fortunes (fortune_id,title,content,reminder,category,weight,is_active) VALUES ('
                 + ','.join([q(f['fortune_id']), q(f['title']), q(f['content']), q(f['reminder']),
                             q(f['category']), str(f['weight']), '1' if f['is_active'] else '0']) + ');')
open('src/line-daily-seed.sql', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print('OK', len(out), '支')

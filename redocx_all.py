# -*- coding: utf-8 -*-
"""U 盘 .md 全部改完后，强制覆盖重转所有 .docx（不跳过已有文件）。"""
import os, sys, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import md2docx
ROOT = r'E:/分层试卷'
files = []
for dp, dn, fns in os.walk(ROOT):
    for fn in sorted(fns):
        if fn.endswith('.md'):
            files.append(os.path.join(dp, fn))
print('TOTAL', len(files), flush=True)
bad = []
for i, p in enumerate(files, 1):
    out = p[:-3] + '.docx'
    try:
        md2docx.convert(p, out)
    except Exception as e:
        bad.append((p, repr(e)))
        print('FAIL', p, repr(e), flush=True)
    if i % 40 == 0:
        print('PROGRESS', i, flush=True)
print('DONE', len(files), 'BAD', len(bad), flush=True)

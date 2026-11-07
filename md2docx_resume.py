# -*- coding: utf-8 -*-
"""断点续跑：只转换还没有 .docx 的 .md，结果写日志文件（不依赖 stdout）。"""
import os, sys, io, traceback, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import md2docx
from docx import Document

ROOT = r'E:\分层试卷'
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'md2docx.log')


def log(msg):
    with io.open(LOG, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')


def main():
    mds = []
    for dp, dn, fns in os.walk(ROOT):
        for fn in fns:
            if fn.endswith('.md'):
                mds.append(os.path.join(dp, fn))
    mds.sort()
    todo = [p for p in mds if not os.path.exists(p[:-3] + '.docx')]
    log('=== resume %s | total=%d todo=%d ===' % (time.strftime('%H:%M:%S'), len(mds), len(todo)))
    ok, fail = 0, []
    for p in todo:
        out = p[:-3] + '.docx'
        try:
            md2docx.convert(p, out)
            ok += 1
        except Exception as e:
            fail.append((p, repr(e)))
            log('FAIL ' + p + ' ' + repr(e))
        if (ok + len(fail)) % 20 == 0:
            log('  progress %d/%d' % (ok + len(fail), len(todo)))
    log('DONE ok=%d fail=%d' % (ok, len(fail)))
    return len(fail)


if __name__ == '__main__':
    sys.exit(1 if main() else 0)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
종목 페이지(/stock/*.html) 39개를 검색엔진 색인에서 임시로 제외하는 스크립트.
(2026-07-13, Claude가 리포 사본에서 미리 실행해서 39/39 성공 확인함)

하는 일:
1. stock/*.html 39개 파일의 <meta name="robots" content="index, follow">를
   <meta name="robots" content="noindex, follow">로 변경 (검색엔진이 이 페이지를
   크롤링은 하되 색인에는 안 넣도록 함)
2. sitemap.xml에서 /stock/ 경로가 포함된 39개 URL 라인을 제거

실행 방법 — 리포 루트에서:
    python3 apply_stock_noindex.py

**애드센스 승인 이후 이 조치를 되돌리려면** (나중에 콘텐츠 보강한 뒤):
- stock/*.html의 "noindex, follow"를 다시 "index, follow"로 되돌리고
- scripts/generate-stock-pages.js를 다시 실행하거나 sitemap.xml에 stock URL 39개를 다시 추가
"""

import glob
import sys


def main():
    # 1. noindex 처리
    files = sorted(glob.glob('stock/*.html'))
    if not files:
        print('[ERROR] stock/*.html 파일을 찾을 수 없습니다. 리포 루트에서 실행했는지 확인하세요.')
        sys.exit(1)

    old_meta = '<meta name="robots" content="index, follow">'
    new_meta = '<meta name="robots" content="noindex, follow">'
    ok, fail = 0, 0
    for fp in files:
        with open(fp, 'r', encoding='utf-8') as f:
            content = f.read()
        count = content.count(old_meta)
        if count != 1:
            print(f'[ERROR] {fp}: 예상 문자열이 {count}번 발견됨 (기대값 1). 건드리지 않고 건너뜀.')
            fail += 1
            continue
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content.replace(old_meta, new_meta))
        ok += 1

    print(f'[noindex 처리] 성공: {ok} / 실패: {fail} (전체 {len(files)}개 파일)')

    # 2. sitemap.xml에서 stock URL 제거
    try:
        with open('sitemap.xml', 'r', encoding='utf-8') as f:
            sitemap_lines = f.read().split('\n')
    except FileNotFoundError:
        print('[ERROR] sitemap.xml을 찾을 수 없습니다.')
        sys.exit(1)

    before_count = len(sitemap_lines)
    kept_lines = [line for line in sitemap_lines if '/stock/' not in line]
    removed_count = before_count - len(kept_lines)

    with open('sitemap.xml', 'w', encoding='utf-8') as f:
        f.write('\n'.join(kept_lines))

    print(f'[sitemap.xml 정리] 제거된 URL 줄 수: {removed_count} (기대값 39)')

    print('')
    if ok == 39 and fail == 0 and removed_count == 39:
        print('=== 전체 성공 ===')
        sys.exit(0)
    else:
        print('=== 일부 실패 있음, 위 로그를 그대로 보고할 것 ===')
        sys.exit(1)


if __name__ == "__main__":
    main()

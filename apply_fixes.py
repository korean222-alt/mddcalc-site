#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mddcalc-site 유사투자자문업 리스크 문구 일괄 수정 스크립트
(2026-07-13, Claude가 실제 리포 사본에 미리 돌려서 127건 전부 성공 확인함)

실행 방법 — 리포 루트(mddcalc-site 폴더 안)에서:
    python3 apply_fixes.py

이 스크립트는 사람이 수동으로 찾아 바꾸는 게 아니라, 각 문자열이 정확히
"기대한 횟수"만큼 존재하는지 먼저 확인한 뒤에만 치환합니다.
기대한 횟수와 다르면 그 항목은 건드리지 않고 ERROR로만 표시하고 계속
진행합니다 (한 곳이 안 맞다고 전체가 멈추지 않게).

**절대 이 파일 내용을 손으로 다시 타이핑하거나 요약해서 실행하지 마세요.
파일 그대로 저장해서 그대로 실행만 하세요.**

실행 후 반드시:
1) 아래 "성공/실패" 요약 전체를 그대로 복사해서 보고할 것
2) 그 다음 node scripts/generate-blog-pages.js 를 실행할 것 (아래 안내 참고)
"""

import sys

FIXES = [
    {
        "id": "1. index.html 가벼운 조정 문구",
        "files": ["index.html"],
        "find": '<div class="note">가벼운 조정 · 분할매수 시작</div>',
        "replace": '<div class="note">가벼운 조정 구간</div>',
        "expected": 1,
    },
    {
        "id": "2-1. 블로그#21 도입부",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html", "blog/21.html",
        ],
        "find": '<p>주식을 살 때 하나의 지표만 보면 실패할 수 있습니다. <strong>5가지 지표를 종합적으로 확인</strong>하면 더 안전한 매수가 가능합니다.</p>',
        "replace": '<p>주식을 살 때 하나의 지표만 보면 판단이 한쪽으로 치우칠 수 있습니다. <strong>아래 5가지 지표를 함께 살펴보면</strong> 시장 상황을 여러 각도에서 파악하는 데 도움이 될 수 있습니다.</p>',
        "expected": 1,
    },
    {
        "id": "2-2. 블로그#21 하이라이트박스",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html", "blog/21.html",
        ],
        "find": '<div class="highlight-box"><p>🎯 5가지 지표 중 3개 이상이 매수 신호를 보낼 때 종합적으로 판단하는 것이 권장됩니다.</p></div>',
        "replace": '<div class="highlight-box"><p>🎯 실전에서는 5가지 지표를 하나씩 보기보다 함께 놓고 비교해보는 경우가 많습니다.</p></div>',
        "expected": 1,
    },
    {
        "id": "3-1. tools.html MDD카드 설명",
        "files": ["tools.html"],
        "find": '<p>고점 대비 하락률(Maximum Drawdown)을 계산하여 하락 및 회복 패턴을 찾아보세요. 회복률 분석과 매수 신호 제공.</p>',
        "replace": '<p>고점 대비 하락률(Maximum Drawdown)을 계산하여 하락 및 회복 패턴을 찾아보세요. 회복률 분석과 데이터 기반 지표 제공.</p>',
        "expected": 1,
    },
    {
        "id": "3-2. tools.html RSI카드 설명",
        "files": ["tools.html"],
        "find": '<p>상대강도지수(RSI)로 과매수/과매도 구간을 파악하세요. RSI 30 이하는 매수 기회, 70 이상은 매도 신호.</p>',
        "replace": '<p>상대강도지수(RSI)로 과매수/과매도 구간을 파악하세요. 통상 RSI 30 이하는 과매도, 70 이상은 과매수 구간으로 해석됩니다.</p>',
        "expected": 1,
    },
    {
        "id": "4. 블로그#1 하락및회복패턴최적화",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html", "blog/1.html",
        ],
        "find": '<li><strong>하락 및 회복 패턴 최적화</strong>: 역사적으로 큰 MDD를 기록한 구간은 종종 매력적인 매수 기회가 되기도 합니다. MDD 데이터를 통해 저점 근처에서 분할 매수를 고려하는 전략을 세울 수 있습니다.</li>',
        "replace": '<li><strong>하락 및 회복 패턴 파악</strong>: 역사적으로 큰 MDD를 기록한 구간들이 이후 어떤 회복 패턴을 보였는지 데이터로 확인할 수 있습니다. 이러한 과거 패턴은 개인의 투자 판단에 참고 자료가 될 수 있습니다.</li>',
        "expected": 1,
    },
    {
        "id": "5-1. 블로그#3 도입부",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html", "blog/3.html",
        ],
        "find": '<p>주식 시장에서 "싸게 사서 비싸게 팔라"는 격언은 누구나 알지만, 실제로 하락장에서 용기 있게 매수하기란 쉽지 않습니다. 특히 고점 대비 큰 폭의 하락은 투자자에게 심리적 압박감을 주어 매수를 주저하게 만듭니다. 하지만 역사적 데이터를 분석해보면, 고점 대비 -30% 이하의 하락은 종종 장기적인 관점에서 매력적인 매수 기회를 제공했음을 알 수 있습니다. 이 글에서는 S&P 500의 과거 데이터를 통해 -30% 하락 시 하락 대응 패턴의 유효성을 검증하고, 효과적인 분할 하락 대응 패턴을 제시합니다.</p>',
        "replace": '<p>주식 시장에서 "싸게 사서 비싸게 팔라"는 격언은 누구나 알지만, 실제로 하락장에서는 심리적으로 위축되기 쉽습니다. 고점 대비 큰 폭의 하락은 투자자에게 상당한 심리적 압박감을 주기도 합니다. 이 글에서는 S&P 500의 과거 데이터를 통해 고점 대비 -30% 이하 하락 이후 시장이 실제로 어떻게 움직였는지 살펴봅니다.</p>',
        "expected": 1,
    },
    {
        "id": "5-2. 블로그#3 마무리문단",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html",
        ],
        "find": '<p>이러한 역사적 데이터를 통해 투자자는 자신의 리스크 허용 범위와 투자 기간을 고려하여 적절한 자산 배분 전략을 수립할 수 있습니다. 시장의 하락은 고통스럽지만, 장기적인 관점에서 보면 매수 기회가 될 수 있습니다. MDD 분석기는 이러한 과거 데이터를 객관적으로 제시함으로써, 투자자가 감정적인 판단을 피하고 데이터에 기반한 합리적인 투자 결정을 내릴 수 있도록 돕는 강력한 도구입니다.</p>',
        "replace": '<p>이러한 역사적 데이터는 투자자가 자신의 리스크 허용 범위와 투자 기간을 고려해 판단하는 데 참고 자료가 될 수 있습니다. MDD 분석기는 이러한 과거 데이터를 객관적으로 보여줌으로써, 투자자가 감정적인 판단보다 데이터를 참고해 스스로 결정을 내릴 수 있도록 돕는 도구입니다.</p>',
        "expected": 1,
    },
    {
        "id": "6. 블로그#17 분할매수기회포착",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html",
        ],
        "find": '<li><strong>분할 매수 기회 포착</strong>: 시장이 크게 하락하여 MDD가 깊어질 때를 오히려 저가 매수의 기회로 삼을 수 있습니다. 미리 정해둔 MDD 수준에 따라 분할 매수 계획을 세워 실행한다면, 평균 매수 단가를 낮추고 장기적인 수익률을 극대화할 수 있습니다.</li>',
        "replace": '<li><strong>MDD 수준별 분할매수 계획 참고</strong>: 시장이 크게 하락하여 MDD가 깊어지는 구간을 분할매수 계획의 참고 지점으로 활용하는 투자자들도 있습니다. 미리 정해둔 MDD 수준별로 매수 단가가 어떻게 달라지는지는 아래 계산기로 직접 확인해볼 수 있습니다.</li>',
        "expected": 1,
    },
    {
        "id": "7-1. 블로그#22 회복기",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html",
        ],
        "find": '<li><strong>회복기 (Expansion)</strong>: 경기가 바닥을 찍고 회복하기 시작하는 단계입니다. 기업 실적이 개선되고 투자 심리가 살아나면서 주식 시장은 상승세를 보입니다. 이 시기에는 과거의 깊은 MDD가 점차 줄어들고, 새로운 상승 추세가 시작됩니다. 따라서 MDD가 하락하는 초기에 매수 기회를 포착하는 것이 중요합니다.</li>',
        "replace": '<li><strong>회복기 (Expansion)</strong>: 경기가 바닥을 찍고 회복하기 시작하는 단계입니다. 기업 실적이 개선되고 투자 심리가 살아나면서 주식 시장은 상승세를 보입니다. 이 시기에는 과거의 깊은 MDD가 점차 줄어들고, 새로운 상승 추세가 시작됩니다. 경기 사이클상 회복기는 통상 MDD가 하락하기 시작하는 초기 국면으로 분류됩니다.</li>',
        "expected": 1,
    },
    {
        "id": "7-2. 블로그#22 침체기",
        "files": [
            "index.html", "about.html", "blog.html", "compound-calculator.html",
            "contact.html", "dca-planner.html", "disclaimer.html",
            "dividend-calculator.html", "fx-calculator.html",
            "leverage-etf-simulator.html", "privacy.html", "roi-calculator.html",
            "rsi-calculator.html", "terms.html", "tools.html",
        ],
        "find": '<li><strong>침체기 (Trough)</strong>: 경기가 바닥을 찍고 가장 어려운 시기입니다. 기업 실적은 최악을 기록하고 투자 심리는 극도로 위축됩니다. 주식 시장은 저점을 형성하며, MDD는 최대 수준에 도달합니다. 하지만 역설적으로 이 시기는 장기 투자자에게는 가장 큰 매수 기회가 될 수 있습니다.</li>',
        "replace": '<li><strong>침체기 (Trough)</strong>: 경기가 바닥을 찍고 가장 어려운 시기입니다. 기업 실적은 최악을 기록하고 투자 심리는 극도로 위축됩니다. 주식 시장은 저점을 형성하며, MDD는 최대 수준에 도달합니다. MDD 지표상으로는 이 시기가 하락폭이 가장 큰 국면에 해당합니다.</li>',
        "expected": 1,
    },
]


def main():
    total_ok = 0
    total_error = 0
    errors = []

    for fix in FIXES:
        for relpath in fix["files"]:
            try:
                with open(relpath, "r", encoding="utf-8") as f:
                    content = f.read()
            except FileNotFoundError:
                msg = f'[ERROR] {fix["id"]} — 파일 없음: {relpath}'
                print(msg)
                errors.append(msg)
                total_error += 1
                continue

            count = content.count(fix["find"])

            if count != fix["expected"]:
                msg = (f'[ERROR] {fix["id"]} — {relpath}: 찾기 문자열이 '
                       f'{count}번 발견됨 (기대값 {fix["expected"]}번). '
                       f'건드리지 않고 건너뜀.')
                print(msg)
                errors.append(msg)
                total_error += 1
                continue

            new_content = content.replace(fix["find"], fix["replace"])
            with open(relpath, "w", encoding="utf-8") as f:
                f.write(new_content)

            print(f'[OK] {fix["id"]} — {relpath}: 수정 완료')
            total_ok += 1

    print("")
    print("=" * 60)
    print(f"성공: {total_ok}건 / 실패: {total_error}건")
    if errors:
        print("")
        print("실패 목록:")
        for e in errors:
            print("  -", e)
    print("=" * 60)

    if total_error > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()

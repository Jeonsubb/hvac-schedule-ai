"""Regenerate every number quoted in the docs from the running API (single source of truth).

    python3 scripts/gen_numbers.py [--api https://d32ggz3cj7s7bx.cloudfront.net]

Writes docs/numbers.md and replaces the blocks between
<!-- numbers:NAME:start --> and <!-- numbers:NAME:end --> in README.md and docs/evaluation.md.
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = {"fixed": "고정 스케줄", "manual": "수동 운영", "rule": "규칙 기반", "ai": "AI 예측 제어"}


def get(api: str, path: str):
    with urllib.request.urlopen(urllib.request.Request(api + path, headers={"User-Agent": "gen-numbers"}), timeout=120) as r:
        return json.loads(r.read())


def pct(a: float, b: float) -> str:
    return f"{100 * (1 - a / b):.1f}%"


def strategy_table(t: dict) -> str:
    rows = ["| 전략 | 전력량 | 전기요금 | 쾌적 시간 | 불쾌 지표(K·분) | 최대 피크 |", "|---|---|---|---|---|---|"]
    for k in ("fixed", "manual", "rule", "ai"):
        v = t[k]
        name = f"**{NAMES[k]}**" if k == "ai" else NAMES[k]
        rows.append(f"| {name} | {v['kwh']:,.0f} kWh | {v['cost_krw']:,.0f}원 | {v['comfort_pct']:.2f}% | "
                    f"{v['discomfort_dm']:,.0f} | {v['peak_kw']:.1f} kW |")
    return "\n".join(rows)


def render(api: str) -> dict[str, str]:
    sm = get(api, "/api/summary")
    at = get(api, "/api/attribution")
    cons = get(api, "/api/consolidation")
    meta = get(api, "/api/meta")
    al, td = sm["totals"]["all"], sm["totals"]["to_date"]
    va, wf = at["all"]["variants"], at["all"]["waterfall"]
    ai, rule, fixed, manual, rule30 = al["ai"], al["rule"], al["fixed"], al["manual"], va["rule30"]

    headline = (
        f"- 학기 전체(9/1~12/18): AI 예측 제어는 고정 스케줄 대비 **{pct(ai['kwh'], fixed['kwh'])} 절감**, "
        f"수동 운영 대비 {pct(ai['kwh'], manual['kwh'])}, 규칙 기반 대비 {pct(ai['kwh'], rule['kwh'])} 절감합니다. "
        f"전기요금은 {fixed['cost_krw']:,.0f}원 → {ai['cost_krw']:,.0f}원, CO₂는 {fixed['co2_kg'] - ai['co2_kg']:,.0f} kg 줄어듭니다.\n"
        f"- 오늘({sm['today']})까지: 고정 대비 {pct(td['ai']['kwh'], td['fixed']['kwh'])}, "
        f"규칙 기반 대비 {pct(td['ai']['kwh'], td['rule']['kwh'])} 절감.\n"
        f"- **같은 쾌적도 기준**: 규칙 기반이 AI의 쾌적도에 다가가려면 30분 전에 켜야 하고 {rule30['kwh']:,.0f} kWh를 씁니다"
        f"(수업 시작 시 저온 {rule30['cold_starts']}회). AI는 {va['ai']['kwh']:,.0f} kWh로 **{pct(va['ai']['kwh'], rule30['kwh'])} 적게** 쓰고 "
        f"저온 시작은 {va['ai']['cold_starts']}회입니다. 10분 전 규칙은 저온 시작이 {va['rule']['cold_starts']}회입니다."
    )
    water = ["| 단계 | 전력량 | 변화 | 수업 시작 시 저온 | 쾌적 시간 |", "|---|---|---|---|---|"]
    for w in wf:
        d = "" if w["delta_kwh"] is None else f"{w['delta_kwh']:+,.1f}"
        water.append(f"| {w['label']} | {w['kwh']:,.0f} kWh | {d} | {w['cold_starts']}회 | {w['comfort_pct']:.2f}% |")
    water.append(f"| (참고) 규칙 기반 30분 전 | {rule30['kwh']:,.0f} kWh | | {rule30['cold_starts']}회 | {rule30['comfort_pct']:.2f}% |")
    water.append(f"| (참고) 규칙 기반 + 재실 감지 | {va['rule_vacancy']['kwh']:,.0f} kWh | | "
                 f"{va['rule_vacancy']['cold_starts']}회 | {va['rule_vacancy']['comfort_pct']:.2f}% |")
    cons_lines = [f"- 강의실 재배치 권고(학사 부서 검토용): 학기 전체 {cons['semester_kwh_saving']:,.1f} kWh 절감 예상"]
    for w in cons["weekdays"]:
        if w["moves"]:
            cons_lines.append(f"  - {w['weekday_label']}요일 {len(w['moves'])}건 이동: {w['kwh_saving']:,.1f} kWh "
                              f"({w['saving_pct']}%), 실외기 가동 {w['odu_minutes_before'] / 60:.1f}h → {w['odu_minutes_after'] / 60:.1f}h")
    decisions = ", ".join(f"{k} {v}" for k, v in sm["decisions"].items())
    stamp = f"_{meta['now']['real']} 기준 배포 API에서 자동 생성 (엔진 {get(api, '/api/health')['engine']})._"
    readme = "\n".join([stamp, "", strategy_table(al), "", headline])
    evaluation = "\n".join([stamp, "", "### 전략 비교 (학기 전체)", "", strategy_table(al), "", headline, "",
                            "### 절감 요인 분해와 같은 쾌적도 비교", "", "\n".join(water), "",
                            at.get("note", ""), "", "### 기타", "", "\n".join(cons_lines),
                            f"- AI 판단 횟수(학기): {decisions}"])
    return {"README": readme, "EVAL": evaluation}


def replace_block(path: Path, name: str, body: str) -> None:
    s = path.read_text()
    start, end = f"<!-- numbers:{name}:start -->", f"<!-- numbers:{name}:end -->"
    if start not in s:
        raise SystemExit(f"{path}: missing {start}")
    s = re.sub(re.escape(start) + r".*?" + re.escape(end), start + "\n" + body + "\n" + end, s, flags=re.S)
    path.write_text(s)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://d32ggz3cj7s7bx.cloudfront.net")
    a = ap.parse_args()
    blocks = render(a.api.rstrip("/"))
    (ROOT / "docs" / "numbers.md").write_text("# 발표·문서용 수치\n\n" + blocks["EVAL"] + "\n")
    replace_block(ROOT / "README.md", "README", blocks["README"])
    replace_block(ROOT / "docs" / "evaluation.md", "EVAL", blocks["EVAL"])
    print("updated README.md, docs/evaluation.md, docs/numbers.md")

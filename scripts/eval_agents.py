"""Evaluate the two-agent negotiation (run from backend/: ../.venv… see usage).

1) Outcomes over a period with rule-based agents (sandbox lab): energy, cost, comfort vs current
   operation (22 ℃ fixed), rule-based and AI without agents.
2) LLM agents on sample days, repeated: numeric grounding rate, run-to-run consistency, latency,
   LLM vs rule-based agents.

Usage (from backend/, with a scratch copy of the store so nothing in the dev store changes):
  LOCAL_STORE=/tmp/eval_store AWS_PROFILE=hvac .venv/bin/python ../scripts/eval_agents.py \
      --start 2026-11-02 --days 15 --llm-days 2026-11-23,2026-11-24 --repeats 2 --out ../docs/evaluation_agents.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import evaluation, lab, service  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-11-02")
    ap.add_argument("--days", type=int, default=15)
    ap.add_argument("--llm-days", default="")
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    # 1) period outcomes, in chunks the lab accepts
    ctx = service.Ctx()
    dates = lab.operating_days(date.fromisoformat(a.start), a.days, ctx)
    rows = []
    i = 0
    while i < len(dates):
        chunk = lab.run(dates[i], min(10, len(dates) - i), "rule")
        rows += chunk["days"]
        i += len(chunk["days"])
        if not chunk["days"]:
            break
    tot = {k: {"kwh": round(sum(r["strategies"][k]["kwh"] for r in rows), 1),
               "cost_krw": sum(r["strategies"][k]["cost_krw"] for r in rows),
               "pmv_ok_pct": round(sum(r["strategies"][k]["pmv_ok_pct"] or 0 for r in rows) / len(rows), 1),
               "pmv_mean": round(sum(r["strategies"][k]["pmv_mean"] or 0 for r in rows) / len(rows), 2),
               "discomfort_dm": round(sum(r["strategies"][k]["discomfort_dm"] for r in rows), 1),
               "cold_starts": sum(r["strategies"][k]["cold_starts"] for r in rows)} for k in lab.LABELS}
    comp = [(room, r) for r in rows for room in r["agents"]["complaint_rooms"]]

    def cpmv(k):
        v = [r["strategies"][k]["room_pmv"].get(room) for room, r in comp if r["strategies"][k]["room_pmv"].get(room) is not None]
        return round(sum(v) / len(v), 2) if v else None

    period = {"dates": [r["date"] for r in rows], "totals": tot,
              "agreement_pct": round(100.0 * sum(r["agents"]["agreed"] for r in rows) / len(rows), 1),
              "policy_pct": round(100.0 * sum(r["agents"]["in_policy"] for r in rows) / len(rows), 1),
              "complaint_room_days": len(comp), "complaint_room_pmv": {k: cpmv(k) for k in lab.LABELS}}

    # regret of the (rule-based) negotiation vs the arbiter's full-grid optimum, per day
    ctx2 = service.Ctx()
    ctx2.adjustments = []
    from app import agents as _agents
    regs = []
    for d in [date.fromisoformat(x) for x in period["dates"]]:
        ds = _agents.build_dossier(3, d, ctx2, fb_until=d)
        neg = _agents.negotiate(3, d, use_ai=False, sandbox=True, ctx=ctx2, fb_until=d)
        regs.append({"date": d.isoformat(), **evaluation.regret(neg, ds)})
    period["regret"] = {"days": regs, "regret_won": sum(r["regret_won"] for r in regs),
                        "j_current_plan": sum(r["j_current_plan"] for r in regs), "j_negotiated": sum(r["j_negotiated"] for r in regs),
                        "j_optimum": sum(r["j_optimum"] for r in regs)}
    period["comfort_sweep"] = evaluation.comfort_sweep([date.fromisoformat(x) for x in period["dates"]])

    # 2) LLM agents on sample days
    llm = [evaluation.evaluate_llm_day(date.fromisoformat(x), a.repeats) for x in a.llm_days.split(",") if x.strip()]
    out = {"period": period, "llm": llm, "created_at": service.now_kst().isoformat(timespec="seconds")}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if a.out:
        Path(a.out).write_text(text)
    print(json.dumps({"period": {k: (v if k != "regret" else {kk: vv for kk, vv in v.items() if kk != "days"}) for k, v in period.items() if k != "dates"}, "llm": [
        {k: v for k, v in x.items() if k in ("date", "ai_runs", "seconds", "grounding", "consistency", "llm_vs_rule", "regret")} for x in llm]},
        ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

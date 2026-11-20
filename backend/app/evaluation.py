"""Agent evaluation: grounding of the numbers the LLM agents write, run-to-run consistency, and
energy/comfort outcomes against baselines (via the simulation lab).

Grounding: every number in an agent's message and trace should be quoted from the dossier or a
simulator evaluation shown to the agent (direct_rate). Differences/sums of two given numbers are also
counted (rate), but that check accepts almost any number, so only direct_rate is meaningful; the
null control (the same numbers shifted by 0.37 and 1.13) shows how often a made-up value would still
pass the direct check. Structural numbers (1–3, years, room numbers, times) are skipped.
"""
from __future__ import annotations

import re
from datetime import date

from . import agents, service

NUM = re.compile(r"(?<![\d.])[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.])[-−]?\d+(?:\.\d+)?")


def numbers_in(text: str) -> list[float]:
    out = []
    for m in NUM.finditer(text or ""):
        s = m.group(0).replace(",", "").replace("−", "-")
        try:
            out.append(float(s))
        except ValueError:
            pass
    return out


def _allowed(ds: dict, neg: dict) -> set[float]:
    vals = set(numbers_in(agents.dossier_text(ds)))
    for t in neg["turns"]:
        ev = t.get("eval") or {}
        for k in ("kwh", "cost_krw", "pmv_mean", "discomfort_dm", "cold_starts", "complaints_addressed"):
            if isinstance(ev.get(k), (int, float)):
                vals.add(float(ev[k]))
        for r, v in (ev.get("rooms") or {}).items():
            for k in ("kwh", "pmv"):
                if isinstance(v.get(k), (int, float)):
                    vals.add(float(v[k]))
        for v in (t.get("proposal") or {}).values():
            vals.update(float(x) for x in v.values())
        vals.update((float(len(ev.get("cold_rooms") or [])), float(len(ev.get("hot_rooms") or []))))
    return {round(v, 2) for v in vals}


def _structural(v: float) -> bool:
    return (v.is_integer() and (0 <= v <= 3 or 300 <= v <= 499 or 2020 <= v <= 2030 or v in (7, 14, 24, 30, 60, 100)))


def grounding(neg: dict, ds: dict) -> dict:
    """Share of numbers in LLM turns that trace back to data the agent was given."""
    allowed = _allowed(ds, neg)
    arr = sorted(allowed)
    pairs = None
    checked = grounded = direct = 0
    misses = []
    null_hits = null_n = 0  # control: shifted copies of the same numbers should mostly NOT match
    for t in neg["turns"]:
        if t["agent"] == "arbiter":
            continue
        text = t["message"] + " " + " ".join(f"{x['query']} {x['finding']}" for x in t.get("trace", []))
        for v in numbers_in(text):
            if _structural(abs(v)):
                continue
            checked += 1
            if pairs is None:  # differences and sums of two given numbers (e.g. "2.45 kWh 늘고")
                pairs = {round(abs(a - b), 2) for i, a in enumerate(arr) for b in arr[i + 1:]} | \
                        {round(a + b, 2) for i, a in enumerate(arr) for b in arr[i + 1:] if a > 0 and b > 0}

            def ok_direct(x):
                return any(abs(abs(x) - abs(a)) <= max(0.011, 0.005 * abs(a)) for a in arr)

            def ok_derived(x):
                return any(abs(abs(x) - q) <= 0.011 for q in pairs)

            for shift in (0.37, 1.13):  # how often would a made-up nearby number pass the direct check?
                null_n += 1
                null_hits += ok_direct(v + shift)
            if ok_direct(v):
                grounded += 1
                direct += 1
            elif ok_derived(v):
                grounded += 1
            else:
                misses.append({"agent": t["agent"], "round": t["round"], "value": v})
    return {"checked": checked, "grounded": grounded, "direct": direct,
            "rate": round(100.0 * grounded / checked, 1) if checked else None,
            "direct_rate": round(100.0 * direct / checked, 1) if checked else None,
            "null_pass_rate": round(100.0 * null_hits / null_n, 1) if null_n else None,
            "ungrounded": misses[:20]}


def consistency(runs: list[dict]) -> dict:
    """Same day, repeated negotiations: share of rooms whose final setpoint is identical in every run."""
    if len(runs) < 2:
        return {"runs": len(runs), "identical_rooms_pct": None}
    rooms = set.intersection(*(set(r["final"]["proposal"]) for r in runs))
    same = sum(1 for room in rooms if len({tuple(sorted(r["final"]["proposal"][room].items())) for r in runs}) == 1)
    spread = max((max(list(r["final"]["proposal"][room].values())[0] for r in runs) -
                  min(list(r["final"]["proposal"][room].values())[0] for r in runs)) for room in rooms) if rooms else 0.0
    kwh = [r["final"]["eval"]["kwh"] for r in runs]
    return {"runs": len(runs), "rooms": len(rooms), "identical_rooms_pct": round(100.0 * same / len(rooms), 1) if rooms else None,
            "max_setpoint_spread_c": round(spread, 1), "kwh_min": min(kwh), "kwh_max": max(kwh)}


def evaluate_llm_day(d: date, repeats: int = 2) -> dict:
    """Run the LLM negotiation `repeats` times on one day (sandbox) and score grounding and consistency."""
    import time

    ctx = service.Ctx()
    ctx.adjustments = []
    ds = agents.build_dossier(3, d, ctx, fb_until=d)
    runs, gr, secs = [], [], []
    for _ in range(repeats):
        t0 = time.time()
        neg = agents.negotiate(3, d, use_ai=True, sandbox=True, ctx=ctx, fb_until=d)
        secs.append(round(time.time() - t0, 1))
        runs.append(neg)
        if neg["ai"]:
            gr.append(grounding(neg, ds))
    rule = agents.negotiate(3, d, use_ai=False, sandbox=True, ctx=ctx, fb_until=d)
    ok = [g for g in gr if g["checked"]]
    regrets = [regret(r, ds) for r in runs if r["ai"]]
    return {
        "date": d.isoformat(), "ai_runs": sum(1 for r in runs if r["ai"]), "seconds": secs,
        "grounding": {"checked": sum(g["checked"] for g in ok), "grounded": sum(g["grounded"] for g in ok),
                      "direct": sum(g["direct"] for g in ok),
                      "direct_rate": round(100.0 * sum(g["direct"] for g in ok) / max(1, sum(g["checked"] for g in ok)), 1) if ok else None,
                      "null_pass_rate": round(sum(g["null_pass_rate"] or 0 for g in ok) / len(ok), 1) if ok else None,
                      "rate": round(100.0 * sum(g["grounded"] for g in ok) / max(1, sum(g["checked"] for g in ok)), 1) if ok else None,
                      "ungrounded": [m for g in gr for m in g["ungrounded"]][:10]},
        "consistency": consistency([r for r in runs if r["ai"]]),
        "agreed": [r["final"]["agreed"] for r in runs],
        "regret": {"llm": regrets, "rule": regret(rule, ds)},
        "llm_vs_rule": {"llm_kwh": [r["final"]["eval"]["kwh"] for r in runs], "rule_kwh": rule["final"]["eval"]["kwh"],
                        "llm_pmv": [r["final"]["eval"]["pmv_mean"] for r in runs], "rule_pmv": rule["final"]["eval"]["pmv_mean"],
                        "baseline_kwh": rule["baseline"]["kwh"], "baseline_pmv": rule["baseline"]["pmv_mean"]},
    }


def objective(ds: dict, proposal: dict, comfort_won: float | None = None) -> float:
    """Arbiter objective (won) of a proposal, read from the dossier grid: room electricity cost + comfort penalty."""
    hot = agents.complaint_rooms(ds)
    d2 = {**ds, "comfort_won": ds.get("comfort_won", agents.COMFORT_WON) if comfort_won is None else comfort_won}
    n = len(ds["dates"])
    tot = 0.0
    for r in ds["rooms"]:
        sp = (proposal.get(r) or {}).get(ds["key"], ds["base_sp"][r])
        g = agents._grid(ds, r, sp)
        if g and g["kwh"] is not None:
            tot += agents._room_score(d2, r, g, hot, n)
    return tot


def grid_optimum(ds: dict, comfort_won: float) -> dict:
    hot = agents.complaint_rooms(ds)
    d2 = {**ds, "comfort_won": comfort_won}
    out = {}
    for r in ds["rooms"]:
        g = [x for x in ds["grid"].get(r, []) if x["kwh"] is not None]
        if g:
            out[r] = {ds["key"]: min(g, key=lambda x: agents._room_score(d2, r, x, hot, len(ds["dates"])))["sp"]}
    return out


def regret(neg: dict, ds: dict) -> dict:
    """How much worse (won, arbiter objective) the negotiated setpoints are than the full-grid optimum."""
    base = {r: {ds["key"]: ds["base_sp"][r]} for r in ds["rooms"]}
    opt = grid_optimum(ds, ds.get("comfort_won", agents.COMFORT_WON))
    j_neg, j_opt, j_base = objective(ds, neg["final"]["proposal"]), objective(ds, opt), objective(ds, base)
    return {"j_current_plan": round(j_base), "j_negotiated": round(j_neg), "j_optimum": round(j_opt), "regret_won": round(j_neg - j_opt),
            "gap_closed_pct": round(100.0 * (j_base - j_neg) / (j_base - j_opt), 1) if j_base - j_opt > 1 else None}


def comfort_sweep(dates: list[date], weights=(0, 150, 300, 600, 1200, 2500, 5000, 10000)) -> list[dict]:
    """Pareto curve: the arbiter's full-grid optimum over the period for each comfort weight (deterministic)."""
    from . import planning

    ctx = service.Ctx()
    ctx.adjustments = []
    dss = [agents.build_dossier(3, d, ctx, fb_until=d) for d in dates]
    out = []
    for w in weights:
        kwh = cost = 0.0
        pm, n = 0.0, 0
        for d, ds in zip(dates, dss):
            ev = planning.evaluate([d], ctx, grid_optimum(ds, float(w)), ds["feedback"])
            kwh += ev["kwh"]
            cost += ev["cost_krw"]
            if ev["pmv_mean"] is not None:
                pm += ev["pmv_mean"]
                n += 1
        out.append({"comfort_won": w, "kwh": round(kwh, 1), "cost_krw": round(cost), "pmv_mean": round(pm / n, 2) if n else None})
    return out

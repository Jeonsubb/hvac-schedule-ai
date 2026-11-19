"""Weather acquisition: KMA (기상청 단기예보, 공공데이터포털) + Open-Meteo.

Per date we keep two hourly series (24 values each):
  actual   - what happened (Open-Meteo archive/best-match, KMA 초단기실황 for the latest hour)
  forecast - what the planner saw (KMA 단기예보 snapshot if stored, else Open-Meteo forecast;
             for dates beyond every forecast horizon: same date last year = climatology)
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
KMA_BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"


def now_kst() -> datetime:
    return datetime.now(KST)


def kma_grid(lat: float, lon: float) -> tuple[int, int]:
    """Lambert conformal conic conversion used by KMA (DFS grid, 5 km)."""
    re_, grid, slat1, slat2, olon, olat, xo, yo = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    d = math.pi / 180
    re = re_ / grid
    s1, s2, ol, oa = slat1 * d, slat2 * d, olon * d, olat * d
    sn = math.log(math.cos(s1) / math.cos(s2)) / math.log(
        math.tan(math.pi * 0.25 + s2 * 0.5) / math.tan(math.pi * 0.25 + s1 * 0.5)
    )
    sf = math.tan(math.pi * 0.25 + s1 * 0.5) ** sn * math.cos(s1) / sn
    ro = re * sf / math.tan(math.pi * 0.25 + oa * 0.5) ** sn
    ra = re * sf / math.tan(math.pi * 0.25 + lat * d * 0.5) ** sn
    th = lon * d - ol
    if th > math.pi:
        th -= 2 * math.pi
    if th < -math.pi:
        th += 2 * math.pi
    th *= sn
    return int(ra * math.sin(th) + xo + 0.5), int(ro - ra * math.cos(th) + yo + 0.5)


def _get_json(url: str, timeout: float = 20.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "hvac-ai/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------- Open-Meteo

def _om_hourly(url: str) -> dict[str, dict]:
    js = _get_json(url)
    h = js["hourly"]
    out = {}
    for i, t in enumerate(h["time"]):
        out[t[:13]] = {
            "t": h["temperature_2m"][i],
            "rh": h["relative_humidity_2m"][i],
            "ghi": h["shortwave_radiation"][i],
        }
    return out


def open_meteo_archive(lat: float, lon: float, start: date, end: date) -> dict[str, dict]:
    q = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "hourly": "temperature_2m,relative_humidity_2m,shortwave_radiation",
            "timezone": "Asia/Seoul",
        }
    )
    return _om_hourly(f"https://archive-api.open-meteo.com/v1/archive?{q}")


def open_meteo_forecast(lat: float, lon: float, past_days: int = 7, forecast_days: int = 16) -> dict[str, dict]:
    q = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,relative_humidity_2m,shortwave_radiation",
            "past_days": past_days,
            "forecast_days": forecast_days,
            "timezone": "Asia/Seoul",
        }
    )
    return _om_hourly(f"https://api.open-meteo.com/v1/forecast?{q}")


def open_meteo_previous_day1(lat: float, lon: float, start: date, end: date) -> dict[str, dict]:
    """Forecast issued the day before (planner's view for past dates)."""
    q = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "hourly": "temperature_2m_previous_day1,relative_humidity_2m_previous_day1,shortwave_radiation_previous_day1",
            "timezone": "Asia/Seoul",
        }
    )
    js = _get_json(f"https://previous-runs-api.open-meteo.com/v1/forecast?{q}")
    h = js["hourly"]
    out = {}
    for i, t in enumerate(h["time"]):
        out[t[:13]] = {
            "t": h["temperature_2m_previous_day1"][i],
            "rh": h["relative_humidity_2m_previous_day1"][i],
            "ghi": h["shortwave_radiation_previous_day1"][i],
        }
    return out


# ---------------------------------------------------------------- KMA

def _kma_items(endpoint: str, key: str, params: dict) -> list[dict]:
    q = urllib.parse.urlencode({"pageNo": 1, "numOfRows": 1000, "dataType": "JSON", **params})
    url = f"{KMA_BASE}/{endpoint}?serviceKey={key}&{q}"
    js = _get_json(url)
    hdr = js.get("response", {}).get("header", {})
    if hdr.get("resultCode") != "00":
        raise RuntimeError(f"KMA {endpoint} error: {hdr}")
    return js["response"]["body"]["items"]["item"]


def kma_vilage_base(now: datetime) -> tuple[str, str]:
    """Latest issued 단기예보 base (02,05,...,23 h; available ~10 min after)."""
    t = now - timedelta(minutes=15)
    hours = [2, 5, 8, 11, 14, 17, 20, 23]
    cands = [h for h in hours if h <= t.hour]
    if not cands:
        t = t - timedelta(days=1)
        h = 23
    else:
        h = cands[-1]
    return t.strftime("%Y%m%d"), f"{h:02d}00"


def kma_forecast(key: str, nx: int, ny: int, now: datetime | None = None) -> dict:
    now = now or now_kst()
    bd, bt = kma_vilage_base(now)
    items = _kma_items("getVilageFcst", key, {"base_date": bd, "base_time": bt, "nx": nx, "ny": ny})
    hourly: dict[str, dict] = {}
    for it in items:
        k = f"{it['fcstDate'][:4]}-{it['fcstDate'][4:6]}-{it['fcstDate'][6:]}T{it['fcstTime'][:2]}"
        rec = hourly.setdefault(k, {})
        cat, v = it["category"], it["fcstValue"]
        if cat == "TMP":
            rec["t"] = float(v)
        elif cat == "REH":
            rec["rh"] = float(v)
        elif cat == "SKY":
            rec["sky"] = int(v)
        elif cat == "PTY":
            rec["pty"] = int(v)
        elif cat == "POP":
            rec["pop"] = int(v)
    return {"base": f"{bd}{bt}", "hourly": hourly}


def kma_nowcast(key: str, nx: int, ny: int, now: datetime | None = None) -> dict:
    now = now or now_kst()
    t = now - timedelta(minutes=45)  # 초단기실황 is published ~40 min past the hour
    bd, bt = t.strftime("%Y%m%d"), t.strftime("%H00")
    items = _kma_items("getUltraSrtNcst", key, {"base_date": bd, "base_time": bt, "nx": nx, "ny": ny})
    vals = {it["category"]: float(it["obsrValue"]) for it in items}
    return {
        "time": f"{bd[:4]}-{bd[4:6]}-{bd[6:]}T{bt[:2]}",
        "t": vals.get("T1H"),
        "rh": vals.get("REH"),
        "rain_mm": vals.get("RN1"),
        "wind": vals.get("WSD"),
        "pty": int(vals.get("PTY", 0)),
    }


# ---------------------------------------------------------------- assembly

def _series(hourly: dict[str, dict], d: date, field: str) -> list[float] | None:
    out = []
    for h in range(24):
        rec = hourly.get(f"{d.isoformat()}T{h:02d}")
        if rec is None or rec.get(field) is None:
            return None
        out.append(float(rec[field]))
    return out


def assemble_days(
    dates: list[date],
    today: date,
    archive: dict[str, dict],
    om_forecast: dict[str, dict],
    climatology: dict[str, dict],
    kma_snapshots: dict[str, dict] | None = None,
    nowcast: dict | None = None,
    prev_day1: dict[str, dict] | None = None,
    kma_forecast_hourly: dict[str, dict] | None = None,
) -> dict[str, dict]:
    """Build {iso_date: {actual:{t,rh,ghi}, forecast:{t,rh,ghi}, src_actual, src_forecast}}."""
    kma_snapshots = kma_snapshots or {}
    out: dict[str, dict] = {}
    for d in dates:
        iso = d.isoformat()
        clim_d = d.replace(year=d.year - 1)

        def pick(sources):
            for name, hourly, dd in sources:
                t = _series(hourly, dd, "t")
                rh = _series(hourly, dd, "rh")
                ghi = _series(hourly, dd, "ghi")
                if t and rh and ghi:
                    return name, {"t": t, "rh": rh, "ghi": ghi}
            return None, None

        if d < today:
            src_a, actual = pick([("Open-Meteo 실측", archive, d), ("Open-Meteo 분석", om_forecast, d)])
        else:
            src_a, actual = pick([("Open-Meteo 예보", om_forecast, d), ("평년(전년 동일)", climatology, clim_d)])
        if actual is None:
            src_a, actual = pick([("평년(전년 동일)", climatology, clim_d)])
        if actual is None:
            # last resort: flat mild day so the engine never crashes
            src_a, actual = "기본값", {"t": [15.0] * 24, "rh": [60.0] * 24, "ghi": [0.0] * 24}

        forecast = {k: list(v) for k, v in actual.items()}
        src_f = src_a
        if d < today and prev_day1:
            src_p, fc = pick([("Open-Meteo 전날 예보", prev_day1, d)])
            if fc:
                forecast, src_f = fc, src_p
        snap = kma_snapshots.get(iso)
        if not snap and kma_forecast_hourly and d >= today:
            snap = {k[11:13]: v for k, v in kma_forecast_hourly.items() if k[:10] == iso}
            if len(snap) < 12:
                snap = None
        if snap:
            # KMA forecast snapshot captured before the day started (planner view)
            for h in range(24):
                rec = snap.get(f"{h:02d}")
                if rec:
                    if rec.get("t") is not None:
                        forecast["t"][h] = float(rec["t"])
                    if rec.get("rh") is not None:
                        forecast["rh"][h] = float(rec["rh"])
            src_f = "기상청 단기예보"
        if nowcast and nowcast.get("time", "")[:10] == iso and d == today:
            h = int(nowcast["time"][11:13])
            if nowcast.get("t") is not None:
                actual["t"][h] = float(nowcast["t"])
            if nowcast.get("rh") is not None:
                actual["rh"][h] = float(nowcast["rh"])
            src_a = src_a + " + 기상청 실황"
        out[iso] = {"actual": actual, "forecast": forecast, "src_actual": src_a, "src_forecast": src_f}
    return out


def minute_series(hourly: list[float]) -> list[float]:
    """Linear interpolation of 24 hourly values (at :00) to 1440 minute values."""
    out = []
    for m in range(1440):
        h = m // 60
        frac = (m % 60) / 60.0
        a = hourly[h]
        b = hourly[h + 1] if h + 1 < 24 else hourly[h]
        out.append(a + (b - a) * frac)
    return out


def fetch_sources(today: date, start: date, end: date, lat: float, lon: float, nx: int, ny: int,
                  kma_key: str | None = None) -> dict:
    """Fetch every raw source once; failures are recorded instead of raised."""
    src: dict = {"fetched_at": now_kst().isoformat(timespec="seconds"), "errors": {}}

    def attempt(name, fn):
        try:
            src[name] = fn()
        except Exception as e:  # network/API failure must not break planning
            src[name] = {}
            src["errors"][name] = str(e)[:200]

    past_end = min(today - timedelta(days=1), end)
    attempt("archive", lambda: open_meteo_archive(lat, lon, start, past_end) if past_end >= start else {})
    attempt("prev_day1", lambda: open_meteo_previous_day1(lat, lon, start, past_end) if past_end >= start else {})
    attempt("om_forecast", lambda: open_meteo_forecast(lat, lon, past_days=7, forecast_days=16))
    clim_start = max(today, start).replace(year=today.year - 1)
    attempt("climatology", lambda: open_meteo_archive(lat, lon, clim_start, end.replace(year=end.year - 1)))
    if kma_key:
        attempt("kma_forecast", lambda: kma_forecast(kma_key, nx, ny))
        attempt("kma_nowcast", lambda: kma_nowcast(kma_key, nx, ny))
    return src


def build_weather(src: dict, dates: list[date], today: date, kma_snapshots: dict | None = None) -> dict[str, dict]:
    return assemble_days(
        dates, today, src.get("archive", {}), src.get("om_forecast", {}), src.get("climatology", {}),
        kma_snapshots=kma_snapshots, nowcast=src.get("kma_nowcast") or None,
        prev_day1=src.get("prev_day1", {}),
        kma_forecast_hourly=(src.get("kma_forecast") or {}).get("hourly"),
    )

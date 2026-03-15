"""
CS2 Demo Parser
Parsii .dem-tiedoston ja tallentaa kaiken datan SQL Serveriin.

Käyttö:
    python parser.py "C:/polku/matsi.dem"
"""

import sys
import os
import math
import io
import pyodbc
from demoparser2 import DemoParser

# Pakotetaan UTF-8 stdout:iin Windows-ympäristössä
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── Sanitointiaputoiminnot — NaN/None/inf eivät mene SQL Serveriin ────────────
def f(val, default=0.0):
    """Turvallinen float — NaN/None/inf → default"""
    try:
        v = float(val)
        return default if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return default

def ii(val, default=0):
    """Turvallinen int"""
    try:
        v = float(val)
        return default if (math.isnan(v) or math.isinf(v)) else int(v)
    except (TypeError, ValueError):
        return default

def ss(val, default=""):
    """Turvallinen string — None/nan → default"""
    if val is None:
        return default
    sv = str(val)
    return default if sv in ("nan", "None", "NaN") else sv

def b(val):
    """Turvallinen bool"""
    try:
        v = float(val)
        return False if math.isnan(v) else bool(int(v))
    except (TypeError, ValueError):
        return bool(val) if val is not None else False

# ── SQL Server yhteys ──────────────────────────────────────────────────────────
# Muuta SERVER omaan koneesi nimeen tai IP:hen
CONN_STRING = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=cs2demos;"
    "Trusted_Connection=yes;"
    "TrustServerCertificate=yes;"
)

def get_conn():
    try:
        return pyodbc.connect(CONN_STRING)
    except Exception as e:
        print(f"[VIRHE] SQL Server yhteys epäonnistui: {e}")
        print("[INFO] Tarkista että SQL Server on käynnissä ja CONN_STRING on oikein parser.py:ssä")
        sys.exit(1)

def log(msg: str):
    """Tulostaa progress-viestit Electronille (stdout)"""
    print(msg, flush=True)

# ── Pääparseri ─────────────────────────────────────────────────────────────────
def parse_and_store(dem_path: str, force: bool = False) -> int:
    log(f"[1/9] Avataan demo: {dem_path}")
    parser = DemoParser(dem_path)
    conn = get_conn()
    cursor = conn.cursor()

    # ── Demo metadata ──────────────────────────────────────────────────────────
    log("[2/9] Parsitaan metadata...")
    header = parser.parse_header()
    map_name    = header.get("map_name", "unknown")
    tickrate    = int(header.get("tickrate", 64))
    server_name = header.get("server_name", "")
    match_id    = header.get("match_id", None)
    filename    = os.path.basename(dem_path)

    # ── Tarkista duplikaatti ───────────────────────────────────────────────────
    cursor.execute("SELECT id FROM demos WHERE filename = ?", filename)
    existing = cursor.fetchone()
    if existing:
        if not force:
            log(f"[VAROITUS]  Demo '{filename}' on jo kannassa (ID: {existing[0]}). Skipätään.")
            log(f"   Jos haluat parsita uudelleen, aja: python parser.py <demo> --force")
            conn.close()
            return existing[0]
        else:
            old_id = existing[0]
            log(f"[--force] Poistetaan vanha demo ID={old_id} ja parsitaan uudelleen...")
            tables = [
                'grenade_trajectories', 'smoke_effects', 'flash_events',
                'grenades', 'kills', 'damage',
                'bomb_events', 'positions',
                'players', 'rounds',
            ]
            for table in tables:
                if table in ('grenade_trajectories', 'smoke_effects'):
                    cursor.execute(f"DELETE FROM {table} WHERE grenade_id IN (SELECT id FROM grenades WHERE demo_id=?)", old_id)
                else:
                    cursor.execute(f"DELETE FROM {table} WHERE demo_id=?", old_id)
            cursor.execute("DELETE FROM demos WHERE id=?", old_id)
            conn.commit()
            log(f"    Vanha data poistettu.")

    cursor.execute("""
        INSERT INTO demos (filename, map_name, tickrate, server_name, match_id)
        OUTPUT INSERTED.id
        VALUES (?, ?, ?, ?, ?)
    """, filename, map_name, tickrate, server_name, match_id)
    demo_id = cursor.fetchone()[0]
    log(f"    Demo ID: {demo_id}, Kartta: {map_name}, Tickrate: {tickrate}")

    # ── Pelaajat ───────────────────────────────────────────────────────────────
    log("[3/9] Parsitaan pelaajat...")
    try:
        player_info = parser.parse_player_info()
        # team_number: 2=CT, 3=T
        seen = set()
        for _, row in player_info.iterrows():
            steam_id = ss(str(row.get("steamid", "")))
            if not steam_id or steam_id in seen:
                continue
            seen.add(steam_id)
            team_num = row.get("team_number", 0)
            team = "CT" if team_num == 2 else "T"
            cursor.execute("""
                INSERT INTO players (demo_id, steam_id, name, team_start)
                VALUES (?, ?, ?, ?)
            """, demo_id, steam_id,
                ss(row.get("name", "Unknown")) or "Unknown",
                team)
        conn.commit()
        log(f"    Pelaajia: {len(seen)}")
    except Exception as e:
        log(f"    [VAROITUS] Pelaajaparsinta: {e}")

    # ── Roundit ────────────────────────────────────────────────────────────────
    log("[4/9] Parsitaan roundit...")
    try:
        round_ends   = parser.parse_event("round_end")
        round_starts = parser.parse_event("round_start")
        t_score = ct_score = 0

        import numpy as np

        rs_sorted = round_starts.sort_values("tick").reset_index(drop=True)

        # Normaali: ensimmäinen round_start per round
        rs_first = rs_sorted.groupby("round", sort=True)["tick"].min().reset_index()

        # Round 1 erityistapaus: käytä VIIMEISTÄ round_start-eventtiä
        # (FACEIT: lämmittely/puukko aiheuttaa useita round_start-eventtejä round 1:ssä)
        round1_starts = rs_sorted[rs_sorted["round"] == 1]["tick"]
        if len(round1_starts) > 1:
            real_round1_start = int(round1_starts.max())
            rs_first.loc[rs_first["round"] == 1, "tick"] = real_round1_start
            log(f"    Round 1: useita round_start-eventtejä, käytetään viimeistä tick={real_round1_start}")

        # ── FACEIT knife round tunnistus ──────────────────────────────────────
        # round_announce_match_start #1 = puukon alku → round 0
        knife_start_tick = None
        match_start_tick = None
        try:
            match_start_df = parser.parse_event("round_announce_match_start")
            if not match_start_df.empty:
                all_ticks = sorted([int(t) for t in match_start_df["tick"].tolist()])
                log(f"    round_announce_match_start eventit: {all_ticks}")
                cursor.execute("IF COL_LENGTH('demos','match_start_tick') IS NULL ALTER TABLE demos ADD match_start_tick INT NULL")
                cursor.execute("IF COL_LENGTH('rounds','is_knife') IS NULL ALTER TABLE rounds ADD is_knife BIT NOT NULL DEFAULT 0")
                knife_start_tick = all_ticks[0]
                match_start_tick = all_ticks[0]
                cursor.execute("UPDATE demos SET match_start_tick=? WHERE id=?", match_start_tick, demo_id)
                conn.commit()
        except Exception as e:
            log(f"    [VAROITUS] round_announce_match_start: {e}")

        rs_first = rs_first.sort_values("tick").reset_index(drop=True)
        start_ticks      = rs_first["tick"].values
        start_round_nums = rs_first["round"].values

        round_start_tick_map = {int(start_round_nums[i]): int(start_ticks[i]) for i in range(len(start_ticks))}

        # Rakenna myös end_tick per round (seuraavan roundin start - 1)
        sorted_rounds = sorted(round_start_tick_map.items())
        round_end_tick_map = {}
        for i, (rnum, rtick) in enumerate(sorted_rounds):
            if i + 1 < len(sorted_rounds):
                round_end_tick_map[rnum] = sorted_rounds[i+1][1] - 1
            else:
                round_end_tick_map[rnum] = rtick + 50000  # viimeinen round

        def tick_to_round_num(tick):
            idx = np.searchsorted(start_ticks, int(tick), side="right") - 1
            if idx < 0: return 0
            return int(start_round_nums[min(idx, len(start_round_nums)-1)])

        re_sorted = round_ends.sort_values("tick").drop_duplicates("tick").reset_index(drop=True)
        inserted_rounds = set()
        for _, row in re_sorted.iterrows():
            winner    = ss(row.get("winner", ""))
            reason    = ss(row.get("reason", ""))
            round_num = tick_to_round_num(ii(row.get("tick", 0)))

            if round_num in inserted_rounds:
                continue  # skip duplicate round_num
            inserted_rounds.add(round_num)

            if winner == "CT":   ct_score += 1
            elif winner == "T":  t_score  += 1

            cursor.execute("""
                IF NOT EXISTS (SELECT 1 FROM rounds WHERE demo_id=? AND round_num=?)
                INSERT INTO rounds
                (demo_id, round_num, winner_team, win_reason, round_type, t_score, ct_score, start_tick)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, demo_id, round_num,
                demo_id, round_num,
                winner or None, reason or None, "unknown",
                t_score, ct_score,
                round_start_tick_map.get(round_num, 0))
        conn.commit()
        log(f"    Roundit: {len(inserted_rounds)}, start_ticks: {list(start_ticks[:5])}...")
        log(f"    round_start_tick_map: {dict(list(round_start_tick_map.items())[:6])}")

        # ── Round 0: puukkokierros ────────────────────────────────────────────
        if knife_start_tick is not None:
            cursor.execute("""
                IF NOT EXISTS (SELECT 1 FROM rounds WHERE demo_id=? AND round_num=0)
                INSERT INTO rounds (demo_id, round_num, winner_team, win_reason, round_type, t_score, ct_score, start_tick, is_knife)
                VALUES (?, 0, NULL, NULL, 'unknown', 0, 0, ?, 1)
            """, demo_id, demo_id, knife_start_tick)
            cursor.execute("UPDATE rounds SET is_knife=0 WHERE demo_id=? AND round_num > 0", demo_id)
            conn.commit()
            log(f"    Round 0 (puukko) start_tick={knife_start_tick}, round 1 start_tick={match_start_tick}")
    except Exception as e:
        log(f"    [VAROITUS] Roundiparsinta: {e}")
        import traceback; log(traceback.format_exc())
        def tick_to_round_num(tick): return 0
        round_start_tick_map = {}

    # ── Sijainnit (iso taulu!) ─────────────────────────────────────────────────
    log("[5/9] Parsitaan sijainnit (kaikki tickit — voi kestää hetken)...")
    pos_df = None
    try:
        pos_df = parser.parse_ticks([
            "X", "Y", "Z", "yaw", "pitch",
            "velocity_X", "velocity_Y", "velocity_Z",
            "is_alive", "is_ducking", "is_scoped", "is_airborne",
            "health", "armor_value", "has_helmet",
            "active_weapon_name", "current_equip_value",
            "balance", "inventory",
        ])
        log(f"    Kentät ok: {[c for c in ['balance','inventory'] if c in pos_df.columns]}")
        if "inventory" in pos_df.columns:
            log(f"    inventory sample: {pos_df['inventory'].dropna().head(2).tolist()}")
        if "balance" in pos_df.columns:
            log(f"    balance sample: {pos_df['balance'].dropna().head(2).tolist()}")
        import math as _math

        # Lisää round-sarake tick_to_round_num-funktiolla (sama kuin muuallakin)
        try:
            pos_df["round"] = pos_df["tick"].apply(tick_to_round_num)
        except Exception as re:
            log(f"    [VAROITUS] round-sarake: {re}")
            pos_df["round"] = 0
        total = len(pos_df)
        log(f"    Sijainti-rivejä: {total:,}")

        # Tallennetaan Parquet-tiedostoon SQL:n sijaan — 10x nopeampi
        parquet_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "demos")
        os.makedirs(parquet_dir, exist_ok=True)
        parquet_path = os.path.join(parquet_dir, f"{demo_id}_positions.parquet")
        pos_df.to_parquet(parquet_path, index=False, compression="snappy")
        log(f"PROGRESS:positions:100")
        log(f"    [OK] Sijainnit tallennettu: {parquet_path}")

        # Fallback: jos pelaajat puuttuvat, hae steam_id:t sijaintidatasta
        cursor.execute("SELECT COUNT(*) FROM players WHERE demo_id = ?", demo_id)
        player_count = cursor.fetchone()[0]
        if player_count == 0 and pos_df is not None:
            log("    Haetaan pelaajat sijaintidatasta (fallback)...")
            unique_ids = pos_df["steamid"].dropna().unique()
            for sid in unique_ids:
                sid_str = ss(sid)
                if not sid_str:
                    continue
                cursor.execute("""
                    INSERT INTO players (demo_id, steam_id, name, team_start)
                    VALUES (?, ?, ?, ?)
                """, demo_id, sid_str, sid_str[-8:], "Unknown")
            conn.commit()
            log(f"    Pelaajia (fallback): {len(unique_ids)}")
    except Exception as e:
        log(f"    [VAROITUS] Sijaintiparsinta: {e}")

    # ── Tapot ──────────────────────────────────────────────────────────────────
    log("[6/9] Parsitaan tapot...")
    try:
        kills_df = parser.parse_event("player_death", player=[
            "X", "Y", "Z", "team_name"
        ], other=["attacker_X", "attacker_Y"])

        for _, row in kills_df.iterrows():
            cursor.execute("""
                INSERT INTO kills
                (demo_id, round_num, tick, attacker_steam_id, victim_steam_id, assister_steam_id,
                 weapon, headshot, wallbang, noscope, thrusmoke, blind,
                 attacker_x, attacker_y, victim_x, victim_y)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            demo_id, tick_to_round_num(ii(row.get("tick"))), ii(row.get("tick")),
            ss(row.get("attacker_steamid")) or None,
            ss(row.get("user_steamid")) or None,
            ss(row.get("assister_steamid")) or None,
            ss(row.get("weapon")),
            b(row.get("headshot")),
            b(row.get("penetrated_objects")),
            b(row.get("noscope")),
            b(row.get("thrusmoke")),
            b(row.get("attackerblind")),
            f(row.get("attacker_X")), f(row.get("attacker_Y")),
            f(row.get("user_X")), f(row.get("user_Y"))
            )
        conn.commit()
        log(f"    Tapot: {len(kills_df)}")
    except Exception as e:
        log(f"    [VAROITUS] Tappoparsinta: {e}")

    # ── Damage ─────────────────────────────────────────────────────────────────
    try:
        dmg_df = parser.parse_event("player_hurt", player=["X","Y"])
        for _, row in dmg_df.iterrows():
            cursor.execute("""
                INSERT INTO damage
                (demo_id, round_num, tick, attacker_steam_id, victim_steam_id,
                 weapon, damage, hitgroup, armor_damage, health_after)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            demo_id, tick_to_round_num(ii(row.get("tick"))), ii(row.get("tick")),
            ss(row.get("attacker_steamid")) or None,
            ss(row.get("user_steamid")) or None,
            ss(row.get("weapon")),
            ii(row.get("dmg_health")),
            ss(row.get("hitgroup")),
            ii(row.get("dmg_armor")),
            ii(row.get("health"))
            )
        conn.commit()
    except Exception as e:
        log(f"    [VAROITUS] Damageparsinta: {e}")

    # ── Granaatit + lentoradat ─────────────────────────────────────────────────
    log("[7/9] Parsitaan granaatit...")
    try:
        import pandas as pd

        # parse_grenades() on ainoa luotettava lähde — sisältää entity_id, tyyppi, steamid, tick, x,y,z
        traj_raw = parser.parse_grenades()
        log(f"    parse_grenades rows: {len(traj_raw)}, cols: {traj_raw.columns.tolist()}")
        all_types = traj_raw['grenade_type'].unique().tolist() if len(traj_raw) else []
        log(f"    ALL grenade_type uniques: {all_types}")

        # Tarkista inferno/fire tyypit erikseen
        inferno_types = [t for t in all_types if t and any(x in str(t) for x in ['Inferno','Fire','Incend','fire','inferno'])]
        if inferno_types:
            inf_sample = traj_raw[traj_raw['grenade_type'].isin(inferno_types)]
            log(f"    Inferno rows: {len(inf_sample)}, types: {inferno_types}")
            # Tarkista mitkä kolumnit ovat NOT NULL
            non_null = {col: inf_sample[col].notna().sum() for col in inf_sample.columns}
            log(f"    Inferno non-null counts: {non_null}")
            log(f"    Inferno sample (kaikki arvot): {inf_sample.iloc[0].to_dict()}")
            if len(inf_sample) > 5:
                log(f"    Inferno rows 1-5: {inf_sample.head(5).to_dict('records')}")
        else:
            log(f"    Ei inferno-tyyppejä parse_grenades():ssa")

        # Tarkista myös parse_event("inferno_startburn") kolumnit tarkemmin
        try:
            inf_ev = parser.parse_event("inferno_startburn", other=["X","Y","Z","origin_x","origin_y","origin_z"])
            log(f"    inferno_startburn cols: {list(inf_ev.columns)}")
            if len(inf_ev) > 0:
                log(f"    inferno_startburn sample: {inf_ev.iloc[0].to_dict()}")
        except Exception as e:
            log(f"    inferno_startburn event check: {e}")
        traj_raw = traj_raw.rename(columns={"grenade_entity_id": "entity_id"})
        traj_raw = traj_raw.dropna(subset=["x","y","z"])
        log(f"    after dropna: {len(traj_raw)}")

        type_map = {
            "CSmokeGrenade":             "smokegrenade",
            "CSmokeGrenadeProjectile":   "smokegrenade",
            "CFlashbang":                "flashbang",
            "CFlashbangProjectile":      "flashbang",
            "CHEGrenade":                "hegrenade",
            "CHEGrenadeProjectile":      "hegrenade",
            "CMolotovGrenade":           "molotov",
            "CMolotovProjectile":        "molotov",
            "CIncendiaryGrenade":        "incgrenade",
            "CIncendiaryGrenadeProjectile": "incgrenade",
            "CDecoyGrenade":             "decoy",
            "CDecoyProjectile":          "decoy",
        }

        # Per-granaatti aggregaatti: entity_id → ensiesiintymä
        grp = traj_raw.groupby("entity_id", sort=False).agg(
            grenade_type=("grenade_type", "first"),
            steamid=("steamid",           "first"),
            first_tick=("tick",           "min"),
            first_x=("x",                "first"),
            first_y=("y",                "first"),
            first_z=("z",                "first"),
        ).reset_index()

        log(f"    grp rows: {len(grp)}, sample types: {grp['grenade_type'].unique()[:8].tolist()}")

        # grenade_id_map: eid → lista (first_tick, db_id, gtype) — entity ID kierrätetään!
        grenade_id_map: dict[int, list[tuple[int, int, str]]] = {}
        skipped_types = set()

        for _, row in grp.iterrows():
            raw_type = ss(row.get("grenade_type", ""))
            gtype = type_map.get(raw_type)
            if not gtype:
                skipped_types.add(raw_type)
                continue
            eid        = ii(row["entity_id"])
            steam_id   = ss(row.get("steamid")) or None
            first_tick = ii(row["first_tick"])
            cursor.execute("""
                INSERT INTO grenades
                (demo_id, round_num, tick_thrown, thrower_steam_id, grenade_type,
                 throw_x, throw_y, throw_z)
                OUTPUT INSERTED.id
                VALUES (?,?,?,?,?,?,?,?)
            """,
            demo_id, tick_to_round_num(first_tick), first_tick,
            steam_id, gtype,
            f(row["first_x"]), f(row["first_y"]), f(row["first_z"]))
            db_id = cursor.fetchone()[0]
            # Lisää listaan — sama eid voi esiintyä useita kertoja eri tickeillä
            if eid not in grenade_id_map:
                grenade_id_map[eid] = []
            grenade_id_map[eid].append((first_tick, db_id, gtype))

        conn.commit()
        log(f"    Granaatteja: {sum(len(v) for v in grenade_id_map.values())}, ohitetut tyypit: {skipped_types}")

        # Apufunktio: etsi oikea db_id entity_id + tick + tyyppi perusteella
        MAX_FLIGHT = {
            "hegrenade":   1920,  # 30s — pelaaja voi pitää pitkään
            "flashbang":   1920,
            "smokegrenade":1920,
            "molotov":     1920,
            "incgrenade":  1920,
            "decoy":       2560,
        }
        def find_grenade_db_id(eid: int, det_tick: int, expected_gtype: str | None = None) -> int | None:
            entries = grenade_id_map.get(eid, [])
            if not entries:
                return None
            if expected_gtype:
                if expected_gtype == "molotov":
                    typed = [(t, d, g) for t, d, g in entries if g in ("molotov", "incgrenade")]
                else:
                    typed = [(t, d, g) for t, d, g in entries if g == expected_gtype]
                if typed:
                    entries = typed
            # Etsi granaatit joiden first_tick <= det_tick JA det_tick ei ole liian kaukana
            candidates = []
            for (first_tick, db_id, gtype) in entries:
                max_f = MAX_FLIGHT.get(gtype, 768)
                if first_tick <= det_tick <= first_tick + max_f:
                    candidates.append((first_tick, db_id, gtype))
            if candidates:
                return max(candidates, key=lambda x: x[0])[1]
            return None

        # ── Lentoradat parquetiin ─────────────────────────────────────────────
        try:
            # Rakenna nopea lookup: eid → lista (first_tick, db_id, round_end_tick) lajiteltu
            traj_lookup: dict[int, list[tuple[int, int, int]]] = {}
            for eid, entries in grenade_id_map.items():
                rlist = []
                for first_tick, db_id, gtype in entries:
                    rnum = tick_to_round_num(first_tick)
                    rend = round_end_tick_map.get(rnum, first_tick + 50000)
                    rlist.append((first_tick, db_id, rend))
                traj_lookup[eid] = sorted(rlist, key=lambda x: x[0])

            def map_traj_eid(eid: int, tick: int) -> int | None:
                entries = traj_lookup.get(eid)
                if not entries:
                    return None
                # Etsi granaatti jonka round-alue kattaa tämän tikin
                for first_tick, db_id, rend in reversed(entries):
                    if first_tick <= tick <= rend:
                        return db_id
                return None

            traj_df = traj_raw.copy()
            traj_df["grenade_id"] = [
                map_traj_eid(ii(row["entity_id"]), ii(row["tick"]))
                for _, row in traj_df.iterrows()
            ]
            traj_df = traj_df[traj_df["grenade_id"].notna()]
            traj_df["grenade_id"] = traj_df["grenade_id"].astype(int)
            traj_df = traj_df[["grenade_id","tick","x","y","z"]]
            traj_path = os.path.join(parquet_dir, f"{demo_id}_trajectories.parquet")
            traj_df.to_parquet(traj_path, index=False, compression="snappy")
            log(f"    Lentoratapisteitä: {len(traj_df)}")

            # Savuefektit insertoidaan VASTA detonaatioiden päivityksen jälkeen
            # (smoke_insert_placeholder)

        except Exception as e:
            log(f"    [VAROITUS] Lentoradat/savut: {e}")
            import traceback; log(traceback.format_exc())

        # ── Detonaatiot: päivitä tick_detonated + koordinaatit ───────────────
        event_type_map = {
            "hegrenade_detonate":    "hegrenade",
            "flashbang_detonate":    "flashbang",
            "smokegrenade_detonate": "smokegrenade",
            "decoy_started":         "decoy",
        }
        for event_name, expected_type in event_type_map.items():
            try:
                det_df = parser.parse_event(event_name, other=["X","Y","Z"])
                if det_df.empty:
                    continue
                matched = 0
                for _, row in det_df.iterrows():
                    eid      = ii(row.get("entityid") or row.get("entity_id") or 0)
                    det_tick = ii(row.get("tick"))
                    db_id    = find_grenade_db_id(eid, det_tick, expected_type)
                    if not db_id:
                        continue
                    x = f(row.get("X") if row.get("X") is not None else row.get("x"))
                    y = f(row.get("Y") if row.get("Y") is not None else row.get("y"))
                    z = f(row.get("Z") if row.get("Z") is not None else row.get("z"))
                    cursor.execute("""
                        UPDATE grenades SET tick_detonated=?, detonate_x=?, detonate_y=?, detonate_z=?
                        WHERE id=?
                    """, det_tick, x, y, z, db_id)
                    matched += 1
                log(f"    [{event_name}] matched {matched}/{len(det_df)}")
            except Exception as e:
                log(f"    [VAROITUS] Detonaatio {event_name}: {e}")

        # ── Inferno (molotov) — entity ID on eri kuin projektiili ─────────────
        # Matchataan lähimpään molotoviin sijainnin + tikin perusteella
        try:
            import math as _math
            inf_df = parser.parse_event("inferno_startburn", other=["X","Y","Z"])
            if not inf_df.empty:
                # Hae kaikki molotovit kannasta
                cursor.execute("""
                    SELECT id, tick_thrown, throw_x, throw_y
                    FROM grenades
                    WHERE demo_id=? AND grenade_type IN ('molotov','incgrenade')
                    AND tick_detonated IS NULL
                """, demo_id)
                molotovs = cursor.fetchall()  # [(id, tick_thrown, x, y)]
                matched = 0
                used_ids = set()
                for _, row in inf_df.iterrows():
                    det_tick = ii(row.get("tick"))
                    ix = f(row.get("X") if row.get("X") is not None else row.get("x"))
                    iy = f(row.get("Y") if row.get("Y") is not None else row.get("y"))
                    iz = f(row.get("Z") if row.get("Z") is not None else row.get("z"))
                    # Etsi lähin molotov: heitetty ennen det_tick, ei jo käytetty
                    best_id, best_dist = None, float("inf")
                    for (mid, mtick, mx, my) in molotovs:
                        if mid in used_ids:
                            continue
                        if mtick > det_tick or det_tick - mtick > 1024:
                            continue
                        dist = _math.hypot(mx - ix, my - iy)
                        if dist < best_dist:
                            best_dist, best_id = dist, mid
                    if best_id and best_dist < 2000:
                        cursor.execute("""
                            UPDATE grenades SET tick_detonated=?, detonate_x=?, detonate_y=?, detonate_z=?
                            WHERE id=?
                        """, det_tick, ix, iy, iz, best_id)
                        used_ids.add(best_id)
                        matched += 1
                log(f"    [inferno_startburn] matched {matched}/{len(inf_df)} (position-based)")
        except Exception as e:
            log(f"    [VAROITUS] Inferno: {e}")
            import traceback; log(traceback.format_exc())

        conn.commit()
        log(f"    Detonaatiot päivitetty")

        # ── Savuefektit — nyt kun tick_detonated on päivitetty ───────────────
        try:
            smoke_rows = []
            cursor.execute("""
                SELECT id, tick_detonated, detonate_x, detonate_y, detonate_z
                FROM grenades
                WHERE demo_id=? AND grenade_type='smokegrenade'
            """, demo_id)
            for (db_id, tick_det, det_x, det_y, det_z) in cursor.fetchall():
                pts = traj_df[traj_df["grenade_id"] == db_id].sort_values("tick")
                last = pts.iloc[-1] if not pts.empty else None
                if tick_det is not None:
                    start = int(tick_det)
                    x = float(det_x) if det_x is not None else (float(last["x"]) if last is not None else 0.0)
                    y = float(det_y) if det_y is not None else (float(last["y"]) if last is not None else 0.0)
                    z = float(det_z) if det_z is not None else (float(last["z"]) if last is not None else 0.0)
                elif last is not None:
                    start = int(last["tick"])
                    x, y, z = float(last["x"]), float(last["y"]), float(last["z"])
                else:
                    continue
                smoke_rows.append((db_id, start, start + 1152, x, y, z, 115.0))
            if smoke_rows:
                cursor.executemany("""
                    INSERT INTO smoke_effects (grenade_id, start_tick, end_tick, x, y, z, radius)
                    VALUES (?,?,?,?,?,?,?)
                """, smoke_rows)
            conn.commit()
            log(f"    Savuefektejä: {len(smoke_rows)}")
        except Exception as e:
            log(f"    [VAROITUS] Savuinsert: {e}")

    except Exception as e:
        log(f"    [VAROITUS] Granaattiparsinta: {e}")
        import traceback; log(traceback.format_exc())

    # ── Inferno liekkipisteet (Go-parseri) ────────────────────────────────────
    log("[7b/9] Parsitaan inferno-liekkipisteet Go-parserilla...")
    try:
        import subprocess, pandas as pd

        go_dir      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "go-inferno")
        go_exe      = os.path.join(go_dir, "inferno_parser.exe")
        frames_csv  = os.path.join(parquet_dir, f"{demo_id}_inferno_frames.csv")
        meta_csv    = os.path.join(parquet_dir, f"{demo_id}_inferno_meta.csv")

        # Lataa tai rakenna inferno_parser.exe
        if not os.path.exists(go_exe):
            import urllib.request, shutil
            # Yritä ladata valmiiksi käännetty binaari
            RELEASE_URL = "https://github.com/joniof/cs2-demo-viewer/releases/latest/download/inferno_parser.exe"
            log(f"    inferno_parser.exe puuttuu — yritetään latausta...")
            downloaded = False
            try:
                urllib.request.urlretrieve(RELEASE_URL, go_exe)
                log(f"    Ladattu onnistuneesti.")
                downloaded = True
            except Exception:
                pass

            if not downloaded:
                # Fallback: yritä buildaa jos Go on asennettuna
                log(f"    Lataus ei onnistunut — yritetään go build...")
                vendor_dir = os.path.join(go_dir, "vendor")
                if os.path.exists(vendor_dir):
                    shutil.rmtree(vendor_dir)
                build_result = subprocess.run(
                    ["go", "build", "-mod=mod", "-o", go_exe, "."],
                    cwd=go_dir, capture_output=True, text=True,
                    env={**os.environ, "GOFLAGS": ""}
                )
                if build_result.returncode != 0:
                    log(f"    [VAROITUS] go build epäonnistui: {build_result.stderr[:300]}")
                    log(f"    Molotovin geometria ei ole saatavilla tässä parsinnassa.")
                    raise RuntimeError("inferno_parser.exe puuttuu")
                else:
                    log(f"    inferno_parser.exe rakennettu go build:lla")

        result = subprocess.run(
            [go_exe, dem_path, frames_csv, meta_csv],
            capture_output=True, text=True
        )
        log(f"    Go-parseri: {result.stderr.strip()}")
        if result.returncode != 0:
            raise RuntimeError(f"inferno_parser.exe virhe: {result.stderr}")

        # Lue frames-CSV ja tallenna parquetiksi
        if os.path.exists(frames_csv):
            inf_frames = pd.read_csv(frames_csv)
            log(f"    Inferno frames: {len(inf_frames)} riviä")

            # Yhdistä grenade_id: unique_id → grenade.id kantahaulla (steamid + start_tick)
            if os.path.exists(meta_csv):
                inf_meta = pd.read_csv(meta_csv)
                log(f"    Inferno meta: {len(inf_meta)} infernoita")

                # Hae molotovit kannasta
                cursor.execute("""
                    SELECT g.id, g.thrower_steam_id, g.tick_thrown, g.tick_detonated
                    FROM grenades g
                    WHERE g.demo_id=? AND g.grenade_type IN ('molotov','incgrenade')
                """, demo_id)
                mol_rows = cursor.fetchall()  # [(id, steamid, tick_thrown, tick_det)]

                # Mäppää unique_id → grenade_id lähimmän heittäjän + tikin perusteella
                uid_to_gid: dict[int, int] = {}
                for _, mrow in inf_meta.iterrows():
                    uid        = int(mrow["unique_id"])
                    stk        = int(mrow["start_tick"])
                    sid        = str(mrow.get("thrower_steamid", ""))
                    best_id, best_dist = None, float("inf")
                    for (gid, gsid, gtick, gdet) in mol_rows:
                        if str(gsid or "") != sid and sid:
                            continue  # eri heittäjä
                        dist = abs(stk - (gdet or gtick + 64))
                        if dist < best_dist:
                            best_dist, best_id = dist, gid
                    if best_id and best_dist < 256:
                        uid_to_gid[uid] = best_id

                log(f"    Inferno uid→grenade_id mäppejä: {len(uid_to_gid)}/{len(inf_meta)}")

                # Lisää grenade_id sarake frames-dataan
                inf_frames["grenade_id"] = inf_frames["unique_id"].map(uid_to_gid)
                inf_frames = inf_frames[inf_frames["grenade_id"].notna()]
                inf_frames["grenade_id"] = inf_frames["grenade_id"].astype(int)

            # Tallenna parquetiksi
            inf_parquet = os.path.join(parquet_dir, f"{demo_id}_inferno_fires.parquet")
            inf_frames[["grenade_id","tick","x","y"]].to_parquet(
                inf_parquet, index=False, compression="snappy"
            )
            log(f"    Inferno fires tallennettu: {len(inf_frames)} riviä → {inf_parquet}")
        else:
            log(f"    [VAROITUS] frames_csv puuttuu: {frames_csv}")
    except Exception as e:
        log(f"    [VAROITUS] Inferno-liekkiparsinta: {e}")
        import traceback; log(traceback.format_exc())

    # ── Pommi ──────────────────────────────────────────────────────────────────
    log("[8/9] Parsitaan pommitapahtumat...")
    for event_name, event_type in [
        ("bomb_planted", "plant"),
        ("bomb_defused", "defuse"),
        ("bomb_exploded", "explode"),
        ("bomb_begindefuse", "defuse_start"),
        ("bomb_abortdefuse", "defuse_abort"),
    ]:
        try:
            df = parser.parse_event(event_name, player=["X","Y"])
            for _, row in df.iterrows():
                cursor.execute("""
                    INSERT INTO bomb_events
                    (demo_id, round_num, event_type, tick, player_steam_id, site, x, y)
                    VALUES (?,?,?,?,?,?,?,?)
                """,
                demo_id, tick_to_round_num(ii(row.get("tick"))),
                event_type, ii(row.get("tick")),
                ss(row.get("user_steamid")) or None,
                ss(row.get("site")) or None,
                f(row.get("user_X")),
                f(row.get("user_Y"))
                )
        except:
            pass
    conn.commit()

    # ── Laukaukset ─────────────────────────────────────────────────────────────
    log("[9/10] Parsitaan laukaukset...")
    try:
        shots_df = parser.parse_event("weapon_fire", player=["X","Y","Z","yaw","pitch"])
        grenade_names = {"smokegrenade", "flashbang", "hegrenade", "molotov", "incgrenade", "decoy"}
        shot_rows = []
        for _, row in shots_df.iterrows():
            weapon = ss(row.get("weapon", "")).replace("weapon_", "")
            if weapon in grenade_names:
                continue
            shot_rows.append((
                demo_id, tick_to_round_num(ii(row.get("tick"))), ii(row.get("tick")),
                ss(row.get("user_steamid")) or None, weapon,
                f(row.get("user_X")),
                f(row.get("user_Y")),
                f(row.get("user_Z")),
                f(row.get("user_yaw")),
                f(row.get("user_pitch"))
            ))
        if shot_rows:
            cursor.executemany("""
                INSERT INTO shots_fired
                (demo_id, round_num, tick, steam_id, weapon, x, y, z, yaw, pitch)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            """, shot_rows)
        conn.commit()
        log(f"    Laukaukset: {len(shot_rows)}")
    except Exception as e:
        log(f"    [VAROITUS] Laukausparsinta: {e}")

    # ── Flash events ───────────────────────────────────────────────────────────
    log("[10/10] Parsitaan flash-tapahtumat...")
    try:
        import pandas as pd
        import numpy as np

        # CS2:ssa ei ole player_blind-eventtia — luetaan flash_duration prop suoraan tickeistä
        # Haetaan kaikki tikit joissa jollain pelaajalla on flash_duration > 0
        try:
            flash_ticks = parser.parse_ticks(["flash_duration"], players=None)
        except Exception:
            flash_ticks = pd.DataFrame()

        if not flash_ticks.empty:
            log(f"    flash_ticks cols: {list(flash_ticks.columns)}, rows: {len(flash_ticks)}")
            # Suodata pois nollat
            flash_ticks = flash_ticks[flash_ticks["flash_duration"] > 0.1]
            log(f"    flash_ticks after filter: {len(flash_ticks)}")

            # Ryhmittele per pelaaja: etsi jaksot joissa flash_duration laskee
            # Käytä diff-tekniikkaa: uusi sokaistuminen alkaa kun flash_duration kasvaa
            flash_rows = []
            for steam_id, grp in flash_ticks.groupby("steamid"):
                grp = grp.sort_values("tick")
                # Etsi tikit joissa flash_duration on paikallinen maksimi (jakson alku)
                fd = grp["flash_duration"].values
                ticks = grp["tick"].values
                i = 0
                while i < len(fd):
                    # Uusi jakso alkaa
                    peak_val = fd[i]
                    peak_tick = ticks[i]
                    # Hypätään eteenpäin niin kauan kuin arvo laskee
                    j = i + 1
                    while j < len(fd) and fd[j] <= fd[j-1]:
                        j += 1
                    # Tallennetaan jakso
                    flash_rows.append((
                        demo_id,
                        tick_to_round_num(ii(peak_tick)),
                        ii(peak_tick),
                        None,  # thrower_steam_id — ei saatavilla tässä metodissa
                        ss(str(steam_id)) or None,
                        f(peak_val)
                    ))
                    i = j

            if flash_rows:
                cursor.executemany("""
                    INSERT INTO flash_events
                    (demo_id, round_num, tick, thrower_steam_id, blinded_steam_id, flash_duration)
                    VALUES (?,?,?,?,?,?)
                """, flash_rows)
            conn.commit()
            log(f"    Flash-tapahtumat: {len(flash_rows)}")
        else:
            log("    flash_duration-proppia ei löydy — flash-tapahtumat skipataan")
    except Exception as e:
        log(f"    [VAROITUS] Flash-parsinta: {e}")
        import traceback; log(traceback.format_exc())
    except Exception as e:
        log(f"    [VAROITUS] Flash-parsinta: {e}")

    conn.close()
    log(f"[OK] Valmis! Demo ID: {demo_id}")
    return demo_id


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Käyttö: python parser.py <polku/demo.dem> [--force]")
        sys.exit(1)
    force = "--force" in sys.argv
    parse_and_store(sys.argv[1], force=force)
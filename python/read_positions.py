import sys
import os
import io
import json
import math

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def main():
    if len(sys.argv) < 4:
        print("ERROR: tarvitaan argumentit: parquet_path round_num out_file")
        sys.exit(1)

    parquet_path = sys.argv[1]
    round_num    = int(sys.argv[2])
    out_file     = sys.argv[3]

    if not os.path.exists(parquet_path):
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump([], f)
        print("OK:0")
        sys.exit(0)

    import pandas as pd

    df = pd.read_parquet(parquet_path)

    round_col = None
    for c in ["round", "round_num"]:
        if c in df.columns:
            round_col = c
            break

    if round_col:
        df = df[df[round_col] == round_num]

    if df.empty:
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump([], f)
        print("OK:0")
        sys.exit(0)

    # Debug — tulostetaan 3 ensimmäistä riviä raakana
    sys.stderr.write(f"[DEBUG] columns: {list(df.columns)}\n")
    sys.stderr.write(f"[DEBUG] rows: {len(df)}\n")
    if "inventory" in df.columns:
        sample = df["inventory"].iloc[0]
        sys.stderr.write(f"[DEBUG] inventory[0] type={type(sample)} val={repr(sample)}\n")
    if "balance" in df.columns:
        sample = df["balance"].iloc[0]
        sys.stderr.write(f"[DEBUG] balance[0] type={type(sample)} val={repr(sample)}\n")
    if "active_weapon_name" in df.columns:
        sample = df["active_weapon_name"].iloc[0]
        sys.stderr.write(f"[DEBUG] active_weapon_name[0]={repr(sample)}\n")

    def sf(v):
        if v is None: return 0.0
        try:
            fv = float(v)
            return 0.0 if (math.isnan(fv) or math.isinf(fv)) else fv
        except: return 0.0

    def si(v):
        if v is None: return 0
        try:
            fv = float(v)
            return 0 if (math.isnan(fv) or math.isinf(fv)) else int(fv)
        except: return 0

    # Display-nimi → weapon key mapping
    DISPLAY_TO_KEY: dict = {
        'ak-47': 'ak47', 'ak47': 'ak47',
        'aug': 'aug',
        'awp': 'awp',
        'pp-bizon': 'bizon', 'bizon': 'bizon',
        'cz75-auto': 'cz75a', 'cz75a': 'cz75a',
        'desert eagle': 'deagle', 'deagle': 'deagle',
        'decoy grenade': 'decoy', 'decoy': 'decoy',
        'famas': 'famas',
        'five-seven': 'fiveseven', 'five sevens': 'fiveseven',
        'g3sg1': 'g3sg1',
        'galil ar': 'galilar', 'galil': 'galilar',
        'glock-18': 'glock', 'glock': 'glock',
        'he grenade': 'hegrenade', 'high explosive grenade': 'hegrenade',
        'flashbang': 'flashbang',
        'incendiary grenade': 'incgrenade',
        'molotov cocktail': 'molotov', 'molotov': 'molotov',
        'smoke grenade': 'smokegrenade',
        'm249': 'm249',
        'm4a1-s': 'm4a1_silencer', 'm4a1 silencer': 'm4a1_silencer',
        'm4a1': 'm4a1',
        'm4a4': 'm4a4',
        'mac-10': 'mac10', 'mac10': 'mac10',
        'mag-7': 'mag7', 'mag7': 'mag7',
        'mp5-sd': 'mp5sd', 'mp5sd': 'mp5sd',
        'mp7': 'mp7',
        'mp9': 'mp9',
        'negev': 'negev',
        'nova': 'nova',
        'p2000': 'p2000',
        'p250': 'p250',
        'p90': 'p90',
        'r8 revolver': 'revolver', 'revolver': 'revolver',
        'sawed-off': 'sawedoff', 'sawedoff': 'sawedoff',
        'scar-20': 'scar20', 'scar20': 'scar20',
        'sg 553': 'sg553', 'sg553': 'sg553', 'sg556': 'sg556',
        'ssg 08': 'ssg08', 'ssg08': 'ssg08',
        'tec-9': 'tec9', 'tec9': 'tec9',
        'ump-45': 'ump45', 'ump45': 'ump45',
        'usp-s': 'usp_silencer', 'usp silencer': 'usp_silencer',
        'xm1014': 'xm1014',
        'zeus x27': 'zeus', 'zeus': 'zeus',
        'c4 explosive': 'c4', 'c4': 'c4',
    }
    # Kaikki veitset → knife
    KNIFE_WORDS = ['knife', 'karambit', 'bayonet', 'flip', 'gut ', 'huntsman',
                   'falchion', 'shadow', 'bowie', 'butterfly', 'navaja', 'stiletto',
                   'talon', 'ursus', 'classic', 'paracord', 'survival', 'nomad',
                   'skeleton', 'kukri']

    def display_to_weapon_key(name: str) -> str | None:
        if not name: return None
        low = name.lower().strip()
        # Suora match
        if low in DISPLAY_TO_KEY:
            return DISPLAY_TO_KEY[low]
        # Veitsicheck
        if any(k in low for k in KNIFE_WORDS):
            return 'knife'
        return None

    records = []
    for _, row in df.iterrows():
        raw_inv = row.get("inventory", None)
        inv_list = []
        # Parquetista luettu lista voi olla numpy.ndarray eikä list — käytetään hasattr
        if raw_inv is not None and hasattr(raw_inv, '__iter__') and not isinstance(raw_inv, (str, bytes)):
            for item in raw_inv:
                if hasattr(item, '__iter__') and not isinstance(item, (str, bytes)):
                    for sub in item:
                        k = display_to_weapon_key(str(sub))
                        if k: inv_list.append(k)
                else:
                    k = display_to_weapon_key(str(item))
                    if k: inv_list.append(k)

        records.append({
            "tick":          si(row.get("tick", 0)),
            "steam_id":      str(row.get("steamid", "") or ""),
            "x":             sf(row.get("X", 0.0)),
            "y":             sf(row.get("Y", 0.0)),
            "z":             sf(row.get("Z", 0.0)),
            "yaw":           sf(row.get("yaw", 0.0)),
            "pitch":         sf(row.get("pitch", 0.0)),
            "velocity_x":    sf(row.get("velocity_X", 0.0)),
            "velocity_y":    sf(row.get("velocity_Y", 0.0)),
            "velocity_z":    sf(row.get("velocity_Z", 0.0)),
            "is_alive":      bool(row.get("is_alive", False)),
            "is_ducking":    bool(row.get("is_ducking", False)),
            "is_scoped":     bool(row.get("is_scoped", False)),
            "is_airborne":   bool(row.get("is_airborne", False)),
            "is_blinded":    False,
            "health":        si(row.get("health", 0)),
            "armor":         si(row.get("armor_value", 0)),
            "helmet":        bool(row.get("has_helmet", False)),
            "active_weapon": str(row.get("active_weapon_name", "") or ""),
            "equip_value":   si(row.get("current_equip_value", 0)),
            "cash":          si(row.get("balance", 0)),
            "inventory":     inv_list,
        })

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(records, f)

    print(f"OK:{len(records)}")

if __name__ == "__main__":
    main()
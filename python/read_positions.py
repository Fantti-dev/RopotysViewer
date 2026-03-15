import sys, os, io, json, math

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

DISPLAY_TO_KEY = {
    'ak-47':'ak47','ak47':'ak47','aug':'aug','awp':'awp','pp-bizon':'bizon','bizon':'bizon',
    'cz75-auto':'cz75a','cz75a':'cz75a','desert eagle':'deagle','deagle':'deagle',
    'decoy grenade':'decoy','decoy':'decoy','famas':'famas','five-seven':'fiveseven',
    'g3sg1':'g3sg1','galil ar':'galilar','galil':'galilar','glock-18':'glock','glock':'glock',
    'he grenade':'hegrenade','high explosive grenade':'hegrenade','flashbang':'flashbang',
    'incendiary grenade':'incgrenade','molotov cocktail':'molotov','molotov':'molotov',
    'smoke grenade':'smokegrenade','m249':'m249','m4a1-s':'m4a1_silencer',
    'm4a1 silencer':'m4a1_silencer','m4a1':'m4a1','m4a4':'m4a4','mac-10':'mac10',
    'mag-7':'mag7','mp5-sd':'mp5sd','mp7':'mp7','mp9':'mp9','negev':'negev','nova':'nova',
    'p2000':'p2000','p250':'p250','p90':'p90','r8 revolver':'revolver','sawed-off':'sawedoff',
    'scar-20':'scar20','sg 553':'sg553','ssg 08':'ssg08','tec-9':'tec9','ump-45':'ump45',
    'usp-s':'usp_silencer','usp silencer':'usp_silencer','xm1014':'xm1014',
    'zeus x27':'zeus','zeus':'zeus','c4 explosive':'c4','c4':'c4',
}
KNIFE_WORDS = ['knife','karambit','bayonet','flip','gut ','huntsman','falchion','shadow',
               'bowie','butterfly','navaja','stiletto','talon','ursus','classic',
               'paracord','survival','nomad','skeleton','kukri']

def display_to_weapon_key(name):
    if not name: return None
    low = name.lower().strip()
    if low in DISPLAY_TO_KEY: return DISPLAY_TO_KEY[low]
    if any(k in low for k in KNIFE_WORDS): return 'knife'
    return None

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

def main():
    if len(sys.argv) < 3:
        print("[]"); return
    parquet_path = sys.argv[1]
    round_num    = int(sys.argv[2])
    if not os.path.exists(parquet_path):
        print("[]"); return

    import pandas as pd
    df = pd.read_parquet(parquet_path)
    round_col = next((c for c in ["round","round_num"] if c in df.columns), None)
    if round_col:
        df = df[df[round_col] == round_num]
    if df.empty:
        print("[]"); return

    records = []
    for _, row in df.iterrows():
        raw_inv = row.get("inventory", None)
        inv_list = []
        if raw_inv is not None and hasattr(raw_inv,'__iter__') and not isinstance(raw_inv,(str,bytes)):
            for item in raw_inv:
                if hasattr(item,'__iter__') and not isinstance(item,(str,bytes)):
                    for sub in item:
                        k = display_to_weapon_key(str(sub))
                        if k: inv_list.append(k)
                else:
                    k = display_to_weapon_key(str(item))
                    if k: inv_list.append(k)
        records.append({
            "tick":si(row.get("tick",0)),"steam_id":str(row.get("steamid","") or ""),
            "x":sf(row.get("X",0.0)),"y":sf(row.get("Y",0.0)),"z":sf(row.get("Z",0.0)),
            "yaw":sf(row.get("yaw",0.0)),"pitch":sf(row.get("pitch",0.0)),
            "velocity_x":sf(row.get("velocity_X",0.0)),"velocity_y":sf(row.get("velocity_Y",0.0)),
            "velocity_z":sf(row.get("velocity_Z",0.0)),
            "is_alive":bool(row.get("is_alive",False)),"is_ducking":bool(row.get("is_ducking",False)),
            "is_scoped":bool(row.get("is_scoped",False)),"is_airborne":bool(row.get("is_airborne",False)),
            "is_blinded":False,"health":si(row.get("health",0)),"armor":si(row.get("armor_value",0)),
            "helmet":bool(row.get("has_helmet",False)),"active_weapon":str(row.get("active_weapon_name","") or ""),
            "equip_value":si(row.get("current_equip_value",0)),"cash":si(row.get("balance",0)),
            "inventory":inv_list,
        })
    json.dump(records, sys.stdout)

if __name__ == "__main__":
    main()
import sys, os, io, json, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def main():
    if len(sys.argv) < 4:
        print("[]"); return
    parquet_path = sys.argv[1]
    demo_id      = int(sys.argv[2])
    round_num    = int(sys.argv[3])
    if not os.path.exists(parquet_path):
        print("[]"); return

    try:
        import pyodbc
        conn = pyodbc.connect(
            "DRIVER={ODBC Driver 17 for SQL Server};"
            "SERVER=localhost,1433;DATABASE=cs2demos;"
            "UID=cs2user;PWD=cs2pass123!;TrustServerCertificate=yes"
        )
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM grenades WHERE demo_id=? AND round_num=?", demo_id, round_num)
        grenade_ids = set(row[0] for row in cursor.fetchall())
        conn.close()
    except Exception as e:
        sys.stderr.write(f"SQL error: {e}\n")
        print("[]"); return

    if not grenade_ids:
        print("[]"); return

    import pandas as pd
    df = pd.read_parquet(parquet_path)
    if "grenade_id" not in df.columns:
        print("[]"); return
    df = df[df["grenade_id"].isin(grenade_ids)]
    if df.empty:
        print("[]"); return

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

    records = []
    for row in df.itertuples(index=False):
        records.append({
            "id":0,"grenade_id":si(getattr(row,"grenade_id",0)),
            "tick":si(getattr(row,"tick",0)),
            "x":sf(getattr(row,"x",0.0)),"y":sf(getattr(row,"y",0.0)),"z":sf(getattr(row,"z",0.0)),
        })
    json.dump(records, sys.stdout)

if __name__ == "__main__":
    main()
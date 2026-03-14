"""
read_inferno_fires.py
Lukee inferno_fires parquetista roundin mukaan.
Argumentit: parquet_path demo_id round_num out_file
"""
import sys, os, io, json, math

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def main():
    if len(sys.argv) < 5:
        print("ERROR: tarvitaan: parquet_path demo_id round_num out_file")
        sys.exit(1)

    parquet_path = sys.argv[1]
    demo_id      = int(sys.argv[2])
    round_num    = int(sys.argv[3])
    out_file     = sys.argv[4]

    def empty():
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump([], f)
        print("OK:0")

    if not os.path.exists(parquet_path):
        empty(); sys.exit(0)

    import pandas as pd, pyodbc

    try:
        conn = pyodbc.connect(
            "DRIVER={ODBC Driver 17 for SQL Server};"
            "SERVER=localhost,1433;"
            "DATABASE=cs2demos;"
            "UID=cs2user;PWD=cs2pass123!;"
            "TrustServerCertificate=yes"
        )
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM grenades WHERE demo_id=? AND round_num=? AND grenade_type IN ('molotov','incgrenade')",
            demo_id, round_num
        )
        grenade_ids = set(row[0] for row in cursor.fetchall())
        conn.close()
    except Exception as e:
        sys.stderr.write(f"SQL error: {e}\n")
        empty(); sys.exit(0)

    if not grenade_ids:
        empty(); sys.exit(0)

    df = pd.read_parquet(parquet_path)
    if "grenade_id" not in df.columns:
        empty(); sys.exit(0)

    df = df[df["grenade_id"].isin(grenade_ids)]
    if df.empty:
        empty(); sys.exit(0)

    def sf(v):
        try:
            fv = float(v)
            return 0.0 if (math.isnan(fv) or math.isinf(fv)) else fv
        except: return 0.0

    def si(v):
        try:
            fv = float(v)
            return 0 if (math.isnan(fv) or math.isinf(fv)) else int(fv)
        except: return 0

    records = []
    for row in df.itertuples(index=False):
        records.append({
            "grenade_id": si(getattr(row, "grenade_id", 0)),
            "tick":       si(getattr(row, "tick", 0)),
            "x":          sf(getattr(row, "x", 0.0)),
            "y":          sf(getattr(row, "y", 0.0)),
        })

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(records, f)

    print(f"OK:{len(records)}")

if __name__ == "__main__":
    main()

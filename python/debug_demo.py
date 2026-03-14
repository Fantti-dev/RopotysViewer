import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from demoparser2 import DemoParser

if len(sys.argv) < 2:
    print("Kaytto: python debug_demo.py demo.dem")
    sys.exit(1)

parser = DemoParser(sys.argv[1])

print("=== parse_header ===")
h = parser.parse_header()
print(h)

print("\n=== parse_player_info ===")
try:
    pi = parser.parse_player_info()
    print(type(pi))
    print(pi)
except Exception as e:
    print(f"VIRHE: {e}")

print("\n=== player_connect_full ===")
try:
    pc = parser.parse_event("player_connect_full")
    print(type(pc))
    if hasattr(pc, 'columns'):
        print("Sarakkeet:", pc.columns.tolist())
        print(pc.head(5).to_string())
    else:
        print(repr(pc))
except Exception as e:
    print(f"VIRHE: {e}")

print("\n=== player_spawn ===")
try:
    ps = parser.parse_event("player_spawn")
    print(type(ps))
    if hasattr(ps, 'columns'):
        print("Sarakkeet:", ps.columns.tolist())
        print(ps.head(5).to_string())
    else:
        print(repr(ps))
except Exception as e:
    print(f"VIRHE: {e}")

print("\n=== parse_ticks nayte (3 rivia) ===")
try:
    ticks = parser.parse_ticks(["X","Y","Z","is_alive","health"])
    print(type(ticks))
    if hasattr(ticks, 'columns'):
        print("Sarakkeet:", ticks.columns.tolist())
        print(ticks.head(3).to_string())
    else:
        print(repr(ticks))
except Exception as e:
    print(f"VIRHE: {e}")
import sys
from demoparser2 import DemoParser

parser = DemoParser(sys.argv[1])

print("=== round_start ===")
rs = parser.parse_event("round_start")
print(rs[["tick","round"]].to_string())

print("\n=== round_announce_match_start ===")
try: print(parser.parse_event("round_announce_match_start")[["tick"]].to_string())
except: print("ei löydy")

print("\n=== begin_new_match ===")
try: print(parser.parse_event("begin_new_match")[["tick"]].to_string())
except: print("ei löydy")

print("\n=== cs_intermission ===")
try: print(parser.parse_event("cs_intermission")[["tick"]].to_string())
except: print("ei löydy")
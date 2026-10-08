"""Simple mutation fuzzer for the input boundary (drone_id + waypoint validators)."""
import math
import pathlib
import random
import string
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app import command_service as cs

random.seed(1337)                       # reproducible
ITERATIONS = 200_000
SEEDS = ["DRN-ABC123", "DRN-ABC123\n", "'; DROP TABLE drones;--", "$(reboot)", "`id`",
         "%s%s%n", "A" * 5000, "\x00", "\u202e", "1e999", "nan", "-0", "../../etc/passwd"]
ALPHABET = string.printable + "\x00\u202e\u00e9\u0661"


def mutate(s: str) -> str:
    s = list(s) or ["A"]
    for _ in range(random.randint(1, 4)):
        op = random.choice(("ins", "del", "flip", "dup"))
        i = random.randrange(len(s))
        if op == "ins":
            s.insert(i, random.choice(ALPHABET))
        elif op == "del" and len(s) > 1:
            del s[i]
        elif op == "flip":
            s[i] = random.choice(ALPHABET)
        else:
            s[i:i] = s[i:i + random.randint(1, 5)]
    return "".join(s)


def main() -> int:
    failures, accepted_ids = [], 0
    for _ in range(ITERATIONS):
        cand = mutate(random.choice(SEEDS))
        # --- drone_id boundary ---
        try:
            out = cs.validate_drone_id(cand)
            accepted_ids += 1
            ok = len(out) == 10 and set(out) <= set(string.ascii_uppercase + string.digits + "-")
            if not ok:
                failures.append(("drone_id accepted unsafe value", repr(cand)))
        except cs.ValidationError:
            pass
        except Exception as e:                       # any other exception = crash
            failures.append(("drone_id crashed", repr(cand), type(e).__name__))
        # --- waypoint boundary ---
        a, b, c = (mutate(random.choice(SEEDS)) for _ in range(3))
        try:
            lat, lon, alt = cs.validate_waypoint(a, b, c)
            if not (math.isfinite(lat) and -90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= alt <= cs.MAX_ALT_M):
                failures.append(("waypoint accepted out-of-range", repr((a, b, c))))
        except cs.ValidationError:
            pass
        except Exception as e:
            failures.append(("waypoint crashed", repr((a, b, c)), type(e).__name__))
    print(f"iterations={ITERATIONS} accepted_ids={accepted_ids} failures={len(failures)}")
    for f in failures[:10]:
        print("FAIL:", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

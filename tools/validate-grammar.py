import json, pathlib, collections, sys

GROUPS = {'Tenses','Future and Conditionals','Modality','Voice and Reporting',
          'Clause Structure','The Noun Phrase','Verb Patterns and Prepositions',
          'Precision and Style'}
d = pathlib.Path('data/grammar')
problems = collections.defaultdict(list)
idx_hist = collections.Counter()
per_file_idx = {}
tot_q = 0

for f in sorted(d.glob('*.json')):
    name = f.stem
    try:
        m = json.loads(f.read_text())
    except Exception as e:
        problems[name].append(f"INVALID JSON: {e}"); continue

    if m.get('id') != name: problems[name].append(f"id {m.get('id')!r} != filename")
    if m.get('group') not in GROUPS: problems[name].append(f"unknown group {m.get('group')!r}")
    if len(m.get('summary','')) > 140: problems[name].append("summary over 140 chars")

    secs = m.get('sections') or []
    if not 4 <= len(secs) <= 6: problems[name].append(f"{len(secs)} sections (want 4-6)")
    for i, s in enumerate(secs):
        ex = s.get('examples') or []
        if not 2 <= len(ex) <= 4: problems[name].append(f"section {i+1}: {len(ex)} examples (want 2-4)")
        if not s.get('heading'): problems[name].append(f"section {i+1}: no heading")
        if not s.get('body'): problems[name].append(f"section {i+1}: no body")
        for j, e in enumerate(ex):
            if not e.get('right'): problems[name].append(f"section {i+1} ex {j+1}: no 'right'")

    slips = m.get('slips') or []
    if not 4 <= len(slips) <= 6: problems[name].append(f"{len(slips)} slips (want 4-6)")

    qs = m.get('questions') or []
    tot_q += len(qs)
    if len(qs) != 12: problems[name].append(f"{len(qs)} questions (want 12)")
    kinds = collections.Counter(q.get('type') for q in qs)
    if kinds['mcq'] != 7 or kinds['blank'] != 5:
        problems[name].append(f"types {dict(kinds)} (want 7 mcq / 5 blank)")

    seen_prompts = set()
    local = []
    for i, q in enumerate(qs):
        w = f"q{i+1}"
        p = q.get('prompt','')
        if '___' not in p: problems[name].append(f"{w}: no ___ gap")
        if p in seen_prompts: problems[name].append(f"{w}: duplicate prompt")
        seen_prompts.add(p)
        if not q.get('explain'): problems[name].append(f"{w}: no explain")
        if q.get('type') == 'mcq':
            opts = q.get('options') or []
            if len(opts) != 4: problems[name].append(f"{w}: {len(opts)} options (want 4)")
            if len(set(opts)) != len(opts): problems[name].append(f"{w}: duplicate options")
            a = q.get('answer')
            if not isinstance(a, int) or not (0 <= a < len(opts)):
                problems[name].append(f"{w}: answer {a!r} out of range")
            else:
                idx_hist[a] += 1; local.append(a)
        elif q.get('type') == 'blank':
            acc = q.get('accept')
            if not isinstance(acc, list) or not acc or not all(isinstance(x,str) and x.strip() for x in acc):
                problems[name].append(f"{w}: bad accept list {acc!r}")
            else:
                if len(set(x.strip().lower() for x in acc)) != len(acc):
                    problems[name].append(f"{w}: duplicate accept entries")
        else:
            problems[name].append(f"{w}: unknown type {q.get('type')!r}")
    per_file_idx[name] = local

print(f"{len(list(d.glob('*.json')))} modules · {tot_q} questions")
print("mcq key positions overall:", dict(sorted(idx_hist.items())))
flat = [n for n, l in per_file_idx.items() if len(set(l)) <= 1 and len(l) > 2]
if flat: print("!! modules whose mcq keys are all in one position:", flat)
if problems:
    print("\nPROBLEMS")
    for k, v in problems.items():
        for x in v: print(f"  {k}: {x}")
else:
    print("\nno schema problems")

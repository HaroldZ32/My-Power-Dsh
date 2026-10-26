import json, sys, time
seen = set()
def sends():
    out = []
    try:
        with open('.mpd/team/mailbox.jsonl', 'r', encoding='utf-8', errors='replace') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get('t') == 'send' and str(d.get('toName')) == 'w4-verifier':
                    out.append(d)
    except FileNotFoundError:
        pass
    return out
for d in sends():
    seen.add(d.get('id'))
deadline = time.time() + float(sys.argv[1])
print('baseline sends:', len(seen), flush=True)
while time.time() < deadline:
    for d in sends():
        if d.get('id') not in seen:
            seen.add(d.get('id'))
            print('NEW MAIL', d.get('id'), '|', d.get('subject'), flush=True)
            print('BODY:', (d.get('body') or '')[:1600], flush=True)
    time.sleep(5)
print('watch ended', flush=True)

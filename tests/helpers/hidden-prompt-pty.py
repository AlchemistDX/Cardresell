# Offline terminal tests. Python 3, Unix PTY; no real credentials or network.
import os, pty, subprocess, select
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SECRET = b'SYNTHETIC_INPUT_SENTINEL_90210'
def start(script):
    m,s=pty.openpty()
    p=subprocess.Popen(['node', 'tools/'+script], cwd=ROOT, stdin=s, stdout=s, stderr=s)
    os.close(s)
    return m,p
def read(m):
    out=b''
    while select.select([m],[],[],0.2)[0]:
        try: out+=os.read(m,65536)
        except OSError: break
    return out
def send(m,data):
    os.write(m,data)
    return read(m)
for script,prompt in [('compare-cert-generation.mjs',b'Vercel-stored EBAY_CERT_ID: '),('verify-ebay-credential.mjs',b'Production App ID  (hidden): '),('verify-challenge.mjs',b'Verification token (hidden): ')]:
    m,p=start(script)
    try:
        initial=read(m)
        assert initial.endswith(prompt), (script,initial)
        # Individual keystrokes must produce NO output, even temporarily.
        for ch in SECRET: assert send(m,bytes([ch])) == b'', script
        out=send(m,b'\x03')
        assert SECRET not in out
        assert p.wait(timeout=3)!=0
    finally:
        if p.poll() is None: p.kill();p.wait()
        os.close(m)
    q=subprocess.run(['node','tools/'+script],cwd=ROOT,input=SECRET,capture_output=True)
    assert q.returncode!=0 and SECRET not in q.stdout+q.stderr
    print('PASS visible prompt, no keystroke echo, Ctrl+C, pipe refusal:',script)
for suffix in [b'',b' ']:
    m,p=start('compare-cert-generation.mjs')
    try:
        assert b'Vercel-stored' in read(m)
        out=send(m,SECRET+suffix+b'\r');assert SECRET not in out and b'How many' in out
        out=send(m,b'1\r');assert b'label' in out
        out=send(m,b'portal-current\r');assert out.endswith(b'  Generation 1 value: ')
        out=send(m,SECRET+b'\r');assert SECRET not in out
        assert (b'NO MATCH' if suffix else b'MATCH:') in out
        assert p.wait(timeout=3)==0
    finally:
        if p.poll() is None:p.kill();p.wait()
        os.close(m)
print('PASS full comparison: match and whitespace mismatch')

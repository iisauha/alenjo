#!/usr/bin/env python3
"""Write Alenjo's Content-Security-Policy into index.html.

The policy tells the browser where code may come from. Inline <script> blocks are allowed only
by their exact fingerprint (sha256), so a script slipped into the page some other way won't
run. release.sh calls this after stamping the version, because one inline script holds the
version number and its fingerprint changes with every release.
"""
import base64, hashlib, re, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
SUPABASE = 'https://itkufrockebnlzcroigc.supabase.co'

html = open(PATH, encoding='utf-8').read()
inline = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
hashes = ["'sha256-%s'" % base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode() for s in inline]

policy = '; '.join([
    "default-src 'self'",
    # App code, Plaid Link, and the image cropper (pinned version, integrity checked)
    "script-src 'self' " + ' '.join(hashes) + " https://cdn.plaid.com https://cdn.jsdelivr.net",
    "worker-src 'self'",
    "connect-src 'self' " + SUPABASE + " wss://itkufrockebnlzcroigc.supabase.co https://*.plaid.com data: blob:",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com",
    "frame-src https://cdn.plaid.com https://*.plaid.com",
    "manifest-src 'self'",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])
tag = '<meta http-equiv="Content-Security-Policy" content="%s">' % policy
if 'http-equiv="Content-Security-Policy"' in html:
    html = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', lambda m: tag, html, count=1)
else:
    html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  ' + tag, 1)
open(PATH, 'w', encoding='utf-8').write(html)
print('CSP: %d inline scripts fingerprinted' % len(hashes))

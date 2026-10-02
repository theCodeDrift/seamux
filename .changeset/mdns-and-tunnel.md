---
"seamux": patch
---

mDNS and the Cloudflare tunnel can now be on at the same time: turning one on in the Remote tab no longer turns the other off. Each keeps its own login, the password at the `.local` name and Cloudflare Access at the tunnel's hostname, and with mDNS on, a request from the network addressed to the tunnel's hostname is refused.

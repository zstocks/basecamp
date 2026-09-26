# Basecamp — backup and restore

Everything here assumes the VPS (`vps`, port 2222) and the Hetzner Storage Box
sub-account `u613904-sub3`.

## TL;DR — I need my data back right now

```bash
# On the VPS. Newest local backup:
ls -t /var/backups/basecamp/daily/ | head -5

# Restore it to a scratch file and look before you leap:
gunzip -c /var/backups/basecamp/daily/basecamp-YYYY-MM-DD_HHMMSS.db.gz > /tmp/restored.db
sqlite3 /tmp/restored.db "PRAGMA integrity_check; SELECT COUNT(*) FROM habits;"

# Happy with it? Swap it in:
cd ~/apps/basecamp
docker compose down
sudo cp data/basecamp.db data/basecamp.db.broken-$(date +%F)   # keep the bad one
sudo rm -f data/basecamp.db-wal data/basecamp.db-shm           # stale WAL vs new db = corruption
sudo cp /tmp/restored.db data/basecamp.db
docker compose up -d
```

**Delete the `-wal` and `-shm` files.** A leftover WAL from the old database
paired with a restored one is how you turn a recoverable problem into an
unrecoverable one.

## If the VPS is gone entirely

The backups do not depend on the VPS. From any machine with an SSH key for the
sub-account (the key lives at `/root/.ssh/box_basecamp` on the VPS — if that is
gone too, use the sub-account password from your password manager):

```bash
sftp -P 23 u613904-sub3@u613904.your-storagebox.de
> ls daily
> get daily/basecamp-YYYY-MM-DD_HHMMSS.db.gz
> quit

gunzip -c basecamp-*.db.gz > restored.db
sqlite3 restored.db "SELECT * FROM body_metrics ORDER BY date DESC LIMIT 10;"
```

The archive is a plain gzipped SQLite file. No proprietary format, no tooling to
install, nothing to decrypt. That was a deliberate choice: restore-under-stress
beats feature count.

## How it works

| Piece | What it does | Where |
|---|---|---|
| `scripts/backup.sh` | snapshot → verify → compress → retain → push off-site | daily 03:30 |
| `scripts/verify-backup.sh` | downloads the newest **off-site** copy and proves it restores | Sundays 04:00 |
| `scripts/pre-deploy.sh` | local snapshot before `docker compose up` runs migrations | every deploy |

Retention: 14 daily, 8 weekly (Sundays), 12 monthly (1st of the month). At ~6 KB
per snapshot the whole history is well under a megabyte.

### Why `sqlite3 .backup` and never `cp`

The database runs in WAL mode. On 2026-09-26 the live `basecamp.db` was **4 KB**
while `basecamp.db-wal` held **1.2 MB** — every row was in the WAL. Copying
`basecamp.db` alone was tested and restored to **zero tables**.

`.backup` uses SQLite's online backup API: it takes a read lock and folds the WAL
into one consistent file, safely, while the app is running. If you ever copy
files by hand instead, you must take **all three** of `.db`, `-wal` and `-shm`
together.

### Why the off-site copy is append-only

`rsync` runs **without `--delete`**. Local retention prunes; the Storage Box
keeps everything. If a bug or a bad command empties `/var/backups/basecamp`,
that deletion must not replicate to the only surviving copy. ~2 MB/year on a
5 TB box is not worth optimising.

## Checking on it

```bash
systemctl list-timers 'basecamp-*'              # when did it last run, when is next
journalctl -u basecamp-backup.service -n 50     # what happened last time
journalctl -u basecamp-backup-verify.service -n 50
cat /var/backups/basecamp/last-backup.json      # machine-readable status
cat /var/backups/basecamp/last-verify.json

sudo systemctl start basecamp-backup.service    # force one now
sudo /home/zstox/apps/basecamp/scripts/verify-backup.sh   # force a restore drill
```

A failed run leaves the unit in a `failed` state, so `systemctl list-timers` and
`systemctl --failed` will show it.

**Known weak point:** nothing actively *notifies* you when a backup fails — you
have to look. The planned fix is to surface "last backup age" from
`last-backup.json` inside Basecamp itself, so the app you open daily tells you
when its own backups have stopped.

## Storage Box setup (for next time)

Sub-accounts follow one pattern per app:

| | |
|---|---|
| Host / port | `u613904.your-storagebox.de` : `23` |
| Sub-account | `u613904-sub3`, base directory `/basecamp/` |
| Settings | SSH ✓, External reachability ✓, SMB ✗, WebDAV ✗, Read-only ✗ |
| Key on VPS | `/root/.ssh/box_basecamp`, ed25519, no passphrase (timers run unattended) |
| Key comment | `basecamp-vps->storagebox` |

To create another:

```bash
sudo ssh-keygen -t ed25519 -f /root/.ssh/box_<app> -N "" -C "<app>-vps->storagebox"
sudo bash -c 'cat /root/.ssh/box_<app>.pub | ssh -p 23 u613904-subN@u613904.your-storagebox.de install-ssh-key'
sudo ssh -p 23 -i /root/.ssh/box_<app> -o BatchMode=yes u613904-subN@u613904.your-storagebox.de ls
```

Two gotchas, both learned the hard way:

- **The key lives in `<base directory>/.ssh/authorized_keys`.** Change the base
  directory in the panel and you orphan the key — rerun `install-ssh-key`.
- **Storage Box SSH is a restricted shell.** It takes one command, not a chain.
  `mkdir foo && ls -la` silently does nothing and returns success. Run commands
  separately and check `$?`.

## Installing the timers

```bash
cd ~/apps/basecamp
chmod +x scripts/*.sh
sudo cp deploy/systemd/basecamp-backup*.service deploy/systemd/basecamp-backup*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now basecamp-backup.timer basecamp-backup-verify.timer
systemctl list-timers 'basecamp-*'
```

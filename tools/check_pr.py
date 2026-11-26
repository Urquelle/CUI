#!/usr/bin/env python3
"""Lists what a range of commits adds that a reviewer must look at closely.

    python3 tools/check_pr.py BASE HEAD [--strict] [--github]

It reads the changes from BASE's merge base with HEAD up to HEAD, and the commit
messages in that range, from git's objects only: it never checks out, builds or
runs what it reads, so it can look at an untrusted pull request safely.

Two kinds of findings:

  block   must not land as it is: characters that hide text or change its
          direction (the "Trojan Source" trick), secrets, session links and
          other private links, symbolic links, submodules, and binary files
          outside the image and font folders.
  review  fine in itself but needs a careful look: changes to CI, release and
          site machinery, build commands that run programs or download, and
          instructions for AI agents; new calls that run programs, load code,
          delete files or open network connections; downloads and shell tricks
          in scripts; long encoded strings and large files.

Exits with 1 when there is a block finding, or with --strict a review finding.
--github also writes GitHub annotations and a job summary. Findings never quote
the changed text: a secret is not repeated and a line from a pull request
cannot pass as a command to the CI runner.
"""
import os
import re
import subprocess
import sys
import unicodedata

# ---------------------------------------------------------------------------
# What the checks look for. Patterns are written so that this file does not
# match them itself.

# Direction overrides and isolates reorder how code is shown (the "Trojan Source"
# trick); zero-width spaces, word joiners, line separators and tag characters
# hide text. Joiners and direction marks are ordinary in Persian, Arabic, Indic
# and emoji text, and cannot reorder code, so they only need a look.
HIDDEN_CHARS = {0x200B, 0x2028, 0x2029, 0xFEFF} | set(range(0x202A, 0x202F)) | \
    set(range(0x2060, 0x2065)) | set(range(0x2066, 0x206A)) | set(range(0xE0000, 0xE0080))
JOINER_CHARS = {0x00AD, 0x061C, 0x180E, 0x200C, 0x200D, 0x200E, 0x200F}

SECRETS = [
    (r"gh[pousr]_[A-Za-z0-9]{36}", "a GitHub token"),
    (r"github_pat_[A-Za-z0-9_]{40,}", "a GitHub token"),
    (r"\bAKIA[0-9A-Z]{16}\b", "an AWS access key"),
    (r"\bAIza[0-9A-Za-z_\-]{35}\b", "a Google API key"),
    (r"\bsk-ant-[A-Za-z0-9_\-]{20,}", "an Anthropic API key"),
    (r"\bsk-(proj-)?[A-Za-z0-9]{32,}", "an API key"),
    (r"\bxox[abposr]-[A-Za-z0-9\-]{10,}", "a Slack token"),
    (r"-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}", "a private key"),
]
PRIVATE_LINKS = [
    (r"claude\.ai/(code|chat|share|project)/[^\s)\]>\"']+", "a link to a Claude session or chat"),
    (r"\bsession_[0-9A-Za-z]{16,}", "a session ID"),
    (r"chatgpt\.com/(c|share|g)/[^\s)\]>\"']+", "a link to a ChatGPT conversation"),
    (r"docs\.google\.com/[^\s)\]>\"']+/edit", "a link to a private document"),
]

CODE_EXT = (".c", ".h", ".m", ".mm", ".cpp", ".cc", ".inc", ".java", ".kt", ".swift")
RISKY_CALLS = [
    (r"\b(system|popen|_popen|_wpopen|execl|execlp|execle|execv|execvp|execvpe|posix_spawnp?|fork|vfork)\s*\(", "runs a program"),
    (r"\b(ShellExecute(Ex)?[AW]?|CreateProcess[AW]?|WinExec)\s*\(", "runs a program"),
    (r"\bNSTask\b|\bRuntime\.getRuntime\(\)\.exec|\bProcessBuilder\b", "runs a program"),
    (r"\b(dlopen|LoadLibrary(Ex)?[AW]?)\s*\(", "loads code by name"),
    (r"\b(socket|connect|getaddrinfo|gethostbyname|URLDownloadToFile[AW]?|InternetOpen[AW]?|WinHttpOpen)\s*\(", "opens a network connection"),
    (r"\bNSURLSession\b|\bNSURLConnection\b|\bURLConnection\b|\bHttpURLConnection\b", "opens a network connection"),
    (r"\b(remove|unlink|rmdir|DeleteFile[AW]?|RemoveDirectory[AW]?)\s*\(", "deletes files"),
]
SCRIPT_EXT = (".sh", ".py", ".mjs", ".js", ".cmake", ".yml", ".yaml", ".gradle", ".ps1", ".bat", ".cmd")
SCRIPT_RISKS = [
    (r"\b(curl|wget)\b|Invoke-WebRequest|\biwr\b|urlopen|urllib\.request|\bfetch\(", "downloads something"),
    (r"file\s*\(\s*DOWNLOAD|FetchContent|ExternalProject", "downloads something at build time"),
    (r"\|\s*(ba|z)?sh\b|\beval\b|\bexec\(|base64\s+(-d|--decode)|b64decode|fromCharCode", "runs generated or decoded code"),
    (r"execute_process|add_custom_(command|target)|install\s*\(\s*(CODE|SCRIPT)|subprocess|os\.system|child_process", "runs a program"),
    (r"\b(npm|pip|pip3|gem|cargo|go)\s+install\b|apt-get\s+install", "installs something"),
    (r"pull_request_target|secrets\.|GITHUB_TOKEN|permissions\s*:|id-token", "changes what CI may do"),
]
ENCODED_BLOB = re.compile(r"[A-Za-z0-9+/=]{200,}|(\\x[0-9A-Fa-f]{2}){48,}|(0x[0-9A-Fa-f]{2}\s*,\s*){64,}")

# Changes here run on GitHub's machines, on the machines of people who build CUI,
# in the browsers of the site's visitors, or tell an AI agent what to do.
SENSITIVE = [
    (r"^\.github/", "CI and repository settings: runs on GitHub's machines"),
    (r"^cmake/", "the build: runs on every machine that builds CUI"),
    (r"(^|/)(build|settings)\.gradle(\.kts)?$|(^|/)gradle\.properties$|(^|/)gradle-wrapper|(^|/)gradlew(\.bat)?$", "the Android build"),
    (r"^tools/|^web/tools/", "build and release tools"),
    (r"^third_party/|^web/shim/", "vendored code"),
    (r"^src/render/generated/", "generated shader code: regenerate it and compare"),
    (r"\.(sh|ps1|bat|cmd|py|mjs)$", "a script"),
    (r"^web/site/.*\.(js|html)$", "the docs site: runs in visitors' browsers"),
    (r"\.svg$", "an SVG image: can carry scripts"),
    (r"(^|/)(CLAUDE|AGENTS)\.md$|^\.claude/|^\.cursor|(^|/)\.cursorrules$|copilot-instructions\.md$", "instructions for AI agents"),
    (r"(^|/)\.git(attributes|modules)$", "git settings"),
]
BINARY_OK = re.compile(r"(^|/)(docs/images|web/site/img|assets/fonts)/.*\.(png|jpe?g|gif|webp|ttf|otf)$", re.I)
LARGE_FILE = 2 * 1024 * 1024

# ---------------------------------------------------------------------------

def git(*args):
    # no external diff programs and no textconv filters: nothing from the range is run
    cmd = ["git", "-c", "core.quotepath=off", "-c", "diff.noprefix=false"] + list(args)
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE).stdout


class Report:
    def __init__(self):
        self.items = []

    def add(self, level, path, line, what):
        item = (level, path, line, what)
        if item not in self.items:
            self.items.append(item)


def char_names(text, chars=HIDDEN_CHARS):
    found = sorted({ord(c) for c in text if ord(c) in chars})
    return ", ".join("U+%04X %s" % (c, unicodedata.name(chr(c), "")) for c in found)


def check_text(report, path, line, text, where_code, where_script, blob_ok):
    names = char_names(text)
    if names:
        report.add("block", path, line, "invisible or direction-changing character: " + names)
    names = char_names(text, JOINER_CHARS)
    if names:
        report.add("review", path, line, "joiner or direction mark, fine in right-to-left or emoji text: " + names)
    for pat, what in SECRETS:
        if re.search(pat, text):
            report.add("block", path, line, "looks like " + what)
    for pat, what in PRIVATE_LINKS:
        if re.search(pat, text):
            report.add("block", path, line, "contains " + what)
    if where_code:
        for pat, what in RISKY_CALLS:
            m = re.search(pat, text)
            if m:
                report.add("review", path, line, "new call that %s: %s" % (what, m.group(0).rstrip("( ")))
    if where_script:
        for pat, what in SCRIPT_RISKS:
            m = re.search(pat, text)
            if m:
                report.add("review", path, line, "%s: %s" % (what, m.group(0).strip()))
    if not blob_ok and ENCODED_BLOB.search(text):
        report.add("review", path, line, "a long encoded string: decode it and look at what it is")


def changed_files(base, head):
    """(status, old mode, new mode, path) for each file the range changes."""
    out = git("diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--raw", "-z", base + "..." + head)
    fields = out.split(b"\0")
    files = []
    i = 0
    while i + 1 < len(fields):
        meta = fields[i].decode("utf-8", "replace").split()
        path = fields[i + 1].decode("utf-8", "replace")
        i += 2
        if len(meta) < 5:
            continue
        files.append((meta[4][0], meta[0].lstrip(":"), meta[1], path))
    return files


def binary_files(base, head):
    out = git("diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z", base + "..." + head)
    found = set()
    for rec in out.split(b"\0"):
        parts = rec.split(b"\t", 2)
        if len(parts) == 3 and parts[0] == b"-" and parts[1] == b"-":
            found.add(parts[2].decode("utf-8", "replace"))
    return found


def added_lines(base, head, path):
    """(line number in the new file, text) for each added line of one file."""
    out = git("diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "-U0",
              base + "..." + head, "--", ":(literal)" + path)
    lines = []
    num = 0
    for raw in out.split(b"\n"):
        if raw.startswith(b"@@"):
            m = re.match(rb"@@ -\d+(?:,\d+)? \+(\d+)", raw)
            num = int(m.group(1)) if m else 0
        elif raw.startswith(b"+") and not raw.startswith(b"+++"):
            lines.append((num, raw[1:].decode("utf-8", "replace")))
            num += 1
    return lines


def check_range(base, head):
    report = Report()
    binaries = binary_files(base, head)
    for status, old_mode, new_mode, path in changed_files(base, head):
        for pat, why in SENSITIVE:
            if re.search(pat, path):
                report.add("review", path, 0, "changes %s" % why)
                break
        names = char_names(path)
        if names:
            report.add("block", path, 0, "invisible or direction-changing character in the file name: " + names)
        if status == "D":
            continue
        if new_mode == "120000":
            report.add("block", path, 0, "a symbolic link: it can point outside the repository")
            continue
        if new_mode == "160000":
            report.add("block", path, 0, "a submodule: it brings in code from another repository")
            continue
        if new_mode == "100755" and old_mode != "100755" and not path.endswith((".sh", ".py")):
            report.add("review", path, 0, "made executable")
        size = int(git("cat-file", "-s", "%s:%s" % (head, path)).strip() or 0)
        if size > LARGE_FILE:
            report.add("review", path, 0, "a large file (%.1f MB)" % (size / 1048576.0))
        if path in binaries:
            if not BINARY_OK.search(path):
                report.add("block", path, 0, "a binary file outside the image and font folders")
            continue
        lower = path.lower()
        where_code = lower.endswith(CODE_EXT)
        where_script = lower.endswith(SCRIPT_EXT) or lower.endswith("cmakelists.txt")
        blob_ok = path.startswith("src/render/generated/")
        for num, text in added_lines(base, head, path):
            check_text(report, path, num, text, where_code, where_script, blob_ok)
    log = git("log", "--format=%H%x00%B%x00", base + ".." + head).split(b"\0")
    for sha, body in zip(log[0::2], log[1::2]):
        sha = sha.decode().strip()[:7]
        text = body.decode("utf-8", "replace")
        where = "commit message " + sha
        for line in text.splitlines():
            check_text(report, where, 0, line, False, False, True)
    return report


def escape_data(s):
    return s.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def escape_property(s):
    return escape_data(s).replace(":", "%3A").replace(",", "%2C")


def printable(s):
    return "".join(c if c.isprintable() and ord(c) not in HIDDEN_CHARS | JOINER_CHARS else "?" for c in s)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    strict = "--strict" in argv
    github = "--github" in argv
    if len(args) != 2:
        print(__doc__.strip())
        return 2
    base, head = args
    report = check_range(base, head)
    blocks = [i for i in report.items if i[0] == "block"]
    reviews = [i for i in report.items if i[0] == "review"]
    for level, path, line, what in blocks + reviews:
        place = printable(path) + (":%d" % line if line else "")
        print("%-6s  %s: %s" % (level, place, what))
        if github and not path.startswith("commit message"):
            kind = "error" if level == "block" or strict else "warning"
            loc = "file=" + escape_property(path) + (",line=%d" % line if line else "")
            print("::%s %s::%s" % (kind, loc, escape_data(what)))
    if github and os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("## PR guard\n\n")
            if not report.items:
                f.write("Nothing found.\n")
            for title, group in (("Must not land as it is", blocks), ("Look closely", reviews)):
                if group:
                    f.write("### %s\n\n" % title)
                    for _, path, line, what in group:
                        place = printable(path).replace("`", "'") + (":%d" % line if line else "")
                        f.write("- `%s`: %s\n" % (place, what.replace("`", "'")))
                    f.write("\n")
    if not report.items:
        print("nothing found")
    print("%d to fix, %d to look at closely" % (len(blocks), len(reviews)))
    return 1 if blocks or (strict and reviews) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

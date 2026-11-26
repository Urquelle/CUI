#!/usr/bin/env python3
"""Checks a pull request's description for what docs/CONTRIBUTING.md asks of every
pull request: the disclosure block filled in, and test output pasted.

    python3 tools/check_pr_description.py [--github] < description.md

The description can also come in the PR_BODY environment variable, which is how
CI passes it. It lists what is missing and never repeats the description's text.
It also reports text that talks to an AI reviewer, as tools/check_pr.py does for
the code. Exits with 1 when something is missing; --github also writes a job
summary.
"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_check_pr():
    sys.dont_write_bytecode = True   # leave no __pycache__ in tools/
    spec = importlib.util.spec_from_file_location("check_pr", os.path.join(HERE, "check_pr.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def field(text, name):
    """The value after "name:" at the start of a line, or None."""
    m = re.search(r"^[ \t>*-]*" + name + r"\s*:[ \t]*(.*)$", text, re.I | re.M)
    return m.group(1).strip() if m else None


def placeholder(value):
    # the template's own text: "Human | AI agent | ...", "exact model name ...", "yes / no"
    return not value or "|" in value or "exact model name" in value.lower() or \
        re.fullmatch(r"yes\s*/\s*no", value.strip(), re.I) is not None


def section(text, title):
    m = re.search(r"^#+\s*" + title + r"[^\n]*\n(.*?)(?=^#+\s|\Z)", text, re.I | re.M | re.S)
    return m.group(1) if m else ""


def check(body):
    """(missing, notes): what is missing, and remarks that do not fail the check."""
    text = re.sub(r"<!--.*?-->", "", body or "", flags=re.S)   # the template's hints
    missing, notes = [], []

    author = field(text, "Author")
    model = field(text, "AI model")
    review = field(text, "Human review")
    if author is None and model is None:
        missing.append("the disclosure block (Author, AI model, AI tool, AI role, Human review)")
    else:
        if placeholder(author):
            missing.append("who wrote it, in `Author:` (Human, AI agent, or Human with AI assistance)")
        if placeholder(model):
            missing.append("the exact AI model and version, or \"none\", in `AI model:`")
        elif author and re.search(r"\bAI\b", author) and re.fullmatch(r"(none|n/?a|-)?", model.lower().strip(" .`\"")):
            missing.append("the exact AI model in `AI model:`, since `Author:` says an AI took part")
        if placeholder(review):
            missing.append("whether a person checked it, in `Human review:` (yes or no)")

    tested = section(text, "How it was tested") or text
    if re.search(r"\d+%\s+tests\s+passed|tests passed,\s*\d+\s+tests? failed|\b\d+ checks?, 0 failed", text, re.I):
        pass
    elif re.search(r"\bnot\s+run\b", tested, re.I):
        notes.append("the tests were not run, as the description says; CI runs them")
    else:
        missing.append("test output: the `ctest` summary line pasted verbatim, or \"not run\" if you did not run them")

    check_pr = load_check_pr()
    lines = [n for n, line in enumerate(text.splitlines(), 1) if check_pr.ai_directed(line)]
    if lines:
        missing.append("nothing addressed to an AI reviewer or agent: line %s reads as an order to the reviewing bot"
                       % ", ".join(str(n) for n in lines[:5]))
    return missing, notes


def main(argv):
    body = os.environ.get("PR_BODY")
    if body is None:
        body = sys.stdin.read()
    missing, notes = check(body)
    for item in missing:
        print("missing: " + item)
    for item in notes:
        print("note: " + item)
    if not missing:
        print("the description has the disclosure block and test evidence")
    if "--github" in argv and os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("## Disclosure and test evidence\n\n")
            if missing:
                f.write("docs/CONTRIBUTING.md asks every pull request description for these, and this one does not have them yet:\n\n")
                f.write("".join("- %s\n" % m for m in missing))
                f.write("\nEdit the description to add them (the pull request template shows where); this check runs again by itself.\n")
            else:
                f.write("The description has the disclosure block and test evidence.\n")
            if notes:
                f.write("\n" + "".join("- %s\n" % n for n in notes))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

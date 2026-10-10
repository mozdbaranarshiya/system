#!/usr/bin/env python3
"""Fixed-origin, read-only school OAuth client. Credentials never enter argv."""

import argparse
import json
import math
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request


BASE_URL = "https://efibfevyiepkwpnobaro.supabase.co/functions/v1/oauth-connector"
TOKEN_BINDING = "SYSTEM_SCHOOL_ACCESS_TOKEN"
MAX_RESPONSE_BYTES = 1024 * 1024
TIMEOUT_SECONDS = 20
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
ACCESS_TOKEN = re.compile(r"soa_[A-Za-z0-9_-]{43}")
CREDENTIAL = re.compile(r"(?:soa_|sor_|soc_|scs_)[A-Za-z0-9_-]{43}")
FIELDS = {
    "me": ("id", "display_name"),
    "classes": ("id", "title", "grade_id", "academic_year"),
    "grades": ("id", "student_id", "class_id", "subject_id", "period", "continuous_score", "final_score", "lesson_score"),
    "assignments": ("id", "title", "description", "class_id", "subject_id", "due_at"),
}
MESSAGES = {
    "invalid_request": "Choose a supported read operation and valid filters; no URL or credential arguments are accepted.",
    "oauth_binding_required": "The runtime must provide the connected user's secure OAuth access-token binding. Do not paste a token in chat.",
    "invalid_oauth_binding": "The secure runtime binding is not a school OAuth access token. Use the supported OAuth connection flow.",
    "reconnect_required": "The account connection expired or was revoked. Use the platform's supported OAuth reconnect flow.",
    "access_denied": "The connected account lacks the required scope or current resource permission.",
    "rate_limited": "The school service rate limit was reached; do not retry in a loop.",
    "service_unavailable": "The school OAuth service is unavailable or its deployment prerequisites are incomplete.",
    "redirect_refused": "The fixed school endpoint returned a redirect; the credential was not forwarded.",
    "invalid_response": "The school endpoint returned an unexpected response; no raw body or headers were displayed.",
}


class SafeError(Exception):
    """Contains only an allowlisted public error code."""

    def __init__(self, code):
        self.code = code if code in MESSAGES else "service_unavailable"
        super().__init__(self.code)


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise SafeError("invalid_request")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def refuse(self, _request, _response, _code, _message, _headers):
        raise SafeError("redirect_refused")

    http_error_301 = refuse
    http_error_302 = refuse
    http_error_303 = refuse
    http_error_307 = refuse
    http_error_308 = refuse


def arguments(argv):
    option_names = [part.split("=", 1)[0] for part in argv if part.startswith("--")]
    if len(set(option_names)) != len(option_names):
        raise SafeError("invalid_request")
    parser = SafeParser(description="Read permitted school data using a secure, runtime-managed OAuth binding.", allow_abbrev=False)
    parser.add_argument("resource", choices=tuple(FIELDS))
    parser.add_argument("--class-id")
    parser.add_argument("--student-id")
    parser.add_argument("--subject-id")
    parser.add_argument("--limit")
    parser.add_argument("--offset")
    args = parser.parse_args(argv)
    filters = {}
    for key in ("class_id", "student_id", "subject_id"):
        value = getattr(args, key)
        if value is not None:
            if args.resource == "me" or (args.resource == "classes" and key == "subject_id") or not UUID.fullmatch(value):
                raise SafeError("invalid_request")
            filters[key] = value
    for key, lower, upper in (("limit", 1, 100), ("offset", 0, 10000)):
        value = getattr(args, key)
        if value is not None:
            if args.resource == "me" or not re.fullmatch(r"[0-9]{1,5}", value) or not lower <= int(value) <= upper:
                raise SafeError("invalid_request")
            filters[key] = str(int(value))
    return args.resource, filters


def project_row(resource, row):
    if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not UUID.fullmatch(row["id"]):
        raise SafeError("invalid_response")
    projected = {}
    for key in FIELDS[resource]:
        if key not in row:
            raise SafeError("invalid_response")
        value = row[key]
        if value is not None and not isinstance(value, (str, int, float)):
            raise SafeError("invalid_response")
        if isinstance(value, bool) or (isinstance(value, float) and not math.isfinite(value)):
            raise SafeError("invalid_response")
        projected[key] = value
    if resource == "me" and not isinstance(projected["display_name"], str):
        raise SafeError("invalid_response")
    return projected


def project_response(resource, value):
    if not isinstance(value, dict) or "error" in value:
        raise SafeError("invalid_response")
    if resource == "me":
        result = project_row(resource, value)
    else:
        rows, offset, limit = value.get("rows"), value.get("offset"), value.get("limit")
        if not isinstance(rows, list) or type(offset) is not int or type(limit) is not int or not 0 <= offset <= 10000 or not 1 <= limit <= 100 or len(rows) > limit:
            raise SafeError("invalid_response")
        result = {"rows": [project_row(resource, row) for row in rows], "offset": offset, "limit": limit}
    rendered = json.dumps(result, ensure_ascii=False, allow_nan=False)
    if CREDENTIAL.search(rendered):
        raise SafeError("invalid_response")
    return result


def read(resource, filters):
    # Input remains constrained even if this module is called programmatically.
    if resource not in FIELDS:
        raise SafeError("invalid_request")
    command = [resource]
    for name, value in filters.items():
        if name not in ("class_id", "student_id", "subject_id", "limit", "offset") or not isinstance(value, str):
            raise SafeError("invalid_request")
        command += ["--" + name.replace("_", "-"), value]
    resource, filters = arguments(command)
    token = os.environ.get(TOKEN_BINDING)
    if not token:
        raise SafeError("oauth_binding_required")
    if not ACCESS_TOKEN.fullmatch(token):
        raise SafeError("invalid_oauth_binding")
    url = BASE_URL + "/api/" + resource
    if filters:
        url += "?" + urllib.parse.urlencode(filters)
    request = urllib.request.Request(url, method="GET", headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "Accept-Encoding": "identity",
    })
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()), NoRedirect())
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise SafeError("invalid_response")
            if response.headers.get_content_type() != "application/json" or response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise SafeError("invalid_response")
            length = response.headers.get("Content-Length")
            if length is not None and (not re.fullmatch(r"[0-9]+", length) or len(length) > 8 or int(length) > MAX_RESPONSE_BYTES):
                raise SafeError("invalid_response")
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise SafeError("invalid_response")
            value = json.loads(payload.decode("utf-8"))
            return project_response(resource, value)
    except urllib.error.HTTPError as error:
        # Never read, render, or log an error's body, headers, URL, or reason.
        if 300 <= error.code < 400:
            raise SafeError("redirect_refused") from None
        code = {400: "invalid_request", 401: "reconnect_required", 403: "access_denied", 429: "rate_limited"}.get(error.code, "service_unavailable")
        raise SafeError(code) from None
    except (UnicodeError, ValueError, RecursionError):
        raise SafeError("invalid_response") from None
    except (urllib.error.URLError, OSError):
        raise SafeError("service_unavailable") from None


def main(argv=None):
    try:
        resource, filters = arguments(sys.argv[1:] if argv is None else argv)
        result = read(resource, filters)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except SafeError as error:
        print(json.dumps({"error": error.code, "message": MESSAGES[error.code]}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception:
        # Unexpected runtime failures must not expose a traceback or credentials.
        print(json.dumps({"error": "service_unavailable", "message": MESSAGES["service_unavailable"]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

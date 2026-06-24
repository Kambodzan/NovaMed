# Pusty stan: żaden endpoint odczytu nie powinien 500-ować, gdy konto nie ma
# jeszcze danych (świeży pacjent/personel po provisioningu). Regresja do obserwacji,
# że /appointments/my sypał 500 na koncie bez wizyt.
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import auth_header


def _no_param_get_routes() -> list[str]:
    """Wszystkie ścieżki GET bez parametrów {…} (da się je zawołać bez kontekstu)."""
    paths = set()
    for r in app.routes:
        methods = getattr(r, "methods", None) or set()
        if "GET" in methods and "{" not in getattr(r, "path", "{"):
            paths.add(r.path)
    return sorted(paths)


def _bare_users(factory) -> dict:
    """Gołe konto każdej roli (bez wizyt/dokumentów/placówek)."""
    pac, pac_t = factory.patient()
    doc, doc_t = factory.doctor()
    nur, nur_t = factory.user("pielegniarka")
    rej, rej_t = factory.user("rejestracja")
    kie, kie_t = factory.user("kierownik")
    adm, adm_t = factory.user("administrator")
    return {
        "pacjent": pac_t, "lekarz": doc_t, "pielegniarka": nur_t,
        "rejestracja": rej_t, "kierownik": kie_t, "administrator": adm_t,
    }


def _hit(client, path, headers):
    try:
        return client.get(path, headers=headers).status_code
    except Exception as exc:  # 500 z TestClient (raise_server_exceptions=True) leci jako wyjątek
        return f"EXC:{type(exc).__name__}: {str(exc)[:160]}"


def test_empty_account_no_500(client, factory, capsys):
    tokens = _bare_users(factory)
    routes = _no_param_get_routes()
    failures = []
    for role, tok in tokens.items():
        for path in routes:
            st = _hit(client, path, auth_header(tok))
            crash = (isinstance(st, str) and st.startswith("EXC")) or (isinstance(st, int) and st >= 500)
            if crash:
                failures.append(f"[{role}] GET {path} -> {st}")
    if failures:
        print("\n=== 500 NA PUSTYM KONCIE ===")
        for f in failures:
            print(" ", f)
    assert not failures, f"{len(failures)} endpointow 500-uje na pustym koncie (szczegoly wyzej)"

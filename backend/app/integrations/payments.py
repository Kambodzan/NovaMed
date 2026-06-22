# Port + adapter HTTP do operatora płatności.
# W realnej integracji (P24/PayU/Stripe) potwierdzenie przychodzi webhookiem;
# w mocku backend sam wywołuje confirm (symulacja autoryzacji klienta).
from typing import Protocol

import httpx

from app.core.config import settings
from app.integrations.base import IntegrationError


class PaymentsClient(Protocol):
    def create_payment(self, *, amount: float, reference: str) -> str:
        """Zwraca id płatności u operatora."""
        ...

    def confirm(self, *, provider_ref: str, outcome: str) -> str:
        """Symulacja autoryzacji (mock). Zwraca status: PAID / FAILED."""
        ...

    def get_status(self, *, provider_ref: str) -> str: ...

    def issue_invoice(self, *, amount: float, reference: str, buyer: str | None = None) -> str:
        """Mini-mock fakturowania — zwraca numer faktury (FV/rok/nr)."""
        ...


class HttpPaymentsClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or settings.payments_base_url).rstrip("/")
        self.timeout = timeout

    def _req(self, method: str, path: str, json: dict | None = None) -> dict:
        try:
            resp = httpx.request(method, f"{self.base_url}{path}", json=json, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z operatorem płatności. Spróbuj ponownie.") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except ValueError:
                detail = resp.text
            raise IntegrationError(f"Operator płatności: {detail}")
        return resp.json()

    def create_payment(self, *, amount: float, reference: str) -> str:
        return self._req("POST", "/api/v1/payments", {"amount": amount, "reference": reference})["payment_id"]

    def confirm(self, *, provider_ref: str, outcome: str) -> str:
        return self._req("POST", f"/api/v1/payments/{provider_ref}/confirm", {"outcome": outcome})["status"]

    def get_status(self, *, provider_ref: str) -> str:
        return self._req("GET", f"/api/v1/payments/{provider_ref}")["status"]

    def issue_invoice(self, *, amount: float, reference: str, buyer: str | None = None) -> str:
        return self._req("POST", "/api/v1/invoices",
                         {"amount": amount, "reference": reference, "buyer": buyer})["invoice_number"]


def get_payments_client() -> PaymentsClient:
    return HttpPaymentsClient()

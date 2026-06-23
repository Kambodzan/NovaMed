# Powiadomienia domenowe (UC-P7): zapis do tabeli notification przy zdarzeniach
# + kanały SMS i e-mail (best-effort; mock bramki w dev). Adres/numer z konta.
from uuid import UUID
from sqlalchemy.orm import Session

from sqlalchemy import select

from app.integrations.email import get_email_client
from app.integrations.push import get_push_client
from app.integrations.sms import get_sms_client
from app.models import AppUser, Notification, Patient, PushToken


def notify(db: Session, user_id: UUID, title: str, content: str, *,
           email: bool = False, sms: bool = True, push: bool = True) -> None:
    """Dopisuje powiadomienie w ramach bieżącej transakcji wywołującego.
    SMS wysyłany od razu (poza transakcją DB) — jego awaria niczego nie psuje.
    Powiadomienia podopiecznego (konta rodzinne) trafiają do opiekuna —
    podopieczny nie loguje się sam.

    Kanały poza in-app są zawężane wg wartości zdarzenia:
    - **in-app** (dzwonek) — ZAWSZE (pełna historia).
    - **push** (`push`, domyślnie True) — na zarejestrowane urządzenia mobilne
      (apka pacjenta); idzie do TEGO SAMEGO adresata co in-app (po przekierowaniu
      podopieczny→opiekun). Cichy no-op, gdy adresat nie ma tokenów (np. tylko web).
    - **SMS** (`sms`, domyślnie True) — szeroki, ale wyłączany dla przejściowego
      szumu, który adresat i tak widzi na ekranie (odrzucona płatność, wygasła
      rezerwacja) lub który jest kolejką pracy personelu (wynik do opisania).
    - **e-mail** (`email`, domyślnie False) — WHITELISTA: tylko rzeczy trwałe/ważne
      (potwierdzenie/zmiana/przypomnienie wizyty, link do teleporady, nowy dokument)."""
    patient = db.get(Patient, user_id)
    if patient is not None and patient.guardian_id is not None:
        content = f"[{patient.first_name} {patient.last_name}] {content}"
        user_id = patient.guardian_id
    db.add(Notification(
        user_id=user_id,
        notification_title=title[:100],
        notification_content=content,
        is_read=False,
    ))
    user = db.get(AppUser, user_id)
    # push — na urządzenia mobilne adresata (best-effort, poza transakcją DB)
    if push:
        tokens = list(db.scalars(select(PushToken.token).where(PushToken.user_id == user_id)))
        if tokens:
            get_push_client().send(tokens=tokens, title=title, body=content,
                                   data={"kind": "notification"})
    if sms and user is not None and user.phone_number and user.notify_sms:
        get_sms_client().send(to=user.phone_number, message=f"NovaMed: {title}. {content}")
    # e-mail — tylko dla zdarzeń z whitelisty (email=True); best-effort, gdy konto ma adres
    if email and user is not None and user.email:
        get_email_client().send(to=user.email, subject=f"NovaMed: {title}", body=content)

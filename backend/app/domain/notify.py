# Powiadomienia domenowe (UC-P7): zapis do tabeli notification przy zdarzeniach
# + kanały SMS i e-mail (best-effort; mock bramki w dev). Adres/numer z konta.
from uuid import UUID
from sqlalchemy.orm import Session

from app.integrations.email import get_email_client
from app.integrations.sms import get_sms_client
from app.models import AppUser, Notification, Patient


def notify(db: Session, user_id: UUID, title: str, content: str, *, email: bool = False) -> None:
    """Dopisuje powiadomienie w ramach bieżącej transakcji wywołującego.
    SMS wysyłany od razu (poza transakcją DB) — jego awaria niczego nie psuje.
    Powiadomienia podopiecznego (konta rodzinne) trafiają do opiekuna —
    podopieczny nie loguje się sam.

    Kanał e-mail jest WHITELISTĄ: domyślnie wyłączony, włącza go `email=True`
    tylko przy zdarzeniach wartych skrzynki (potwierdzenie/zmiana/przypomnienie
    wizyty, link do teleporady, nowy dokument). Reszta zostaje w aplikacji + SMS —
    inaczej mail puchnie od proceduralnych powiadomień (odrzucona płatność itp.)."""
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
    if user is not None and user.phone_number and user.notify_sms:
        get_sms_client().send(to=user.phone_number, message=f"NovaMed: {title}. {content}")
    # e-mail — tylko dla zdarzeń z whitelisty (email=True); best-effort, gdy konto ma adres
    if email and user is not None and user.email:
        get_email_client().send(to=user.email, subject=f"NovaMed: {title}", body=content)

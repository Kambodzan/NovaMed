# Generowanie PDF dokumentu medycznego (UC-P4: „pobieranie wyników w formacie PDF").
# Polskie znaki: rejestrujemy systemowy Arial (Windows); fallback Helvetica
# (na maszynach bez Ariala znaki diakrytyczne mogą się zdegradować — dev/demo OK).
from io import BytesIO
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT, FONT_BOLD = "Helvetica", "Helvetica-Bold"
_arial = Path("C:/Windows/Fonts/arial.ttf")
_arial_bold = Path("C:/Windows/Fonts/arialbd.ttf")
if _arial.exists():
    pdfmetrics.registerFont(TTFont("PL", str(_arial)))
    FONT = "PL"
    if _arial_bold.exists():
        pdfmetrics.registerFont(TTFont("PL-Bold", str(_arial_bold)))
        FONT_BOLD = "PL-Bold"
    else:
        FONT_BOLD = "PL"

TEAL = (0.05, 0.58, 0.53)  # primary #0D9488


def render_document_pdf(*, doc_label: str, patient_name: str, pesel: str,
                        doctor_name: str, issued_at: str, status_label: str,
                        code: str | None, details: str | None,
                        clinic_name: str = "NovaMed — Uniwersalny Portal Medyczny") -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    # nagłówek
    c.setFillColorRGB(*TEAL)
    c.rect(0, height - 28 * mm, width, 28 * mm, fill=True, stroke=False)
    c.setFillColorRGB(1, 1, 1)
    c.setFont(FONT_BOLD, 18)
    c.drawString(20 * mm, height - 16 * mm, "NovaMed")
    c.setFont(FONT, 9)
    c.drawString(20 * mm, height - 22 * mm, clinic_name)

    y = height - 42 * mm
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont(FONT_BOLD, 15)
    c.drawString(20 * mm, y, doc_label)
    y -= 12 * mm

    c.setFont(FONT, 10)
    rows = [
        ("Pacjent", f"{patient_name}  (PESEL: {pesel})"),
        ("Wystawił", doctor_name),
        ("Data wystawienia", issued_at),
        ("Status", status_label),
    ]
    if code:
        rows.append(("Kod dokumentu", code))
    for label, value in rows:
        c.setFillColorRGB(0.45, 0.45, 0.45)
        c.drawString(20 * mm, y, label)
        c.setFillColorRGB(0.1, 0.1, 0.1)
        c.drawString(60 * mm, y, value)
        y -= 7 * mm

    y -= 4 * mm
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.line(20 * mm, y, width - 20 * mm, y)
    y -= 10 * mm

    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.setFont(FONT, 9)
    c.drawString(20 * mm, y, "TREŚĆ DOKUMENTU")
    y -= 7 * mm
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont(FONT, 11)
    for line in simpleSplit(details or "—", FONT, 11, width - 40 * mm):
        c.drawString(20 * mm, y, line)
        y -= 6 * mm
        if y < 30 * mm:
            c.showPage()
            y = height - 30 * mm
            c.setFont(FONT, 11)

    c.setFont(FONT, 8)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.drawString(20 * mm, 15 * mm, "Dokument wygenerowany elektronicznie w systemie NovaMed — nie wymaga podpisu.")
    c.save()
    return buf.getvalue()


def render_report_pdf(*, clinic_name: str, month: str, total_booked: int, completed: int,
                      cancelled: int, no_show: int, online_share_pct: float,
                      per_doctor: list[tuple[str, int, int]]) -> bytes:
    """Raport miesięczny poradni w PDF (UC-PP4)."""
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    c.setFillColorRGB(*TEAL)
    c.rect(0, height - 28 * mm, width, 28 * mm, fill=True, stroke=False)
    c.setFillColorRGB(1, 1, 1)
    c.setFont(FONT_BOLD, 18)
    c.drawString(20 * mm, height - 16 * mm, "NovaMed — raport poradni")
    c.setFont(FONT, 9)
    c.drawString(20 * mm, height - 22 * mm, f"{clinic_name} · miesiąc {month}")

    y = height - 44 * mm
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.setFont(FONT_BOLD, 13)
    c.drawString(20 * mm, y, "Podsumowanie")
    y -= 10 * mm
    c.setFont(FONT, 11)
    for label, value in [
        ("Wizyty (z pacjentem)", str(total_booked)),
        ("Zakończone", str(completed)),
        ("Odwołane", str(cancelled)),
        ("Nieodbyte (no-show)", str(no_show)),
        ("Udział teleporad", f"{online_share_pct}%"),
    ]:
        c.setFillColorRGB(0.45, 0.45, 0.45)
        c.drawString(20 * mm, y, label)
        c.setFillColorRGB(0.1, 0.1, 0.1)
        c.drawString(80 * mm, y, value)
        y -= 7 * mm

    y -= 6 * mm
    c.setFont(FONT_BOLD, 13)
    c.drawString(20 * mm, y, "Obłożenie lekarzy")
    y -= 9 * mm
    c.setFont(FONT_BOLD, 9)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.drawString(20 * mm, y, "LEKARZ")
    c.drawString(120 * mm, y, "WIZYTY")
    c.drawString(150 * mm, y, "ZAKOŃCZONE")
    y -= 6 * mm
    c.setFont(FONT, 11)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    for name, booked, done in per_doctor:
        c.drawString(20 * mm, y, name[:55])
        c.drawString(120 * mm, y, str(booked))
        c.drawString(150 * mm, y, str(done))
        y -= 7 * mm
        if y < 30 * mm:
            c.showPage()
            y = height - 30 * mm
            c.setFont(FONT, 11)

    c.setFont(FONT, 8)
    c.setFillColorRGB(0.55, 0.55, 0.55)
    c.drawString(20 * mm, 15 * mm, f"Wygenerowano w systemie NovaMed.")
    c.save()
    return buf.getvalue()

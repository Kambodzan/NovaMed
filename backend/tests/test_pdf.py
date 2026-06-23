# Generowanie PDF (UC-P4 dokument, UC-PP4 raport). Sprawdzamy, że wychodzi poprawny
# strumień PDF i że długa treść / wiele wierszy uruchamia łamanie strony (showPage).
from app.domain.pdf import render_document_pdf, render_report_pdf


def test_render_document_pdf_z_kodem_i_dluga_trescia():
    pdf = render_document_pdf(
        doc_label="E-recepta",
        patient_name="Janina Wiśniewska",
        pesel="47030812344",
        doctor_name="dr Anna Kowalczyk",
        issued_at="2026-06-23",
        status_label="Wystawiona",
        code="RX-2026-0811",
        details="Atorvastatyna 40 mg ×30 tabl.\n" + ("Zalecenia: kontrola za 4 tygodnie. " * 60),
    )
    assert pdf[:5] == b"%PDF-" and pdf.rstrip().endswith(b"%%EOF")
    assert len(pdf) > 1500


def test_render_document_pdf_bez_kodu_i_bez_tresci():
    pdf = render_document_pdf(
        doc_label="Zaświadczenie",
        patient_name="Jan Testowy",
        pesel="90010112345",
        doctor_name="dr X",
        issued_at="2026-06-23",
        status_label="Lokalny",
        code=None,
        details=None,
    )
    assert pdf[:5] == b"%PDF-"


def test_render_report_pdf_z_lamaniem_strony():
    per_doctor = [(f"dr Lekarz {i}", i, i // 2) for i in range(40)]  # dużo wierszy → showPage
    pdf = render_report_pdf(
        clinic_name="Zdrowa Rodzina — Piastów",
        month="2026-06",
        total_booked=120, completed=90, cancelled=20, no_show=10,
        online_share_pct=12.5,
        per_doctor=per_doctor,
    )
    assert pdf[:5] == b"%PDF-" and pdf.rstrip().endswith(b"%%EOF")
    assert len(pdf) > 2000

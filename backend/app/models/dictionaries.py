# Słowniki: ICD-10 i leki (podpowiedzi przy wystawianiu dokumentów) —
# ROZSZERZENIE względem oryginalnego ERD.
# Dane ładowane importerem (scripts/import-dictionaries.py): startowy zestaw
# z repo lub pełne oficjalne CSV (RPL / NFZ).
import uuid

from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Icd10Entry(Base):
    __tablename__ = "icd10_dict"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))


class MedicationEntry(Base):
    __tablename__ = "medication_dict"

    med_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))      # nazwa handlowa
    form: Mapped[str | None] = mapped_column(String(100))   # postać (tabl., syrop…)
    strength: Mapped[str | None] = mapped_column(String(100))  # moc (np. 5 mg)

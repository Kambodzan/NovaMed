"""szyfrowanie at-rest: pesel_bidx + zaszyfrowanie istniejących danych wrażliwych

Revision ID: f2b593804756
Revises: 5958ff9dcb7e
Create Date: 2026-06-23 09:12:51.864275

Dodaje blind index PESEL i zmienia typ kolumny `pesel` na TEXT (szyfrogram jest dłuższy
niż 11 znaków), a następnie SZYFRUJE istniejące dane wrażliwe w bazie (AES-256-GCM) i
backfilluje `pesel_bidx`. Idempotentna — pomija wartości już zaszyfrowane (`enc:v1:`).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.crypto import blind_index, decrypt, encrypt

revision: str = 'f2b593804756'
down_revision: Union[str, None] = '5958ff9dcb7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (tabela, kolumna) — wszystkie pola szyfrowane at-rest
ENCRYPTED_COLUMNS = [
    ("patient", "pesel"),
    ("patient", "allergies"),
    ("patient", "chronic_diseases"),
    ("patient", "chronic_medications"),
    ("medical_document", "document_content"),
    ("clinical_note", "content"),
    ("note_addendum", "content"),
    ("note_event", "content_snapshot"),
    ("lab_result", "values_json"),
    ("certificate", "content"),
]


def _transform_column(conn, table, col, fn):
    rows = conn.execute(sa.text(
        f"SELECT ctid, {col} AS v FROM {table} WHERE {col} IS NOT NULL")).fetchall()
    for ctid, v in rows:
        conn.execute(sa.text(f"UPDATE {table} SET {col} = :e WHERE ctid = :c"),
                     {"e": fn(v), "c": ctid})


def upgrade() -> None:
    op.add_column('patient', sa.Column('pesel_bidx', sa.String(length=64), nullable=True))
    op.alter_column('patient', 'pesel',
                    existing_type=sa.VARCHAR(length=11), type_=sa.Text(), existing_nullable=False)
    op.create_index(op.f('ix_patient_pesel_bidx'), 'patient', ['pesel_bidx'], unique=False)

    conn = op.get_bind()
    # backfill blind index z JAWNEGO PESEL-u (zanim zaszyfrujemy kolumnę pesel)
    for ctid, pesel in conn.execute(sa.text("SELECT ctid, pesel FROM patient WHERE pesel IS NOT NULL")).fetchall():
        plain = decrypt(pesel) if pesel.startswith("enc:v1:") else pesel
        conn.execute(sa.text("UPDATE patient SET pesel_bidx = :b WHERE ctid = :c"),
                     {"b": blind_index(plain), "c": ctid})
    # zaszyfruj istniejące wartości (pomijając już zaszyfrowane → idempotentne)
    for table, col in ENCRYPTED_COLUMNS:
        _transform_column(conn, table, col, lambda v: v if v.startswith("enc:v1:") else encrypt(v))


def downgrade() -> None:
    conn = op.get_bind()
    for table, col in ENCRYPTED_COLUMNS:
        _transform_column(conn, table, col, lambda v: decrypt(v) if v.startswith("enc:v1:") else v)
    op.drop_index(op.f('ix_patient_pesel_bidx'), table_name='patient')
    op.alter_column('patient', 'pesel',
                    existing_type=sa.Text(), type_=sa.VARCHAR(length=11), existing_nullable=False)
    op.drop_column('patient', 'pesel_bidx')

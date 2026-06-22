"""drop doctor.slot_duration_min — długość wizyty per lekarz wycofana

Po przejściu na model „atom + wielokrotność" długość wizyty NIE jest per lekarz —
obowiązuje siatka placówki. Kolumna była już nieużywana; usuwamy ją całkowicie.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-06-22

"""
from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("doctor", "slot_duration_min")


def downgrade() -> None:
    op.add_column("doctor", sa.Column("slot_duration_min", sa.Integer(), nullable=True))

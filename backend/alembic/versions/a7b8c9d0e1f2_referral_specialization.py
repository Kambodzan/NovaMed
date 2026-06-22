"""referral.specialization — cel skierowania do specjalisty

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-22

Skierowanie SPECIALIST nie miało gdzie zapisać, do jakiej specjalizacji kieruje
lekarz (było tylko wolne `notes`). Dokładamy kolumnę `specialization` (nullable —
dotyczy tylko skierowań do specjalisty; NURSING/LAB jej nie używają).
"""
import sqlalchemy as sa

from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("referral", sa.Column("specialization", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("referral", "specialization")

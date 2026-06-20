"""service.allow_online — czy usługę można odbyć jako teleporadę

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-21

Konsultacja może być teleporadą, badanie (USG/echo) nie. Slot usługowy dziedziczy
tę flagę, więc pacjent przy konsultacji-usłudze może wybrać wideo.
"""
import sqlalchemy as sa
from alembic import op

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("service", sa.Column("allow_online", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("service", "allow_online")

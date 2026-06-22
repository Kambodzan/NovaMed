"""staff_clinic.room — stały gabinet lekarza w danej placówce

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-22

Gabinet, w którym lekarz przyjmuje w danej placówce — ustawiany raz (kierownik/
admin), używany przy meldowaniu pacjenta (recepcja nie wpisuje go ręcznie).
"""
import sqlalchemy as sa

from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("staff_clinic", sa.Column("room", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("staff_clinic", "room")

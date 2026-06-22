"""appointment.checked_in_at + room — meldowanie pacjenta przez recepcję

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-22

Recepcja melduje przybyłego pacjenta (checked_in_at) i przydziela gabinet (room),
żeby lekarz w „Mój dzień" widział, że pacjent czeka, a pacjent wiedział, gdzie iść.
"""
import sqlalchemy as sa

from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointment", sa.Column("checked_in_at", sa.DateTime(), nullable=True))
    op.add_column("appointment", sa.Column("room", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("appointment", "room")
    op.drop_column("appointment", "checked_in_at")

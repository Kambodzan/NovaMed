"""appointment.teleporada_link_sent — flaga przypomnienia teleporady tuż przed startem

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-06-22

"""
from alembic import op
import sqlalchemy as sa

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointment", sa.Column(
        "teleporada_link_sent", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("appointment", "teleporada_link_sent")
